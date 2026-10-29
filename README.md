# STL Painter

A browser-based, client-side tool to project 2D images, logos, and graphics directly onto 3D STL meshes and export native, multi-color **.3MF** files ready for Bambu Studio and Bambu Lab 3D printers.

### 🌐 Try It Online
**No installation required:** Launch and use the app directly in your browser at **[https://stl-painter.onrender.com](https://stl-painter.onrender.com/)**

---

## Key Features

- **100% Client-Side Processing:** No cloud uploads and no server backend. All slicing, color clustering, mesh decimation, and 3MF packaging happen directly in your web browser.
- **Dual Multi-Color Modes:**
  - **Geometry Split Mode:** Uses high-performance Manifold 3D boolean CSG (WebAssembly) to slice the exact contour of your graphic $N$ mm deep into the mesh. Each color becomes an independent solid sub-part for exact layer slicing.
  - **Surface Paint Mode:** Projects the graphic onto the surface triangles and writes native Bambu Studio `paint_color` quadtree attributes.
- **Interactive 3D Decal Gizmo:** Live 3D preview with Three.js, corner resize handles, rotation knob, axis snapping, surface reach clipping, and precision centering.
- **Smart Color Quantization:** K-means color clustering with automatic background removal, transparency handling, and Bambu AMS slot mapping (up to 8 filaments).
- **Native Bambu Studio Profiles:** Seamlessly embeds Bambu Lab A1 (0.4mm or 0.2mm nozzle) and Textured PEI plate configs without triggering configuration mismatch warnings.

---

## Prerequisites

The only software required is **[Node.js](https://nodejs.org/)** (v18 or higher, LTS recommended).
- **No Python required.**
- **No Python virtual environment (venv) needed.**
- The app runs entirely on **JavaScript, HTML, CSS, and WebAssembly (WASM)**.

---

## Quick Start

### Windows
1. Clone or download this repository.
2. Double-click **`Start Windows.bat`**.

### Linux & macOS
1. Open a terminal in the cloned directory.
2. Make the script executable (first time only) and run it:
   ```bash
   chmod +x start_linux.sh
   ./start_linux.sh
   ```

> **Note:** On the very first run, the start script automatically detects that `node_modules` is missing, runs `npm install`, and opens the application in your default web browser.

---

## Manual Run (Any Platform)

1. Open your terminal in this directory:
   ```bash
   npm install
   ```
2. Start the local development server:
   ```bash
   npm run dev
   ```
3. Open the printed local URL (e.g., `http://localhost:5173`) in your browser.

---

## Building a Static Standalone Distribution

To generate a standalone static bundle that can be hosted on GitHub Pages or any static web server:

```bash
npm run build
```

The resulting files in the `dist/` directory are static `.html`, `.js`, `.css`, and `.wasm` files that require no Node.js server at runtime.

