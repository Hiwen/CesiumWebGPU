import Check from "../../Core/Check.js";
import createGuid from "../../Core/createGuid.js";
import Frozen from "../../Core/Frozen.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import DeveloperError from "../../Core/DeveloperError.js";

/**
 * Buffer usage hints – mirrors {@link BufferUsage} but expressed as WebGPU
 * `GPUBufferUsage` flags so callers do not need to map them manually.
 * Values match the WebGPU specification constants.
 * @see https://gpuweb.github.io/gpuweb/#buffer-usage
 */
const WebGPUBufferUsage = Object.freeze({
  /** Vertex data. */
  VERTEX: 0x0020 | 0x0008, // VERTEX | COPY_DST
  /** Index data. */
  INDEX: 0x0010 | 0x0008, // INDEX | COPY_DST
  /** Uniform data. */
  UNIFORM: 0x0040 | 0x0008, // UNIFORM | COPY_DST
  /** General-purpose storage (read/write in shaders). */
  STORAGE: 0x0080 | 0x0008, // STORAGE | COPY_DST
  /** CPU-readable readback buffer. */
  MAP_READ: 0x0001 | 0x0008, // MAP_READ | COPY_DST
  /** CPU-writeable staging buffer. */
  MAP_WRITE: 0x0002 | 0x0004, // MAP_WRITE | COPY_SRC
});

/**
 * A WebGPU buffer that wraps a {@link GPUBuffer}.
 *
 * Use the static factory helpers ({@link WebGPUBuffer.createVertexBuffer},
 * {@link WebGPUBuffer.createIndexBuffer}, {@link WebGPUBuffer.createUniformBuffer})
 * rather than constructing directly.
 *
 * @alias WebGPUBuffer
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {WebGPUContext} options.context
 * @param {number}     [options.sizeInBytes]   Byte size when `typedArray` is absent.
 * @param {TypedArray} [options.typedArray]    Initial data; size is inferred.
 * @param {number}     options.usage           One of the `WebGPUBufferUsage` flag combinations.
 * @param {string}     [options.label]         Optional debug label.
 */
function WebGPUBuffer(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.context", options.context);
  if (!defined(options.typedArray) && !defined(options.sizeInBytes)) {
    throw new DeveloperError(
      "Either options.sizeInBytes or options.typedArray is required.",
    );
  }
  if (defined(options.typedArray) && defined(options.sizeInBytes)) {
    throw new DeveloperError(
      "Cannot pass in both options.sizeInBytes and options.typedArray.",
    );
  }
  //>>includeEnd('debug');

  const context = options.context;
  const device = context.device;
  const typedArray = options.typedArray;
  const usage = options.usage;
  const label = options.label ?? createGuid();

  let sizeInBytes = defined(typedArray)
    ? typedArray.byteLength
    : options.sizeInBytes;

  // WebGPU requires buffer sizes to be a multiple of 4.
  sizeInBytes = Math.ceil(sizeInBytes / 4) * 4;

  const mappedAtCreation = defined(typedArray);

  const gpuBuffer = device.createBuffer({
    label,
    size: sizeInBytes,
    usage,
    mappedAtCreation,
  });

  if (mappedAtCreation) {
    const dst = new typedArray.constructor(gpuBuffer.getMappedRange());
    dst.set(typedArray);
    gpuBuffer.unmap();
  }

  this._id = createGuid();
  this._context = context;
  this._buffer = gpuBuffer;
  this._sizeInBytes = sizeInBytes;
  this._usage = usage;
  this._label = label;

  /**
   * When `true` the buffer will be destroyed when the owning {@link WebGPUVertexArray}
   * is destroyed.  Mirrors the WebGL `Buffer.vertexArrayDestroyable` flag.
   * @type {boolean}
   */
  this.vertexArrayDestroyable = true;
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Creates a vertex buffer, optionally pre-filled with `typedArray`.
 *
 * @param {object} options
 * @param {WebGPUContext} options.context
 * @param {TypedArray} [options.typedArray]
 * @param {number}     [options.sizeInBytes]
 * @param {string}     [options.label]
 * @returns {WebGPUBuffer}
 */
WebGPUBuffer.createVertexBuffer = function (options) {
  return new WebGPUBuffer({
    ...options,
    usage: WebGPUBufferUsage.VERTEX,
  });
};

/**
 * Creates an index buffer, optionally pre-filled with `typedArray`.
 *
 * @param {object} options
 * @param {WebGPUContext} options.context
 * @param {TypedArray} [options.typedArray]
 * @param {number}     [options.sizeInBytes]
 * @param {string}     [options.label]
 * @returns {WebGPUBuffer}
 */
WebGPUBuffer.createIndexBuffer = function (options) {
  return new WebGPUBuffer({
    ...options,
    usage: WebGPUBufferUsage.INDEX,
  });
};

/**
 * Creates a uniform buffer of the given byte size.
 *
 * @param {object} options
 * @param {WebGPUContext} options.context
 * @param {number}     options.sizeInBytes
 * @param {TypedArray} [options.typedArray]
 * @param {string}     [options.label]
 * @returns {WebGPUBuffer}
 */
WebGPUBuffer.createUniformBuffer = function (options) {
  return new WebGPUBuffer({
    ...options,
    usage: WebGPUBufferUsage.UNIFORM,
  });
};

// ─── Instance API ─────────────────────────────────────────────────────────────

Object.defineProperties(WebGPUBuffer.prototype, {
  /**
   * The underlying {@link GPUBuffer}.
   * @memberof WebGPUBuffer.prototype
   * @type {GPUBuffer}
   */
  buffer: {
    get: function () {
      return this._buffer;
    },
  },

  /**
   * The byte size of the buffer (padded to a multiple of 4).
   * @memberof WebGPUBuffer.prototype
   * @type {number}
   */
  sizeInBytes: {
    get: function () {
      return this._sizeInBytes;
    },
  },

  /**
   * The `GPUBufferUsage` flags used to create this buffer.
   * @memberof WebGPUBuffer.prototype
   * @type {number}
   */
  usage: {
    get: function () {
      return this._usage;
    },
  },

  /**
   * A unique identifier for this buffer instance.
   * @memberof WebGPUBuffer.prototype
   * @type {string}
   */
  id: {
    get: function () {
      return this._id;
    },
  },
});

/**
 * Uploads new data into the buffer using `queue.writeBuffer`.
 *
 * @param {TypedArray|ArrayBuffer} data      New data.
 * @param {number}                 [dstByteOffset=0] Offset into the GPU buffer.
 * @param {number}                 [srcByteOffset=0] Offset into `data`.
 * @param {number}                 [byteLength]      Byte count to copy (defaults to all).
 */
WebGPUBuffer.prototype.copyFromTypedArray = function (
  data,
  dstByteOffset,
  srcByteOffset,
  byteLength,
) {
  dstByteOffset = dstByteOffset ?? 0;
  srcByteOffset = srcByteOffset ?? 0;

  this._context.queue.writeBuffer(
    this._buffer,
    dstByteOffset,
    data,
    srcByteOffset,
    byteLength,
  );
};

/**
 * @returns {boolean}
 */
WebGPUBuffer.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the underlying GPU buffer.
 */
WebGPUBuffer.prototype.destroy = function () {
  this._buffer.destroy();
  return destroyObject(this);
};

export { WebGPUBufferUsage };
export default WebGPUBuffer;
