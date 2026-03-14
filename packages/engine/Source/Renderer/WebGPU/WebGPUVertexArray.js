import Check from "../../Core/Check.js";
import ComponentDatatype from "../../Core/ComponentDatatype.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import DeveloperError from "../../Core/DeveloperError.js";
import IndexDatatype from "../../Core/IndexDatatype.js";

/**
 * Maps a Cesium {@link ComponentDatatype} to the corresponding WebGPU vertex
 * format string for a given number of components.
 *
 * @param {ComponentDatatype} componentDatatype
 * @param {number} componentsPerAttribute 1–4
 * @returns {string} A `GPUVertexFormat` string (e.g. `"float32x3"`).
 */
function getGPUVertexFormat(componentDatatype, componentsPerAttribute) {
  const count = componentsPerAttribute;

  switch (componentDatatype) {
    case ComponentDatatype.FLOAT:
      return count === 1 ? "float32" : `float32x${count}`;
    case ComponentDatatype.DOUBLE:
      // WebGPU does not support float64 vertex inputs; use float32.
      return count === 1 ? "float32" : `float32x${count}`;
    case ComponentDatatype.BYTE:
      return count === 1 ? "sint8" : `sint8x${count}`;
    case ComponentDatatype.UNSIGNED_BYTE:
      return count === 1 ? "uint8" : `uint8x${count}`;
    case ComponentDatatype.SHORT:
      return count === 1 ? "sint16" : `sint16x${count}`;
    case ComponentDatatype.UNSIGNED_SHORT:
      return count === 1 ? "uint16" : `uint16x${count}`;
    case ComponentDatatype.INT:
      return count === 1 ? "sint32" : `sint32x${count}`;
    case ComponentDatatype.UNSIGNED_INT:
      return count === 1 ? "uint32" : `uint32x${count}`;
    default:
      throw new DeveloperError(
        `Unsupported ComponentDatatype: ${componentDatatype}`,
      );
  }
}

/**
 * A WebGPU analogue of the WebGL {@link VertexArray}.
 *
 * Holds a set of vertex-buffer bindings (each mapped to a shader location)
 * together with an optional index buffer, and can produce the
 * {@link GPUVertexBufferLayout[]} array needed when creating a render pipeline.
 *
 * @alias WebGPUVertexArray
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {WebGPUContext} options.context
 * @param {Array<WebGPUVertexArrayAttribute>} [options.attributes=[]]
 *   Vertex attribute descriptors.
 * @param {WebGPUBuffer} [options.indexBuffer]  Optional index buffer.
 */
function WebGPUVertexArray(options) {
  options = options ?? {};

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.context", options.context);
  //>>includeEnd('debug');

  const attributes = options.attributes ?? [];
  const indexBuffer = options.indexBuffer;
  // Index format: "uint16" for UNSIGNED_SHORT, "uint32" for UNSIGNED_INT.
  // Callers should pass the Cesium IndexDatatype value via options.indexDatatype.
  // Note: WebGPU does not support uint8 index buffers; UNSIGNED_BYTE must be
  // converted to UNSIGNED_SHORT or UNSIGNED_INT before use.
  const indexDatatype = options.indexDatatype;
  let indexFormat = "uint32";
  if (defined(indexDatatype)) {
    if (indexDatatype === IndexDatatype.UNSIGNED_SHORT) {
      indexFormat = "uint16";
    } else if (indexDatatype === IndexDatatype.UNSIGNED_INT) {
      indexFormat = "uint32";
    }
    // IndexDatatype.UNSIGNED_BYTE is not supported by WebGPU; callers must
    // convert to UNSIGNED_SHORT or UNSIGNED_INT before constructing the buffer.
  }

  this._context = options.context;
  this._attributes = attributes;
  this._indexBuffer = indexBuffer;
  this._indexFormat = indexFormat;

  // Build the GPUVertexBufferLayout array once and cache it.
  this._vertexBufferLayouts = buildVertexBufferLayouts(attributes);
}

/**
 * @typedef {object} WebGPUVertexArrayAttribute
 * @property {object} vertexBuffer         The source GPU buffer ({@link WebGPUBuffer}).
 * @property {number}       shaderLocation        The `@location(n)` binding in the vertex shader.
 * @property {number}       componentsPerAttribute 1–4.
 * @property {ComponentDatatype} componentDatatype Cesium component type.
 * @property {number}       [strideInBytes=0]     Stride between consecutive elements.
 * @property {number}       [offsetInBytes=0]     Byte offset of the first element.
 * @property {boolean}      [normalize=false]     Whether to normalise integer values.
 * @property {number}       [instanceDivisor=0]   > 0 for instanced attributes.
 */

/** @private */
function buildVertexBufferLayouts(attributes) {
  const layouts = [];

  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    const format = getGPUVertexFormat(
      attr.componentDatatype,
      attr.componentsPerAttribute,
    );

    layouts.push({
      arrayStride: attr.strideInBytes ?? 0,
      stepMode: (attr.instanceDivisor ?? 0) > 0 ? "instance" : "vertex",
      attributes: [
        {
          shaderLocation: attr.shaderLocation,
          offset: attr.offsetInBytes ?? 0,
          format,
        },
      ],
    });
  }

  return layouts;
}

Object.defineProperties(WebGPUVertexArray.prototype, {
  /**
   * The list of vertex attributes.
   * @memberof WebGPUVertexArray.prototype
   * @type {WebGPUVertexArrayAttribute[]}
   */
  attributes: {
    get: function () {
      return this._attributes;
    },
  },

  /**
   * The optional index buffer.
   * @memberof WebGPUVertexArray.prototype
   * @type {object|undefined}
   */
  indexBuffer: {
    get: function () {
      return this._indexBuffer;
    },
  },

  /**
   * Pre-built {@link GPUVertexBufferLayout} array for pipeline creation.
   * @memberof WebGPUVertexArray.prototype
   * @type {GPUVertexBufferLayout[]}
   */
  vertexBufferLayouts: {
    get: function () {
      return this._vertexBufferLayouts;
    },
  },
});

/**
 * Binds all vertex buffers and the index buffer (if present) to a
 * {@link GPURenderPassEncoder} prior to a draw call.
 *
 * @param {GPURenderPassEncoder} passEncoder
 */
WebGPUVertexArray.prototype.bind = function (passEncoder) {
  const attributes = this._attributes;
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    passEncoder.setVertexBuffer(i, attr.vertexBuffer.buffer);
  }

  if (defined(this._indexBuffer)) {
    passEncoder.setIndexBuffer(this._indexBuffer.buffer, this._indexFormat);
  }
};

/**
 * @returns {boolean}
 */
WebGPUVertexArray.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys all vertex buffers (that are marked `vertexArrayDestroyable`) and
 * the index buffer.
 */
WebGPUVertexArray.prototype.destroy = function () {
  const attributes = this._attributes;
  for (let i = 0; i < attributes.length; i++) {
    const buf = attributes[i].vertexBuffer;
    if (defined(buf) && buf.vertexArrayDestroyable && !buf.isDestroyed()) {
      buf.destroy();
    }
  }

  if (
    defined(this._indexBuffer) &&
    this._indexBuffer.vertexArrayDestroyable &&
    !this._indexBuffer.isDestroyed()
  ) {
    this._indexBuffer.destroy();
  }

  return destroyObject(this);
};

export { getGPUVertexFormat };
export default WebGPUVertexArray;
