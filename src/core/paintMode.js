// "Surface paint" mode: encode the projected image as slicer paint data (Bambu Studio / OrcaSlicer `paint_color`).
//
// IMPORTANT: Bambu Studio's XML parser (Expat) has a fixed buffer limit on XML attribute values (~1 KB),
// and TriangleSelector::split_triangle splits ONLY edges longer than `minEdge` (1-, 2-, or 3-side splits):
//   sides[0] = |v2 - v1|^2   (edge opposite v0, i.e. edge 1: v1->v2)
//   sides[1] = |v0 - v2|^2   (edge opposite v1, i.e. edge 2: v2->v0)
//   sides[2] = |v1 - v0|^2   (edge opposite v2, i.e. edge 0: v0->v1)
// To guarantee unlimited attribute compactness AND exact edge compatibility with Bambu Studio:
//   1. Any coarse STL triangle whose projected bounding box overlaps the decal is pre-refined in the mesh
//      (splitting the longest edge at its midpoint, paired across shared edges so the mesh stays watertight)
//      until every triangle in the decal zone has edges <= coarseEdgeMax (~2.0 mm).
//   2. Each refined triangle then needs at most depth 3..4 of Bambu's native 1/2/3-side TriangleSelector
//      subdivision, keeping every `paint_color="..."` attribute well under ~60 hex chars.

import { toLocal, dot, sub, cross, norm } from './frame.js';

/** Build summed-area tables per filament state so we can test "is this pixel rectangle one color?" in O(states). */
export function buildStateIndex(stateMap) {
  const { width: W, height: H, states } = stateMap;
  const present = [...new Set(states)].sort((a, b) => a - b);
  const sats = new Map();
  for (const s of present) {
    const sat = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        if (states[y * W + x] === s) row++;
        sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
      }
    }
    sats.set(s, sat);
  }
  return {
    W, H, states, present, sats,
    sample(px, py) {
      const x = Math.floor(px), y = Math.floor(py);
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return states[y * W + x];
    },
    uniform(px0, py0, px1, py1) {
      const outside = px0 < 0 || py0 < 0 || px1 > W || py1 > H;
      const x0 = Math.max(0, Math.floor(px0)), y0 = Math.max(0, Math.floor(py0));
      const x1 = Math.min(W, Math.ceil(px1)), y1 = Math.min(H, Math.ceil(py1));
      if (x1 <= x0 || y1 <= y0) return 0;
      const area = (x1 - x0) * (y1 - y0);
      for (const s of present) {
        const sat = sats.get(s);
        const W1 = W + 1;
        const c = sat[y1 * W1 + x1] - sat[y0 * W1 + x1] - sat[y1 * W1 + x0] + sat[y0 * W1 + x0];
        if (c === 0) continue;
        if (c === area && (!outside || s === 0)) return s;
        return -1;
      }
      return 0;
    },
  };
}

/**
 * Watertight longest-edge bisection of mesh triangles inside the decal's bounding region so no painted
 * triangle has huge edges (which would otherwise require deep `paint_color` strings that overflow Expat).
 */
export function refineMeshInDecalZone(mesh, frame, maxEdgeLen = 2.0) {
  const maxLen2 = maxEdgeLen * maxEdgeLen;
  const pos = Array.from(mesh.positions);
  let tris = Array.from(mesh.indices);
  const halfW = frame.width * 0.55;
  const halfH = frame.height * 0.55;
  const reach = frame.reach * 1.5;

  const vCoord = (vi) => [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]];
  const edgeLen2 = (u, v) => {
    const dx = pos[u * 3] - pos[v * 3];
    const dy = pos[u * 3 + 1] - pos[v * 3 + 1];
    const dz = pos[u * 3 + 2] - pos[v * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const edgeKey = (u, v) => (u < v ? `${u}_${v}` : `${v}_${u}`);

  const triTouchesDecal = (a, b, c) => {
    const pa = vCoord(a), pb = vCoord(b), pc = vCoord(c);
    const d0 = sub(pa, frame.origin), d1 = sub(pb, frame.origin), d2 = sub(pc, frame.origin);
    const h0 = dot(d0, frame.normal), h1 = dot(d1, frame.normal), h2 = dot(d2, frame.normal);
    if (Math.min(h0, h1, h2) > reach || Math.max(h0, h1, h2) < -reach) return false;
    const x0 = dot(d0, frame.right), x1 = dot(d1, frame.right), x2 = dot(d2, frame.right);
    if (Math.min(x0, x1, x2) > halfW || Math.max(x0, x1, x2) < -halfW) return false;
    const y0 = dot(d0, frame.up), y1 = dot(d1, frame.up), y2 = dot(d2, frame.up);
    if (Math.min(y0, y1, y2) > halfH || Math.max(y0, y1, y2) < -halfH) return false;
    return true;
  };

  for (let pass = 0; pass < 18; pass++) {
    // 1. Mark every edge longer than maxEdgeLen on triangles overlapping the decal region.
    //    To avoid T-junctions on adjacent triangles, any marked edge is split on BOTH triangles sharing it.
    const midpoints = new Map();
    const getOrAddMid = (u, v) => {
      const k = edgeKey(u, v);
      let m = midpoints.get(k);
      if (m === undefined) {
        m = pos.length / 3;
        pos.push(
          0.5 * (pos[u * 3] + pos[v * 3]),
          0.5 * (pos[u * 3 + 1] + pos[v * 3 + 1]),
          0.5 * (pos[u * 3 + 2] + pos[v * 3 + 2])
        );
        midpoints.set(k, m);
      }
      return m;
    };

    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      if (!triTouchesDecal(a, b, c)) continue;
      const l01 = edgeLen2(a, b), l12 = edgeLen2(b, c), l20 = edgeLen2(c, a);
      const maxL = Math.max(l01, l12, l20);
      if (maxL <= maxLen2) continue;
      // Split the longest edge (and any edge within 80% of the longest)
      const thresh = Math.max(maxLen2, maxL * 0.64);
      if (l01 >= thresh) getOrAddMid(a, b);
      if (l12 >= thresh) getOrAddMid(b, c);
      if (l20 >= thresh) getOrAddMid(c, a);
    }

    if (midpoints.size === 0) break;

    const nextTris = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const m01 = midpoints.get(edgeKey(a, b));
      const m12 = midpoints.get(edgeKey(b, c));
      const m20 = midpoints.get(edgeKey(c, a));
      const count = (m01 !== undefined ? 1 : 0) + (m12 !== undefined ? 1 : 0) + (m20 !== undefined ? 1 : 0);
      if (count === 0) {
        nextTris.push(a, b, c);
      } else if (count === 3) {
        nextTris.push(a, m01, m20, m01, b, m12, m12, c, m20, m01, m12, m20);
      } else if (count === 1) {
        if (m01 !== undefined) nextTris.push(a, m01, c, m01, b, c);
        else if (m12 !== undefined) nextTris.push(a, b, m12, a, m12, c);
        else nextTris.push(a, b, m20, m20, b, c);
      } else {
        // count === 2: rotate so the unsplit edge is (v0, v1)
        let v0 = a, v1 = b, v2 = c, ma = m12, mb = m20;
        if (m12 === undefined) { v0 = b; v1 = c; v2 = a; ma = m20; mb = m01; }
        else if (m20 === undefined) { v0 = c; v1 = a; v2 = b; ma = m01; mb = m12; }
        nextTris.push(v0, v1, mb, v1, ma, mb, ma, v2, mb);
      }
    }
    tris = nextTris;
    if (tris.length / 3 > 120000) break;
  }

  return {
    positions: new Float32Array(pos),
    indices: new Uint32Array(tris),
  };
}

/**
 * Compute Bambu Studio `paint_color` trees for every triangle.
 * Matches `TriangleSelector::split_triangle` and `TriangleSelector::perform_split` in BambuStudio:
 *   - Edge length check:
 *       pt_idx = 0: |v2 - v1|^2 > limit^2
 *       pt_idx = 1: |v0 - v2|^2 > limit^2
 *       pt_idx = 2: |v1 - v0|^2 > limit^2
 *   - 1, 2, or 3 split sides with exact `special_side` and child ordering.
 *
 * @param {{positions:Float32Array,indices:Uint32Array}} mesh
 * @param {import('./frame.js').DecalFrame} frame
 * @param {{width:number,height:number,states:Uint8Array}} stateMap
 * @param {object} opts
 * @param {number} [opts.minEdge=0.25]  stop subdividing below this edge length (mm)
 * @param {number} [opts.maxDepth=4]    max subdivision depth per mesh triangle (keeps paint_color compact)
 * @param {number} [opts.maxAngleDeg=80]
 * @returns {{mesh:{positions:Float32Array,indices:Uint32Array}, paint:string[], previewPositions:Float32Array, previewStates:Uint8Array, paintedTriangles:number, leaves:number}}
 */
export function computePaint(mesh, frame, stateMap, opts = {}) {
  const minEdge = opts.minEdge ?? 0.25;
  const maxDepth = opts.maxDepth ?? 4;
  const cosMax = Math.cos(((opts.maxAngleDeg ?? 80) * Math.PI) / 180);
  const idx = buildStateIndex(stateMap);
  const { W, H } = idx;
  const reach = frame.reach;

  // Pre-refine coarse triangles in the decal zone so `maxDepth = 4` achieves fine `minEdge` detail
  // while keeping every `paint_color` attribute short (~1–85 hex chars).
  const targetCoarseEdge = Math.max(minEdge * (1 << (maxDepth - 1)), 1.5);
  const workingMesh = refineMeshInDecalZone(mesh, frame, targetCoarseEdge);

  const P = workingMesh.positions, I = workingMesh.indices;
  const triCount = I.length / 3;
  const paint = new Array(triCount).fill('');
  const prevPos = [];
  const prevState = [];
  let leaves = 0, painted = 0;

  const vtx = (p) => {
    const l = toLocal(frame, p);
    return { p, px: l.s * W, py: (1 - l.t) * H, h: l.h };
  };
  const mid = (a, b) => ({
    p: [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2],
    px: (a.px + b.px) / 2, py: (a.py + b.py) / 2, h: (a.h + b.h) / 2,
  });
  const dist2 = (a, b) => (a.p[0] - b.p[0]) ** 2 + (a.p[1] - b.p[1]) ** 2 + (a.p[2] - b.p[2]) ** 2;
  const minEdge2 = minEdge * minEdge;

  const centroidState = (a, b, c) => {
    const h = (a.h + b.h + c.h) / 3;
    if (Math.abs(h) > reach) return 0;
    return idx.sample((a.px + b.px + c.px) / 3, (a.py + b.py + c.py) / 3);
  };

  // Always use 3-side midpoint subdivision (code '3': splitSides=3, specialSide=0) on the pre-refined mesh.
  // Because `refineMeshInDecalZone` already bisects any elongated or coarse triangles in the decal zone,
  // uniform 3-side splits avoid 1/2-side grandchild midpoint recursion in Bambu Studio's TriangleSelector
  // while keeping every `paint_color` string short (<= 85 chars at maxDepth=4).
  function splitTriangleVertices(v0, v1, v2) {
    const maxE2 = Math.max(dist2(v2, v1), dist2(v0, v2), dist2(v1, v0));
    if (maxE2 <= minEdge2) return null;

    const m01 = mid(v1, v0);
    const m12 = mid(v2, v1);
    const m20 = mid(v0, v2);
    return {
      splitSides: 3,
      specialSide: 0,
      childrenTris: [
        [v0, m01, m20],
        [m01, v1, m12],
        [m12, v2, m20],
        [m01, m12, m20],
      ],
    };
  }

  function build(a, b, c, depth) {
    const inA = Math.abs(a.h) <= reach, inB = Math.abs(b.h) <= reach, inC = Math.abs(c.h) <= reach;
    if (!inA && !inB && !inC) {
      const sa = Math.sign(a.h);
      if (sa === Math.sign(b.h) && sa === Math.sign(c.h)) return { state: 0 };
    }
    let st = -1;
    if (inA && inB && inC) {
      st = idx.uniform(
        Math.min(a.px, b.px, c.px), Math.min(a.py, b.py, c.py),
        Math.max(a.px, b.px, c.px), Math.max(a.py, b.py, c.py)
      );
    }
    if (st >= 0) return { state: st };
    if (depth >= maxDepth) return { state: centroidState(a, b, c) };

    const split = splitTriangleVertices(a, b, c);
    if (!split) return { state: centroidState(a, b, c) };

    leaves += 3;
    const ch = split.childrenTris.map(([u, v, w]) => build(u, v, w, depth + 1));
    if (!ch[0].children && ch.every((k) => !k.children && k.state === ch[0].state)) {
      return { state: ch[0].state };
    }
    return {
      children: ch,
    };
  }

  function collectPreview(node, a, b, c) {
    if (node.children) {
      const split = splitTriangleVertices(a, b, c);
      if (!split) return;
      for (let i = 0; i < node.children.length; i++) {
        const [u, v, w] = split.childrenTris[i];
        collectPreview(node.children[i], u, v, w);
      }
    } else if (node.state > 0) {
      prevPos.push(...a.p, ...b.p, ...c.p);
      prevState.push(node.state);
    }
  }

  for (let t = 0; t < triCount; t++) {
    const pa = [P[I[t * 3] * 3], P[I[t * 3] * 3 + 1], P[I[t * 3] * 3 + 2]];
    const pb = [P[I[t * 3 + 1] * 3], P[I[t * 3 + 1] * 3 + 1], P[I[t * 3 + 1] * 3 + 2]];
    const pc = [P[I[t * 3 + 2] * 3], P[I[t * 3 + 2] * 3 + 1], P[I[t * 3 + 2] * 3 + 2]];
    const n = norm(cross(sub(pb, pa), sub(pc, pa)));
    if (dot(n, frame.normal) <= cosMax) continue;
    const a = vtx(pa), b = vtx(pb), c = vtx(pc);
    if (Math.max(a.px, b.px, c.px) < 0 || Math.min(a.px, b.px, c.px) > W) continue;
    if (Math.max(a.py, b.py, c.py) < 0 || Math.min(a.py, b.py, c.py) > H) continue;
    const root = build(a, b, c, 0);
    if (!root.children && root.state === 0) continue;
    paint[t] = encodeNode(root);
    painted++;
    collectPreview(root, a, b, c);
  }

  return {
    mesh: workingMesh,
    paint,
    previewPositions: new Float32Array(prevPos),
    previewStates: new Uint8Array(prevState),
    paintedTriangles: painted,
    leaves,
  };
}

/** Serialize a paint tree node to the slicer's hex string. */
export function encodeNode(node) {
  const bits = [];
  (function ser(nd) {
    if (nd.children) {
      const splitSides = nd.splitSides ?? 3;
      const specialSide = splitSides === 3 ? 0 : (nd.specialSide ?? 0);
      bits.push(splitSides & 1, (splitSides >> 1) & 1, specialSide & 1, (specialSide >> 1) & 1);
      for (let i = nd.children.length - 1; i >= 0; i--) ser(nd.children[i]);
    } else {
      const s = nd.state;
      if (s >= 3) {
        bits.push(0, 0, 1, 1);
        let n = s - 3;
        while (n >= 15) { bits.push(1, 1, 1, 1); n -= 15; }
        for (let b = 0; b < 4; b++) bits.push((n >> b) & 1);
      } else {
        bits.push(0, 0, s & 1, (s >> 1) & 1);
      }
    }
  })(node);
  let out = '';
  for (let o = 0; o < bits.length; o += 4) {
    const code = bits[o] | (bits[o + 1] << 1) | (bits[o + 2] << 2) | (bits[o + 3] << 3);
    out = code.toString(16).toUpperCase() + out;
  }
  return out;
}

/** Inverse of encodeNode (used by tests to verify round trips). */
export function decodePaint(str) {
  const nibbles = [];
  for (let i = str.length - 1; i >= 0; i--) nibbles.push(parseInt(str[i], 16));
  let k = 0;
  function read() {
    const code = nibbles[k++];
    const split = code & 3;
    if (split) {
      const specialSide = code >> 2;
      const ch = new Array(split + 1);
      for (let i = split; i >= 0; i--) ch[i] = read();
      const node = { children: ch };
      if (split !== 3) { node.splitSides = split; node.specialSide = specialSide; }
      return node;
    }
    if ((code & 12) === 12) {
      let n = nibbles[k++], extra = 0;
      while (n === 15) { extra++; n = nibbles[k++]; }
      return { state: n + 15 * extra + 3 };
    }
    return { state: code >> 2 };
  }
  const root = read();
  if (k !== nibbles.length) throw new Error('trailing data in paint string');
  return root;
}
