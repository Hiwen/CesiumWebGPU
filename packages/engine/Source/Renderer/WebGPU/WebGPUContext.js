import Check from "../../Core/Check.js";
import createGuid from "../../Core/createGuid.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import DeveloperError from "../../Core/DeveloperError.js";
import RuntimeError from "../../Core/RuntimeError.js";
import WebGPUShaderCache from "./WebGPUShaderCache.js";
import WebGPUTextureCache from "./WebGPUTextureCache.js";

/**
 * Checks whether the browser supports WebGPU.
 * @returns {boolean}
 */
export function isWebGPUSupported() {
  return typeof navigator !== "undefined" && defined(navigator.gpu);
}

/**
 * Requests a WebGPU adapter and device, resolving with a {@link WebGPUContext}.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {GPURequestAdapterOptions} [options.adapterOptions]
 * @param {GPUDeviceDescriptor} [options.deviceDescriptor]
 * @param {string} [options.canvasFormat] Preferred canvas texture format.
 * @returns {Promise<WebGPUContext>}
 */
WebGPUContext.create = async function (canvas, options) {
  options = options ?? {};

  if (!isWebGPUSupported()) {
    throw new RuntimeError(
      "WebGPU is not supported in this browser. Please use a browser that supports WebGPU.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter(
    options.adapterOptions ?? { powerPreference: "high-performance" },
  );

  if (!defined(adapter)) {
    throw new RuntimeError(
      "Failed to obtain a WebGPU adapter. Your browser or GPU may not fully support WebGPU.",
    );
  }

  const device = await adapter.requestDevice(options.deviceDescriptor);

  if (!defined(device)) {
    throw new RuntimeError("Failed to obtain a WebGPU device.");
  }

  return new WebGPUContext(canvas, adapter, device, options);
};

/**
 * A WebGPU rendering context that wraps a {@link GPUDevice} and provides
 * higher-level helpers that mirror the API of the legacy WebGL {@link Context}.
 *
 * Do **not** construct directly – use {@link WebGPUContext.create}.
 *
 * @alias WebGPUContext
 * @constructor
 * @private
 *
 * @param {HTMLCanvasElement} canvas
 * @param {GPUAdapter} adapter
 * @param {GPUDevice} device
 * @param {object} [options]
 */
function WebGPUContext(canvas, adapter, device, options) {
  options = options ?? {};

  this._canvas = canvas;
  this._adapter = adapter;
  this._device = device;
  this._queue = device.queue;
  this._id = createGuid();

  // Preferred swap-chain texture format (sRGB when supported).
  const preferredFormat =
    options.canvasFormat ?? navigator.gpu.getPreferredCanvasFormat();
  this._canvasFormat = preferredFormat;

  // Configure the canvas context for rendering.
  const gpuContext = canvas.getContext("webgpu");
  if (!defined(gpuContext)) {
    throw new RuntimeError(
      "Could not obtain a WebGPU canvas context from the provided canvas element.",
    );
  }
  gpuContext.configure({
    device: device,
    format: preferredFormat,
    alphaMode: "premultiplied",
  });
  this._gpuCanvasContext = gpuContext;

  // Shader / texture caches
  this._shaderCache = new WebGPUShaderCache(this);
  this._textureCache = new WebGPUTextureCache();

  // Pipeline cache – keyed by a descriptor hash.
  this._pipelineCache = new Map();

  // Bind-group-layout cache – keyed by descriptor hash.
  this._bindGroupLayoutCache = new Map();

  // A general-purpose cache for objects that want to attach data to the context.
  this.cache = {};

  // Pick-object map (mirrors Context.createPickId infrastructure).
  this._pickObjects = new Map();
  this._nextPickColor = new Uint32Array(1);

  // Capabilities / limits (populated from adapter limits).
  const limits = adapter.limits ?? {};
  this._maxTextureDimension2D = limits.maxTextureDimension2D ?? 8192;
  this._maxBindGroups = limits.maxBindGroups ?? 4;
  this._maxSampledTexturesPerShaderStage =
    limits.maxSampledTexturesPerShaderStage ?? 16;

  // Error handling: surface uncaptured GPU errors to the console.
  device.addEventListener("uncapturederror", (event) => {
    console.error("[WebGPU] Uncaptured error:", event.error.message ?? event.error);
  });

  // Logging flags (mirrors Context API)
  this.logShaderCompilation = false;
  this.validateShaderProgram = false;
}

Object.defineProperties(WebGPUContext.prototype, {
  /**
   * The underlying canvas element.
   * @memberof WebGPUContext.prototype
   * @type {HTMLCanvasElement}
   */
  canvas: {
    get: function () {
      return this._canvas;
    },
  },

  /**
   * The {@link GPUAdapter}.
   * @memberof WebGPUContext.prototype
   * @type {GPUAdapter}
   */
  adapter: {
    get: function () {
      return this._adapter;
    },
  },

  /**
   * The {@link GPUDevice}.
   * @memberof WebGPUContext.prototype
   * @type {GPUDevice}
   */
  device: {
    get: function () {
      return this._device;
    },
  },

  /**
   * The {@link GPUQueue} used for command submission.
   * @memberof WebGPUContext.prototype
   * @type {GPUQueue}
   */
  queue: {
    get: function () {
      return this._queue;
    },
  },

  /**
   * The swap-chain texture format (e.g. `"bgra8unorm"` or `"rgba8unorm"`).
   * @memberof WebGPUContext.prototype
   * @type {string}
   */
  canvasFormat: {
    get: function () {
      return this._canvasFormat;
    },
  },

  /**
   * The configured {@link GPUCanvasContext}.
   * @memberof WebGPUContext.prototype
   * @type {GPUCanvasContext}
   */
  gpuCanvasContext: {
    get: function () {
      return this._gpuCanvasContext;
    },
  },

  /**
   * The shader cache.
   * @memberof WebGPUContext.prototype
   * @type {WebGPUShaderCache}
   */
  shaderCache: {
    get: function () {
      return this._shaderCache;
    },
  },

  /**
   * The texture cache.
   * @memberof WebGPUContext.prototype
   * @type {WebGPUTextureCache}
   */
  textureCache: {
    get: function () {
      return this._textureCache;
    },
  },

  /**
   * Current drawing-buffer width.
   * @memberof WebGPUContext.prototype
   * @type {number}
   */
  drawingBufferWidth: {
    get: function () {
      return this._canvas.width;
    },
  },

  /**
   * Current drawing-buffer height.
   * @memberof WebGPUContext.prototype
   * @type {number}
   */
  drawingBufferHeight: {
    get: function () {
      return this._canvas.height;
    },
  },

  /**
   * Always `true` – WebGPU supports depth textures natively.
   * @memberof WebGPUContext.prototype
   * @type {boolean}
   */
  depthTexture: {
    get: function () {
      return true;
    },
  },

  /**
   * Always `true` – WebGPU supports floating-point textures.
   * @memberof WebGPUContext.prototype
   * @type {boolean}
   */
  floatingPointTexture: {
    get: function () {
      return true;
    },
  },

  /**
   * Always `true` – WebGPU supports half-float textures.
   * @memberof WebGPUContext.prototype
   * @type {boolean}
   */
  halfFloatingPointTexture: {
    get: function () {
      return true;
    },
  },

  /**
   * Always `true` – fragment depth is always available in WGSL.
   * @memberof WebGPUContext.prototype
   * @type {boolean}
   */
  fragmentDepth: {
    get: function () {
      return true;
    },
  },

  /**
   * A unique identifier for this context instance.
   * @memberof WebGPUContext.prototype
   * @type {string}
   */
  id: {
    get: function () {
      return this._id;
    },
  },

  /**
   * Always `true` – WebGPU always behaves like WebGL2 for Cesium's purposes.
   * @memberof WebGPUContext.prototype
   * @type {boolean}
   */
  webgl2: {
    get: function () {
      return true;
    },
  },

  /**
   * Maximum 2D texture dimension.
   * @memberof WebGPUContext.prototype
   * @type {number}
   */
  maximumTextureSize: {
    get: function () {
      return this._maxTextureDimension2D;
    },
  },
});

/**
 * Gets or creates a {@link GPURenderPipeline} from the cache.
 *
 * @param {string} cacheKey A stable string key that uniquely identifies this pipeline.
 * @param {GPURenderPipelineDescriptor} descriptor The pipeline descriptor.
 * @returns {GPURenderPipeline}
 */
WebGPUContext.prototype.getRenderPipeline = function (cacheKey, descriptor) {
  let pipeline = this._pipelineCache.get(cacheKey);
  if (!defined(pipeline)) {
    pipeline = this._device.createRenderPipeline(descriptor);
    this._pipelineCache.set(cacheKey, pipeline);
  }
  return pipeline;
};

/**
 * Gets or creates a {@link GPUBindGroupLayout} from the cache.
 *
 * @param {string} cacheKey
 * @param {GPUBindGroupLayoutDescriptor} descriptor
 * @returns {GPUBindGroupLayout}
 */
WebGPUContext.prototype.getBindGroupLayout = function (cacheKey, descriptor) {
  let layout = this._bindGroupLayoutCache.get(cacheKey);
  if (!defined(layout)) {
    layout = this._device.createBindGroupLayout(descriptor);
    this._bindGroupLayoutCache.set(cacheKey, layout);
  }
  return layout;
};

/**
 * Creates a new {@link GPUCommandEncoder}.
 * @returns {GPUCommandEncoder}
 */
WebGPUContext.prototype.createCommandEncoder = function () {
  return this._device.createCommandEncoder();
};

/**
 * Submits a completed {@link GPUCommandBuffer} (or an array thereof) to the GPU queue.
 *
 * @param {GPUCommandBuffer|GPUCommandBuffer[]} commandBuffers
 */
WebGPUContext.prototype.submitCommandBuffers = function (commandBuffers) {
  const buffers = Array.isArray(commandBuffers)
    ? commandBuffers
    : [commandBuffers];
  this._queue.submit(buffers);
};

/**
 * Returns the current swap-chain texture view for rendering into the canvas.
 * @returns {GPUTextureView}
 */
WebGPUContext.prototype.getCurrentTextureView = function () {
  return this._gpuCanvasContext.getCurrentTexture().createView();
};

/**
 * Creates and assigns a pick ID, mirroring {@link Context#createPickId}.
 *
 * @param {object} object
 * @returns {{ color: import("../../Core/Color").default, destroy: function }}
 */
WebGPUContext.prototype.createPickId = function (object) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("object", object);
  //>>includeEnd('debug');

  ++this._nextPickColor[0];
  const key = this._nextPickColor[0];
  if (key === 0) {
    throw new RuntimeError("Out of unique Pick IDs.");
  }

  this._pickObjects.set(key, object);

  const pickObjects = this._pickObjects;
  return {
    color: colorFromId(key),
    destroy: function () {
      pickObjects.delete(key);
    },
  };
};

/** @private */
function colorFromId(id) {
  // Encode 32-bit id as RGBA (same scheme as WebGL Context)
  const r = ((id >>> 0) & 0xff) / 255.0;
  const g = ((id >>> 8) & 0xff) / 255.0;
  const b = ((id >>> 16) & 0xff) / 255.0;
  const a = ((id >>> 24) & 0xff) / 255.0;
  return { red: r, green: g, blue: b, alpha: a };
}

/**
 * Gets the object associated with a pick color.
 *
 * @param {{ red: number, green: number, blue: number, alpha: number }} color
 * @returns {object|undefined}
 */
WebGPUContext.prototype.getObjectByPickColor = function (color) {
  const id =
    Math.round(color.red * 255) |
    (Math.round(color.green * 255) << 8) |
    (Math.round(color.blue * 255) << 16) |
    (Math.round(color.alpha * 255) << 24);
  return this._pickObjects.get(id >>> 0);
};

/**
 * @returns {boolean}
 */
WebGPUContext.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the context and releases all associated GPU resources.
 */
WebGPUContext.prototype.destroy = function () {
  // Destroy objects held in the general-purpose cache.
  const cache = this.cache;
  for (const key in cache) {
    if (Object.prototype.hasOwnProperty.call(cache, key)) {
      const value = cache[key];
      if (defined(value) && typeof value.destroy === "function") {
        value.destroy();
      }
    }
  }

  this._shaderCache = this._shaderCache.destroy();
  this._textureCache = this._textureCache.destroy();
  this._pipelineCache.clear();
  this._bindGroupLayoutCache.clear();
  this._pickObjects.clear();

  this._device.destroy();

  return destroyObject(this);
};

export default WebGPUContext;
