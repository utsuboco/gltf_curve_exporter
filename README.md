# glTF Curve Exporter and Loader

This project provides a set of tools for exporting and importing curve data in glTF files, specifically designed for use with Blender and Three.js. It consists of two main components:

1. A Blender extension for exporting curve data in glTF files
2. A Three.js addon for loading and rendering these curves in web applications

## Blender Extension: glTF Curve Exporter

### Features
- Exports Bezier, NURBS, and Poly curves from Blender
- Preserves curve data including control points, handles, and knots
- Supports cyclic curves
- Integrates seamlessly with Blender's glTF export process

### Installation
1. Download the `gltf_curve_exporter.zip` file from the releases section of this repository
2. Open Blender and go to Edit > Preferences > Add-ons
3. Click "Install" and select the downloaded `gltf_curve_exporter.zip` file
4. Enable the addon by checking the box next to "Import-Export: glTF Curve Exporter Extension"

Note: If you're using an older version of Blender or prefer manual installation, you can extract the `gltf_curve_exporter.py` file from the ZIP and install it directly.

### Usage
1. Create your curves in Blender
2. When exporting your scene as glTF, ensure the "Export Curves" option is enabled in the export settings
3. Export your scene as usual

## Three.js Addon: GLTFCurveExtension

[... rest of the Three.js section remains unchanged ...]

## Important Notes
- Ensure that you're using compatible versions of Blender (4.2.0 beta or later recommended), Three.js, and the extensions
- The Three.js addon requires the `NURBSCurve` class from Three.js examples

## Known Issues
- Cyclic NURBS curves may not render perfectly closed in Three.js. This is due to differences in how Blender and Three.js handle NURBS curves. We're working on improving this, but for now, you may need to implement additional logic to ensure perfect closure for cyclic NURBS curves in your Three.js application.

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## License
This project is licensed under the MIT License - see the LICENSE file for details.

## Support
If you encounter any issues or have questions, please file an issue on the GitHub repository.

## Troubleshooting
- If the addon doesn't appear in Blender's addon list after installation, make sure you're using a compatible version of Blender and that the ZIP file wasn't corrupted during download.
- If curves are not appearing in your Three.js scene, ensure that the "Export Curves" option was enabled during the glTF export from Blender.
- Check the console for any error messages related to the GLTFCurveExtension.
- Verify that the curve data is present in the exported glTF file by inspecting its contents.

## 🧑‍🎨 Maintainers :

- [`twitter 🐈‍⬛ @onirenaud`](https://twitter.com/onirenaud)
- [`twitter @utsuboco`](https://twitter.com/utsuboco)
