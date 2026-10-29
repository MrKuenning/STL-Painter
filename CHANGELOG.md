# Changelog

All notable changes and milestones for **STL Painter** are documented in this file.

---

## [0.3.0] - 2026-10-29

### Built-in Example Presets (4 Shapes & 4 Test Graphics)
* **Reordered and Renamed Presets:**
  * **3D Shapes (in exact sequence):**
    1. **Flat (`demo-coaster.stl`):** $50 \times 35$ mm flat surface, ideal for baseline surface tests and flat top/bottom first-layer printing.
    2. **Uneven (`demo-stepped.stl`):** 3-tier stepped pedestal ($50 \times 40$ mm base at $Z=2.5$ mm, $34 \times 26$ mm middle tier at $Z=5.0$ mm, and $18 \times 14$ mm top tier at $Z=7.5$ mm), demonstrating projection mapping dropping down across multiple flat step elevations.
    3. **Curved (`demo-dome.stl`):** Fully rounded elliptical pebble ($50 \times 40$ mm) with a prominent $7.5$ mm smooth parabolic dome rising to $Z=10.0$ mm and over 1,600 subdivided triangles, specifically designed to demonstrate **3D projection mapping** across steep curved topography.
    4. **Wavy (`demo-wavy.stl`):** Undulating continuous sinusoidal wave tile ($50 \times 40$ mm) with alternating crests and valleys up to $Z=5.5$ mm, showcasing continuous contour mapping over rippled surfaces.
  * **Graphic Images (in exact sequence):**
    1. **1 Color (`demo-1color-car.png`):** Custom car silhouette PNG on a transparent background.
    2. **2 Color (`demo-2color-badge.svg`):** High-contrast geometric coaster logo.
    3. **4 Color (`demo-4color-retro.svg`):** Multi-filament circular sunset and mountain landscape across 4 distinct colors, mapping cleanly to Bambu AMS slots.
    4. **White Background (`demo-whitebg-shield.png`):** Custom shield PNG (blue shield + gold star) on a solid white canvas; demonstrates removing background without losing foreground details.
* **Try Examples Panel (Symmetric 2×2 Layouts):**
  * Formatted both 3D Shapes and Graphic Images into clean, symmetric $2 \times 2$ responsive grids (`.preset-grid-2`) with `minmax(0, 1fr)` to prevent buttons from overflowing the sidebar.
  * Updated initial boot sequence and defaults: loads with **Flat** shape, **2 Color** graphic, and **Surface Paint** mode (`paint_color`).
* **Directional Soft Shadows & Depth Perception:**
  * Enabled Three.js `PCFSoftShadowMap` with an angled directional key light (`dir1`, 2048×2048 map, normal bias compensation).
  * Added a subtle ground shadow receiver on the build plate bed plane (`ShadowMaterial`, opacity 0.35) and enabled `castShadow` and `receiveShadow` on model geometry and painted surface layers.
  * Significantly enhances edge detection and vertical relief visualization on uneven surfaces (e.g. drop shadows from the tiers of the **Uneven** stepped pedestal, gradient shadowing in valleys of the **Wavy** relief, and ground contact shadows).
* **Default Subdivision Detail:** Lowered default surface paint subdivision detail to **`0.10 mm`** (from `0.25 mm`) in both initial state and range slider for maximum edge sharpness.
* **GitHub Repository Links:**
  * Added direct repository links to [`https://github.com/MrKuenning/STL-Painter`](https://github.com/MrKuenning/STL-Painter) both at the bottom of the left sidebar and as a floating HUD pill in the bottom-right corner of the 3D viewport.
* **Double-Vision Elimination & Seamless Editing in 3D Preview:**
  * When in preview mode (after clicking *"Preview on 3D Model"*), the floating flat 2D graphic quad automatically becomes invisible (`opacity: 0`), completely eliminating visual clutter and "double vision" over the 3D model.
  * The interactive cyan bounding box, 4 corner resize handles, rotation knob, and center move dot remain fully visible and active around the projected artwork.
  * Clicking or dragging anywhere on the decal frame or adjusting any slider immediately re-activates edit mode, restoring the flat graphic overlay for live placement feedback.
  * Added a **"Flat Graphic"** toggle in the HUD overlay for explicit manual visibility control.

### Cross-Platform Launchers & Environment Automation
* **Windows Launcher Hardening (`Start Windows.bat`):**
  * Automated first-run setup: detects if `node_modules/` is absent and runs `npm install` automatically.
  * Node.js verification: alerts the user with direct download instructions if Node.js is missing from `PATH`.
  * Resolved batch parser bug: refactored script using `goto` jumps instead of compound parenthesized `if` blocks, eliminating `cmd.exe` crashes caused by parentheses in text strings.
* **Linux & macOS Launcher (`start_linux.sh`):**
  * Created complete, executable Bash launcher with Unix line endings (LF).
  * Automatically checks for `node` and `npm`, surfaces distribution-specific installation commands (Ubuntu/Debian, Fedora, Arch), and handles initial dependency installation before launching the Vite dev server with `--open`.
* **Repository & Distribution Hygiene:**
  * Added comprehensive [`.gitignore`](file:///c:/Users/Brady/Projects/STL%20Painter/STL%20Painter%20-%20App1/.gitignore) excluding slicer test artifacts (`result.json`, `*.3mf`, `*.gcode`), OS cache files, editor configurations, and `.vite/` caches.
  * Added clear project [`README.md`](file:///c:/Users/Brady/Projects/STL%20Painter/STL%20Painter%20-%20App1/README.md) detailing architecture (zero-Python, 100% client-side WASM/JS), prerequisites, and quick-start guides.

### Branding & Visual Identity
* **Custom Vector Logo & Favicon:**
  * [`public/logo.svg`](file:///c:/Users/Brady/Projects/STL%20Painter/STL%20Painter%20-%20App1/public/logo.svg): High-resolution vector logomark with an isometric 3D mesh model, multi-color painted filament layers, wireframe mesh accents, and a stylized angled brush. Added explicit `width="64"` and `height="64"` and removed restricted SVG `<filter>` tags for guaranteed cross-browser rendering in `<img>` tags.
  * [`public/favicon.svg`](file:///c:/Users/Brady/Projects/STL%20Painter/STL%20Painter%20-%20App1/public/favicon.svg): 32×32 high-contrast vector favicon linked in `<head>` for sharp browser tab display.
* **Header Polish:** Embedded logomark in the brand header alongside a compact `3MF` badge pill and subtitle, with an automatic raster fallback (`logo-256.png`).

### Bambu Studio Profile Selector & Sync
* **Printer & Nozzle Profile Dropdown:** Replaced binary checkbox with profile selection dropdown in Step 5:
  * `Bambu A1 (0.4mm) · Textured PEI` (Preset: `Bambu Lab A1 0.4 nozzle`, `0.20mm Standard @BBL A1`, `Bambu PLA Basic @BBL A1`)
  * `Bambu A1 (0.2mm) · Textured PEI` (Preset: `Bambu Lab A1 0.2 nozzle`, `0.10mm Standard @BBL A1 0.2 nozzle`, `Bambu PLA Basic @BBL A1 0.2 nozzle`)
  * `None (Geometry only)` (Exports clean multi-part geometry without embedding slicer machine configs).
* **Automatic Layer Height Synchronization:** Selecting the 0.2mm profile automatically adjusts the default layer height to 0.10 mm (and 0.20 mm for 0.4mm nozzle), updating the real-time layer depth calculation.
* **Extensible Profile Engine:** Added modular preset dictionary in `src/core/export3mf.js` supporting Bambu Lab A1, A1 mini, P1S, and X1 Carbon machine configurations.

---

## [0.2.0] - 2026-10-29

### UI & Workspace Layout
* **Dual-Sidebar Layout:** Redesigned the application into a clean three-column workspace:
  * **Left Sidebar (Assets & Inputs):** Brand header, demo loader, Step 1: Model (STL), and Step 2: Image & Colors.
  * **Center Panel (Interactive Canvas):** Responsive 3D Three.js viewport with OrbitControls, interactive decal gizmo, and floating HUD overlay.
  * **Right Sidebar (Placement & Export):** Step 3: Position on Surface, Step 4: Paint Depth & Mode, and Step 5: Export.
* **Separated Paint Depth & Export Workflow:** Split the previous combined step into two distinct collapsible cards:
  * **Step 4: Paint Depth & Mode:** Mode toggle (Geometry Split vs. Surface Paint), depth & layer parameters, and the primary `"Preview on 3D Model"` action button.
  * **Step 5: Export:** A1 profile embedding toggle, `"Export .3MF for Bambu Studio"` button, and real-time generation status readout.
* **Full-Width Image Preview:** Expanded the image quantization preview canvas to full container width with a checkered transparency background, moving all adjustment controls directly beneath the image.
* **Logical Image Controls Flow:** Reordered controls for intuitive setup:
  1. *Flip horizontally* (ideal for first-layer bottom faces).
  2. *Remove border background* toggle (unchecked by default) + indented *BG tolerance* slider (hidden until enabled).
  3. *Colors* slider limited to 1–7 colors (1 base model filament + 7 image colors = 8 total AMS filaments, preventing duplicate slot collisions).
  4. *Palette list* directly underneath the slider, mapping each detected color to unique filament slots 2..8.
* **Position on Surface Grouping:** Organized Step 3 into four distinct visual control cards:
  * **Surface:** Alignment face buttons (`Top (+Z)`, `Bottom (-Z)`, etc.) and normal axis snapping.
  * **Scale:** Width & Height inputs (fixed CSS column overflow with `minmax(0, 1fr)`), aspect ratio lock, and Scale factor slider.
  * **Position:** Center X / Y / Both alignment buttons and Rotation slider.
  * **Projection Mapping:** Surface reach (±mm) depth boundary slider.
* **Control Alignments & Label Refinements:**
  * Aligned the **BG tolerance** slider flush with all other field controls.
  * Renamed HUD toggle to **"Show Resize Selector"**.
  * Renamed main action button and prompt status to **"Preview on 3D Model"**.
* **Filament UI Consistency:** Formatted **Base filament** in the Model section using the exact same `.palette-row` card and header structure as the image colors list.
* **Collapsible Sections:** Added interactive collapse/expand toggles to all sidebar cards with animated chevron indicators, keyboard accessibility, and compact summary pills (`demo-coaster.stl`, `480×320 · 2 colors`, etc.) when collapsed.
* **Precision Centering:** Added dedicated **Center X**, **Center Y**, and **Center Both** buttons for instant surface alignment without losing coordinate positions on the opposite axis.
* **Scale Slider:** Added a fine-tuned Scale slider (10%–300%) positioned above the rotation slider in the Position panel.
* **Relative Dragging:** Decoupled decal positioning from click coordinates, enabling smooth relative delta dragging without jumping the center to the cursor.

### Bambu Studio 3MF Compatibility
* **Resolved "Invalid Config, Load Geometry Data Only" Warning:**
  * Identified root cause: Bambu Studio's importer (`libslic3r/Format/bbs_3mf.cpp`) strictly checks `<metadata name="Application">` in `3D/3dmodel.model`. Replaced third-party identifier with `BambuStudio-02.08.02.61`.
  * Added `Metadata/slice_info.config` specifying `X-BBL-Client-Type: slicer` and version `02.08.02.61`.
  * Synchronized version numbers and plate assembly tags across `Metadata/model_settings.config` and `Metadata/project_settings.config`.
* **Resolved Bed Type Replacement Notification:**
  * Fixed plate configuration where `curr_bed_type` was previously written as `"3"`, causing Bambu Studio to fall back to `"Engineering Plate"`.
  * Set `curr_bed_type` directly to `"Textured PEI Plate"` to match Bambu Studio's internal string enum, eliminating configuration mismatch prompts.
* **A1 Profile Injection Toggle:** Added option to embed pre-configured Bambu Lab A1 (0.4mm nozzle · Textured PEI) project profile and filament slots directly into the exported `.3mf` archive.

---

## [0.1.0] - 2026-10-28

### Initial Release & Core Architecture
* **STL Loading & Parsing:** Binary and ASCII STL file parsing with vertex deduplication and automatic bounding box computation.
* **Color Quantization Engine:** K-means color clustering (1–8 colors) with automatic alpha transparency detection, dominant border background flood-fill removal, and majority-filter despeckling.
* **Dual Export Engines:**
  * **Geometry Split Mode:** Uses Manifold 3D WASM boolean CSG operations to slice the exact contour shape $N$ millimeters deep into the mesh, outputting individual solid sub-parts per color for precise layer slicing in Bambu Studio.
  * **Surface Paint Mode:** Projects the image onto surface triangles and encodes native Bambu Studio `paint_color` quadtree nibble attributes (`0b0100`, `0b1000`, etc.) onto sub-divided triangles.
* **3D Interactive Decal Gizmo:**
  * Real-time 3D decal projector with surface raycasting and normal alignment.
  * Interactive corner scaling handles and rotation knob with Shift-key snapping ($15^\circ$ increments).
  * Surface reach clipping plane adjustment.
* **Built-in Demo Assets:** Quick "Load Demo Coaster & Logo" button embedding a sample rounded coaster STL and 2-color SVG logo for instant out-of-the-box testing.

