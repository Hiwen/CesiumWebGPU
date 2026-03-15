import destroyObject from "../../Core/destroyObject.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180.0;
const EARTH_RADIUS = 6378137.0;

// Zoom limits (camera distance from earth centre in metres).
// MIN keeps the camera 1 km above the surface; MAX is 100× the earth's radius.
const MIN_DISTANCE = EARTH_RADIUS + 1000.0;
const MAX_DISTANCE = EARTH_RADIUS * 100.0;

// Latitude is clamped to ±MAX_LAT to avoid the lookAt degenerating at the poles.
const MAX_LAT = 89.5 * DEG_TO_RAD;

// Per-frame inertia decay (0 = instant stop, 1 = no decay).
const INERTIA_DAMPING = 0.9;
// Inertia is zeroed when the absolute velocity falls below this threshold.
const INERTIA_THRESHOLD = 1e-9;

// Right-drag sensitivity (metres of zoom per pixel of drag).
const ZOOM_DRAG_SENSITIVITY = 0.005;
// Scroll-wheel exponential zoom sensitivity (larger = more aggressive).
const ZOOM_WHEEL_SENSITIVITY = 0.001;
// Approximate pixel heights for deltaMode normalisation.
const WHEEL_LINE_HEIGHT_PX = 20; // DOM_DELTA_LINE → convert to pixels
const WHEEL_PAGE_HEIGHT_PX = 600; // DOM_DELTA_PAGE → convert to pixels

// Interaction modes
const MODE_NONE = 0;
const MODE_ORBIT = 1; // left-mouse / single-finger drag → orbit
const MODE_ZOOM_DRAG = 2; // right-mouse drag → zoom

/**
 * Handles pointer and touch events on the WebGPU canvas and translates them
 * into changes on a {@link WebGPUCamera}.
 *
 * Interaction model (matches Cesium's globe-camera defaults):
 * - **Left drag**   → orbit (rotate the globe about its centre), with inertia
 * - **Scroll wheel** → zoom in/out (exponential, centred on the globe)
 * - **Right drag**  → additional zoom (drag up = zoom in, down = zoom out)
 * - **Pinch**       → zoom on touch devices
 *
 * Obtain an instance via {@link WebGPUCameraController.create}, or construct
 * directly and keep a reference so that {@link WebGPUCameraController#destroy}
 * can remove all event listeners.
 *
 * @alias WebGPUCameraController
 * @constructor
 * @private
 *
 * @param {WebGPUCamera}        camera  The camera to control.
 * @param {HTMLCanvasElement}   canvas  The canvas receiving pointer events.
 */
function WebGPUCameraController(camera, canvas) {
  this._camera = camera;
  this._canvas = canvas;

  // ── Input state ──────────────────────────────────────────────────────────
  this._mode = MODE_NONE;
  this._lastX = 0; // last clientX used by the active interaction
  this._lastY = 0;

  // ── Inertia state ────────────────────────────────────────────────────────
  this._velLon = 0.0; // longitude velocity in radians/frame
  this._velLat = 0.0; // latitude  velocity in radians/frame

  // ── Pinch-zoom state ─────────────────────────────────────────────────────
  this._pinchDist = 0; // pixel distance between two touch points

  // ── Destroyed flag ───────────────────────────────────────────────────────
  this._isDestroyed = false;

  // ── Bind and register event handlers ────────────────────────────────────
  // Store bound handlers so that removeEventListener receives the same function
  // reference during destroy().
  this._onMouseDown = _mouseDown.bind(null, this);
  this._onMouseMove = _mouseMove.bind(null, this);
  this._onMouseUp = _mouseUp.bind(null, this);
  this._onWheel = _wheel.bind(null, this);
  this._onTouchStart = _touchStart.bind(null, this);
  this._onTouchMove = _touchMove.bind(null, this);
  this._onTouchEnd = _touchEnd.bind(null, this);
  this._onContextMenu = _preventDefault;

  canvas.addEventListener("mousedown", this._onMouseDown);
  canvas.addEventListener("mousemove", this._onMouseMove);
  canvas.addEventListener("mouseup", this._onMouseUp);
  canvas.addEventListener("mouseleave", this._onMouseUp);
  canvas.addEventListener("wheel", this._onWheel, { passive: false });
  canvas.addEventListener("touchstart", this._onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", this._onTouchMove, { passive: false });
  canvas.addEventListener("touchend", this._onTouchEnd);
  canvas.addEventListener("touchcancel", this._onTouchEnd);
  canvas.addEventListener("contextmenu", this._onContextMenu);
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a new {@link WebGPUCameraController} for the given camera and canvas.
 *
 * @param {WebGPUCamera}      camera
 * @param {HTMLCanvasElement} canvas
 * @returns {WebGPUCameraController}
 */
WebGPUCameraController.create = function (camera, canvas) {
  return new WebGPUCameraController(camera, canvas);
};

// ── Per-frame update ──────────────────────────────────────────────────────────

/**
 * Applies inertial continuation of the orbit velocity after a drag gesture is
 * released.  Call once per rendered frame (before camera matrices are computed).
 */
WebGPUCameraController.prototype.update = function () {
  if (this._mode !== MODE_NONE) {
    // A drag is active — inertia is accumulated but not applied yet.
    return;
  }

  if (
    Math.abs(this._velLon) < INERTIA_THRESHOLD &&
    Math.abs(this._velLat) < INERTIA_THRESHOLD
  ) {
    return; // nothing to do
  }

  this._camera._longitude += this._velLon;
  this._camera._latitude = _clampLat(this._camera._latitude + this._velLat);

  this._velLon *= INERTIA_DAMPING;
  this._velLat *= INERTIA_DAMPING;

  if (Math.abs(this._velLon) < INERTIA_THRESHOLD) {
    this._velLon = 0;
  }
  if (Math.abs(this._velLat) < INERTIA_THRESHOLD) {
    this._velLat = 0;
  }
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** @returns {boolean} */
WebGPUCameraController.prototype.isDestroyed = function () {
  return this._isDestroyed;
};

/**
 * Removes all event listeners and frees the controller.
 * @returns {undefined}
 */
WebGPUCameraController.prototype.destroy = function () {
  const canvas = this._canvas;
  canvas.removeEventListener("mousedown", this._onMouseDown);
  canvas.removeEventListener("mousemove", this._onMouseMove);
  canvas.removeEventListener("mouseup", this._onMouseUp);
  canvas.removeEventListener("mouseleave", this._onMouseUp);
  canvas.removeEventListener("wheel", this._onWheel);
  canvas.removeEventListener("touchstart", this._onTouchStart);
  canvas.removeEventListener("touchmove", this._onTouchMove);
  canvas.removeEventListener("touchend", this._onTouchEnd);
  canvas.removeEventListener("touchcancel", this._onTouchEnd);
  canvas.removeEventListener("contextmenu", this._onContextMenu);
  this._isDestroyed = true;
  return destroyObject(this);
};

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Returns the current orbit sensitivity in radians-per-pixel.
 *
 * Using `fovY / canvasHeight` ensures that dragging across the full canvas
 * height rotates the camera by exactly one vertical FOV — independent of the
 * current zoom level.  This matches Cesium's "angular sensitivity" model.
 *
 * @param {WebGPUCameraController} ctrl
 * @returns {number}
 * @private
 */
function _orbitSensitivity(ctrl) {
  return ctrl._camera._fovY / Math.max(1, ctrl._canvas.height);
}

/**
 * Applies orbit deltas (dx, dy) in screen pixels to the camera.
 * @param {WebGPUCameraController} ctrl
 * @param {number} dx  Positive = rightward drag.
 * @param {number} dy  Positive = downward drag.
 * @private
 */
function _applyOrbit(ctrl, dx, dy) {
  const s = _orbitSensitivity(ctrl);
  // Dragging RIGHT moves the camera to the right side of the globe, which
  // means we view less of the east → longitude decreases.
  // Dragging DOWN moves the camera downward → we see more of the south →
  // latitude decreases.
  const dLon = -dx * s;
  const dLat = -dy * s;

  ctrl._camera._longitude += dLon;
  ctrl._camera._latitude = _clampLat(ctrl._camera._latitude + dLat);

  // Accumulate per-frame velocity for inertia.
  ctrl._velLon = dLon;
  ctrl._velLat = dLat;
}

/**
 * Applies a multiplicative zoom factor (>1 = zoom out, <1 = zoom in).
 * @param {WebGPUCameraController} ctrl
 * @param {number} factor
 * @private
 */
function _applyZoom(ctrl, factor) {
  ctrl._camera._distance = Math.max(
    MIN_DISTANCE,
    Math.min(MAX_DISTANCE, ctrl._camera._distance * factor),
  );
}

/**
 * Clamps latitude to the safe range to avoid lookAt degeneracy near poles.
 * @param {number} lat Latitude in radians.
 * @returns {number}
 * @private
 */
function _clampLat(lat) {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

/** @private */
function _preventDefault(e) {
  e.preventDefault();
}

/** Returns the pixel distance between two touch points. @private */
function _touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Event handlers (free functions to avoid `this` confusion) ─────────────────

function _mouseDown(ctrl, e) {
  e.preventDefault();
  if (e.button === 0) {
    ctrl._mode = MODE_ORBIT;
    ctrl._velLon = 0;
    ctrl._velLat = 0;
  } else if (e.button === 2) {
    ctrl._mode = MODE_ZOOM_DRAG;
  }
  ctrl._lastX = e.clientX;
  ctrl._lastY = e.clientY;
}

function _mouseMove(ctrl, e) {
  if (ctrl._mode === MODE_NONE) {
    return;
  }
  const dx = e.clientX - ctrl._lastX;
  const dy = e.clientY - ctrl._lastY;
  ctrl._lastX = e.clientX;
  ctrl._lastY = e.clientY;

  if (ctrl._mode === MODE_ORBIT) {
    _applyOrbit(ctrl, dx, dy);
  } else if (ctrl._mode === MODE_ZOOM_DRAG) {
    // Drag up (dy < 0) = zoom in, drag down (dy > 0) = zoom out.
    _applyZoom(ctrl, Math.exp(dy * ZOOM_DRAG_SENSITIVITY));
  }
}

function _mouseUp(ctrl) {
  ctrl._mode = MODE_NONE;
}

function _wheel(ctrl, e) {
  e.preventDefault();
  // e.deltaY > 0 → scroll down → zoom out; < 0 → scroll up → zoom in.
  // Normalise across different browsers / input devices by using deltaMode.
  let delta = e.deltaY;
  if (e.deltaMode === 1 /* DOM_DELTA_LINE */) {
    delta *= WHEEL_LINE_HEIGHT_PX;
  } else if (e.deltaMode === 2 /* DOM_DELTA_PAGE */) {
    delta *= WHEEL_PAGE_HEIGHT_PX;
  }
  // Exponential zoom: exp(delta * k) gives a smooth, Cesium-like response.
  _applyZoom(ctrl, Math.exp(delta * ZOOM_WHEEL_SENSITIVITY));
}

function _touchStart(ctrl, e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    ctrl._mode = MODE_ORBIT;
    ctrl._lastX = e.touches[0].clientX;
    ctrl._lastY = e.touches[0].clientY;
    ctrl._velLon = 0;
    ctrl._velLat = 0;
  } else if (e.touches.length === 2) {
    ctrl._mode = MODE_NONE;
    ctrl._pinchDist = _touchDistance(e.touches);
  }
}

function _touchMove(ctrl, e) {
  e.preventDefault();
  if (e.touches.length === 1 && ctrl._mode === MODE_ORBIT) {
    const dx = e.touches[0].clientX - ctrl._lastX;
    const dy = e.touches[0].clientY - ctrl._lastY;
    ctrl._lastX = e.touches[0].clientX;
    ctrl._lastY = e.touches[0].clientY;
    _applyOrbit(ctrl, dx, dy);
  } else if (e.touches.length === 2) {
    const newDist = _touchDistance(e.touches);
    if (ctrl._pinchDist > 0 && newDist > 0) {
      // Pinch out = zoom in (newDist > pinchDist → factor < 1).
      _applyZoom(ctrl, ctrl._pinchDist / newDist);
    }
    ctrl._pinchDist = newDist;
  }
}

function _touchEnd(ctrl, e) {
  if (e.touches.length === 0) {
    ctrl._mode = MODE_NONE;
  } else if (e.touches.length === 1) {
    ctrl._mode = MODE_ORBIT;
    ctrl._lastX = e.touches[0].clientX;
    ctrl._lastY = e.touches[0].clientY;
  }
}

export default WebGPUCameraController;
