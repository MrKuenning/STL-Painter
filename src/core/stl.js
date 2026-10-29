// STL parsing + vertex welding. Pure JS (no DOM) so it runs in the browser and in Node tests.

/**
 * Parse a binary or ASCII STL into a flat, non-indexed Float32Array of triangle vertex positions.
 * @param {ArrayBuffer} buffer
 * @returns {Float32Array} length = triangles * 9
 */
export function parseSTL(buffer) {
  const bytes = new Uint8Array(buffer);
  if (isBinarySTL(bytes)) return parseBinary(buffer);
  return parseASCII(new TextDecoder().decode(bytes));
}

function isBinarySTL(bytes) {
  if (bytes.length < 84) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 === bytes.length) return true;
  // Some exporters write "solid" in the binary header, so only fall back to ASCII when it really looks like text.
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(512, bytes.length)));
  return !(/^\s*solid/i.test(head) && /facet/i.test(head));
}

function parseBinary(buffer) {
  const dv = new DataView(buffer);
  const n = dv.getUint32(80, true);
  const out = new Float32Array(n * 9);
  let o = 84;
  for (let i = 0; i < n; i++) {
    o += 12; // skip normal
    for (let k = 0; k < 9; k++) {
      out[i * 9 + k] = dv.getFloat32(o, true);
      o += 4;
    }
    o += 2; // attribute byte count
  }
  return out;
}

function parseASCII(text) {
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const vals = [];
  let m;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  const triCount = Math.floor(vals.length / 9);
  return new Float32Array(vals.slice(0, triCount * 9));
}

/**
 * Weld duplicate vertices so we get an indexed mesh (required by 3MF and by the boolean engine).
 * Degenerate triangles (two identical welded vertices) are dropped.
 * @param {Float32Array} soup non-indexed positions
 * @param {number} tolerance weld distance in mm
 * @returns {{positions: Float32Array, indices: Uint32Array}}
 */
export function weldVertices(soup, tolerance = 1e-4) {
  const inv = 1 / tolerance;
  const map = new Map();
  const pos = [];
  const triCount = soup.length / 9;
  const idx = new Uint32Array(triCount * 3);
  let t = 0;
  const tri = [0, 0, 0];
  for (let i = 0; i < triCount; i++) {
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3;
      const x = soup[o], y = soup[o + 1], z = soup[o + 2];
      const key = Math.round(x * inv) + ',' + Math.round(y * inv) + ',' + Math.round(z * inv);
      let id = map.get(key);
      if (id === undefined) {
        id = pos.length / 3;
        pos.push(x, y, z);
        map.set(key, id);
      }
      tri[k] = id;
    }
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    idx[t++] = tri[0];
    idx[t++] = tri[1];
    idx[t++] = tri[2];
  }
  return { positions: new Float32Array(pos), indices: idx.slice(0, t) };
}

export function meshBounds(mesh) {
  const p = mesh.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Make triangle winding counter-clockwise seen from outside (positive signed volume). Mutates and returns mesh. */
export function ensureOutwardWinding(mesh) {
  const P = mesh.positions, I = mesh.indices;
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
         - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
         + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) {
    for (let t = 0; t < I.length; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  }
  return mesh;
}

/** Load an STL buffer into a welded, outward-wound indexed mesh. */
export function loadSTL(buffer) {
  return ensureOutwardWinding(weldVertices(parseSTL(buffer)));
}
