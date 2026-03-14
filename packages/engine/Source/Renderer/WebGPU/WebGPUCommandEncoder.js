import Check from "../../Core/Check.js";
import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";

/**
 * A thin wrapper around a {@link GPURenderPassEncoder} that provides
 * convenience methods for Cesium draw commands.
 *
 * Obtain an instance through {@link WebGPUCommandEncoder#beginRenderPass}.
 *
 * @alias WebGPURenderPassEncoder
 * @constructor
 * @private
 *
 * @param {GPURenderPassEncoder} passEncoder
 */
function WebGPURenderPassEncoder(passEncoder) {
  this._passEncoder = passEncoder;
}

Object.defineProperties(WebGPURenderPassEncoder.prototype, {
  /**
   * The underlying {@link GPURenderPassEncoder}.
   * @memberof WebGPURenderPassEncoder.prototype
   * @type {GPURenderPassEncoder}
   */
  passEncoder: {
    get: function () {
      return this._passEncoder;
    },
  },
});

/**
 * Executes a Cesium {@link WebGPUDrawCommand} against this pass.
 *
 * @param {WebGPUDrawCommand} drawCommand
 */
WebGPURenderPassEncoder.prototype.executeDrawCommand = function (drawCommand) {
  drawCommand.execute(this._passEncoder);
};

/**
 * Ends the render pass.
 */
WebGPURenderPassEncoder.prototype.end = function () {
  this._passEncoder.end();
};

// ─── WebGPUCommandEncoder ─────────────────────────────────────────────────────

/**
 * A wrapper around a {@link GPUCommandEncoder} that mirrors the Cesium
 * rendering loop's expected API surface.
 *
 * One `WebGPUCommandEncoder` per frame is the typical usage pattern.
 *
 * @alias WebGPUCommandEncoder
 * @constructor
 * @private
 *
 * @param {WebGPUContext} context
 */
function WebGPUCommandEncoder(context) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("context", context);
  //>>includeEnd('debug');

  this._context = context;
  this._commandEncoder = context.device.createCommandEncoder({
    label: "FrameCommandEncoder",
  });
}

Object.defineProperties(WebGPUCommandEncoder.prototype, {
  /**
   * The underlying {@link GPUCommandEncoder}.
   * @memberof WebGPUCommandEncoder.prototype
   * @type {GPUCommandEncoder}
   */
  commandEncoder: {
    get: function () {
      return this._commandEncoder;
    },
  },
});

/**
 * Begins a render pass targeting the swap-chain texture view (canvas).
 *
 * @param {object} [options]
 * @param {GPUColor}   [options.clearColor={r:0,g:0,b:0,a:1}] Clear color.
 * @param {boolean}    [options.loadOp="clear"]   Colour load op (`"clear"` or `"load"`).
 * @param {GPUTextureView} [options.colorView]    Override the color attachment view.
 * @param {GPUTextureView} [options.depthView]    Depth-stencil attachment view.
 * @param {number}     [options.clearDepth=1.0]   Depth clear value.
 * @returns {WebGPURenderPassEncoder}
 */
WebGPUCommandEncoder.prototype.beginRenderPass = function (options) {
  options = options ?? {};

  const colorView = options.colorView ?? this._context.getCurrentTextureView();

  const clearColor = options.clearColor ?? { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
  const loadOp = options.loadOp ?? "clear";

  const colorAttachments = [
    {
      view: colorView,
      clearValue: clearColor,
      loadOp,
      storeOp: "store",
    },
  ];

  const descriptor = { colorAttachments };

  if (defined(options.depthView)) {
    descriptor.depthStencilAttachment = {
      view: options.depthView,
      depthClearValue: options.clearDepth ?? 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    };
  }

  const passEncoder = this._commandEncoder.beginRenderPass(descriptor);
  return new WebGPURenderPassEncoder(passEncoder);
};

/**
 * Begins a compute pass.
 *
 * @param {object} [options]
 * @param {string} [options.label]
 * @returns {GPUComputePassEncoder}
 */
WebGPUCommandEncoder.prototype.beginComputePass = function (options) {
  return this._commandEncoder.beginComputePass(options);
};

/**
 * Copies data from one GPU buffer to another.
 *
 * @param {GPUBuffer} source
 * @param {number}    sourceOffset
 * @param {GPUBuffer} destination
 * @param {number}    destinationOffset
 * @param {number}    size
 */
WebGPUCommandEncoder.prototype.copyBufferToBuffer = function (
  source,
  sourceOffset,
  destination,
  destinationOffset,
  size,
) {
  this._commandEncoder.copyBufferToBuffer(
    source,
    sourceOffset,
    destination,
    destinationOffset,
    size,
  );
};

/**
 * Copies data from a GPU buffer to a GPU texture.
 *
 * @param {GPUImageCopyBuffer}  source
 * @param {GPUImageCopyTexture} destination
 * @param {GPUExtent3D}         copySize
 */
WebGPUCommandEncoder.prototype.copyBufferToTexture = function (
  source,
  destination,
  copySize,
) {
  this._commandEncoder.copyBufferToTexture(source, destination, copySize);
};

/**
 * Copies data from a GPU texture to a GPU buffer.
 *
 * @param {GPUImageCopyTexture} source
 * @param {GPUImageCopyBuffer}  destination
 * @param {GPUExtent3D}         copySize
 */
WebGPUCommandEncoder.prototype.copyTextureToBuffer = function (
  source,
  destination,
  copySize,
) {
  this._commandEncoder.copyTextureToBuffer(source, destination, copySize);
};

/**
 * Finishes encoding and submits all recorded commands to the GPU queue.
 *
 * @returns {GPUCommandBuffer} The submitted command buffer.
 */
WebGPUCommandEncoder.prototype.finish = function () {
  const commandBuffer = this._commandEncoder.finish();
  this._context.queue.submit([commandBuffer]);
  return commandBuffer;
};

/**
 * @returns {boolean}
 */
WebGPUCommandEncoder.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the wrapper.
 */
WebGPUCommandEncoder.prototype.destroy = function () {
  return destroyObject(this);
};

export default WebGPUCommandEncoder;
