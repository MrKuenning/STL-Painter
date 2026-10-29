// Built-in sample STLs and sample graphics for instant exploration and testing
// without requiring users to supply external files.

export function makeSamplePlateSTL(w = 50, h = 35, t = 5, r = 4, segs = 10) {
  const perimeter = [];
  const corners = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      if (i === 0 && perimeter.length) continue;
      const a = a0 + (i / segs) * (Math.PI / 2);
      perimeter.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  perimeter.pop(); // last equals first
  const n = perimeter.length;
  const tris = [];
  const push = (a, b, c) => tris.push(...a, ...b, ...c);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = perimeter[i];
    const [x1, y1] = perimeter[(i + 1) % n];
    // top (z = t), normal +Z
    push([0, 0, t], [x0, y0, t], [x1, y1, t]);
    // bottom (z = 0), normal -Z
    push([0, 0, 0], [x1, y1, 0], [x0, y0, 0]);
    // side
    push([x0, y0, 0], [x1, y1, 0], [x1, y1, t]);
    push([x0, y0, 0], [x1, y1, t], [x0, y0, t]);
  }
  return writeBinarySTL(tris);
}

/**
 * Creates a rounded elliptical pebble with a prominent smooth parabolic dome
 * to showcase 3D projection mapping across curved topography.
 */
export function makeSampleDomeSTL(rx = 25, ry = 20, baseT = 2.5, domeRise = 7.5, nRings = 16, nSlices = 48) {
  const tris = [];
  const push = (a, b, c) => tris.push(...a, ...b, ...c);

  const apex = [0, 0, baseT + domeRise];
  const rings = [];
  for (let r = 1; r <= nRings; r++) {
    const rho = r / nRings;
    const z = baseT + domeRise * (1 - rho * rho);
    const ring = [];
    for (let s = 0; s < nSlices; s++) {
      const theta = (s / nSlices) * Math.PI * 2;
      const x = rho * rx * Math.cos(theta);
      const y = rho * ry * Math.sin(theta);
      ring.push([x, y, z]);
    }
    rings.push(ring);
  }

  // Apex triangle fan
  for (let s = 0; s < nSlices; s++) {
    const next = (s + 1) % nSlices;
    push(apex, rings[0][s], rings[0][next]);
  }

  // Ring quads
  for (let r = 0; r < nRings - 1; r++) {
    const r0 = rings[r], r1 = rings[r + 1];
    for (let s = 0; s < nSlices; s++) {
      const next = (s + 1) % nSlices;
      push(r0[s], r1[s], r1[next]);
      push(r0[s], r1[next], r0[next]);
    }
  }

  // Side rim wall (outward normal)
  const rim = rings[nRings - 1];
  for (let s = 0; s < nSlices; s++) {
    const next = (s + 1) % nSlices;
    const t0 = rim[s], t1 = rim[next];
    const b0 = [t0[0], t0[1], 0], b1 = [t1[0], t1[1], 0];
    push(b0, b1, t1);
    push(b0, t1, t0);
  }

  // Bottom face (-Z normal): clockwise fan to center
  const centerBottom = [0, 0, 0];
  for (let s = 0; s < nSlices; s++) {
    const next = (s + 1) % nSlices;
    const b0 = [rim[s][0], rim[s][1], 0];
    const b1 = [rim[next][0], rim[next][1], 0];
    push(centerBottom, b1, b0);
  }

  return writeBinarySTL(tris);
}

/**
 * Creates a 3-tier stepped pedestal with multiple flat surface heights
 * to showcase projection mapping dropping down across step elevations.
 */
export function makeSampleSteppedSTL() {
  const verts = new Float32Array([
    -25, -20, 0,   -25, -20, 2.5, -17, -13, 2.5, -17, -13, 5,   -9, -7, 5,   -9, -7, 7.5,
    -25, 20, 0,    -25, 20, 2.5,  -17, 13, 2.5,  -17, 13, 5,   -9, 7, 5,    -9, 7, 7.5,
     25, -20, 0,    17, -13, 2.5,  25, -20, 2.5,   9, -7, 5,    9, -7, 7.5,  17, -13, 5,
     25, 20, 0,     17, 13, 2.5,   25, 20, 2.5,    9, 7, 5,     9, 7, 7.5,   17, 13, 5
  ]);
  const tris = new Uint32Array([
    0,1,7, 1,2,8, 0,12,1, 1,14,2, 0,6,12, 0,7,6, 1,8,7, 6,7,20, 7,8,19, 1,12,14,
    14,13,2, 12,18,14, 14,20,13, 6,18,12, 6,20,18, 7,19,20, 14,18,20, 20,19,13,
    3,2,13, 3,9,2, 3,4,9, 3,17,4, 9,8,2, 9,4,10, 9,10,21, 9,23,8, 17,13,19,
    3,13,17, 17,15,4, 17,21,15, 23,19,8, 9,21,23, 17,19,23, 17,23,21, 5,11,4,
    5,4,15, 5,16,11, 11,10,4, 11,22,10, 5,15,16, 16,15,21, 11,16,22, 22,21,10, 16,21,22
  ]);

  const coords = [];
  for (let i = 0; i < tris.length; i += 3) {
    const i0 = tris[i] * 3, i1 = tris[i + 1] * 3, i2 = tris[i + 2] * 3;
    coords.push(
      verts[i0], verts[i0 + 1], verts[i0 + 2],
      verts[i1], verts[i1 + 1], verts[i1 + 2],
      verts[i2], verts[i2 + 1], verts[i2 + 2]
    );
  }
  return writeBinarySTL(coords);
}

/**
 * Creates an undulating sinusoidal wave surface (wavy relief with crests & valleys)
 * to showcase continuous 3D projection mapping over non-uniform ripples.
 */
export function makeSampleWavySTL(w = 50, h = 40, baseT = 2.5, waveAmp = 3.0, nx = 30, ny = 20) {
  const tris = [];
  const push = (a, b, c) => tris.push(...a, ...b, ...c);

  const xVals = [];
  for (let i = 0; i <= nx; i++) xVals.push(-w / 2 + (i / nx) * w);
  const yVals = [];
  for (let j = 0; j <= ny; j++) yVals.push(-h / 2 + (j / ny) * h);

  const topGrid = [];
  for (let j = 0; j <= ny; j++) {
    const row = [];
    const y = yVals[j];
    const nyNorm = y / (h / 2);
    for (let i = 0; i <= nx; i++) {
      const x = xVals[i];
      const nxNorm = x / (w / 2);
      const wave = 0.5 + 0.5 * Math.sin(nxNorm * Math.PI * 2.5);
      const taper = Math.cos((nyNorm * Math.PI) / 3);
      const z = baseT + waveAmp * wave * taper;
      row.push([x, y, z]);
    }
    topGrid.push(row);
  }

  // Top surface (+Z)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      push(topGrid[j][i], topGrid[j][i + 1], topGrid[j + 1][i + 1]);
      push(topGrid[j][i], topGrid[j + 1][i + 1], topGrid[j + 1][i]);
    }
  }
  // Bottom surface (flat at Z=0, -Z normal)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = xVals[i], x1 = xVals[i + 1];
      const y0 = yVals[j], y1 = yVals[j + 1];
      push([x0, y0, 0], [x1, y1, 0], [x1, y0, 0]);
      push([x0, y0, 0], [x0, y1, 0], [x1, y1, 0]);
    }
  }
  // Bottom wall (y = -h/2)
  for (let i = 0; i < nx; i++) {
    const t0 = topGrid[0][i], t1 = topGrid[0][i + 1];
    const b0 = [t0[0], t0[1], 0], b1 = [t1[0], t1[1], 0];
    push(b0, t1, t0);
    push(b0, b1, t1);
  }
  // Top wall (y = +h/2)
  for (let i = 0; i < nx; i++) {
    const t0 = topGrid[ny][i], t1 = topGrid[ny][i + 1];
    const b0 = [t0[0], t0[1], 0], b1 = [t1[0], t1[1], 0];
    push(b0, t0, t1);
    push(b0, t1, b1);
  }
  // Left wall (x = -w/2)
  for (let j = 0; j < ny; j++) {
    const t0 = topGrid[j][0], t1 = topGrid[j + 1][0];
    const b0 = [t0[0], t0[1], 0], b1 = [t1[0], t1[1], 0];
    push(b0, t0, t1);
    push(b0, t1, b1);
  }
  // Right wall (x = +w/2)
  for (let j = 0; j < ny; j++) {
    const t0 = topGrid[j][nx], t1 = topGrid[j + 1][nx];
    const b0 = [t0[0], t0[1], 0], b1 = [t1[0], t1[1], 0];
    push(b0, t1, t0);
    push(b0, b1, t1);
  }
  return writeBinarySTL(tris);
}

export function writeBinarySTL(coords) {
  const triCount = coords.length / 9;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let i = 0; i < triCount; i++) {
    const b = i * 9;
    const ux = coords[b + 3] - coords[b], uy = coords[b + 4] - coords[b + 1], uz = coords[b + 5] - coords[b + 2];
    const vx = coords[b + 6] - coords[b], vy = coords[b + 7] - coords[b + 1], vz = coords[b + 8] - coords[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, coords[b + k], true); o += 4; }
    o += 2;
  }
  return buf;
}

// 1. 2-Color Solid Logo
export const SAMPLE_IMG_2COLOR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" width="480" height="320">
  <rect x="8" y="8" width="224" height="144" rx="26" fill="#1e293b"/>
  <rect x="18" y="18" width="204" height="124" rx="18" fill="none" stroke="#f97316" stroke-width="8"/>
  <polygon points="62,116 92,44 122,116 107,116 92,76 77,116" fill="#f97316"/>
  <circle cx="164" cy="68" r="24" fill="#f97316"/>
  <circle cx="164" cy="68" r="10" fill="#1e293b"/>
  <rect x="136" y="102" width="56" height="14" rx="7" fill="#f97316"/>
</svg>`;

// 2. 1-Color Silhouette with Transparent Background (Simple Car)
export const SAMPLE_IMG_CAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" width="400" height="240">
  <path fill="#2563eb" fill-rule="evenodd" d="M 15 75 C 15 68 20 62 28 62 L 50 62 L 76 34 C 81 29 88 27 96 27 L 138 27 C 146 27 153 31 158 38 L 174 62 L 186 64 C 192 65 196 70 196 76 L 196 86 C 196 90 193 93 189 93 L 168 93 A 19 19 0 0 0 132 93 L 78 93 A 19 19 0 0 0 42 93 L 20 93 C 16 93 15 90 15 85 Z M 94 36 L 134 36 L 134 56 L 82 56 Z M 142 38 C 145 38 148 40 150 43 L 162 56 L 142 56 Z M 55 80 A 13 13 0 1 1 55 106 A 13 13 0 1 1 55 80 Z M 150 80 A 13 13 0 1 1 150 106 A 13 13 0 1 1 150 80 Z"/>
</svg>`;

// Backward-compatibility alias
export const SAMPLE_IMG_TRANSP = SAMPLE_IMG_CAR;

// 3. Solid White Background Shield (2-color subject + white background = 3 colors total)
export const SAMPLE_IMG_WHITEBG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" width="480" height="400">
  <rect width="240" height="200" fill="#ffffff"/>
  <path d="M 120 22 L 188 52 C 188 120 150 164 120 178 C 90 164 52 120 52 52 Z" fill="#1e293b"/>
  <polygon points="120 50 129 78 158 78 135 96 143 124 120 106 97 124 105 96 82 78 111 78" fill="#f59e0b"/>
</svg>`;

// 4. 4-Color Vibrant Retro Sunset Badge with Transparent Background
export const SAMPLE_IMG_4COLOR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="480" height="480">
  <circle cx="120" cy="120" r="106" fill="#0f172a"/>
  <path d="M 30,120 A 90,90 0 0,1 210,120 Z" fill="#facc15"/>
  <path d="M 34,136 A 90,90 0 0,1 206,136 L 200,116 A 90,90 0 0,0 40,116 Z" fill="#f97316"/>
  <polygon points="120,62 170,142 70,142" fill="#38bdf8"/>
  <polygon points="80,88 135,160 25,160" fill="#10b981"/>
  <polygon points="160,102 215,160 105,160" fill="#10b981"/>
  <path d="M 20,154 C 50,186 190,186 220,154 C 206,206 166,226 120,226 C 74,226 34,206 20,154 Z" fill="#0f172a"/>
</svg>`;

// Backward-compatibility alias
export const SAMPLE_LOGO_SVG = SAMPLE_IMG_2COLOR;

export const SAMPLE_MODELS = {
  flat: {
    id: 'flat',
    name: 'demo-coaster.stl',
    label: 'Flat',
    desc: '50 × 35 mm flat plate',
    create: () => makeSamplePlateSTL(50, 35, 5, 4, 12),
    defaultReach: 0.5,
  },
  stepped: {
    id: 'stepped',
    name: 'demo-stepped.stl',
    label: 'Uneven',
    desc: '3-tier pedestal with multiple heights',
    create: () => makeSampleSteppedSTL(),
    defaultReach: 5.0,
  },
  curved: {
    id: 'curved',
    name: 'demo-dome.stl',
    label: 'Curved',
    desc: 'Prominent rounded dome pebble',
    create: () => makeSampleDomeSTL(25, 20, 2.5, 7.5, 16, 48),
    defaultReach: 4.5,
  },
  wavy: {
    id: 'wavy',
    name: 'demo-wavy.stl',
    label: 'Wavy',
    desc: 'Undulating sinusoidal waves',
    create: () => makeSampleWavySTL(50, 40, 2.5, 3.0, 30, 20),
    defaultReach: 3.5,
  },
};

export const SAMPLE_IMAGES = {
  'transp': {
    id: 'transp',
    name: 'demo-1color-car.png',
    label: '1 Color',
    desc: '1-color car on transparent background',
    url: '/sample-images/demo-1color-car.png',
    svg: SAMPLE_IMG_CAR,
    numColors: 1,
    removeBg: false,
    bgTol: 25,
  },
  '2color': {
    id: '2color',
    name: 'demo-2color-badge.svg',
    label: '2 Color',
    desc: 'Solid 2-color geometric graphic',
    svg: SAMPLE_IMG_2COLOR,
    numColors: 2,
    removeBg: false,
    bgTol: 25,
  },
  '4color': {
    id: '4color',
    name: 'demo-4color-retro.svg',
    label: '4 Color',
    desc: 'Vibrant 4-color retro sunset & mountain badge',
    svg: SAMPLE_IMG_4COLOR,
    numColors: 4,
    removeBg: false,
    bgTol: 25,
  },
  'whitebg': {
    id: 'whitebg',
    name: 'demo-whitebg-shield.png',
    label: 'White Background',
    desc: 'Shield on white background (tests Remove BG)',
    url: '/sample-images/demo-whitebg-shield.png',
    svg: SAMPLE_IMG_WHITEBG,
    numColors: 3,
    removeBg: true,
    bgTol: 25,
  },
};
