import Check from "../../Core/Check.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";
import PrimitiveType from "../../Core/PrimitiveType.js";
import BlendEquation from "../../Scene/BlendEquation.js";
import BlendFunction from "../../Scene/BlendFunction.js";
import CullFace from "../../Scene/CullFace.js";
import DepthFunction from "../../Scene/DepthFunction.js";

/**
 * Maps a Cesium {@link PrimitiveType} to a WebGPU `GPUPrimitiveTopology`.
 *
 * @param {PrimitiveType} primitiveType
 * @returns {string}
 */
function toGPUPrimitiveTopology(primitiveType) {
  switch (primitiveType) {
    case PrimitiveType.POINTS:
      return "point-list";
    case PrimitiveType.LINES:
      return "line-list";
    case PrimitiveType.LINE_STRIP:
      return "line-strip";
    case PrimitiveType.TRIANGLES:
      return "triangle-list";
    case PrimitiveType.TRIANGLE_STRIP:
      return "triangle-strip";
    default:
      return "triangle-list";
  }
}

/**
 * Caches and manages {@link GPURenderPipeline} objects.
 *
 * A render pipeline in WebGPU is a heavy object that encodes the complete
 * state needed for a draw call (shaders, vertex layout, blend state, depth
 * state, etc.).  This class handles building the descriptor from Cesium's
 * intermediate representations and caches the result by a stable string key.
 *
 * @alias WebGPURenderPipeline
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {WebGPUContext} options.context
 * @param {WebGPUShaderProgram} options.shaderProgram
 * @param {GPUPipelineLayout|"auto"} options.layout
 * @param {WebGPUVertexArray} [options.vertexArray]
 * @param {PrimitiveType} [options.primitiveType=PrimitiveType.TRIANGLES]
 * @param {object} [options.renderState]   Cesium RenderState descriptor.
 * @param {string} options.colorFormat     Colour attachment texture format.
 * @param {string} [options.depthFormat]   Depth attachment format (e.g. `"depth24plus"`).
 * @param {string} [options.label]
 */
function WebGPURenderPipeline(options) {
  options = options ?? {};

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.context", options.context);
  Check.defined("options.shaderProgram", options.shaderProgram);
  Check.typeOf.string("options.colorFormat", options.colorFormat);
  //>>includeEnd('debug');

  const context = options.context;
  const shaderProgram = options.shaderProgram;
  const renderState = options.renderState ?? {};
  const primitiveType = options.primitiveType ?? PrimitiveType.TRIANGLES;
  const label = options.label ?? "RenderPipeline";
  const colorFormat = options.colorFormat;
  const depthFormat = options.depthFormat;

  // Vertex buffer layouts
  const vertexBufferLayouts = defined(options.vertexArray)
    ? options.vertexArray.vertexBufferLayouts
    : [];

  // Blend state
  const blending = buildBlendState(renderState.blending);

  // Depth/stencil state
  const depthStencil = defined(depthFormat)
    ? buildDepthStencilState(
        renderState.depthTest,
        renderState.depthMask,
        depthFormat,
      )
    : undefined;

  const descriptor = {
    label,
    layout: options.layout ?? "auto",
    vertex: shaderProgram.getVertexState(vertexBufferLayouts),
    fragment: shaderProgram.getFragmentState([
      {
        format: colorFormat,
        blend: blending,
        writeMask: 0xf, // GPUColorWrite.ALL
      },
    ]),
    primitive: {
      topology: toGPUPrimitiveTopology(primitiveType),
      cullMode: buildCullMode(renderState.cull),
      frontFace: "ccw",
    },
    depthStencil,
    multisample: {
      count: options.sampleCount ?? 1,
    },
  };

  // Use the context's pipeline cache when a stable label is provided.
  this._pipeline = context.getRenderPipeline(label, descriptor);
  this._context = context;
  this._label = label;
  this._descriptor = descriptor;
}

/** @private */
function buildBlendState(blending) {
  if (!defined(blending) || !blending.enabled) {
    return undefined;
  }

  return {
    color: {
      srcFactor: toGPUBlendFactor(blending.functionSourceRgb),
      dstFactor: toGPUBlendFactor(blending.functionDestinationRgb),
      operation: toGPUBlendOp(blending.equationRgb),
    },
    alpha: {
      srcFactor: toGPUBlendFactor(blending.functionSourceAlpha),
      dstFactor: toGPUBlendFactor(blending.functionDestinationAlpha),
      operation: toGPUBlendOp(blending.equationAlpha),
    },
  };
}

/** @private */
function toGPUBlendFactor(f) {
  switch (f) {
    case BlendFunction.ZERO:
      return "zero";
    case BlendFunction.ONE:
      return "one";
    case BlendFunction.SOURCE_ALPHA:
      return "src-alpha";
    case BlendFunction.ONE_MINUS_SOURCE_ALPHA:
      return "one-minus-src-alpha";
    case BlendFunction.DESTINATION_ALPHA:
      return "dst-alpha";
    case BlendFunction.ONE_MINUS_DESTINATION_ALPHA:
      return "one-minus-dst-alpha";
    case BlendFunction.SOURCE_COLOR:
      return "src";
    case BlendFunction.ONE_MINUS_SOURCE_COLOR:
      return "one-minus-src";
    case BlendFunction.DESTINATION_COLOR:
      return "dst";
    case BlendFunction.ONE_MINUS_DESTINATION_COLOR:
      return "one-minus-dst";
    default:
      return "one";
  }
}

/** @private */
function toGPUBlendOp(eq) {
  switch (eq) {
    case BlendEquation.SUBTRACT:
      return "subtract";
    case BlendEquation.REVERSE_SUBTRACT:
      return "reverse-subtract";
    default:
      return "add";
  }
}

/** @private */
function buildDepthStencilState(depthTest, depthMask, depthFormat) {
  const depthCompare =
    defined(depthTest) && depthTest.enabled
      ? toGPUCompareFunction(depthTest.func)
      : "always";

  const depthWriteEnabled = depthMask ?? true;

  return {
    format: depthFormat,
    depthWriteEnabled,
    depthCompare,
  };
}

/** @private */
function toGPUCompareFunction(func) {
  switch (func) {
    case DepthFunction.NEVER:
      return "never";
    case DepthFunction.LESS:
      return "less";
    case DepthFunction.EQUAL:
      return "equal";
    case DepthFunction.LESS_OR_EQUAL:
      return "less-equal";
    case DepthFunction.GREATER:
      return "greater";
    case DepthFunction.NOT_EQUAL:
      return "not-equal";
    case DepthFunction.GREATER_OR_EQUAL:
      return "greater-equal";
    case DepthFunction.ALWAYS:
      return "always";
    default:
      return "less";
  }
}

/** @private */
function buildCullMode(cull) {
  if (!defined(cull) || !cull.enabled) {
    return "none";
  }
  return cull.face === CullFace.FRONT ? "front" : "back";
}

Object.defineProperties(WebGPURenderPipeline.prototype, {
  /**
   * The underlying {@link GPURenderPipeline}.
   * @memberof WebGPURenderPipeline.prototype
   * @type {GPURenderPipeline}
   */
  pipeline: {
    get: function () {
      return this._pipeline;
    },
  },
});

/**
 * Binds this pipeline to the given render-pass encoder.
 *
 * @param {GPURenderPassEncoder} passEncoder
 */
WebGPURenderPipeline.prototype.bind = function (passEncoder) {
  passEncoder.setPipeline(this._pipeline);
};

/**
 * @returns {boolean}
 */
WebGPURenderPipeline.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the wrapper (GPURenderPipeline objects are GC'd by the browser).
 */
WebGPURenderPipeline.prototype.destroy = function () {
  return destroyObject(this);
};

export { toGPUPrimitiveTopology };
export default WebGPURenderPipeline;
