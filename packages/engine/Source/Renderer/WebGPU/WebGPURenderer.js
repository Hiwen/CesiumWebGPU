import Check from "../../Core/Check.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import RuntimeError from "../../Core/RuntimeError.js";
import WebGPUContext, { isWebGPUSupported } from "./WebGPUContext.js";
import WebGPUCommandEncoder from "./WebGPUCommandEncoder.js";
import WebGPUTexture from "./WebGPUTexture.js";
import WebGPUGlobePass from "./WebGPUGlobePass.js";

/**
 * High-level WebGPU renderer that manages the per-frame rendering loop.
 *
 * This class is the WebGPU equivalent of the WebGL rendering work done inside
 * `Scene._render` / `Context` / `ComputeEngine`.  It:
 *
 * - Holds a {@link WebGPUContext}
 * - Creates and destroys the per-frame depth buffer as the canvas resizes
 * - Provides `beginFrame()` / `endFrame()` that bracket a frame's render passes
 * - Exposes the color and depth attachment views for use by render-pass builders
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

  // Execute render-command lists accumulated during scene traversal.
  this._opaqueCommandList = [];
  this._translucentCommandList = [];

  /**
   * The {@link WebGPUGlobePass} instance, created via
   * {@link WebGPURenderer#createGlobePass}.
   * @type {WebGPUGlobePass|undefined}
   */
  this.globePass = undefined;
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
 * Renders a single globe frame using the current {@link WebGPUGlobePass}.
 *
 * Automatically calls {@link WebGPURenderer#beginFrame} /
 * {@link WebGPURenderer#endFrame} if no frame is currently in flight.
 *
 * @param {object} uniforms  Forwarded verbatim to {@link WebGPUGlobePass#render}.
 * @param {Float32Array} uniforms.mvp
 * @param {Float32Array} uniforms.mv
 * @param {number[]}     uniforms.lightDirEC
 * @param {number}       uniforms.time
 */
WebGPURenderer.prototype.renderGlobePass = function (uniforms) {
  if (!defined(this.globePass) || !this.globePass._ready) {
    return;
  }

  const canvas = this._context.canvas;
  this._ensureDepthTexture(canvas.width, canvas.height);

  const commandEncoder = this._context.device.createCommandEncoder({
    label: "GlobeFrameEncoder",
  });
  const colorView = this._context.getCurrentTextureView();

  this.globePass.render(commandEncoder, colorView, this._depthView, uniforms);

  this._context.device.queue.submit([commandEncoder.finish()]);
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
  if (defined(this._depthTexture) && !this._depthTexture.isDestroyed()) {
    this._depthTexture.destroy();
  }
  if (defined(this.globePass) && !this.globePass.isDestroyed()) {
    this.globePass.destroy();
  }
  this._context.destroy();
  return destroyObject(this);
};

export default WebGPURenderer;
