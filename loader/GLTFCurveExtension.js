import * as THREE from 'three/webgpu';
import { NURBSCurve } from 'three/examples/jsm/curves/NURBSCurve.js';

let _index = 0;
class GLTFCurveExtension {
  constructor(parser) {
    this.parser = parser;
    this.name = 'UTSUBO_curve_extension';
  }

  // Helper: find an existing Line/LineSegments under a node
  findExistingLine(object3D) {
    if (!object3D || typeof object3D.traverse !== 'function') return null;
    let found = null;
    object3D.traverse((o) => {
      if (found) return;
      // isLine is standard on three.js Line; also check type for safety
      if (o && (o.isLine || o.type === 'Line' || o.type === 'LineSegments')) {
        found = o;
      }
    });
    return found;
  }

  afterRoot(result) {
    const parser = this.parser;
    const json = parser.json;

    if (json.nodes) {
      // Wait for all nodes to be loaded before processing curves
      return parser.getDependencies('node').then((nodes) => {
        return this.createCurves(json.nodes, result, nodes);
      });
    }

    return null;
  }

  createCurves(nodeDefs, result, loadedNodes) {
    const pending = [];

    // Precompute which nodes have the curve extension
    const nodeCount = nodeDefs.length;
    const nodeHasCurveExt = new Array(nodeCount).fill(false);
    for (let i = 0; i < nodeCount; i++) {
      const nd = nodeDefs[i];
      nodeHasCurveExt[i] = !!(nd && nd.extensions && nd.extensions[this.name]);
    }

    // Build parent lists for each node
    const parents = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) parents[i] = [];
    for (let i = 0; i < nodeCount; i++) {
      const nd = nodeDefs[i];
      if (nd && Array.isArray(nd.children)) {
        for (const childIndex of nd.children) {
          if (childIndex >= 0 && childIndex < nodeCount) parents[childIndex].push(i);
        }
      }
    }

    // Mark all ancestors of nodes-with-extension
    const hasDescendantCurveExt = new Array(nodeCount).fill(false);
    for (let i = 0; i < nodeCount; i++) {
      if (!nodeHasCurveExt[i]) continue;
      const stack = parents[i].slice();
      const seen = new Set();
      while (stack.length) {
        const p = stack.pop();
        if (p == null || seen.has(p)) continue;
        seen.add(p);
        hasDescendantCurveExt[p] = true;
        for (const pp of parents[p]) stack.push(pp);
      }
    }

    // Create curves only for nodes that have the extension and are not ancestors of another extension node
    for (let i = 0; i < nodeDefs.length; i++) {
      const nodeDef = nodeDefs[i];
      if (!nodeDef) continue;
      if (!nodeHasCurveExt[i]) continue;
      if (hasDescendantCurveExt[i]) continue; // avoid duplicates at collection/root levels

      // Only generate for leaf nodes or nodes with a mesh; skip pure group/container nodes
      const isLeaf = !Array.isArray(nodeDef.children) || nodeDef.children.length === 0;
      const hasMesh = nodeDef.mesh !== undefined;
      if (!isLeaf && !hasMesh) continue;

      // If a Line already exists under this node in the loaded graph, skip creating another
      const existing = loadedNodes && loadedNodes[i]
        ? this.findExistingLine(loadedNodes[i])
        : null;
      if (existing) continue;

      pending.push(this.createCurve(nodeDef, result, i, loadedNodes[i]));
    }

    return Promise.all(pending);
  }

  createCurve(nodeDef, result, nodeIndex, loadedNode) {
    const curveData = nodeDef.extensions[this.name];
    const curves = [];

    curveData.splines.forEach((spline) => {
      let curve;

      if (spline.type === 'BEZIER') {
        const points = spline.points.map((point) =>
          this.convertBlenderToThreeCoordinates(point.co)
        );
        const handles1 = spline.points.map((point) =>
          this.convertBlenderToThreeCoordinates(point.handle_left)
        );
        const handles2 = spline.points.map((point) =>
          this.convertBlenderToThreeCoordinates(point.handle_right)
        );


        if (points.length === 2) {
          curve = new THREE.CubicBezierCurve3(
            points[0],
            handles2[0],
            handles1[1],
            points[1]
          );
        } else {
          curve = new THREE.CurvePath();
          for (let i = 0; i < points.length - 1; i++) {
            const bezierCurve = new THREE.CubicBezierCurve3(
              points[i],
              handles2[i],
              handles1[i + 1],
              points[i + 1]
            );
            // @ts-ignore - JS context, acceptable for CurvePath of Vector3
            curve.curves.push(bezierCurve);
          }

          if (spline.use_cyclic_u) {
            const lastIndex = points.length - 1;
            const bezierCurve = new THREE.CubicBezierCurve3(
              points[lastIndex],
              handles2[lastIndex],
              handles1[0],
              points[0]
            );
            // @ts-ignore - JS context, acceptable for CurvePath of Vector3
            curve.curves.push(bezierCurve);
            curve.curves[0].v0 = points[0].clone(); // Ensure the first point is connected
          }
        }
      } else if (spline.type === 'NURBS') {
        curve = this.createNURBSCurvePath(spline);
      } else {
        // Poly curve (linear)
        const points = spline.points.map((point) =>
          this.convertBlenderToThreeCoordinates(point.co)
        );
        curve = new THREE.CatmullRomCurve3(points, spline.use_cyclic_u);
      }

      if (curve) {
        curves.push(curve);
      }
    });

    // Create a single CurvePath if there are multiple splines
    let finalCurve = curves[0];
    if (curves.length > 1) {
      finalCurve = new THREE.CurvePath();
      curves.forEach((c) => finalCurve.add(c));
    }


    // Create a visible line for the curve
    const points = finalCurve.getPoints(
      curveData.splines[0].resolution_u * 10 || 100
    );

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xffffff });
    const curveObject = new THREE.Line(geometry, material);
    curveObject.name = nodeDef.name ? `${nodeDef.name}_curve` : `curve_${_index++}`;
    
    // Store the curve data on the object for future use
    curveObject.userData.curve = finalCurve;
    curveObject.userData.sourceNodeIndex = nodeIndex;

    // Set up associations as in the official GLTFLoader
    if (!this.parser.associations.has(curveObject)) {
      this.parser.associations.set(curveObject, {});
    }
    this.parser.associations.get(curveObject).nodes = nodeIndex;

    // Use loadedNode instead of finding it in the scene
    return Promise.resolve(curveObject).then((curveObject) => {
      this.replaceCurveInScene(result, curveObject, loadedNode, nodeIndex);
      return curveObject;
    });
  }

  convertBlenderToThreeCoordinates(coord) {
    return new THREE.Vector3(coord[0], coord[2], -coord[1]);
  }


  replaceCurveInScene(result, curveObject, originalNode, nodeIndex) {
    if (originalNode && originalNode.parent) {
      const parent = originalNode.parent;

      // If the parent already has a Line representing this node, skip adding another
      const hasDuplicate = parent.children.some((o) => {
        if (!o || !(o.isLine || o.type === 'Line' || o.type === 'LineSegments')) return false;
        const sameName = o.name === originalNode.name || o.name === curveObject.name;
        const sameSource = o.userData && o.userData.sourceNodeIndex === nodeIndex;
        return sameName || sameSource;
      });
      if (hasDuplicate) return;

      // Copy transformation so the curve aligns with the original node
      curveObject.position.copy(originalNode.position);
      curveObject.quaternion.copy(originalNode.quaternion);
      curveObject.scale.copy(originalNode.scale);

      // Merge userData, keeping curveObject-specific data
      curveObject.userData = {
        ...originalNode.userData,
        ...curveObject.userData,
      };

      // Add as a sibling under the same parent without reparenting any children
      parent.add(curveObject);
    } else {
      console.warn(
        `Original node or its parent not found. Adding curve to scene root.`
      );
      result.scene.add(curveObject);
    }
  }

  createNURBSCurvePath(nurbsData) {
    const degree = nurbsData.order_u - 1;
    const knots =
      nurbsData.knots ||
      this.generateKnots(
        nurbsData.points.length,
        degree,
        nurbsData.use_cyclic_u
      );

    const controlPoints = nurbsData.points.map((point) => {
      const v = this.convertBlenderToThreeCoordinates(point.co);
      const w = point.w ?? 1;
      return new THREE.Vector4(v.x, v.y, v.z, w);
    });

    let startKnot, endKnot;
    if (nurbsData.use_cyclic_u) {
      startKnot = degree;
      endKnot = knots.length - degree - 1;
    } else {
      startKnot = 0;
      endKnot = knots.length - 1;
    }

    const nurbsCurve = new NURBSCurve(
      degree,
      knots,
      controlPoints,
      startKnot,
      endKnot
    );

    // Convert NURBS curve to points
    const numPoints = Math.max(200, nurbsData.resolution_u * 10);
    const points = nurbsCurve.getPoints(numPoints);

    // Create CurvePath
    const curvePath = new THREE.CurvePath();
    // @ts-ignore - JS context, acceptable for CurvePath of Vector3
    curvePath.add(
      new THREE.CatmullRomCurve3(points, nurbsData.use_cyclic_u, 'centripetal')
    );

    return curvePath;
  }

  // Helper function to generate knots
  generateKnots(numPoints, degree, cyclic) {
    const order = degree + 1;
    let knots = [];

    if (cyclic) {
      // For cyclic curves, create a periodic knot vector
      const numKnots = numPoints + order;
      for (let i = 0; i < numKnots; i++) {
        knots.push(i);
      }
    } else {
      for (let i = 0; i < order; i++) {
        knots.push(0);
      }
      for (let i = 1; i <= numPoints - order; i++) {
        knots.push(i);
      }
      for (let i = 0; i < order; i++) {
        knots.push(numPoints - order + 1);
      }
    }

    // Normalize the knot vector
    const last = knots[knots.length - 1];
    return knots.map((k) => k / last);
  }
}

export { GLTFCurveExtension };