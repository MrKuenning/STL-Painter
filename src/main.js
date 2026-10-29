import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { loadSTL, meshBounds } from './core/stl.js';
import { quantizeImage, toStateMap } from './core/imageQuantize.js';
import { makeFrame, snapToAxis, dot, sub } from './core/frame.js';
import { computePaint } from './core/paintMode.js';
import { computeSplit, healMeshWithManifold } from './core/splitMode.js';
import { build3MF } from './core/export3mf.js';
import { SAMPLE_MODELS, SAMPLE_IMAGES, makeSamplePlateSTL, SAMPLE_LOGO_SVG } from './core/sampleAssets.js';
import { getManifold } from './manifoldClient.js';

// Default preview colors for AMS / filament slots 1..8
const DEFAULT_SLOT_COLORS = [
  '#e2e8f0', // Slot 1 (Base default)
  '#f97316', // Slot 2 (Orange)
  '#1e293b', // Slot 3 (Charcoal)
  '#ef4444', // Slot 4 (Red)
  '#22c55e', // Slot 5 (Green)
  '#3b82f6', // Slot 6 (Blue)
  '#eab308', // Slot 7 (Yellow)
  '#a855f7', // Slot 8 (Purple)
];

const state = {
  modelName: 'coaster',
  mesh: null,         // { positions: Float32Array, indices: Uint32Array }
  bounds: null,
  baseSlot: 1,
  slotColors: [...DEFAULT_SLOT_COLORS],

  rawImage: null,     // { width, height, data: Uint8ClampedArray }
  aspect: 1.5,
  quantized: null,    // LabelMap from quantizeImage
  paletteSlots: [2, 3, 4, 5, 6, 7, 8],

  origin: [0, 0, 5],
  normal: [0, 0, 1],
  width: 30,
  height: 20,
  baseWidth: 30,
  scalePct: 100,
  rotationDeg: 0,
  reach: 0.5,

  mode: 'paint',      // 'split' | 'paint'
  depth: 0.6,
  layerHeight: 0.2,
  minEdge: 0.10,

  lastResult: null,   // { mode, parts, painted }
};

// ---------------- Three.js scene setup (Z-up, matching STL & Bambu Studio) ----------------
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const viewportEl = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewportEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1120');

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
camera.position.set(0, -95, 75);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Build plate grid (256 x 256 mm Bambu X1/P1/A1 bed reference)
const grid = new THREE.GridHelper(256, 16, 0x334155, 0x1e293b);
grid.rotation.x = Math.PI / 2;
scene.add(grid);

// Ground shadow receiver on the build plate bed
const shadowPlaneGeom = new THREE.PlaneGeometry(256, 256);
const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
const shadowPlane = new THREE.Mesh(shadowPlaneGeom, shadowPlaneMat);
shadowPlane.position.z = -0.05;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 0.75);
scene.add(hemi);
const dir1 = new THREE.DirectionalLight(0xffffff, 0.95);
dir1.position.set(70, -80, 110);
dir1.castShadow = true;
dir1.shadow.mapSize.width = 2048;
dir1.shadow.mapSize.height = 2048;
dir1.shadow.camera.near = 10;
dir1.shadow.camera.far = 350;
const d = 60;
dir1.shadow.camera.left = -d;
dir1.shadow.camera.right = d;
dir1.shadow.camera.top = d;
dir1.shadow.camera.bottom = -d;
dir1.shadow.bias = -0.0004;
dir1.shadow.normalBias = 0.02;
scene.add(dir1);

const dir2 = new THREE.DirectionalLight(0x93c5fd, 0.35);
dir2.position.set(-90, 80, 60);
scene.add(dir2);

const modelGroup = new THREE.Group();
const previewGroup = new THREE.Group();
const gizmoGroup = new THREE.Group();
scene.add(modelGroup, previewGroup, gizmoGroup);

let pickableMesh = null; // invisible/visible mesh used for raycasting surface clicks
let decalTexture = null;

function resizeViewport() {
  const w = viewportEl.clientWidth || 800;
  const h = viewportEl.clientHeight || 600;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeViewport);
if (window.ResizeObserver) {
  new ResizeObserver(resizeViewport).observe(viewportEl);
}
resizeViewport();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

// ---------------- UI Helpers ----------------
const $ = (id) => document.getElementById(id);

function setStatus(msg, kind = '') {
  const el = $('statusBox');
  el.textContent = msg;
  el.className = 'status-box' + (kind ? ' ' + kind : '');
}

function updateStlLabel(name) {
  if (!$('stlLabel')) return;
  if (name) {
    $('stlLabel').innerHTML = `
      <div class="drop-status">
        <span class="drop-icon">📦</span>
        <span class="drop-name">Loaded: <strong>${name}</strong></span>
      </div>
      <div class="drop-action">Click or drop a new <strong>.STL</strong> file to replace</div>
    `;
  } else {
    $('stlLabel').innerHTML = `
      <div class="drop-status">
        <span class="drop-icon">📦</span>
        <span>Drop <strong>.STL</strong> file here or click to browse</span>
      </div>
      <div class="drop-action">Upload custom 3D model (<strong>.stl</strong>)</div>
    `;
  }
}

function updateImgLabel(name) {
  if (!$('imgLabel')) return;
  if (name) {
    $('imgLabel').innerHTML = `
      <div class="drop-status">
        <span class="drop-icon">🖼️</span>
        <span class="drop-name">Loaded: <strong>${name}</strong></span>
      </div>
      <div class="drop-action">Click or drop a new image to replace</div>
      <div class="drop-formats">PNG · JPG · SVG · WEBP</div>
    `;
  } else {
    $('imgLabel').innerHTML = `
      <div class="drop-status">
        <span class="drop-icon">🖼️</span>
        <span>Drop image here or click to browse</span>
      </div>
      <div class="drop-action">Click or drop a new image to replace</div>
      <div class="drop-formats">PNG · JPG · SVG · WEBP</div>
    `;
  }
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function initBaseSlotSelect() {
  const sel = $('baseSlotSelect');
  sel.innerHTML = DEFAULT_SLOT_COLORS.map((_, i) => `<option value="${i + 1}">Filament ${i + 1}</option>`).join('');
  sel.value = String(state.baseSlot);
  $('baseSlotColor').value = state.slotColors[state.baseSlot - 1];
  sel.addEventListener('change', () => {
    state.baseSlot = +sel.value;
    $('baseSlotColor').value = state.slotColors[state.baseSlot - 1];
    state.lastResult = null;
    rebuildModelScene();
  });
  $('baseSlotColor').addEventListener('input', (e) => {
    state.slotColors[state.baseSlot - 1] = e.target.value;
    rebuildModelScene();
  });
}

// ---------------- Mesh & Preview Rendering ----------------
function toBufferGeometry(mesh) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geom.computeVertexNormals();
  return geom;
}

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.geometry?.dispose?.();
    if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
    else c.material?.dispose?.();
  }
}

function rebuildModelScene() {
  clearGroup(modelGroup);
  clearGroup(previewGroup);
  if (!state.mesh) return;

  // Always keep a raycastable base mesh matching the unmodified STL
  const baseGeom = toBufferGeometry(state.mesh);
  const baseMat = new THREE.MeshStandardMaterial({
    color: state.slotColors[state.baseSlot - 1] || '#e2e8f0',
    roughness: 0.45,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  pickableMesh = new THREE.Mesh(baseGeom, baseMat);
  pickableMesh.castShadow = true;
  pickableMesh.receiveShadow = true;
  modelGroup.add(pickableMesh);

  const explode = $('explodePreview').checked ? 3.0 : 0;
  const res = state.lastResult;

  if (res?.mode === 'split' && res.parts?.length) {
    // Hide the raw base mesh and show the boolean-split parts instead
    pickableMesh.material.transparent = true;
    pickableMesh.material.opacity = 0;
    for (const part of res.parts) {
      const g = toBufferGeometry(part.mesh);
      const m = new THREE.MeshStandardMaterial({
        color: state.slotColors[(part.slot - 1) % state.slotColors.length] || '#f97316',
        roughness: 0.38,
        metalness: 0.06,
      });
      const meshObj = new THREE.Mesh(g, m);
      meshObj.castShadow = true;
      meshObj.receiveShadow = true;
      if (explode && part.name !== 'Base') {
        meshObj.position.set(
          state.normal[0] * explode,
          state.normal[1] * explode,
          state.normal[2] * explode
        );
      }
      previewGroup.add(meshObj);
    }
  } else if (res?.mode === 'paint' && res.painted) {
    // Overlay subdivided painted triangles grouped by filament state
    const { previewPositions, previewStates } = res.painted;
    const bySlot = new Map();
    for (let i = 0; i < previewStates.length; i++) {
      const s = previewStates[i];
      if (!bySlot.has(s)) bySlot.set(s, []);
      const arr = bySlot.get(s);
      const o = i * 9;
      for (let k = 0; k < 9; k++) arr.push(previewPositions[o + k]);
    }
    for (const [slot, coords] of bySlot) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(coords), 3));
      g.computeVertexNormals();
      const m = new THREE.MeshStandardMaterial({
        color: state.slotColors[(slot - 1) % state.slotColors.length] || '#f97316',
        roughness: 0.35,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const meshObj = new THREE.Mesh(g, m);
      meshObj.castShadow = true;
      meshObj.receiveShadow = true;
      previewGroup.add(meshObj);
    }
  }

  updateDecalGizmo();
}

function getCurrentFrame() {
  return makeFrame({
    origin: state.origin,
    normal: state.normal,
    rotationDeg: state.rotationDeg,
    width: state.width,
    height: state.height,
    reach: state.reach,
  });
}

let gizmoHandles = []; // interactive 3D gizmo meshes for scale / rotate / move

function updateDecalGizmo() {
  clearGroup(gizmoGroup);
  gizmoHandles = [];
  if (!state.mesh || !$('showDecalHelper').checked) return;

  const frame = getCurrentFrame();
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...frame.right),
    new THREE.Vector3(...frame.up),
    new THREE.Vector3(...frame.normal)
  );
  basis.setPosition(
    frame.origin[0] + frame.normal[0] * 0.08,
    frame.origin[1] + frame.normal[1] * 0.08,
    frame.origin[2] + frame.normal[2] * 0.08
  );

  // Translucent textured plane showing the quantized decal right on the surface
  if (decalTexture) {
    const isPreviewing = Boolean(state.lastResult);
    const showGraphic = $('showDecalGraphic') ? $('showDecalGraphic').checked : true;
    const shouldDisplayTexture = showGraphic && !isPreviewing;

    const planeGeom = new THREE.PlaneGeometry(frame.width, frame.height);
    const planeMat = new THREE.MeshBasicMaterial({
      map: shouldDisplayTexture ? decalTexture : null,
      transparent: true,
      opacity: shouldDisplayTexture ? 0.88 : 0.0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(planeGeom, planeMat);
    plane.applyMatrix4(basis);
    plane.userData = { handleType: 'move' };
    gizmoGroup.add(plane);
    gizmoHandles.push(plane);

    // Center move dot / grab handle
    const u = Math.max(0.85, Math.min(frame.width, frame.height) * 0.08);
    const centerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false });
    const centerMesh = new THREE.Mesh(new THREE.RingGeometry(0, u * 0.85, 16), centerMat);
    centerMesh.renderOrder = 10;
    centerMesh.position.set(0, 0, 0.05);
    centerMesh.applyMatrix4(basis);
    centerMesh.userData = { handleType: 'move' };
    gizmoGroup.add(centerMesh);
    gizmoHandles.push(centerMesh);
  }

  // Framing box (width x height x depth) so the user can see the projection footprint & depth
  const depthVis = state.mode === 'split' ? state.depth : 0.4;
  const boxGeom = new THREE.BoxGeometry(frame.width, frame.height, depthVis);
  boxGeom.translate(0, 0, -depthVis / 2);
  const edges = new THREE.EdgesGeometry(boxGeom);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x38bdf8 }));
  line.applyMatrix4(basis);
  gizmoGroup.add(line);
  boxGeom.dispose();

  // Interactive 3D scale & rotate gizmo handles in decal plane
  const hw = frame.width / 2;
  const hh = frame.height / 2;
  const u = Math.max(0.85, Math.min(frame.width, frame.height) * 0.08);

  const addHandle = (geom, color, lx, ly, lz, handleType) => {
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 10;
    mesh.position.set(lx, ly, lz);
    mesh.applyMatrix4(basis);
    mesh.userData = { handleType };
    gizmoGroup.add(mesh);
    gizmoHandles.push(mesh);
    return mesh;
  };

  // 4 Corner scale handles (uniform or free XY scale)
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    addHandle(
      new THREE.BoxGeometry(u * 1.15, u * 1.15, u * 0.55),
      0x38bdf8,
      sx * hw,
      sy * hh,
      0,
      'scale-corner'
    );
  }

  // 4 Edge midpoint scale handles (width / height)
  for (const sx of [-1, 1]) {
    addHandle(
      new THREE.BoxGeometry(u * 0.75, u * 1.65, u * 0.45),
      0xe2e8f0,
      sx * hw,
      0,
      0,
      'scale-x'
    );
  }
  for (const sy of [-1, 1]) {
    addHandle(
      new THREE.BoxGeometry(u * 1.65, u * 0.75, u * 0.45),
      0xe2e8f0,
      0,
      sy * hh,
      0,
      'scale-y'
    );
  }

  // Top rotation stem + arc + orange knob handle
  const rotDist = Math.max(3.2, u * 3.4);
  const stemPts = [new THREE.Vector3(0, hh, 0), new THREE.Vector3(0, hh + rotDist, 0)];
  const stemGeom = new THREE.BufferGeometry().setFromPoints(stemPts);
  const stemLine = new THREE.Line(stemGeom, new THREE.LineBasicMaterial({ color: 0xf97316, depthTest: false }));
  stemLine.renderOrder = 9;
  stemLine.applyMatrix4(basis);
  gizmoGroup.add(stemLine);

  const arcPts = [];
  const arcR = hh + rotDist;
  for (let i = -8; i <= 8; i++) {
    const a = (i / 8) * 0.42;
    arcPts.push(new THREE.Vector3(Math.sin(a) * arcR, Math.cos(a) * arcR, 0));
  }
  const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPts);
  const arcLine = new THREE.Line(arcGeom, new THREE.LineBasicMaterial({ color: 0xf97316, depthTest: false }));
  arcLine.renderOrder = 9;
  arcLine.applyMatrix4(basis);
  gizmoGroup.add(arcLine);

  addHandle(
    new THREE.SphereGeometry(u * 0.85, 16, 12),
    0xf97316,
    0,
    hh + rotDist,
    0,
    'rotate'
  );
}

// ---------------- Image Loading & Quantization ----------------
async function decodeImageFile(fileOrStringOrBlob, labelName) {
  let url;
  let revoke = false;
  if (typeof fileOrStringOrBlob === 'string') {
    if (fileOrStringOrBlob.startsWith('data:') || fileOrStringOrBlob.startsWith('http://') || fileOrStringOrBlob.startsWith('https://') || fileOrStringOrBlob.startsWith('/')) {
      url = fileOrStringOrBlob;
      revoke = false;
    } else if (fileOrStringOrBlob.includes('<svg')) {
      const blob = new Blob([fileOrStringOrBlob], { type: 'image/svg+xml' });
      url = URL.createObjectURL(blob);
      revoke = true;
    } else {
      url = fileOrStringOrBlob;
      revoke = false;
    }
  } else {
    url = URL.createObjectURL(fileOrStringOrBlob);
    revoke = true;
  }
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = url;
    });
    const maxDim = 560;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 300, img.naturalHeight || 300));
    const width = Math.max(16, Math.round((img.naturalWidth || 300) * scale));
    const height = Math.max(16, Math.round((img.naturalHeight || 200) * scale));
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const ctx = off.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    state.rawImage = { width, height, data };
    state.aspect = width / height;
    if ($('lockAspect').checked) {
      state.height = Math.round((state.width / state.aspect) * 10) / 10;
      $('decalHeight').value = state.height;
    }
    updateImgLabel(labelName);
    if ($('imgDims')) {
      const origW = img.naturalWidth || width;
      const origH = img.naturalHeight || height;
      $('imgDims').textContent = `${origW}×${origH}`;
      $('imgDims').style.display = 'inline-block';
    }
    if ($('badgeImage')) {
      $('badgeImage').textContent = labelName;
      $('badgeImage').classList.add('visible');
    }
    runQuantize();
  } finally {
    if (revoke) URL.revokeObjectURL(url);
  }
}

function runQuantize() {
  if (!state.rawImage) return;
  const numColors = +$('numColors').value;
  const removeBackground = $('removeBg').checked;
  const bgTolerance = +$('bgTol').value;
  $('numColorsVal').textContent = numColors;
  $('bgTolVal').textContent = bgTolerance;
  $('bgTolField').style.display = removeBackground ? '' : 'none';

  state.quantized = quantizeImage(state.rawImage, {
    numColors,
    removeBackground,
    bgTolerance,
    despeckle: 1,
  });

  // Match default preview colors to detected image colors
  state.quantized.palette.forEach((rgb, i) => {
    const slot = state.paletteSlots[i] ?? Math.min(8, i + 2);
    state.paletteSlots[i] = slot;
    if (slot > 0) state.slotColors[slot - 1] = rgbToHex(rgb);
  });

  renderQuantPreviewAndTexture();
  renderPaletteList();
  state.lastResult = null;
  rebuildModelScene();
}

function renderQuantPreviewAndTexture() {
  const q = state.quantized;
  if (!q) return;
  const flipH = $('flipH').checked;
  const can = $('quantCanvas');
  can.width = q.width;
  can.height = q.height;
  const ctx = can.getContext('2d');
  const imgData = ctx.createImageData(q.width, q.height);
  const d = imgData.data;

  for (let y = 0; y < q.height; y++) {
    for (let x = 0; x < q.width; x++) {
      const sx = flipH ? q.width - 1 - x : x;
      const l = q.labels[y * q.width + sx];
      const o = (y * q.width + x) * 4;
      if (l >= 0 && state.paletteSlots[l] > 0) {
        const slot = state.paletteSlots[l];
        const rgb = hexToRgb(state.slotColors[slot - 1] || rgbToHex(q.palette[l]));
        d[o] = rgb.r;
        d[o + 1] = rgb.g;
        d[o + 2] = rgb.b;
        d[o + 3] = 255;
      } else {
        d[o + 3] = 0;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  if (decalTexture) decalTexture.dispose();
  decalTexture = new THREE.CanvasTexture(can);
  decalTexture.colorSpace = THREE.SRGBColorSpace;
  decalTexture.needsUpdate = true;
}

function renderPaletteList() {
  const list = $('paletteList');
  list.innerHTML = '';
  if (!state.quantized) return;
  const total = state.quantized.width * state.quantized.height;

  state.quantized.palette.forEach((rgb, idx) => {
    const slot = state.paletteSlots[idx] ?? Math.min(8, idx + 2);
    const pct = Math.max(1, Math.round((state.quantized.counts[idx] / total) * 100));
    const row = document.createElement('div');
    row.className = 'palette-row';

    const swatchColor = slot > 0 ? (state.slotColors[slot - 1] || rgbToHex(rgb)) : rgbToHex(rgb);
    row.innerHTML = `
      <div class="swatch-info">
        <input type="color" data-idx="${idx}" value="${swatchColor}" title="Change preview color" />
        <span>Color ${idx + 1} <small style="color:var(--muted)">(${pct}%)</small></span>
      </div>
      <select data-idx="${idx}">
        <option value="0" ${slot === 0 ? 'selected' : ''}>Skip (unpainted)</option>
        ${DEFAULT_SLOT_COLORS.map((_, s) => `<option value="${s + 1}" ${slot === s + 1 ? 'selected' : ''}>Filament ${s + 1}</option>`).join('')}
      </select>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const idx = +e.target.dataset.idx;
      state.paletteSlots[idx] = +e.target.value;
      state.lastResult = null;
      renderQuantPreviewAndTexture();
      rebuildModelScene();
    });
  });

  list.querySelectorAll('input[type="color"]').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const idx = +e.target.dataset.idx;
      const slot = state.paletteSlots[idx];
      if (slot > 0) state.slotColors[slot - 1] = e.target.value;
      renderQuantPreviewAndTexture();
      rebuildModelScene();
    });
  });
}

// ---------------- STL Loading & Face Alignment ----------------
function applyLoadedMesh(mesh, name) {
  // Center XY and put bottom at Z=0 so it sits cleanly on the build plate grid
  const b0 = meshBounds(mesh);
  const cx = (b0.min[0] + b0.max[0]) / 2;
  const cy = (b0.min[1] + b0.max[1]) / 2;
  const z0 = b0.min[2];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    p[i] -= cx;
    p[i + 1] -= cy;
    p[i + 2] -= z0;
  }

  state.modelName = name.replace(/\.stl$/i, '') || 'model';
  state.mesh = mesh;
  state.bounds = meshBounds(mesh);
  state.lastResult = null;

  const [sx, sy, sz] = state.bounds.size.map((v) => v.toFixed(1));
  $('stlStats').textContent = `${sx} × ${sy} × ${sz} mm · ${(mesh.indices.length / 3).toLocaleString()} triangles`;

  // Default decal size = 60% of top face, placed on the top face (+Z)
  state.width = Math.max(2, Math.round(Math.min(state.bounds.size[0], state.bounds.size[1]) * 0.65 * 10) / 10);
  state.baseWidth = state.width;
  state.scalePct = 100;
  state.height = Math.round((state.width / (state.aspect || 1.5)) * 10) / 10;
  $('decalWidth').value = state.width;
  $('decalHeight').value = state.height;
  if ($('decalScale')) $('decalScale').value = '100';
  if ($('scaleVal')) $('scaleVal').textContent = '100%';
  if ($('badgeModel')) {
    $('badgeModel').textContent = name;
    $('badgeModel').classList.add('visible');
  }

  snapToFace([0, 0, 1], true);
}

/** Project a 3D point onto the STL surface along the given normal direction. */
function projectPointToSurface(targetPoint, normal) {
  if (!pickableMesh) return targetPoint;
  const rayOrigin = new THREE.Vector3(
    targetPoint[0] + normal[0] * 50,
    targetPoint[1] + normal[1] * 50,
    targetPoint[2] + normal[2] * 50
  );
  const rayDir = new THREE.Vector3(-normal[0], -normal[1], -normal[2]).normalize();
  const surfRay = new THREE.Raycaster(rayOrigin, rayDir);
  const hits = surfRay.intersectObject(pickableMesh, false);
  if (hits.length > 0) {
    return [hits[0].point.x, hits[0].point.y, hits[0].point.z];
  }
  return targetPoint;
}

/** Center the decal horizontally ('x'), vertically ('y'), or both ('both') on the model. */
function centerImage(axis) {
  if (!state.bounds) return;
  const b = state.bounds;
  const midX = (b.min[0] + b.max[0]) / 2;
  const midY = (b.min[1] + b.max[1]) / 2;
  const midZ = (b.min[2] + b.max[2]) / 2;

  const nx = Math.abs(state.normal[0]);
  const ny = Math.abs(state.normal[1]);
  const nz = Math.abs(state.normal[2]);

  const target = [...state.origin];

  if (axis === 'x' || axis === 'both') {
    if (nx > 0.8) {
      // Normal is along X (side face) -> horizontal on face is Y
      target[1] = midY;
    } else {
      // Top/Bottom (+Z/-Z) or Front/Back (+Y/-Y) -> horizontal on face is X
      target[0] = midX;
    }
  }

  if (axis === 'y' || axis === 'both') {
    if (nz > 0.8) {
      // Normal is along Z (top/bottom) -> vertical on face is Y
      target[1] = midY;
    } else {
      // Side faces (Front/Back/Left/Right) -> vertical on face is Z
      target[2] = midZ;
    }
  }

  state.origin = projectPointToSurface(target, state.normal);
  state.lastResult = null;
  rebuildModelScene();
}

function snapToFace(dir, resetCamera = false) {
  if (!state.bounds) return;
  const b = state.bounds;
  const mid = [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
  state.normal = [...dir];
  state.origin = [
    dir[0] !== 0 ? (dir[0] > 0 ? b.max[0] : b.min[0]) : mid[0],
    dir[1] !== 0 ? (dir[1] > 0 ? b.max[1] : b.min[1]) : mid[1],
    dir[2] !== 0 ? (dir[2] > 0 ? b.max[2] : b.min[2]) : mid[2],
  ];
  state.lastResult = null;
  rebuildModelScene();

  if (resetCamera) {
    const diag = Math.hypot(...b.size) || 60;
    controls.target.set(mid[0], mid[1], mid[2]);
    camera.position.set(
      mid[0] + dir[0] * diag * 1.3 + (dir[0] === 0 ? diag * 0.25 : 0),
      mid[1] + dir[1] * diag * 1.3 + (dir[1] === 0 ? -diag * 0.85 : 0),
      mid[2] + dir[2] * diag * 1.3 + (dir[2] === 0 ? diag * 0.45 : 0)
    );
    controls.update();
  }
}

// ---------------- Surface Click / Drag / Scale / Rotate Placement ----------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragInteraction = null; // { mode: 'move'|'rotate'|'scale-corner'|'scale-x'|'scale-y', ... }

function updatePointerRay(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

/** Intersect the current camera ray with a plane through `planeOrigin` with normal `planeNormal`. */
function intersectRayPlane(planeOrigin, planeNormal) {
  const ro = [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z];
  const rd = [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z];
  const denom = dot(rd, planeNormal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot(sub(planeOrigin, ro), planeNormal) / denom;
  if (t < 0) return null;
  return [ro[0] + t * rd[0], ro[1] + t * rd[1], ro[2] + t * rd[2]];
}

function placeAtPointer(ev) {
  if (!pickableMesh) return false;
  updatePointerRay(ev);
  const hits = raycaster.intersectObject(pickableMesh, false);
  if (!hits.length) return false;
  const hit = hits[0];
  state.origin = [hit.point.x, hit.point.y, hit.point.z];
  if (hit.face) {
    const n = [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z];
    state.normal = $('snapAxis').checked ? snapToAxis(n) : n;
  }
  state.lastResult = null;
  rebuildModelScene();
  return true;
}

function cursorForHandle(handleType) {
  switch (handleType) {
    case 'rotate': return 'grab';
    case 'scale-corner': return 'nwse-resize';
    case 'scale-x': return 'ew-resize';
    case 'scale-y': return 'ns-resize';
    case 'move': return 'move';
    default: return '';
  }
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return; // left-click only
  updatePointerRay(ev);

  // 1. Check interactive 3D gizmo handles first (scale / rotate / move)
  if (gizmoHandles.length && $('showDecalHelper').checked) {
    const gHits = raycaster.intersectObjects(gizmoHandles, false);
    if (gHits.length) {
      if (state.lastResult) {
        state.lastResult = null;
        rebuildModelScene();
      }
      const handleType = gHits[0].object.userData?.handleType;
      if (handleType === 'move') {
        const frame = getCurrentFrame();
        const pt = intersectRayPlane(frame.origin, frame.normal);
        if (pt) {
          dragInteraction = {
            mode: 'move',
            startOrigin: [...frame.origin],
            startPt: pt,
            normal: [...frame.normal],
          };
          controls.enabled = false;
          renderer.domElement.style.cursor = 'move';
        }
        return;
      }
      if (handleType) {
        const frame = getCurrentFrame();
        const pt = intersectRayPlane(frame.origin, frame.normal);
        if (pt) {
          const rel = sub(pt, frame.origin);
          const lx = dot(rel, frame.right);
          const ly = dot(rel, frame.up);
          dragInteraction = {
            mode: handleType,
            origin: [...frame.origin],
            normal: [...frame.normal],
            right0: [...frame.right],
            up0: [...frame.up],
            startW: state.width,
            startH: state.height,
            startRadius: Math.max(0.5, Math.hypot(lx, ly)),
            startRotDeg: state.rotationDeg,
            startAngleRad: Math.atan2(-lx, ly),
          };
          controls.enabled = false;
          renderer.domElement.style.cursor = handleType === 'rotate' ? 'grabbing' : cursorForHandle(handleType);
          return;
        }
      }
    }
  }

  // Clicking outside the gizmo leaves orbit controls active and does not jump or center the decal
});

window.addEventListener('pointermove', (ev) => {
  if (!dragInteraction) {
    // Update hover cursor over gizmo handles
    if (gizmoHandles.length && $('showDecalHelper').checked && ev.target === renderer.domElement) {
      updatePointerRay(ev);
      const gHits = raycaster.intersectObjects(gizmoHandles, false);
      renderer.domElement.style.cursor = gHits.length ? cursorForHandle(gHits[0].object.userData?.handleType) : '';
    }
    return;
  }

  if (dragInteraction.mode === 'move') {
    updatePointerRay(ev);
    const pt = intersectRayPlane(dragInteraction.startOrigin, dragInteraction.normal);
    if (!pt) return;
    const dx = pt[0] - dragInteraction.startPt[0];
    const dy = pt[1] - dragInteraction.startPt[1];
    const dz = pt[2] - dragInteraction.startPt[2];
    const candidate = [
      dragInteraction.startOrigin[0] + dx,
      dragInteraction.startOrigin[1] + dy,
      dragInteraction.startOrigin[2] + dz,
    ];
    state.origin = projectPointToSurface(candidate, dragInteraction.normal);
    if (state.lastResult) {
      state.lastResult = null;
      rebuildModelScene();
    } else {
      updateDecalGizmo();
    }
    return;
  }

  updatePointerRay(ev);
  const pt = intersectRayPlane(dragInteraction.origin, dragInteraction.normal);
  if (!pt) return;
  const rel = sub(pt, dragInteraction.origin);
  const lx = dot(rel, dragInteraction.right0);
  const ly = dot(rel, dragInteraction.up0);

  if (dragInteraction.mode === 'rotate') {
    const curAngleRad = Math.atan2(-lx, ly);
    const deltaDeg = ((curAngleRad - dragInteraction.startAngleRad) * 180) / Math.PI;
    let deg = dragInteraction.startRotDeg + deltaDeg;
    // Wrap to [-180, 180]
    while (deg > 180) deg -= 360;
    while (deg < -180) deg += 360;
    deg = ev.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
    state.rotationDeg = deg;
    $('decalRot').value = String(deg);
    $('rotVal').textContent = `${deg}°`;
    if (state.lastResult) {
      state.lastResult = null;
      rebuildModelScene();
    } else {
      updateDecalGizmo();
    }
    return;
  }

  // Scale modes ('scale-corner', 'scale-x', 'scale-y')
  const lockAspect = $('lockAspect').checked && state.aspect > 0;
  let newW = state.width;
  let newH = state.height;

  if (dragInteraction.mode === 'scale-x') {
    newW = Math.max(1, Math.round(Math.abs(lx) * 2 * 10) / 10);
    if (lockAspect) newH = Math.max(1, Math.round((newW / state.aspect) * 10) / 10);
  } else if (dragInteraction.mode === 'scale-y') {
    newH = Math.max(1, Math.round(Math.abs(ly) * 2 * 10) / 10);
    if (lockAspect) newW = Math.max(1, Math.round(newH * state.aspect * 10) / 10);
  } else if (dragInteraction.mode === 'scale-corner') {
    if (lockAspect) {
      const ratio = Math.max(0.05, Math.hypot(lx, ly) / dragInteraction.startRadius);
      newW = Math.max(1, Math.round(dragInteraction.startW * ratio * 10) / 10);
      newH = Math.max(1, Math.round((newW / state.aspect) * 10) / 10);
    } else {
      newW = Math.max(1, Math.round(Math.abs(lx) * 2 * 10) / 10);
      newH = Math.max(1, Math.round(Math.abs(ly) * 2 * 10) / 10);
    }
  }

  state.width = newW;
  state.height = newH;
  $('decalWidth').value = String(newW);
  $('decalHeight').value = String(newH);
  if (state.baseWidth > 0 && $('decalScale')) {
    const newPct = Math.max(10, Math.min(300, Math.round((newW / state.baseWidth) * 100)));
    state.scalePct = newPct;
    $('decalScale').value = String(newPct);
    $('scaleVal').textContent = `${newPct}%`;
  }
  if (state.lastResult) {
    state.lastResult = null;
    rebuildModelScene();
  } else {
    updateDecalGizmo();
  }
});

window.addEventListener('pointerup', () => {
  if (dragInteraction) {
    dragInteraction = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = '';
  }
});

// ---------------- Paint & Export Execution ----------------
async function executePaint() {
  if (!state.mesh || !state.quantized) {
    setStatus('Load both an STL model and an image first.', 'error');
    return null;
  }
  const stateMap = toStateMap(state.quantized, state.paletteSlots, $('flipH').checked);
  const frame = getCurrentFrame();
  $('btnPaint').disabled = true;
  $('btnExport').disabled = true;

  try {
    const t0 = performance.now();
    if (state.mode === 'split') {
      setStatus('Running 3D boolean depth split (Manifold WASM)…');
      await new Promise((r) => setTimeout(r, 15));
      const wasm = await getManifold();
      const split = computeSplit(wasm, state.mesh, frame, stateMap, {
        depth: state.depth,
        baseSlot: state.baseSlot,
        maxPixels: 480,
      });
      state.lastResult = { mode: 'split', parts: split.parts };
      const dt = Math.round(performance.now() - t0);
      setStatus(
        `Painted ${split.parts.length} printable sub-parts (${state.depth} mm deep) in ${dt} ms. Ready to export!`,
        'ok'
      );
    } else {
      setStatus('Subdividing surface triangles & encoding Bambu paint_color…');
      await new Promise((r) => setTimeout(r, 15));
      const wasm = await getManifold();
      const cleanMesh = healMeshWithManifold(wasm, state.mesh);
      const painted = computePaint(cleanMesh, frame, stateMap, {
        minEdge: state.minEdge,
      });
      state.lastResult = {
        mode: 'paint',
        painted,
        parts: [{ name: state.modelName, slot: state.baseSlot, mesh: painted.mesh, paint: painted.paint }],
      };
      const dt = Math.round(performance.now() - t0);
      setStatus(
        `Painted ${painted.paintedTriangles} triangles (${painted.previewStates.length.toLocaleString()} sub-faces) in ${dt} ms.`,
        'ok'
      );
    }
    rebuildModelScene();
    return state.lastResult;
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), 'error');
    return null;
  } finally {
    $('btnPaint').disabled = false;
    $('btnExport').disabled = false;
  }
}

async function export3MFFile() {
  let res = state.lastResult;
  if (!res || res.mode !== state.mode) {
    res = await executePaint();
    if (!res) return;
  }
  const profile = $('profileSelect')?.value || 'a1_04_pei';
  const bytes = build3MF({
    name: state.modelName,
    parts: res.parts,
    baseSlot: state.baseSlot,
    profile,
    slotColors: state.slotColors,
  });
  const blob = new Blob([bytes], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suffix = state.mode === 'split' ? `${state.depth}mm` : 'painted';
  a.href = url;
  a.download = `${state.modelName}_${suffix}.3mf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setStatus(`Downloaded ${a.download} (${(bytes.byteLength / 1024).toFixed(1)} KB). Open directly in Bambu Studio!`, 'ok');
}

// ---------------- Wire Up Controls ----------------
function wireFileDrop(dropEl, inputEl, onFile) {
  dropEl.addEventListener('dragover', (e) => { e.preventDefault(); dropEl.classList.add('dragover'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragover'));
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropEl.classList.remove('dragover');
    if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  });
  inputEl.addEventListener('change', () => {
    if (inputEl.files[0]) onFile(inputEl.files[0]);
  });
}

wireFileDrop($('stlDrop'), $('stlInput'), async (file) => {
  try {
    const buf = await file.arrayBuffer();
    const mesh = loadSTL(buf);
    updateStlLabel(file.name);
    document.querySelectorAll('[data-preset-model]').forEach((b) => b.classList.remove('active'));
    applyLoadedMesh(mesh, file.name);
    setStatus(`Loaded ${file.name}. Click on the model to position the logo.`);
  } catch (e) {
    setStatus('Failed to read STL: ' + e.message, 'error');
  }
});

wireFileDrop($('imgDrop'), $('imgInput'), async (file) => {
  try {
    document.querySelectorAll('[data-preset-img]').forEach((b) => b.classList.remove('active'));
    await decodeImageFile(file, file.name);
    setStatus(`Loaded ${file.name}. Click "Preview on 3D Model" to apply.`);
  } catch (e) {
    setStatus('Failed to load image: ' + e.message, 'error');
  }
});

['numColors', 'removeBg', 'bgTol', 'flipH'].forEach((id) => {
  $(id).addEventListener('input', runQuantize);
});

document.querySelectorAll('[data-face]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.face.split(',').map(Number);
    // Automatically flip horizontally when placing on the bottom (-Z) so first-layer logos read right-side-up when flipped over
    if (dir[2] === -1 && !$('flipH').checked) {
      $('flipH').checked = true;
      renderQuantPreviewAndTexture();
    } else if (dir[2] === 1 && $('flipH').checked) {
      $('flipH').checked = false;
      renderQuantPreviewAndTexture();
    }
    snapToFace(dir, true);
  });
});

$('btnCenterX')?.addEventListener('click', () => centerImage('x'));
$('btnCenterY')?.addEventListener('click', () => centerImage('y'));
$('btnCenterBoth')?.addEventListener('click', () => centerImage('both'));

$('decalWidth').addEventListener('input', (e) => {
  state.width = Math.max(1, +e.target.value || 10);
  if ($('lockAspect').checked && state.aspect) {
    state.height = Math.round((state.width / state.aspect) * 10) / 10;
    $('decalHeight').value = state.height;
  }
  if (state.scalePct > 0) {
    state.baseWidth = state.width / (state.scalePct / 100);
  }
  state.lastResult = null;
  rebuildModelScene();
});

$('decalHeight').addEventListener('input', (e) => {
  state.height = Math.max(1, +e.target.value || 10);
  if ($('lockAspect').checked && state.aspect) {
    state.width = Math.round(state.height * state.aspect * 10) / 10;
    $('decalWidth').value = state.width;
  }
  if (state.scalePct > 0) {
    state.baseWidth = state.width / (state.scalePct / 100);
  }
  state.lastResult = null;
  rebuildModelScene();
});

$('decalScale')?.addEventListener('input', (e) => {
  const pct = +e.target.value;
  state.scalePct = pct;
  $('scaleVal').textContent = `${pct}%`;
  const baseW = state.baseWidth || state.width || 30;
  const newW = Math.max(1, Math.round(baseW * (pct / 100) * 10) / 10);
  state.width = newW;
  $('decalWidth').value = String(newW);
  if ($('lockAspect').checked && state.aspect) {
    state.height = Math.round((newW / state.aspect) * 10) / 10;
    $('decalHeight').value = String(state.height);
  }
  state.lastResult = null;
  updateDecalGizmo();
});

$('decalRot').addEventListener('input', (e) => {
  state.rotationDeg = +e.target.value;
  $('rotVal').textContent = `${state.rotationDeg}°`;
  state.lastResult = null;
  updateDecalGizmo();
});

$('decalReach').addEventListener('input', (e) => {
  state.reach = +e.target.value;
  $('reachVal').textContent = state.reach.toFixed(1);
  state.lastResult = null;
  updateDecalGizmo();
});

function updateLayerReadout() {
  state.depth = Math.max(0.05, +$('paintDepth').value || 0.6);
  state.layerHeight = Math.max(0.04, +$('layerHeight').value || 0.2);
  const layers = Math.max(1, Math.round(state.depth / state.layerHeight));
  $('layerReadout').innerHTML = `≈ <strong>${layers}</strong> layer${layers === 1 ? '' : 's'} deep at ${state.layerHeight.toFixed(2)} mm`;
  state.lastResult = null;
  updateDecalGizmo();
}
$('paintDepth').addEventListener('input', updateLayerReadout);
$('layerHeight').addEventListener('input', updateLayerReadout);

$('profileSelect')?.addEventListener('change', (e) => {
  const val = e.target.value;
  if (val.includes('02')) {
    if ($('layerHeight')) {
      $('layerHeight').value = '0.10';
      updateLayerReadout();
    }
  } else if (val.includes('04')) {
    if ($('layerHeight')) {
      $('layerHeight').value = '0.20';
      updateLayerReadout();
    }
  }
});

$('minEdge').addEventListener('input', (e) => {
  state.minEdge = +e.target.value;
  $('minEdgeVal').textContent = state.minEdge.toFixed(2);
  state.lastResult = null;
});

document.querySelectorAll('input[name="exportMode"]').forEach((rad) => {
  rad.addEventListener('change', (e) => {
    state.mode = e.target.value;
    $('tabSplit').classList.toggle('active', state.mode === 'split');
    $('tabPaint').classList.toggle('active', state.mode === 'paint');
    $('splitOptions').classList.toggle('hidden', state.mode !== 'split');
    $('paintOptions').classList.toggle('hidden', state.mode !== 'paint');
    state.lastResult = null;
    rebuildModelScene();
  });
});

$('showDecalHelper').addEventListener('change', updateDecalGizmo);
$('showDecalGraphic')?.addEventListener('change', updateDecalGizmo);
$('explodePreview').addEventListener('change', rebuildModelScene);
$('btnPaint').addEventListener('click', executePaint);
$('btnExport').addEventListener('click', export3MFFile);

async function selectSampleModel(modelKey) {
  const modelDef = SAMPLE_MODELS[modelKey];
  if (!modelDef) return;
  document.querySelectorAll('[data-preset-model]').forEach((b) => {
    b.classList.toggle('active', b.dataset.presetModel === modelKey);
  });
  const buf = modelDef.create();
  updateStlLabel(modelDef.name);
  applyLoadedMesh(loadSTL(buf), modelDef.name);
  if (modelDef.defaultReach !== undefined && $('decalReach')) {
    state.reach = modelDef.defaultReach;
    $('decalReach').value = String(modelDef.defaultReach);
    $('reachVal').textContent = modelDef.defaultReach.toFixed(1);
  }
  setStatus(`Loaded 3D shape ${modelDef.label}.`);
  await executePaint();
}

async function selectSampleImage(imgKey) {
  const imgDef = SAMPLE_IMAGES[imgKey];
  if (!imgDef) return;
  document.querySelectorAll('[data-preset-img]').forEach((b) => {
    b.classList.toggle('active', b.dataset.presetImg === imgKey);
  });
  if ($('numColors')) {
    $('numColors').value = String(imgDef.numColors);
    $('numColorsVal').textContent = String(imgDef.numColors);
  }
  if ($('removeBg')) {
    $('removeBg').checked = imgDef.removeBg;
    $('bgTolField').style.display = imgDef.removeBg ? '' : 'none';
  }
  if (imgDef.bgTol && $('bgTol')) {
    $('bgTol').value = String(imgDef.bgTol);
    $('bgTolVal').textContent = String(imgDef.bgTol);
  }
  let imageSource = imgDef.url || `/sample-images/${imgDef.name}`;
  try {
    const resp = await fetch(`/sample-images/${imgDef.name}?t=${Date.now()}`);
    if (resp.ok) {
      if (imgDef.name.endsWith('.png') || imgDef.name.endsWith('.jpg') || imgDef.name.endsWith('.webp')) {
        imageSource = await resp.blob();
      } else {
        const txt = await resp.text();
        if (txt && txt.includes('<svg')) imageSource = txt;
      }
    }
  } catch (_) {
    if (imgDef.svg) imageSource = imgDef.svg;
  }
  await decodeImageFile(imageSource, imgDef.name);
  setStatus(`Loaded graphic ${imgDef.label}.`);
  await executePaint();
}

function initPresetControls() {
  document.querySelectorAll('[data-preset-model]').forEach((btn) => {
    btn.addEventListener('click', () => selectSampleModel(btn.dataset.presetModel));
  });
  document.querySelectorAll('[data-preset-img]').forEach((btn) => {
    btn.addEventListener('click', () => selectSampleImage(btn.dataset.presetImg));
  });
}

async function loadDemo() {
  await selectSampleModel('flat');
  await selectSampleImage('2color');
}

$('btnSample')?.addEventListener('click', loadDemo);

function initCollapsibleCards() {
  document.querySelectorAll('.card-title').forEach((titleEl) => {
    titleEl.addEventListener('click', (e) => {
      // Don't toggle if a button, input, or other interactive element was clicked inside header
      if (e.target.closest('button, input, select, a, label')) return;
      const card = titleEl.closest('.card');
      if (card) card.classList.toggle('collapsed');
    });
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const card = titleEl.closest('.card');
        if (card) card.classList.toggle('collapsed');
      }
    });
  });
}

// Boot with the demo loaded so the user immediately sees a painted 3D model
initBaseSlotSelect();
initCollapsibleCards();
initPresetControls();
loadDemo();

