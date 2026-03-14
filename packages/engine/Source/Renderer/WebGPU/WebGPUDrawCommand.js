import Frozen from "../../Core/Frozen.js";
import defined from "../../Core/defined.js";
import PrimitiveType from "../../Core/PrimitiveType.js";

/**
 * A WebGPU analogue of the WebGL {@link DrawCommand}.
 *
 * Encapsulates all state required to issue a single draw call through a
 * {@link GPURenderPassEncoder}: pipeline, bind groups, vertex array,
 * and draw parameters.
 *
 * @alias WebGPUDrawCommand
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {WebGPURenderPipeline} options.renderPipeline
 * @param {WebGPUVertexArray} [options.vertexArray]
 * @param {Array<{index: number, bindGroup: WebGPUBindGroup}>} [options.bindGroups]
 *   Bind groups to set before the draw call; each entry has `index` and `bindGroup`.
 * @param {number}  [options.count]          Number of vertices/indices.
 * @param {number}  [options.offset=0]       First vertex/index offset.
 * @param {number}  [options.instanceCount=0] Number of instances (0 = non-instanced).
 * @param {boolean} [options.indexed=false]  Use `drawIndexed` instead of `draw`.
 * @param {PrimitiveType} [options.primitiveType=PrimitiveType.TRIANGLES]
 * @param {object}  [options.boundingVolume]
 * @param {object}  [options.modelMatrix]
 * @param {boolean} [options.cull=true]
 * @param {*}       [options.owner]
 * @param {*}       [options.pass]
 */
function WebGPUDrawCommand(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  this._renderPipeline = options.renderPipeline;
  this._vertexArray = options.vertexArray;
  this._bindGroups = options.bindGroups ?? [];
  this._count = options.count;
  this._offset = options.offset ?? 0;
  this._instanceCount = options.instanceCount ?? 0;
  this._indexed = options.indexed ?? false;
  this._primitiveType = options.primitiveType ?? PrimitiveType.TRIANGLES;
  this._boundingVolume = options.boundingVolume;
  this._modelMatrix = options.modelMatrix;
  this._owner = options.owner;
  this._pass = options.pass;

  this.cull = options.cull ?? true;

  /**
   * Whether this command needs to be rebuilt before the next frame.
   * @type {boolean}
   */
  this.dirty = true;
  this.lastDirtyTime = 0;
}

Object.defineProperties(WebGPUDrawCommand.prototype, {
  /**
   * The render pipeline for this command.
   * @memberof WebGPUDrawCommand.prototype
   * @type {WebGPURenderPipeline}
   */
  renderPipeline: {
    get: function () {
      return this._renderPipeline;
    },
    set: function (value) {
      this._renderPipeline = value;
    },
  },

  /**
   * The vertex array providing geometry data.
   * @memberof WebGPUDrawCommand.prototype
   * @type {WebGPUVertexArray|undefined}
   */
  vertexArray: {
    get: function () {
      return this._vertexArray;
    },
    set: function (value) {
      this._vertexArray = value;
    },
  },

  /**
   * Bind groups to be set before drawing.
   * @memberof WebGPUDrawCommand.prototype
   * @type {Array<{index: number, bindGroup: WebGPUBindGroup}>}
   */
  bindGroups: {
    get: function () {
      return this._bindGroups;
    },
    set: function (value) {
      this._bindGroups = value;
    },
  },

  /**
   * Number of vertices or indices to draw.
   * @memberof WebGPUDrawCommand.prototype
   * @type {number}
   */
  count: {
    get: function () {
      return this._count;
    },
    set: function (value) {
      this._count = value;
    },
  },

  /**
   * First vertex/index.
   * @memberof WebGPUDrawCommand.prototype
   * @type {number}
   */
  offset: {
    get: function () {
      return this._offset;
    },
    set: function (value) {
      this._offset = value;
    },
  },

  /**
   * Number of instances.  0 means a non-instanced draw.
   * @memberof WebGPUDrawCommand.prototype
   * @type {number}
   */
  instanceCount: {
    get: function () {
      return this._instanceCount;
    },
    set: function (value) {
      this._instanceCount = value;
    },
  },

  /**
   * Whether to use an indexed draw call.
   * @memberof WebGPUDrawCommand.prototype
   * @type {boolean}
   */
  indexed: {
    get: function () {
      return this._indexed;
    },
    set: function (value) {
      this._indexed = value;
    },
  },

  /**
   * The bounding volume for culling.
   * @memberof WebGPUDrawCommand.prototype
   * @type {object|undefined}
   */
  boundingVolume: {
    get: function () {
      return this._boundingVolume;
    },
    set: function (value) {
      this._boundingVolume = value;
    },
  },

  /**
   * The model matrix.
   * @memberof WebGPUDrawCommand.prototype
   * @type {object|undefined}
   */
  modelMatrix: {
    get: function () {
      return this._modelMatrix;
    },
    set: function (value) {
      this._modelMatrix = value;
    },
  },

  /**
   * The owner of this command.
   * @memberof WebGPUDrawCommand.prototype
   * @type {*}
   */
  owner: {
    get: function () {
      return this._owner;
    },
    set: function (value) {
      this._owner = value;
    },
  },

  /**
   * The render pass this command belongs to.
   * @memberof WebGPUDrawCommand.prototype
   * @type {*}
   */
  pass: {
    get: function () {
      return this._pass;
    },
    set: function (value) {
      this._pass = value;
    },
  },
});

/**
 * Executes this draw command against the given {@link GPURenderPassEncoder}.
 *
 * @param {GPURenderPassEncoder} passEncoder
 */
WebGPUDrawCommand.prototype.execute = function (passEncoder) {
  // 1. Set pipeline
  if (defined(this._renderPipeline)) {
    passEncoder.setPipeline(this._renderPipeline.pipeline);
  }

  // 2. Bind vertex buffers and index buffer
  if (defined(this._vertexArray)) {
    this._vertexArray.bind(passEncoder);
  }

  // 3. Set bind groups
  const bindGroups = this._bindGroups;
  for (let i = 0; i < bindGroups.length; i++) {
    const entry = bindGroups[i];
    entry.bindGroup.bind(passEncoder, entry.index);
  }

  // 4. Issue the draw call
  const instanceCount = this._instanceCount > 0 ? this._instanceCount : 1;
  const count = this._count ?? 0;
  const offset = this._offset ?? 0;

  if (this._indexed) {
    passEncoder.drawIndexed(count, instanceCount, offset, 0, 0);
  } else {
    passEncoder.draw(count, instanceCount, offset, 0);
  }
};

export default WebGPUDrawCommand;
