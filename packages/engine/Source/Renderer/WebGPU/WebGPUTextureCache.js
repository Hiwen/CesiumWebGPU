import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";

/**
 * Manages a simple reference-counted cache of {@link WebGPUTexture} objects,
 * mirroring the WebGL {@link TextureCache} API.
 *
 * @alias WebGPUTextureCache
 * @constructor
 * @private
 */
function WebGPUTextureCache() {
  this._textures = new Map();
  this._count = 0;
}

/**
 * Gets a cached texture by key.
 *
 * @param {string} key
 * @returns {WebGPUTexture|undefined}
 */
WebGPUTextureCache.prototype.getTexture = function (key) {
  const entry = this._textures.get(key);
  if (defined(entry)) {
    entry.count++;
    return entry.texture;
  }
  return undefined;
};

/**
 * Adds a texture to the cache.
 *
 * @param {string} key
 * @param {WebGPUTexture} texture
 */
WebGPUTextureCache.prototype.addTexture = function (key, texture) {
  this._textures.set(key, { texture, count: 1 });
};

/**
 * Releases a reference to a cached texture.  When the reference count drops to
 * zero the texture is eligible for destruction.
 *
 * @param {string} key
 */
WebGPUTextureCache.prototype.releaseTexture = function (key) {
  const entry = this._textures.get(key);
  if (defined(entry)) {
    entry.count--;
  }
};

/**
 * Destroys all textures whose reference count has reached zero.
 */
WebGPUTextureCache.prototype.destroyReleasedTextures = function () {
  for (const [key, entry] of this._textures) {
    if (entry.count <= 0) {
      if (!entry.texture.isDestroyed()) {
        entry.texture.destroy();
      }
      this._textures.delete(key);
    }
  }
};

/**
 * @returns {boolean}
 */
WebGPUTextureCache.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the cache and all cached textures.
 */
WebGPUTextureCache.prototype.destroy = function () {
  for (const entry of this._textures.values()) {
    if (!entry.texture.isDestroyed()) {
      entry.texture.destroy();
    }
  }
  this._textures.clear();
  return destroyObject(this);
};

export default WebGPUTextureCache;
