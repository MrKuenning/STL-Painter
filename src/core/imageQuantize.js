// Image -> color-indexed label map. Pure JS (works on {width,height,data:RGBA} objects).

/**
 * @typedef {{width:number,height:number,labels:Int16Array,palette:{r:number,g:number,b:number}[]}} LabelMap
 * labels[i] = -1 means "no paint" (transparent / background), otherwise an index into palette.
 */

/**
 * Quantize an RGBA image down to `numColors` colors.
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img
 * @param {object} opts
 * @param {number} opts.numColors 1..16
 * @param {number} [opts.alphaThreshold=128] pixels with alpha below this are ignored
 * @param {boolean} [opts.removeBackground=true] treat the dominant border color as background
 * @param {number} [opts.bgTolerance=40] RGB distance for background removal
 * @param {number} [opts.despeckle=1] number of 3x3 majority-filter passes
 * @returns {LabelMap}
 */
export function quantizeImage(img, opts) {
  const { width, height, data } = img;
  const numColors = Math.max(1, Math.min(16, opts.numColors | 0 || 1));
  const alphaThreshold = opts.alphaThreshold ?? 128;
  const bgTol = opts.bgTolerance ?? 40;
  const n = width * height;
  const opaque = new Uint8Array(n);
  for (let i = 0; i < n; i++) opaque[i] = data[i * 4 + 3] >= alphaThreshold ? 1 : 0;

  if (opts.removeBackground ?? true) {
    const bg = dominantBorderColor(img, opaque);
    if (bg) {
      const t2 = bgTol * bgTol;
      // Flood fill from the border so interior regions of the same color (e.g. white inside a logo) are kept.
      const stack = [];
      const visited = new Uint8Array(n);
      const matches = (i) => {
        const dr = data[i * 4] - bg[0], dg = data[i * 4 + 1] - bg[1], db = data[i * 4 + 2] - bg[2];
        return dr * dr + dg * dg + db * db <= t2;
      };
      for (let x = 0; x < width; x++) { stack.push(x, (height - 1) * width + x); }
      for (let y = 0; y < height; y++) { stack.push(y * width, y * width + width - 1); }
      while (stack.length) {
        const i = stack.pop();
        if (visited[i]) continue;
        visited[i] = 1;
        if (opaque[i] && !matches(i)) continue; // a real colored pixel: stop here
        opaque[i] = 0;
        const x = i % width, y = (i / width) | 0;
        if (x > 0) stack.push(i - 1);
        if (x < width - 1) stack.push(i + 1);
        if (y > 0) stack.push(i - width);
        if (y < height - 1) stack.push(i + width);
      }
    }
  }

  // Gather samples of opaque pixels.
  const opaqueIdx = [];
  for (let i = 0; i < n; i++) if (opaque[i]) opaqueIdx.push(i);
  const labels = new Int16Array(n).fill(-1);
  if (opaqueIdx.length === 0) return { width, height, labels, palette: [] };

  const maxSamples = 30000;
  const step = Math.max(1, Math.floor(opaqueIdx.length / maxSamples));
  const samples = [];
  for (let j = 0; j < opaqueIdx.length; j += step) {
    const i = opaqueIdx[j];
    samples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  }
  const centers = kmeans(samples, numColors);

  for (const i of opaqueIdx) {
    labels[i] = nearest(centers, data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }

  let result = { width, height, labels, palette: centers.map(([r, g, b]) => ({ r: Math.round(r), g: Math.round(g), b: Math.round(b) })) };
  for (let p = 0; p < (opts.despeckle ?? 1); p++) result = majorityFilter(result);
  return compactPalette(result);
}

function dominantBorderColor(img, opaque) {
  const { width, height, data } = img;
  const counts = new Map();
  const add = (x, y) => {
    const i = y * width + x;
    if (!opaque[i]) return;
    // bucket to 4 bits/channel
    const key = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
    const c = counts.get(key);
    if (c) { c.n++; c.r += data[i * 4]; c.g += data[i * 4 + 1]; c.b += data[i * 4 + 2]; }
    else counts.set(key, { n: 1, r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] });
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y++) { add(0, y); add(width - 1, y); }
  let best = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  const perimeter = 2 * (width + height);
  // Only treat it as background if it dominates the border.
  if (!best || best.n < perimeter * 0.3) return null;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

function nearest(centers, r, g, b) {
  let bi = 0, bd = Infinity;
  for (let k = 0; k < centers.length; k++) {
    const c = centers[k];
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) { bd = d; bi = k; }
  }
  return bi;
}

// Deterministic k-means++ (seeded PRNG) so results are stable between runs.
function kmeans(samples, k) {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const centers = [samples[Math.floor(rand() * samples.length)].slice()];
  const d2 = new Float64Array(samples.length);
  while (centers.length < k) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let bd = Infinity;
      for (const c of centers) bd = Math.min(bd, (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 + (c[2] - s[2]) ** 2);
      d2[i] = bd;
      sum += bd;
    }
    if (sum === 0) break; // fewer distinct colors than k
    let r = rand() * sum, i = 0;
    for (; i < samples.length - 1; i++) { r -= d2[i]; if (r <= 0) break; }
    centers.push(samples[i].slice());
  }
  const assign = new Int32Array(samples.length);
  for (let iter = 0; iter < 25; iter++) {
    let changed = false;
    for (let i = 0; i < samples.length; i++) {
      const a = nearest(centers, samples[i][0], samples[i][1], samples[i][2]);
      if (a !== assign[i]) { changed = true; assign[i] = a; }
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      const a = acc[assign[i]];
      a[0] += samples[i][0]; a[1] += samples[i][1]; a[2] += samples[i][2]; a[3]++;
    }
    for (let c = 0; c < centers.length; c++) if (acc[c][3]) centers[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
    if (!changed && iter > 0) break;
  }
  return centers;
}

function majorityFilter(map) {
  const { width, height, labels } = map;
  const out = new Int16Array(labels.length);
  const counts = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      counts.clear();
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const l = labels[yy * width + xx];
          counts.set(l, (counts.get(l) || 0) + 1);
        }
      }
      const own = labels[y * width + x];
      let best = own, bc = counts.get(own);
      for (const [l, c] of counts) if (c > bc) { best = l; bc = c; }
      // Only replace isolated pixels (needs a clear majority).
      out[y * width + x] = bc >= 5 ? best : own;
    }
  }
  return { ...map, labels: out };
}

/** Remove unused palette entries and sort by pixel count (most common first). */
function compactPalette(map) {
  const counts = new Array(map.palette.length).fill(0);
  for (const l of map.labels) if (l >= 0) counts[l]++;
  const order = counts.map((c, i) => [c, i]).filter(([c]) => c > 0).sort((a, b) => b[0] - a[0]);
  const remap = new Int16Array(map.palette.length).fill(-1);
  order.forEach(([, i], j) => (remap[i] = j));
  const labels = new Int16Array(map.labels.length);
  for (let i = 0; i < labels.length; i++) labels[i] = map.labels[i] >= 0 ? remap[map.labels[i]] : -1;
  return { ...map, labels, palette: order.map(([, i]) => map.palette[i]), counts: order.map(([c]) => c) };
}

/**
 * Convert a label map into a per-pixel filament "state" map using the palette->filament assignment.
 * @param {LabelMap} map
 * @param {number[]} slotOf slotOf[paletteIndex] = filament number (1..16) or 0 to skip
 * @param {boolean} flipH mirror horizontally
 * @returns {{width:number,height:number,states:Uint8Array}}
 */
export function toStateMap(map, slotOf, flipH = false) {
  const { width, height, labels } = map;
  const states = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = flipH ? width - 1 - x : x;
      const l = labels[y * width + sx];
      states[y * width + x] = l >= 0 ? (slotOf[l] | 0) : 0;
    }
  }
  return { width, height, states };
}
