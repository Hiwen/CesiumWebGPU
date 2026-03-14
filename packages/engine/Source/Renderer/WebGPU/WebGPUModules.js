/**
 * WebGPU renderer module – re-exports all public WebGPU infrastructure classes.
 *
 * Import individual classes from this barrel file when working with the WebGPU
 * rendering backend:
 *
 * ```js
 * import { WebGPUContext, WebGPUShaderProgram } from "./WebGPU/WebGPUModules.js";
 * ```
 */

export { default as WebGPUContext, isWebGPUSupported } from "./WebGPUContext.js";
export { default as WebGPUShaderCache } from "./WebGPUShaderCache.js";
export { default as WebGPUTextureCache } from "./WebGPUTextureCache.js";
export { default as WebGPUShaderProgram } from "./WebGPUShaderProgram.js";
export { default as WebGPUBuffer, WebGPUBufferUsage } from "./WebGPUBuffer.js";
export { default as WebGPUVertexArray, getGPUVertexFormat } from "./WebGPUVertexArray.js";
export { default as WebGPUTexture, getGPUTextureFormat } from "./WebGPUTexture.js";
export { default as WebGPUSampler } from "./WebGPUSampler.js";
export { default as WebGPUBindGroup } from "./WebGPUBindGroup.js";
export { default as WebGPURenderPipeline, toGPUPrimitiveTopology } from "./WebGPURenderPipeline.js";
export { default as WebGPUCommandEncoder } from "./WebGPUCommandEncoder.js";
export { default as WebGPUDrawCommand } from "./WebGPUDrawCommand.js";
export { default as WebGPURenderer } from "./WebGPURenderer.js";
