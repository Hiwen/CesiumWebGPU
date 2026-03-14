import Check from "../../Core/Check.js";
import destroyObject from "../../Core/destroyObject.js";

/**
 * A helper that builds and caches {@link GPUBindGroup} objects.
 *
 * Each bind group corresponds to a set of resources bound to a particular
 * bind-group index in a pipeline layout.  Because bind groups are immutable
 * in WebGPU, this class caches them by a caller-supplied string key.
 *
 * @alias WebGPUBindGroup
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {WebGPUContext} options.context
 * @param {GPUBindGroupLayout} options.layout   The layout this group conforms to.
 * @param {GPUBindGroupEntry[]} options.entries  The resource entries.
 * @param {string} [options.label]
 */
function WebGPUBindGroup(options) {
  options = options ?? {};

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.context", options.context);
  Check.defined("options.layout", options.layout);
  Check.defined("options.entries", options.entries);
  //>>includeEnd('debug');

  const label = options.label ?? "BindGroup";

  this._context = options.context;
  this._layout = options.layout;
  this._entries = options.entries;
  this._label = label;
  this._bindGroup = options.context.device.createBindGroup({
    label,
    layout: options.layout,
    entries: options.entries,
  });
}

Object.defineProperties(WebGPUBindGroup.prototype, {
  /**
   * The underlying {@link GPUBindGroup}.
   * @memberof WebGPUBindGroup.prototype
   * @type {GPUBindGroup}
   */
  bindGroup: {
    get: function () {
      return this._bindGroup;
    },
  },

  /**
   * The {@link GPUBindGroupLayout} used to create this bind group.
   * @memberof WebGPUBindGroup.prototype
   * @type {GPUBindGroupLayout}
   */
  layout: {
    get: function () {
      return this._layout;
    },
  },
});

/**
 * Sets this bind group on the given render-pass encoder at the given index.
 *
 * @param {GPURenderPassEncoder} passEncoder
 * @param {number} [index=0] The `@group(n)` index.
 * @param {Uint32Array|number[]} [dynamicOffsets] Dynamic uniform buffer offsets.
 */
WebGPUBindGroup.prototype.bind = function (passEncoder, index, dynamicOffsets) {
  passEncoder.setBindGroup(index ?? 0, this._bindGroup, dynamicOffsets);
};

/**
 * @returns {boolean}
 */
WebGPUBindGroup.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the wrapper (GPUBindGroup objects are GC'd by the browser).
 */
WebGPUBindGroup.prototype.destroy = function () {
  return destroyObject(this);
};

export default WebGPUBindGroup;
