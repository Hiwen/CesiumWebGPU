import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";

/**
 * Manages a cache of compiled WebGPU shader modules ({@link GPUShaderModule}).
 *
 * Shader modules are keyed by a stable string that encodes the shader type
 * and source content (or any other application-defined discriminator).
 *
 * @alias WebGPUShaderCache
 * @constructor
 * @private
 *
 * @param {WebGPUContext} context
 */
function WebGPUShaderCache(context) {
  this._context = context;
  this._shaders = new Map();
  this._programs = new Map();
}

/**
 * Returns a cached {@link GPUShaderModule} for the given WGSL source, creating
 * it if it does not already exist.
 *
 * @param {string} key      A stable cache key (e.g. a content hash or name).
 * @param {string} wgslCode The WGSL shader source.
 * @returns {GPUShaderModule}
 */
WebGPUShaderCache.prototype.getShaderModule = function (key, wgslCode) {
  let module = this._shaders.get(key);
  if (!defined(module)) {
    module = this._context.device.createShaderModule({
      label: key,
      code: wgslCode,
    });
    this._shaders.set(key, module);
  }
  return module;
};

/**
 * Returns a cached {@link WebGPUShaderProgram} by its combined vertex + fragment
 * cache key, or `undefined` if no matching program has been cached yet.
 *
 * @param {string} key
 * @returns {WebGPUShaderProgram|undefined}
 */
WebGPUShaderCache.prototype.getShaderProgram = function (key) {
  return this._programs.get(key);
};

/**
 * Stores a compiled {@link WebGPUShaderProgram} under the given key.
 *
 * @param {string} key
 * @param {WebGPUShaderProgram} program
 */
WebGPUShaderCache.prototype.setShaderProgram = function (key, program) {
  this._programs.set(key, program);
};

/**
 * Removes shader programs that have been explicitly released (i.e., whose
 * reference count has dropped to zero).  Mirrors `ShaderCache#destroyReleasedShaderPrograms`.
 */
WebGPUShaderCache.prototype.destroyReleasedShaderPrograms = function () {
  // Shader modules are lightweight GPU objects; we rely on the GC / explicit
  // destroys rather than reference counting for now.
};

/**
 * @returns {boolean}
 */
WebGPUShaderCache.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the cache and all cached shader modules.
 */
WebGPUShaderCache.prototype.destroy = function () {
  this._shaders.clear();
  this._programs.clear();
  return destroyObject(this);
};

export default WebGPUShaderCache;
