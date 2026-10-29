// The "decal frame": where the image sits in 3D and which way it projects.

/**
 * @typedef {object} DecalFrame
 * @property {number[]} origin  center of the image on the surface (mm)
 * @property {number[]} normal  unit vector pointing OUT of the surface (projection travels along -normal)
 * @property {number[]} right   unit vector = image +x direction
 * @property {number[]} up      unit vector = image +y direction (towards the top row of the image)
 * @property {number} width     image width in mm
 * @property {number} height    image height in mm
 * @property {number} reach     only surfaces within +/- reach mm of the origin plane (along normal) are painted
 */

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Snap a direction to the closest +/- X/Y/Z axis. */
export function snapToAxis(n) {
  const ax = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const i = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : ax[1] >= ax[2] ? 1 : 2;
  const out = [0, 0, 0];
  out[i] = Math.sign(n[i]) || 1;
  return out;
}

/**
 * Build a right-handed frame (right x up = normal) for a surface point/normal and an in-plane rotation.
 * "Up" defaults to world +Z projected into the plane (or +Y when looking straight down/up the Z axis).
 */
export function makeFrame({ origin, normal, rotationDeg = 0, width, height, reach }) {
  const n = norm(normal);
  const ref = Math.abs(n[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  let up = norm(sub(ref, scale(n, dot(ref, n))));
  let right = norm(cross(up, n));
  const a = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const r2 = add(scale(right, c), scale(up, s));
  const u2 = add(scale(right, -s), scale(up, c));
  return { origin: [...origin], normal: n, right: r2, up: u2, width, height, reach };
}

/** World point -> image space: s,t in [0,1] (t=1 is the top row), h = signed height above the origin plane. */
export function toLocal(frame, p) {
  const d = sub(p, frame.origin);
  return {
    s: dot(d, frame.right) / frame.width + 0.5,
    t: dot(d, frame.up) / frame.height + 0.5,
    h: dot(d, frame.normal),
  };
}

/** Column-major 4x4 matrix mapping local (x=right mm, y=up mm, z=normal mm) to world. */
export function frameMatrix(frame) {
  const { right: r, up: u, normal: n, origin: o } = frame;
  return [r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, n[0], n[1], n[2], 0, o[0], o[1], o[2], 1];
}

