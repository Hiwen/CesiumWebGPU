import Check from "../../Core/Check.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import RuntimeError from "../../Core/RuntimeError.js";
import WebGPUContext, { isWebGPUSupported } from "./WebGPUContext.js";
import WebGPUCommandEncoder from "./WebGPUCommandEncoder.js";
import WebGPUTexture from "./WebGPUTexture.js";
import WebGPUGlobePass from "./WebGPUGlobePass.js";
import WebGPUCamera from "./WebGPUCamera.js";
import WebGPUCameraController from "./WebGPUCameraController.js";

// Pre-allocated uniform buffer (36 floats: mvp[16] | mv[16] | lightDirEC[3] | time[1])
const _uniformScratch = new Float32Array(36);

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
 */
function WebGPURenderer(context) {
  this._context = context;
  this._depthTexture = undefined;
  this._depthView = undefined;
  this._width = 0;
  this._height = 0;
  this._frameCommandEncoder = undefined;
  this._rafId = undefined;
  this._destroyed = false;

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
 * @param {object} [options]   Forwarded to {@link WebGPUContext.create}.
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

  const context = await WebGPUContext.create(canvas, options);
  return new WebGPURenderer(context);
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
    const sun = this.camera.sunDirectionEC();
    _uniformScratch.set(this.camera.mvpMatrix, 0);
    _uniformScratch.set(this.camera.mvMatrix, 16);
    _uniformScratch[32] = sun[0];
    _uniformScratch[33] = sun[1];
    _uniformScratch[34] = sun[2];
    _uniformScratch[35] = performance.now() * 0.001;
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
