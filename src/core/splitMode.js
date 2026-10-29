// "Geometry split" mode: physically cut the model into a base part + one part per filament color.
// The colored parts are exactly `depth` mm thick (measured along the projection direction), so the
// slicer prints the image exactly N layers deep on a flat top surface.

import { frameMatrix } from './frame.js';

/** Trace the boundary of a binary pixel mask into closed polygons (pixel-corner coordinates). */
export function traceMask(mask, W, H) {
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const W1 = W + 1;
  const out = new Map(); // start vertex -> array of end vertices
  const addEdge = (x0, y0, x1, y1) => {
    const k = y0 * W1 + x0;
    const v = y1 * W1 + x1;
    const l = out.get(k);
    if (l) l.push(v); else out.set(k, [v]);
  };
  let edgeCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) { addEdge(x + 1, y, x, y); edgeCount++; }
      if (!at(x, y + 1)) { addEdge(x, y + 1, x + 1, y + 1); edgeCount++; }
      if (!at(x - 1, y)) { addEdge(x, y, x, y + 1); edgeCount++; }
      if (!at(x + 1, y)) { addEdge(x + 1, y + 1, x + 1, y); edgeCount++; }
    }
  }
  const loops = [];
  for (const [start] of out) {
    let l = out.get(start);
    while (l && l.length) {
      const loop = [start];
      let cur = l.pop();
      let guard = 0;
      while (cur !== start && guard++ <= edgeCount) {
        loop.push(cur);
        const nl = out.get(cur);
        if (!nl || !nl.length) break;
        cur = nl.pop();
      }
      if (cur === start && loop.length >= 4) loops.push(simplifyLoop(loop.map((v) => [v % W1, Math.floor(v / W1)])));
      l = out.get(start);
    }
  }
  return loops;
}

/** Drop collinear points from an axis-aligned pixel loop. */
function simplifyLoop(pts) {
  const n = pts.length;
  const res = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const cr = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (cr !== 0) res.push(c);
  }
  return res;
}

/** Nearest-neighbour downsample of a state map so polygons stay manageable. */
export function downsampleStates(stateMap, maxSide) {
  const { width, height, states } = stateMap;
  const f = Math.max(width, height) / maxSide;
  if (f <= 1) return stateMap;
  const w = Math.max(1, Math.round(width / f)), h = Math.max(1, Math.round(height / f));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / w));
      out[y * w + x] = states[sy * width + sx];
    }
  }
  return { width: w, height: h, states: out };
}

/**
 * @param {object} wasm initialised manifold-3d module
 * @param {{positions:Float32Array,indices:Uint32Array}} mesh
 * @param {import('./frame.js').DecalFrame} frame
 * @param {{width:number,height:number,states:Uint8Array}} stateMap
 * @param {object} opts
 * @param {number} opts.depth        paint depth in mm
 * @param {number} opts.baseSlot     filament for the rest of the model
 * @param {number} [opts.maxPixels=512] polygon resolution (long side, pixels)
 * @returns {{parts:{name:string,slot:number,mesh:{positions:Float32Array,indices:Uint32Array}}[]}}
 */
export function computeSplit(wasm, mesh, frame, stateMap, opts) {
  const { Manifold, Mesh, CrossSection } = wasm;
  const depth = opts.depth;
  const garbage = [];
  const keep = (o) => (garbage.push(o), o);
  try {
    const mm = new Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
    mm.merge();
    let model;
    try {
      model = keep(new Manifold(mm));
    } catch (e) {
      throw new Error('The STL is not a closed (watertight) solid, so it cannot be split. Repair it first or use "Surface paint" mode.');
    }
    const sm = downsampleStates(stateMap, opts.maxPixels ?? 512);
    const { width: W, height: H } = sm;

    // How far the prisms must extend "above" the surface so they cover everything in front of it.
    const p = mesh.positions;
    let r = 0;
    for (let i = 0; i < p.length; i += 3) {
      r = Math.max(r, Math.hypot(p[i] - frame.origin[0], p[i + 1] - frame.origin[1], p[i + 2] - frame.origin[2]));
    }
    const zMin = -(frame.reach + depth);
    const zMax = r + 1;

    // Shell = points of the model whose point `depth` mm further out along the normal is outside the model.
    const n = frame.normal;
    const shifted = keep(model.translate([-n[0] * depth, -n[1] * depth, -n[2] * depth]));
    const shell = keep(model.subtract(shifted));

    const slots = [...new Set(sm.states)].filter((s) => s > 0).sort((a, b) => a - b);
    const parts = [];
    const colored = [];
    const M = frameMatrix(frame);
    for (const slot of slots) {
      const mask = new Uint8Array(W * H);
      for (let i = 0; i < mask.length; i++) mask[i] = sm.states[i] === slot ? 1 : 0;
      const loops = traceMask(mask, W, H);
      if (!loops.length) continue;
      const polys = loops.map((loop) => loop.map(([gx, gy]) => [(gx / W - 0.5) * frame.width, (0.5 - gy / H) * frame.height]));
      const cs = keep(new CrossSection(polys, 'EvenOdd'));
      if (cs.isEmpty()) continue;
      const prism = keep(keep(keep(Manifold.extrude(cs, zMax - zMin)).translate([0, 0, zMin])).transform(M));
      const part = keep(shell.intersect(prism));
      if (part.isEmpty()) continue;
      colored.push(part);
      parts.push({ name: `Color filament ${slot}`, slot, mesh: toMesh(part) });
    }
    if (!parts.length) throw new Error('The image does not overlap the model. Move it onto the surface or increase "Reach".');
    let base = model;
    for (const c of colored) base = keep(base.subtract(c));
    const result = [];
    if (!base.isEmpty()) result.push({ name: 'Base', slot: opts.baseSlot, mesh: toMesh(base) });
    return { parts: result.concat(parts) };
  } finally {
    for (const g of garbage) { try { g.delete(); } catch { /* already freed */ } }
  }
}

function toMesh(manifold) {
  const m = manifold.getMesh();
  const np = m.numProp;
  const nv = m.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = m.vertProperties[i * np];
    positions[i * 3 + 1] = m.vertProperties[i * np + 1];
    positions[i * 3 + 2] = m.vertProperties[i * np + 2];
  }
  return { positions, indices: new Uint32Array(m.triVerts) };
}

/**
 * Repair/merge vertex seams and enforce manifold topology using Manifold WASM when possible.
 * Falls back to the input mesh if the STL is an open sheet.
 */
export function healMeshWithManifold(wasm, mesh) {
  const { Manifold, Mesh } = wasm;
  let mm = null, model = null;
  try {
    mm = new Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
    mm.merge();
    model = new Manifold(mm);
    if (model.isEmpty()) return mesh;
    return toMesh(model);
  } catch {
    return mesh;
  } finally {
    try { model?.delete?.(); } catch { /* ignore */ }
    try { mm?.delete?.(); } catch { /* ignore */ }
  }
}


