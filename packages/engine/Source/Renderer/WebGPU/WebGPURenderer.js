import Cartesian3 from "../../Core/Cartesian3.js";
import Check from "../../Core/Check.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import JulianDate from "../../Core/JulianDate.js";
import Matrix3 from "../../Core/Matrix3.js";
import RuntimeError from "../../Core/RuntimeError.js";
import Simon1994PlanetaryPositions from "../../Core/Simon1994PlanetaryPositions.js";
import Transforms from "../../Core/Transforms.js";
import WebGPUContext, { isWebGPUSupported } from "./WebGPUContext.js";
import WebGPUCommandEncoder from "./WebGPUCommandEncoder.js";
import WebGPUTexture from "./WebGPUTexture.js";
import WebGPUGlobePass from "./WebGPUGlobePass.js";
import WebGPUCamera from "./WebGPUCamera.js";
import WebGPUCameraController from "./WebGPUCameraController.js";

// Pre-allocated uniform buffer (36 floats: mvp[16] | mv[16] | lightDirEC[3] | time[1])
const _uniformScratch = new Float32Array(36);

// Pre-allocated scratch objects for sun-direction computation (avoids per-frame GC).
const _sunPositionECIScratch = new Cartesian3();
const _sunDirectionECEFScratch = new Cartesian3();
const _icrfToFixedScratch = new Matrix3();

const _DEG_TO_RAD = Math.PI / 180.0;

/**
 * Computes the sun direction in eye (camera) space from a {@link JulianDate}.
 *
 * Algorithm:
 *  1. Compute the sun position in the Earth-Centred Inertial (ECI) frame
 *     via Simon (1994) planetary positions.
 *  2. Rotate to ECEF using `Transforms.computeIcrfToCentralBodyFixedMatrix`.
 *     That function falls back to a TEME approximation so it never returns
 *     `undefined` in practice.
 *  3. If the rotation matrix is still unavailable (edge case), fall back to a
 *     simplified GAST-based approximation that requires no external data.
 *  4. Transform the ECEF unit direction to eye space using the upper-left
 *     3 × 3 of the column-major `viewMatrix`.
 *
 * @param {JulianDate} julianDate
 * @param {Float32Array} viewMatrix  Column-major 4 × 4 view matrix.
 * @returns {number[]} Length-3 normalised direction in eye space.
 * @private
 */
function _computeSunDirectionEC(julianDate, viewMatrix) {
  // ── 1. Sun position in ECI ────────────────────────────────────────────────
  Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
    julianDate,
    _sunPositionECIScratch,
  );

  // ── 2. Rotate ECI → ECEF ─────────────────────────────────────────────────
  let sx, sy, sz;
  const icrfToFixed = Transforms.computeIcrfToCentralBodyFixedMatrix(
    julianDate,
    _icrfToFixedScratch,
  );

  if (defined(icrfToFixed)) {
    Matrix3.multiplyByVector(
      icrfToFixed,
      _sunPositionECIScratch,
      _sunDirectionECEFScratch,
    );
    Cartesian3.normalize(_sunDirectionECEFScratch, _sunDirectionECEFScratch);
    sx = _sunDirectionECEFScratch.x;
    sy = _sunDirectionECEFScratch.y;
    sz = _sunDirectionECEFScratch.z;
  } else {
    // ── 3. Fallback: simple GAST approximation ─────────────────────────────
    // Days since J2000.0
    const d =
      julianDate.dayNumber - 2451545.0 + julianDate.secondsOfDay / 86400.0;
    const L = (280.46 + 0.9856474 * d) * _DEG_TO_RAD;
    const g = (357.528 + 0.9856003 * d) * _DEG_TO_RAD;
    const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2.0 * g)) * _DEG_TO_RAD;
    const epsilon = (23.439 - 0.0000004 * d) * _DEG_TO_RAD;
    const cosLambda = Math.cos(lambda);
    const sinLambda = Math.sin(lambda);
    // ECI direction
    const xECI = cosLambda;
    const yECI = Math.cos(epsilon) * sinLambda;
    const zECI = Math.sin(epsilon) * sinLambda;
    // GAST (Greenwich Apparent Sidereal Time)
    const GAST = (280.46061837 + 360.98564736629 * d) * _DEG_TO_RAD;
    const cosG = Math.cos(GAST);
    const sinG = Math.sin(GAST);
    // Rotate ECI → ECEF and store in scratch for normalisation
    _sunDirectionECEFScratch.x = xECI * cosG + yECI * sinG;
    _sunDirectionECEFScratch.y = -xECI * sinG + yECI * cosG;
    _sunDirectionECEFScratch.z = zECI;
    Cartesian3.normalize(_sunDirectionECEFScratch, _sunDirectionECEFScratch);
    sx = _sunDirectionECEFScratch.x;
    sy = _sunDirectionECEFScratch.y;
    sz = _sunDirectionECEFScratch.z;
  }

  // ── 4. ECEF → eye space via upper-left 3 × 3 of column-major viewMatrix ──
  // Column-major layout: element at row r, col c → index c*4+r.
  const v = viewMatrix;
  _sunDirectionECEFScratch.x = v[0] * sx + v[4] * sy + v[8] * sz;
  _sunDirectionECEFScratch.y = v[1] * sx + v[5] * sy + v[9] * sz;
  _sunDirectionECEFScratch.z = v[2] * sx + v[6] * sy + v[10] * sz;
  Cartesian3.normalize(_sunDirectionECEFScratch, _sunDirectionECEFScratch);
  return [
    _sunDirectionECEFScratch.x,
    _sunDirectionECEFScratch.y,
    _sunDirectionECEFScratch.z,
  ];
}

/**
 * High-level WebGPU renderer that manages the per-frame rendering loop.
 *
 * Unlike the previous implementation this renderer is **completely
 * self-contained** – it does not depend on Cesium's WebGL {@link Context} or
 * {@link UniformState} for camera matrices.  Instead it owns a
 * {@link WebGPUCamera} and a {@link WebGPUCameraController}, and drives its
 * own `requestAnimationFrame` loop once
 * {@link WebGPURenderer#startRenderLoop} is called.
 *
 * Obtain an instance through the async {@link WebGPURenderer.create} factory.
 *
 * @alias WebGPURenderer
 * @constructor
 * @private
 *
 * @param {WebGPUContext} context
 * @param {object} [options]
 * @param {Clock} [options.clock]  An optional Cesium {@link Clock} to drive
 *   simulation time.  When provided the renderer calls {@link Clock#tick} on
 *   every frame and uses the resulting {@link JulianDate} to compute the
 *   `time` shader uniform (seconds since `clock.startTime`).  When omitted
 *   `performance.now()` is used as before.
 */
function WebGPURenderer(context, options) {
  options = options ?? {};
  this._context = context;
  this._depthTexture = undefined;
  this._depthView = undefined;
  this._width = 0;
  this._height = 0;
  this._frameCommandEncoder = undefined;
  this._rafId = undefined;
  this._destroyed = false;

  /**
   * Optional Cesium {@link Clock} used to drive simulation time.
   * When set the renderer ticks the clock every frame and derives the
   * `time` shader uniform from `JulianDate.secondsDifference(currentTime, startTime)`.
   * @type {Clock|undefined}
   */
  this.clock = options.clock ?? undefined;

  /**
   * External simulation time set by the Cesium render loop (e.g. from Scene.render).
   * When both this and `simulationTimeEpoch` are defined, this JulianDate is used
   * for the `time` shader uniform instead of the clock or `performance.now()`.
   * It is updated externally every frame; the renderer does NOT tick any clock.
   * Pre-allocated to avoid per-frame GC pressure once set by the first Scene frame.
   * Guarded by `simulationTimeEpoch` – having only one set has no effect.
   * @type {JulianDate}
   */
  this.simulationTime = new JulianDate();

  /**
   * Epoch (start time) used together with `simulationTime` to compute the
   * seconds-since-start shader uniform.  Set alongside `simulationTime`.
   * @type {JulianDate|undefined}
   */
  this.simulationTimeEpoch = undefined;

  // Execute render-command lists accumulated during scene traversal.
  this._opaqueCommandList = [];
  this._translucentCommandList = [];

  /**
   * The {@link WebGPUGlobePass} instance, created via
   * {@link WebGPURenderer#createGlobePass}.
   * @type {WebGPUGlobePass|undefined}
   */
  this.globePass = undefined;

  /**
   * The self-contained camera used for globe rendering.
   * @type {WebGPUCamera}
   */
  this.camera = new WebGPUCamera();

  /**
   * The camera controller that handles pointer/touch interaction.
   * Created automatically by {@link WebGPURenderer#startRenderLoop}.
   * @type {WebGPUCameraController|undefined}
   */
  this.cameraController = undefined;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Asynchronously creates a {@link WebGPURenderer} for the given canvas.
 *
 * This is the primary entry point for the WebGPU rendering backend.  Call it
 * once per canvas and store the result.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {Clock} [options.clock]  Optional Cesium {@link Clock} to drive
 *   simulation time.  Forwarded to the renderer constructor.
 * @param {object} [options.webgpu]  Additional options forwarded to
 *   {@link WebGPUContext.create}.
 * @returns {Promise<WebGPURenderer>}
 *
 * @throws {RuntimeError} If the browser does not support WebGPU.
 */
WebGPURenderer.create = async function (canvas, options) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("canvas", canvas);
  //>>includeEnd('debug');

  if (!isWebGPUSupported()) {
    throw new RuntimeError(
      "WebGPU is not supported in this browser. " +
        "Please use a modern browser with WebGPU support (Chrome 113+, Edge 113+).",
    );
  }

  options = options ?? {};
  const context = await WebGPUContext.create(canvas, options.webgpu ?? options);
  return new WebGPURenderer(context, options);
};

// ─── Properties ───────────────────────────────────────────────────────────────

Object.defineProperties(WebGPURenderer.prototype, {
  /**
   * The underlying {@link WebGPUContext}.
   * @memberof WebGPURenderer.prototype
   * @type {WebGPUContext}
   */
  context: {
    get: function () {
      return this._context;
    },
  },

  /**
   * The {@link GPUDevice}.
   * @memberof WebGPURenderer.prototype
   * @type {GPUDevice}
   */
  device: {
    get: function () {
      return this._context.device;
    },
  },

  /**
   * The depth {@link WebGPUTexture} for the current frame size.
   * @memberof WebGPURenderer.prototype
   * @type {WebGPUTexture|undefined}
   */
  depthTexture: {
    get: function () {
      return this._depthTexture;
    },
  },

  /**
   * The {@link GPUTextureView} for the depth attachment.
   * @memberof WebGPURenderer.prototype
   * @type {GPUTextureView|undefined}
   */
  depthView: {
    get: function () {
      return this._depthView;
    },
  },

  /**
   * The current canvas drawing-buffer width.
   * @memberof WebGPURenderer.prototype
   * @type {number}
   */
  drawingBufferWidth: {
    get: function () {
      return this._context.drawingBufferWidth;
    },
  },

  /**
   * The current canvas drawing-buffer height.
   * @memberof WebGPURenderer.prototype
   * @type {number}
   */
  drawingBufferHeight: {
    get: function () {
      return this._context.drawingBufferHeight;
    },
  },
});

// ─── Rendering API ────────────────────────────────────────────────────────────

/**
 * Begins a new frame.  Call this at the start of `requestAnimationFrame`.
 *
 * Creates a new command encoder and rebuilds the depth texture if the canvas
 * size has changed.
 *
 * @param {object} [clearColor]  Optional RGBA clear color `{r, g, b, a}`.
 *   Defaults to a dark blue sky color.
 * @returns {{ commandEncoder: WebGPUCommandEncoder, colorView: GPUTextureView, depthView: GPUTextureView }}
 */
WebGPURenderer.prototype.beginFrame = function (clearColor) {
  const canvas = this._context.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // Resize the depth buffer if needed.
  this._ensureDepthTexture(width, height);

  this._frameCommandEncoder = new WebGPUCommandEncoder(this._context);

  const colorView = this._context.getCurrentTextureView();
  const depthView = this._depthView;

  return {
    commandEncoder: this._frameCommandEncoder,
    colorView,
    depthView,
  };
};

/**
 * Begins the main opaque render pass for the current frame.
 *
 * @param {object} [options]
 * @param {{r:number,g:number,b:number,a:number}} [options.clearColor]  Clear color.
 * @returns {WebGPURenderPassEncoder}
 */
WebGPURenderer.prototype.beginOpaquePass = function (options) {
  options = options ?? {};

  const clearColor = options.clearColor ?? {
    r: 0.0,
    g: 0.05,
    b: 0.15,
    a: 1.0,
  };

  return this._frameCommandEncoder.beginRenderPass({
    clearColor,
    loadOp: "clear",
    depthView: this._depthView,
    clearDepth: 1.0,
  });
};

/**
 * Begins a translucent render pass that *loads* (does not clear) the color
 * attachment so opaque content rendered previously is preserved.
 *
 * @returns {WebGPURenderPassEncoder}
 */
WebGPURenderer.prototype.beginTranslucentPass = function () {
  return this._frameCommandEncoder.beginRenderPass({
    loadOp: "load",
    depthView: this._depthView,
    clearDepth: 1.0,
  });
};

// ─── Globe Pass ───────────────────────────────────────────────────────────────

/**
 * Creates and initialises a {@link WebGPUGlobePass} for this renderer.
 *
 * Call this once after the renderer is created (e.g. after `webGPUReady` is
 * `true`), passing in the equirectangular imagery source.
 *
 * @param {ImageBitmap|HTMLCanvasElement|OffscreenCanvas|string|URL} imageSource
 *   Equirectangular Earth imagery (passed to {@link WebGPUGlobePass.create}).
 * @returns {Promise<WebGPUGlobePass>}
 */
WebGPURenderer.prototype.createGlobePass = async function (imageSource) {
  if (defined(this.globePass) && !this.globePass.isDestroyed()) {
    this.globePass.destroy();
  }
  this.globePass = await WebGPUGlobePass.create(this._context, imageSource);
  return this.globePass;
};

/**
 * Renders a single globe frame using the current {@link WebGPUGlobePass} and
 * the self-contained {@link WebGPUCamera}.
 *
 * This method no longer depends on Cesium's WebGL {@link UniformState} – all
 * matrices are computed by {@link WebGPUCamera}.  Call {@link
 * WebGPURenderer#startRenderLoop} to drive this automatically via
 * `requestAnimationFrame`.
 *
 * @param {object} [uniformOverride]  Optional per-frame uniform override.
 *   When provided (legacy path) it bypasses the internal camera.
 */
WebGPURenderer.prototype.renderGlobePass = function (uniformOverride) {
  if (!defined(this.globePass) || !this.globePass._ready) {
    return;
  }

  const canvas = this._context.canvas;
  this._ensureDepthTexture(canvas.width, canvas.height);

  // Update camera viewport on every frame to handle resize.
  this.camera.setViewport(canvas.width, canvas.height);
  this.camera.update();

  // Pack uniforms: mvp(16) | mv(16) | lightDirEC(3) | time(1) = 36 floats
  let uniforms;
  if (defined(uniformOverride) && defined(uniformOverride.uniformArray)) {
    // Legacy path: caller provides pre-packed array (e.g. old Scene.js hook).
    uniforms = uniformOverride;
  } else {
    // Determine the current simulation JulianDate once — used for both the
    // sun direction and the time shader uniform so they stay in sync.
    // Priority: simulationTime (external, set by Scene.render) > clock > none
    const hasExternalTime =
      defined(this.simulationTime) && defined(this.simulationTimeEpoch);
    let simJD;
    if (hasExternalTime) {
      simJD = this.simulationTime;
    } else if (defined(this.clock)) {
      simJD = this.clock.currentTime;
    }

    // Sun direction: time-varying when we have a JulianDate, fixed fallback otherwise.
    const sun = defined(simJD)
      ? _computeSunDirectionEC(simJD, this.camera.viewMatrix)
      : this.camera.sunDirectionEC();

    _uniformScratch.set(this.camera.mvpMatrix, 0);
    _uniformScratch.set(this.camera.mvMatrix, 16);
    _uniformScratch[32] = sun[0];
    _uniformScratch[33] = sun[1];
    _uniformScratch[34] = sun[2];
    // Time uniform: seconds since epoch.
    // Priority: simulationTime+epoch (external) > clock > performance.now()
    if (hasExternalTime) {
      _uniformScratch[35] = JulianDate.secondsDifference(
        this.simulationTime,
        this.simulationTimeEpoch,
      );
    } else if (defined(this.clock)) {
      _uniformScratch[35] = JulianDate.secondsDifference(
        this.clock.currentTime,
        this.clock.startTime,
      );
    } else {
      _uniformScratch[35] = performance.now() * 0.001;
    }
    uniforms = { uniformArray: _uniformScratch };
  }

  const commandEncoder = this._context.device.createCommandEncoder({
    label: "GlobeFrameEncoder",
  });
  const colorView = this._context.getCurrentTextureView();

  this.globePass.render(commandEncoder, colorView, this._depthView, uniforms);

  this._context.device.queue.submit([commandEncoder.finish()]);
};

/**
 * Starts a self-contained `requestAnimationFrame` render loop that drives the
 * globe rendering without any dependency on Cesium's WebGL render pipeline.
 *
 * On the first call this method also creates the {@link WebGPUCameraController}
 * and attaches it to the WebGPU canvas so that the globe responds to mouse,
 * scroll, and touch events (Cesium-compatible interaction model).
 *
 * Safe to call multiple times – a second call while a loop is already running
 * is a no-op.
 */
WebGPURenderer.prototype.startRenderLoop = function () {
  if (defined(this._rafId)) {
    return; // already running
  }

  // Create the camera controller on first start so it can attach its event
  // listeners to the canvas.  Subsequent calls are no-ops (already running).
  if (!defined(this.cameraController)) {
    this.cameraController = WebGPUCameraController.create(
      this.camera,
      this._context.canvas,
    );
  }

  const self = this;
  function frame() {
    if (self._destroyed) {
      return;
    }
    // Tick the simulation clock (if provided) before rendering so the time
    // uniform reflects the latest simulated time.
    if (defined(self.clock)) {
      self.clock.tick();
    }
    // Apply inertia / ongoing gestures before computing the camera matrices.
    if (defined(self.cameraController)) {
      self.cameraController.update();
    }
    self.renderGlobePass();
    self._rafId = requestAnimationFrame(frame);
  }
  self._rafId = requestAnimationFrame(frame);
};

/**
 * Stops the render loop started by {@link WebGPURenderer#startRenderLoop}.
 */
WebGPURenderer.prototype.stopRenderLoop = function () {
  if (defined(this._rafId)) {
    cancelAnimationFrame(this._rafId);
    this._rafId = undefined;
  }
};

/**
 * Ends the current frame by finalising the command encoder and submitting
 * all recorded commands to the GPU queue.
 */
WebGPURenderer.prototype.endFrame = function () {
  if (defined(this._frameCommandEncoder)) {
    this._frameCommandEncoder.finish();
    this._frameCommandEncoder = undefined;
  }
};

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Creates or recreates the depth texture when the canvas size changes.
 *
 * @private
 * @param {number} width
 * @param {number} height
 */
WebGPURenderer.prototype._ensureDepthTexture = function (width, height) {
  // Recreate if size changed, or if the existing texture has been destroyed.
  const needsRecreation =
    this._width !== width ||
    this._height !== height ||
    !defined(this._depthTexture) ||
    this._depthTexture.isDestroyed();

  if (!needsRecreation) {
    return;
  }

  // Destroy the old texture if it exists.
  if (defined(this._depthTexture) && !this._depthTexture.isDestroyed()) {
    this._depthTexture.destroy();
  }

  this._depthTexture = new WebGPUTexture({
    context: this._context,
    width,
    height,
    format: "depth24plus",
    label: "SceneDepthTexture",
  });

  this._depthView = this._depthTexture.createView();
  this._width = width;
  this._height = height;
};

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * @returns {boolean}
 */
WebGPURenderer.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the renderer and all associated GPU resources.
 */
WebGPURenderer.prototype.destroy = function () {
  this._destroyed = true;
  this.stopRenderLoop();
  if (defined(this.cameraController) && !this.cameraController.isDestroyed()) {
    this.cameraController.destroy();
  }
  if (defined(this._depthTexture) && !this._depthTexture.isDestroyed()) {
    this._depthTexture.destroy();
  }
  if (defined(this.globePass) && !this.globePass.isDestroyed()) {
    this.globePass.destroy();
  }
  if (defined(this.camera) && !this.camera.isDestroyed()) {
    this.camera.destroy();
  }
  this._context.destroy();
  return destroyObject(this);
};

export default WebGPURenderer;
