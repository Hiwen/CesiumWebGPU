import Check from "../../Core/Check.js";
import createGuid from "../../Core/createGuid.js";
import Frozen from "../../Core/Frozen.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import DeveloperError from "../../Core/DeveloperError.js";
import PixelFormat from "../../Core/PixelFormat.js";
import PixelDatatype from "../PixelDatatype.js";

/**
 * Maps a Cesium {@link PixelFormat} to a WebGPU texture format string.
 *
 * @param {PixelFormat} pixelFormat
 * @param {import("../PixelDatatype.js").default} pixelDatatype
 * @returns {string} GPUTextureFormat
 */
function getGPUTextureFormat(pixelFormat, pixelDatatype) {
  switch (pixelFormat) {
    case PixelFormat.RGBA:
      if (pixelDatatype === PixelDatatype.FLOAT) return "rgba32float";
      if (pixelDatatype === PixelDatatype.HALF_FLOAT) return "rgba16float";
      return "rgba8unorm";
    case PixelFormat.RGB:
      // WebGPU has no rgb8unorm; use rgba8unorm and ignore alpha
      return "rgba8unorm";
    case PixelFormat.LUMINANCE_ALPHA:
      return "rg8unorm";
    case PixelFormat.LUMINANCE:
      return "r8unorm";
    case PixelFormat.ALPHA:
      return "r8unorm";
    case PixelFormat.DEPTH_COMPONENT:
      return "depth24plus";
    case PixelFormat.DEPTH_STENCIL:
      return "depth24plus-stencil8";
    default:
      return "rgba8unorm";
  }
}

/**
 * A WebGPU texture that wraps a {@link GPUTexture}.
 *
 * @alias WebGPUTexture
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {import("./WebGPUContext.js").default} options.context
 * @param {number}   [options.width]       Pixel width (required if no `source`).
 * @param {number}   [options.height]      Pixel height (required if no `source`).
 * @param {number}   [options.depth=1]     Depth layers (for 3-D textures).
 * @param {string}   [options.format]      GPUTextureFormat override.
 * @param {PixelFormat} [options.pixelFormat=PixelFormat.RGBA] Cesium pixel format.
 * @param {*}        [options.pixelDatatype] Cesium pixel data type.
 * @param {number}   [options.mipLevelCount=1]
 * @param {number}   [options.sampleCount=1]
 * @param {ImageBitmap|ImageData|HTMLCanvasElement|HTMLImageElement|HTMLVideoElement|OffscreenCanvas} [options.source]
 *   Source image data to upload immediately.
 * @param {boolean}  [options.flipY=false] Flip image on upload (not yet implemented natively; caller should pre-flip).
 * @param {string}   [options.label]
 */
function WebGPUTexture(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.context", options.context);
  //>>includeEnd('debug');

  const context = options.context;
  const source = options.source;

  let width = options.width;
  let height = options.height;

  if (defined(source)) {
    width = width ?? source.width;
    height = height ?? source.height;
  }

  //>>includeStart('debug', pragmas.debug);
  if (!defined(width) || !defined(height)) {
    throw new DeveloperError(
      "options.width and options.height are required when no source is provided.",
    );
  }
  //>>includeEnd('debug');

  const depth = options.depth ?? 1;
  const mipLevelCount = options.mipLevelCount ?? 1;
  const sampleCount = options.sampleCount ?? 1;
  const format =
    options.format ??
    getGPUTextureFormat(options.pixelFormat, options.pixelDatatype);

  const isDepthFormat =
    format.includes("depth") || format.includes("stencil");
  // WebGPU GPUTextureUsage flags (numeric values from the spec):
  // TEXTURE_BINDING=0x04, COPY_DST=0x02, RENDER_ATTACHMENT=0x10
  const usage = isDepthFormat
    ? 0x10 | 0x04 // RENDER_ATTACHMENT | TEXTURE_BINDING
    : 0x04 | 0x02 | 0x10; // TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT

  const label = options.label ?? createGuid();

  const gpuTexture = context.device.createTexture({
    label,
    size: { width, height, depthOrArrayLayers: depth },
    format,
    usage,
    mipLevelCount,
    sampleCount,
    dimension: depth > 1 ? "3d" : "2d",
  });

  this._id = createGuid();
  this._context = context;
  this._texture = gpuTexture;
  this._width = width;
  this._height = height;
  this._depth = depth;
  this._format = format;
  this._mipLevelCount = mipLevelCount;
  this._sampleCount = sampleCount;
  this._label = label;
  this._view = undefined; // created lazily

  // Upload source image if provided
  if (defined(source)) {
    this._uploadSource(source, options.flipY ?? false);
  }
}

Object.defineProperties(WebGPUTexture.prototype, {
  /**
   * The underlying {@link GPUTexture}.
   * @memberof WebGPUTexture.prototype
   * @type {GPUTexture}
   */
  texture: {
    get: function () {
      return this._texture;
    },
  },

  /**
   * The texture width in pixels.
   * @memberof WebGPUTexture.prototype
   * @type {number}
   */
  width: {
    get: function () {
      return this._width;
    },
  },

  /**
   * The texture height in pixels.
   * @memberof WebGPUTexture.prototype
   * @type {number}
   */
  height: {
    get: function () {
      return this._height;
    },
  },

  /**
   * The `GPUTextureFormat` of this texture.
   * @memberof WebGPUTexture.prototype
   * @type {string}
   */
  format: {
    get: function () {
      return this._format;
    },
  },
});

/**
 * Returns (or creates) the default {@link GPUTextureView} for this texture.
 * @returns {GPUTextureView}
 */
WebGPUTexture.prototype.createView = function (descriptor) {
  if (!defined(descriptor) && defined(this._view)) {
    return this._view;
  }
  const view = this._texture.createView(descriptor);
  if (!defined(descriptor)) {
    this._view = view;
  }
  return view;
};

/**
 * Uploads a source image into the GPU texture via `queue.copyExternalImageToTexture`.
 *
 * @private
 * @param {ImageBitmap|HTMLCanvasElement|OffscreenCanvas|ImageData} source
 * @param {boolean} flipY
 */
WebGPUTexture.prototype._uploadSource = function (source, flipY) {
  this._context.queue.copyExternalImageToTexture(
    { source, flipY },
    { texture: this._texture },
    { width: this._width, height: this._height },
  );
};

/**
 * Uploads raw typed-array pixel data into the GPU texture.
 *
 * @param {TypedArray} data    Pixel data (row-major, no padding).
 * @param {number}     [mipLevel=0]
 * @param {number}     [x=0]
 * @param {number}     [y=0]
 * @param {number}     [width]  Defaults to the texture width.
 * @param {number}     [height] Defaults to the texture height.
 * @param {number}     [bytesPerRow] If omitted it is computed from width × pixelByteSize.
 */
WebGPUTexture.prototype.copyFromTypedArray = function (
  data,
  mipLevel,
  x,
  y,
  width,
  height,
  bytesPerRow,
) {
  mipLevel = mipLevel ?? 0;
  x = x ?? 0;
  y = y ?? 0;
  width = width ?? this._width;
  height = height ?? this._height;

  if (!defined(bytesPerRow)) {
    // Assume 4 bytes per pixel for common RGBA formats.
    bytesPerRow = width * 4;
    // WebGPU requires bytesPerRow to be a multiple of 256.
    bytesPerRow = Math.ceil(bytesPerRow / 256) * 256;
  }

  this._context.queue.writeTexture(
    { texture: this._texture, mipLevel, origin: { x, y, z: 0 } },
    data,
    { offset: 0, bytesPerRow },
    { width, height, depthOrArrayLayers: 1 },
  );
};

/**
 * @returns {boolean}
 */
WebGPUTexture.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the underlying GPU texture.
 */
WebGPUTexture.prototype.destroy = function () {
  this._texture.destroy();
  return destroyObject(this);
};

export { getGPUTextureFormat };
export default WebGPUTexture;
