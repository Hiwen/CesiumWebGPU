import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";

// WGS84 semi-major axis in metres
const EARTH_RADIUS = 6378137.0;
const DEG_TO_RAD = Math.PI / 180.0;

// Latitude threshold (degrees) beyond which the ECEF +Z up-vector is swapped
// for +Y to avoid the lookAt becoming degenerate (camera at a pole).
const POLE_THRESHOLD_DEG = 85.0;

// Near plane = NEAR_ALTITUDE_FRACTION × (camera altitude above surface).
// 5% keeps the near plane close to the camera regardless of zoom level,
// preventing the front face of the sphere from being clipped.
const NEAR_ALTITUDE_FRACTION = 0.05;

// Minimum near-plane distance in metres.  Avoids a zero near plane when the
// camera is exactly on the surface.
const NEAR_MIN_METRES = 1.0;

/**
 * Minimal pure-JS perspective camera for WebGPU globe rendering.
 *
 * Computes view, model-view, and MVP matrices entirely in JavaScript without
 * any dependency on Cesium's WebGL {@link Context} or {@link UniformState}.
 *
 * Key differences from Cesium's WebGL camera:
 * - The **projection matrix uses WebGPU clip-space depth ∈ [0, 1]** (not the
 *   OpenGL/WebGL convention of [-1, 1]).  Using a WebGL projection matrix
 *   with WebGPU causes the front half of any object to be clipped (depth
 *   z/w < 0 is outside WebGPU's valid NDC range), producing the ring/donut
 *   artefact visible when zooming in on the globe.
 * - The **near plane is computed dynamically** from the camera's altitude
 *   above the surface so the front face of the sphere is never clipped even
 *   when zoomed close to the surface.
 *
 * All output matrices are column-major {@link Float32Array}s suitable for
 * direct upload to a WebGPU uniform buffer (matching WGSL `mat4x4<f32>`).
 *
 * @alias WebGPUCamera
 * @constructor
 * @private
 */
function WebGPUCamera() {
  // ── Geocentric spherical position ──────────────────────────────────────────
  // The camera always looks at the earth's centre (world origin).
  this._longitude = 0.0; // radians; ECEF +X axis at lon=0
  this._latitude = 20.0 * DEG_TO_RAD; // start slightly north of equator
  this._distance = EARTH_RADIUS * 2.5; // metres from earth centre

  // ── Vertical field of view ─────────────────────────────────────────────────
  this._fovY = 45.0 * DEG_TO_RAD; // radians

  // ── Viewport (needed for aspect ratio) ────────────────────────────────────
  this._width = 1;
  this._height = 1;

  // ── Destroyed state ────────────────────────────────────────────────────────
  this._isDestroyed = false;

  // ── Output matrices (column-major Float32Array) ───────────────────────────
  this.viewMatrix = new Float32Array(16);
  this.projMatrix = new Float32Array(16);
  this.mvMatrix = new Float32Array(16); // view × model
  this.mvpMatrix = new Float32Array(16); // proj × mv

  // ── Scratch storage ────────────────────────────────────────────────────────
  this._modelMatrix = new Float32Array(16);
  this._eye = new Float32Array(3);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sets the viewport dimensions used for the aspect ratio calculation.
 * @param {number} width
 * @param {number} height
 */
WebGPUCamera.prototype.setViewport = function (width, height) {
  this._width = Math.max(1, width);
  this._height = Math.max(1, height);
};

/**
 * Recomputes all matrices.  Must be called once per frame (or whenever the
 * camera position / viewport changes).
 */
WebGPUCamera.prototype.update = function () {
  // ── Eye position in ECEF world space ──────────────────────────────────────
  const cosLat = Math.cos(this._latitude);
  const sinLat = Math.sin(this._latitude);
  const cosLon = Math.cos(this._longitude);
  const sinLon = Math.sin(this._longitude);
  const d = this._distance;

  this._eye[0] = d * cosLat * cosLon; // ECEF X (prime meridian at equator)
  this._eye[1] = d * cosLat * sinLon; // ECEF Y
  this._eye[2] = d * sinLat; // ECEF Z (north pole)

  // World "up" vector – use ECEF +Z (north pole) unless too close to the pole
  // where the lookAt would become degenerate.
  const up =
    Math.abs(this._latitude) > POLE_THRESHOLD_DEG * DEG_TO_RAD
      ? [0.0, 1.0, 0.0]
      : [0.0, 0.0, 1.0];

  _makeLookAt(this._eye, [0, 0, 0], up, this.viewMatrix);

  // ── Dynamic near / far ────────────────────────────────────────────────────
  // Use NEAR_ALTITUDE_FRACTION of the altitude above the surface as the near
  // distance so the sphere's front face is never clipped even when zoomed
  // very close.  The far plane extends 1.5× earth radii past the centre so
  // the back side of the globe is always visible.
  const altitude = d - EARTH_RADIUS;
  const near = Math.max(NEAR_MIN_METRES, altitude * NEAR_ALTITUDE_FRACTION);
  const far = d + EARTH_RADIUS * 1.5;

  // ── WebGPU perspective matrix (depth NDC ∈ [0, 1]) ───────────────────────
  const aspect = this._width / this._height;
  _makePerspectiveWebGPU(this._fovY, aspect, near, far, this.projMatrix);

  // ── Model matrix: scale unit sphere to WGS84 semi-major axis ─────────────
  _makeUniformScale(EARTH_RADIUS, this._modelMatrix);

  // ── Compound matrices ─────────────────────────────────────────────────────
  _matMul4(this.viewMatrix, this._modelMatrix, this.mvMatrix);
  _matMul4(this.projMatrix, this.mvMatrix, this.mvpMatrix);
};

/**
 * Returns the approximate sun direction in eye space (unit vector).
 *
 * The sun is approximated as being in the ECEF +X direction (noon at the
 * prime meridian).  This is a simple stand-in; a future implementation can
 * compute the true solar position from the simulation clock.
 *
 * @returns {Float32Array} length-3 unit vector in eye space
 */
WebGPUCamera.prototype.sunDirectionEC = function () {
  // Transform world direction [1,0,0] by the upper-left 3×3 of viewMatrix.
  // Column-major layout: col j, row i → index j*4+i.
  const v = this.viewMatrix;
  // Row 0: v[0], v[4], v[8]
  // Row 1: v[1], v[5], v[9]
  // Row 2: v[2], v[6], v[10]
  // world direction: wx=1, wy=0, wz=0
  const sx = v[0]; // v[0]*1 + v[4]*0 + v[8]*0
  const sy = v[1]; // v[1]*1 + v[5]*0 + v[9]*0
  const sz = v[2]; // v[2]*1 + v[6]*0 + v[10]*0
  const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1.0;
  return new Float32Array([sx / len, sy / len, sz / len]);
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** @returns {boolean} */
WebGPUCamera.prototype.isDestroyed = function () {
  return this._isDestroyed;
};

/** @returns {undefined} */
WebGPUCamera.prototype.destroy = function () {
  this._isDestroyed = true;
  return destroyObject(this);
};

// ── Private math helpers ──────────────────────────────────────────────────────

/**
 * Column-major 4×4 lookAt matrix (right-handed, camera looks along -Z).
 *
 * Convention (same as gl-matrix / WebGPU):
 *   - The rotation rows are [s, u, -f].
 *   - In column-major storage each column contains the x-, y-, z-component
 *     of ALL three row-vectors, not all components of one row-vector.
 *     Column 0: [s.x, u.x, -f.x, 0]
 *     Column 1: [s.y, u.y, -f.y, 0]
 *     Column 2: [s.z, u.z, -f.z, 0]
 *
 * @param {number[]|Float32Array} eye    Camera position in world space.
 * @param {number[]}              center Point to look at.
 * @param {number[]}              up     World up vector.
 * @param {Float32Array}          out    16-element output (column-major).
 * @private
 */
function _makeLookAt(eye, center, up, out) {
  // Forward: f = normalize(center − eye)
  let fx = center[0] - eye[0];
  let fy = center[1] - eye[1];
  let fz = center[2] - eye[2];
  let fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1.0;
  fx /= fl;
  fy /= fl;
  fz /= fl;

  // Side: s = normalize(f × up)
  let sx = fy * up[2] - fz * up[1];
  let sy = fz * up[0] - fx * up[2];
  let sz = fx * up[1] - fy * up[0];
  let sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1.0;
  sx /= sl;
  sy /= sl;
  sz /= sl;

  // True up: u = s × f
  const ux = sy * fz - sz * fy;
  const uy = sz * fx - sx * fz;
  const uz = sx * fy - sy * fx;

  // Column-major layout: each column stores x/y/z components of ALL row vectors.
  // Column 0: x-components of rows [s, u, -f, 0]
  out[0] = sx;
  out[1] = ux;
  out[2] = -fx;
  out[3] = 0;
  // Column 1: y-components of rows
  out[4] = sy;
  out[5] = uy;
  out[6] = -fy;
  out[7] = 0;
  // Column 2: z-components of rows
  out[8] = sz;
  out[9] = uz;
  out[10] = -fz;
  out[11] = 0;
  // Column 3: translation = -R * eye
  out[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]); // -dot(s, eye)
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]); // -dot(u, eye)
  out[14] = fx * eye[0] + fy * eye[1] + fz * eye[2]; // dot(f, eye) = -dot(-f, eye)
  out[15] = 1;
}

/**
 * WebGPU perspective matrix (right-handed, depth NDC ∈ [0, 1]).
 *
 * WebGL uses depth NDC ∈ [-1, 1].  Using a WebGL projection matrix with a
 * WebGPU pipeline causes depth values < 0 (the front half of any convex
 * object) to be discarded, producing the ring / donut artefact.  This
 * function generates the correct WebGPU variant.
 *
 * Derivation: for a right-handed camera looking along -Z:
 *   z_clip = (far/(near−far)) × z_eye + (near×far/(near−far))
 *   w_clip = −z_eye
 *   z_ndc  = z_clip / w_clip
 * At z_eye = −near → z_ndc = 0 ; at z_eye = −far → z_ndc = 1. ✓
 *
 * @param {number}       fovY   Vertical FoV in radians.
 * @param {number}       aspect Width / height ratio.
 * @param {number}       near   Near-plane distance (positive metres).
 * @param {number}       far    Far-plane distance (positive metres).
 * @param {Float32Array} out    16-element column-major output.
 * @private
 */
function _makePerspectiveWebGPU(fovY, aspect, near, far, out) {
  const f = 1.0 / Math.tan(fovY * 0.5);
  const nf = 1.0 / (near - far); // near − far is negative

  out.fill(0);
  out[0] = f / aspect; // col 0, row 0
  out[5] = f; // col 1, row 1
  out[10] = far * nf; // col 2, row 2  = far/(near−far)
  out[11] = -1.0; // col 2, row 3  → w_clip = −z_eye
  out[14] = near * far * nf; // col 3, row 2  = near×far/(near−far)
  // out[15] = 0  (no w term)
}

/**
 * Column-major 4×4 matrix multiply: out = a × b.
 * @private
 */
function _matMul4(a, b, out) {
  for (let col = 0; col < 4; col++) {
    const c = col * 4;
    for (let row = 0; row < 4; row++) {
      out[c + row] =
        a[0 + row] * b[c + 0] +
        a[4 + row] * b[c + 1] +
        a[8 + row] * b[c + 2] +
        a[12 + row] * b[c + 3];
    }
  }
}

/**
 * Column-major uniform-scale 4×4 matrix (diag = [s, s, s, 1]).
 * @private
 */
function _makeUniformScale(s, out) {
  out.fill(0);
  out[0] = s;
  out[5] = s;
  out[10] = s;
  out[15] = 1.0;
}

export default WebGPUCamera;
