/**
 * WebGPU renderer module – re-exports all public WebGPU infrastructure classes.
 *
 * The Cesium build system requires every source file to have a default export
 * (it generates `export { default as WebGPUModules }` in the engine barrel).
 * The default export here is a namespace object that mirrors the named exports
 * so callers can use either import style:
 *
 * ```js
 * // Named import (preferred)
 * import { WebGPUContext, WebGPURenderer } from "./WebGPU/WebGPUModules.js";
 *
 * // Namespace import (also supported)
 * import WebGPUModules from "./WebGPU/WebGPUModules.js";
 * const ctx = new WebGPUModules.WebGPUContext(…);
 * ```
 */

import _WebGPUContext, { isWebGPUSupported } from "./WebGPUContext.js";
import _WebGPUShaderCache from "./WebGPUShaderCache.js";
import _WebGPUTextureCache from "./WebGPUTextureCache.js";
import _WebGPUShaderProgram from "./WebGPUShaderProgram.js";
import _WebGPUBuffer, { WebGPUBufferUsage } from "./WebGPUBuffer.js";
import _WebGPUVertexArray, { getGPUVertexFormat } from "./WebGPUVertexArray.js";
import _WebGPUTexture, { getGPUTextureFormat } from "./WebGPUTexture.js";
import _WebGPUSampler from "./WebGPUSampler.js";
import _WebGPUBindGroup from "./WebGPUBindGroup.js";
import _WebGPURenderPipeline, {
  toGPUPrimitiveTopology,
} from "./WebGPURenderPipeline.js";
import _WebGPUCommandEncoder from "./WebGPUCommandEncoder.js";
import _WebGPUDrawCommand from "./WebGPUDrawCommand.js";
import _WebGPURenderer from "./WebGPURenderer.js";
import _WebGPUGlobePass from "./WebGPUGlobePass.js";
import _WebGPUCamera from "./WebGPUCamera.js";

// Named exports (preferred for tree-shaking)
export {
  _WebGPUContext as WebGPUContext,
  isWebGPUSupported,
  _WebGPUShaderCache as WebGPUShaderCache,
  _WebGPUTextureCache as WebGPUTextureCache,
  _WebGPUShaderProgram as WebGPUShaderProgram,
  _WebGPUBuffer as WebGPUBuffer,
  WebGPUBufferUsage,
  _WebGPUVertexArray as WebGPUVertexArray,
  getGPUVertexFormat,
  _WebGPUTexture as WebGPUTexture,
  getGPUTextureFormat,
  _WebGPUSampler as WebGPUSampler,
  _WebGPUBindGroup as WebGPUBindGroup,
  _WebGPURenderPipeline as WebGPURenderPipeline,
  toGPUPrimitiveTopology,
  _WebGPUCommandEncoder as WebGPUCommandEncoder,
  _WebGPUDrawCommand as WebGPUDrawCommand,
  _WebGPURenderer as WebGPURenderer,
  _WebGPUGlobePass as WebGPUGlobePass,
  _WebGPUCamera as WebGPUCamera,
};

/**
 * Namespace object exposing all WebGPU renderer classes.
 * This default export satisfies the Cesium engine build system which generates
 * `export { default as WebGPUModules }` in the auto-built `packages/engine/index.js`.
 */
const WebGPUModules = {
  WebGPUContext: _WebGPUContext,
  isWebGPUSupported,
  WebGPUShaderCache: _WebGPUShaderCache,
  WebGPUTextureCache: _WebGPUTextureCache,
  WebGPUShaderProgram: _WebGPUShaderProgram,
  WebGPUBuffer: _WebGPUBuffer,
  WebGPUBufferUsage,
  WebGPUVertexArray: _WebGPUVertexArray,
  getGPUVertexFormat,
  WebGPUTexture: _WebGPUTexture,
  getGPUTextureFormat,
  WebGPUSampler: _WebGPUSampler,
  WebGPUBindGroup: _WebGPUBindGroup,
  WebGPURenderPipeline: _WebGPURenderPipeline,
  toGPUPrimitiveTopology,
  WebGPUCommandEncoder: _WebGPUCommandEncoder,
  WebGPUDrawCommand: _WebGPUDrawCommand,
  WebGPURenderer: _WebGPURenderer,
  WebGPUGlobePass: _WebGPUGlobePass,
  WebGPUCamera: _WebGPUCamera,
};

export default WebGPUModules;
