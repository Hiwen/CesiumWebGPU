import Frozen from "../../Core/Frozen.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import DeveloperError from "../../Core/DeveloperError.js";
import TextureMagnificationFilter from "../TextureMagnificationFilter.js";
import TextureMinificationFilter from "../TextureMinificationFilter.js";
import TextureWrap from "../TextureWrap.js";

/**
 * Maps Cesium {@link TextureWrap} values to WebGPU `GPUAddressMode` strings.
 * @private
 */
function toGPUAddressMode(wrap) {
  switch (wrap) {
    case TextureWrap.CLAMP_TO_EDGE:
      return "clamp-to-edge";
    case TextureWrap.MIRRORED_REPEAT:
      return "mirror-repeat";
    case TextureWrap.REPEAT:
      return "repeat";
    default:
      return "clamp-to-edge";
  }
}

/**
 * Maps Cesium {@link TextureMinificationFilter} values to WebGPU
 * `GPUFilterMode` / `GPUMipmapFilterMode` strings.
 * @private
 */
function toGPUMinFilter(minFilter) {
  switch (minFilter) {
    case TextureMinificationFilter.NEAREST:
    case TextureMinificationFilter.NEAREST_MIPMAP_NEAREST:
    case TextureMinificationFilter.NEAREST_MIPMAP_LINEAR:
      return { minFilter: "nearest", mipmapFilter: "nearest" };
    case TextureMinificationFilter.LINEAR:
    case TextureMinificationFilter.LINEAR_MIPMAP_NEAREST:
    case TextureMinificationFilter.LINEAR_MIPMAP_LINEAR:
    default:
      return { minFilter: "linear", mipmapFilter: "linear" };
  }
}

/**
 * A thin wrapper around a {@link GPUSampler}.
 *
 * Mirrors the WebGL {@link Sampler} API so existing code can reference a
 * sampler object and pass it to render-pipeline helpers.
 *
 * @alias WebGPUSampler
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {import("./WebGPUContext.js").default} options.context
 * @param {TextureWrap}             [options.wrapS=TextureWrap.CLAMP_TO_EDGE]
 * @param {TextureWrap}             [options.wrapT=TextureWrap.CLAMP_TO_EDGE]
 * @param {TextureWrap}             [options.wrapR=TextureWrap.CLAMP_TO_EDGE]
 * @param {TextureMinificationFilter}  [options.minificationFilter=TextureMinificationFilter.LINEAR]
 * @param {TextureMagnificationFilter} [options.magnificationFilter=TextureMagnificationFilter.LINEAR]
 * @param {number}                  [options.maximumAnisotropy=1]
 */
function WebGPUSampler(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  const {
    wrapS = TextureWrap.CLAMP_TO_EDGE,
    wrapT = TextureWrap.CLAMP_TO_EDGE,
    wrapR = TextureWrap.CLAMP_TO_EDGE,
    minificationFilter = TextureMinificationFilter.LINEAR,
    magnificationFilter = TextureMagnificationFilter.LINEAR,
    maximumAnisotropy = 1.0,
  } = options;

  const context = options.context;

  //>>includeStart('debug', pragmas.debug);
  if (!defined(context)) {
    throw new DeveloperError("options.context is required.");
  }
  //>>includeEnd('debug');

  const { minFilter, mipmapFilter } = toGPUMinFilter(minificationFilter);
  const magFilter =
    magnificationFilter === TextureMagnificationFilter.NEAREST
      ? "nearest"
      : "linear";

  const descriptor = {
    addressModeU: toGPUAddressMode(wrapS),
    addressModeV: toGPUAddressMode(wrapT),
    addressModeW: toGPUAddressMode(wrapR),
    minFilter,
    magFilter,
    mipmapFilter,
    maxAnisotropy: Math.max(1, Math.round(maximumAnisotropy)),
  };

  this._context = context;
  this._sampler = context.device.createSampler(descriptor);
  this._descriptor = descriptor;
}

Object.defineProperties(WebGPUSampler.prototype, {
  /**
   * The underlying {@link GPUSampler}.
   * @memberof WebGPUSampler.prototype
   * @type {GPUSampler}
   */
  sampler: {
    get: function () {
      return this._sampler;
    },
  },
});

/**
 * @returns {boolean}
 */
WebGPUSampler.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the wrapper (GPU samplers are GC'd automatically).
 */
WebGPUSampler.prototype.destroy = function () {
  return destroyObject(this);
};

export default WebGPUSampler;
