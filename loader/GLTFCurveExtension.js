import * as THREE from 'three';
import { NURBSCurve } from 'three/examples/jsm/curves/NURBSCurve.js';

let _index = 0;
class GLTFCurveExtension {
  constructor(parser) {
    this.parser = parser;
    this.name = 'UTSUBO_curve_extension';
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

    for (let i = 0; i < nodeDefs.length; i++) {
      const nodeDef = nodeDefs[i];
      if (nodeDef.extensions && nodeDef.extensions[this.name]) {
        pending.push(this.createCurve(nodeDef, result, i, loadedNodes[i]));
      }
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
    curveObject.name = nodeDef.name || spline.type + '_' + _index++;

    this.applyNodeTransform(curveObject, nodeDef);

    // Store the curve data on the object for future use
    curveObject.userData.curve = finalCurve;

    // Set up associations as in the official GLTFLoader
    if (!this.parser.associations.has(curveObject)) {
      this.parser.associations.set(curveObject, {});
    }
    this.parser.associations.get(curveObject).nodes = nodeIndex;

    // Use loadedNode instead of finding it in the scene
    return Promise.resolve(curveObject).then((curveObject) => {
      this.replaceCurveInScene(result, curveObject, loadedNode);
      return curveObject;
    });
  }

  convertBlenderToThreeCoordinates(coord) {
    return new THREE.Vector3(coord[0], coord[2], -coord[1]);
  }

  applyNodeTransform(object, nodeDef) {
    if (nodeDef.matrix !== undefined) {
      const matrix = new THREE.Matrix4();
      matrix.fromArray(nodeDef.matrix);
      object.applyMatrix4(matrix);
    } else {
      if (nodeDef.translation !== undefined) {
        object.position.fromArray(nodeDef.translation);
      }
      if (nodeDef.rotation !== undefined) {
        const rotation = new THREE.Quaternion().fromArray(nodeDef.rotation);
        const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
        euler.x = -euler.x;
        euler.y = -euler.y;
        object.rotation.copy(euler);
      }
      if (nodeDef.scale !== undefined) {
        object.scale.fromArray(nodeDef.scale);
      }
    }
  }

  replaceCurveInScene(result, curveObject, originalNode) {
    if (originalNode && originalNode.parent) {
      const parent = originalNode.parent;
      const index = parent.children.indexOf(originalNode);

      if (index !== -1) {
        // Transfer children
        while (originalNode.children.length > 0) {
          curveObject.add(originalNode.children[0]);
        }

        // Copy transformation
        curveObject.position.copy(originalNode.position);
        curveObject.quaternion.copy(originalNode.quaternion);
        curveObject.scale.copy(originalNode.scale);

        // Replace in parent's children array
        parent.children[index] = curveObject;
        curveObject.parent = parent;

        // Merge userData
        curveObject.userData = {
          ...originalNode.userData,
          ...curveObject.userData,
        };

        // Clean up original node
        originalNode.parent = null;
      } else {
        console.warn(`Original node not found in parent's children.`);
      }
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
      const threePoint = this.convertBlenderToThreeCoordinates(point.co);
      return new THREE.Vector4(
        threePoint.x,
        threePoint.y,
        threePoint.z,
        point.w || 1
      );
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
