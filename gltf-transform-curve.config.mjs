import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  Extension,
  PropertyType,
  ExtensionProperty,
} from '@gltf-transform/core';

const NAME = 'UTSUBO_curve_extension';

class CurveData extends ExtensionProperty {
  init() {
    this.extensionName = NAME;
    this.propertyType = 'CurveData';
    this.parentTypes = [PropertyType.NODE];
    this.splines = [];
    this.dimensions = '3D';
  }

  getDefaults() {
    return {
      splines: [],
      dimensions: '3D',
    };
  }

  getSplines() {
    return this.get('splines');
  }

  setSplines(splines) {
    return this.set('splines', splines);
  }

  getDimensions() {
    return this.get('dimensions');
  }

  setDimensions(dimensions) {
    return this.set('dimensions', dimensions);
  }
}

class CurveExtension extends Extension {
  constructor(doc) {
    super(doc);
    this.extensionName = NAME;
    this.propertyType = CurveData;
  }

  static get EXTENSION_NAME() {
    return NAME;
  }

  createCurveData() {
    return new CurveData(this.document.getGraph());
  }

  read(context) {
    const jsonDoc = context.jsonDoc;

    (jsonDoc.json.nodes || []).forEach((nodeDef, nodeIndex) => {
      if (nodeDef.extensions && nodeDef.extensions[NAME]) {
        const curveDataDef = nodeDef.extensions[NAME];
        const curveData = this.createCurveData()
          .setSplines(curveDataDef.splines)
          .setDimensions(curveDataDef.dimensions);

        console.log(curveData);
        const node = context.nodes[nodeIndex];
        node.setExtension(NAME, curveData);
      }
    });

    return this;
  }

  write(context) {
    const jsonDoc = context.jsonDoc;

    this.document
      .getRoot()
      .listNodes()
      .forEach((node) => {
        const curveData = node.getExtension(NAME);
        if (curveData) {
          const nodeIndex = context.nodeIndexMap.get(node);
          const nodeDef = jsonDoc.json.nodes[nodeIndex];
          nodeDef.extensions = nodeDef.extensions || {};
          nodeDef.extensions[NAME] = {
            splines: curveData.getSplines(),
            dimensions: curveData.getDimensions(),
          };
        }
      });

    // Ensure the extension is listed in extensionsUsed
    if (!jsonDoc.json.extensionsUsed) {
      jsonDoc.json.extensionsUsed = [];
    }
    if (!jsonDoc.json.extensionsUsed.includes(NAME)) {
      jsonDoc.json.extensionsUsed.push(NAME);
    }

    return this;
  }
}

export default { extensions: [...ALL_EXTENSIONS, CurveExtension] };
