import Check from "../../Core/Check.js";
import destroyObject from "../../Core/destroyObject.js";

let nextProgramId = 0;

/**
 * A compiled WebGPU shader program composed of a vertex {@link GPUShaderModule}
 * and a fragment {@link GPUShaderModule}, along with their WGSL source and
 * the entry-point names.
 *
 * Programs are normally retrieved from the {@link WebGPUShaderCache}; only
 * create directly when working outside the cache.
 *
 * @alias WebGPUShaderProgram
 * @constructor
 * @private
 *
 * @param {object} options
 * @param {WebGPUContext} options.context
 * @param {string} options.vertexShaderWGSL     WGSL source for the vertex stage.
 * @param {string} options.fragmentShaderWGSL   WGSL source for the fragment stage.
 * @param {string} [options.vertexEntryPoint="vertexMain"]   Vertex entry-point name.
 * @param {string} [options.fragmentEntryPoint="fragmentMain"] Fragment entry-point name.
 * @param {string} [options.label]              Optional debug label.
 */
function WebGPUShaderProgram(options) {
  options = options ?? {};

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.context", options.context);
  Check.typeOf.string("options.vertexShaderWGSL", options.vertexShaderWGSL);
  Check.typeOf.string("options.fragmentShaderWGSL", options.fragmentShaderWGSL);
  //>>includeEnd('debug');

  const context = options.context;
  const label = options.label ?? `ShaderProgram_${nextProgramId}`;
  const vertexEntryPoint = options.vertexEntryPoint ?? "vertexMain";
  const fragmentEntryPoint = options.fragmentEntryPoint ?? "fragmentMain";

  const vertexModule = context.device.createShaderModule({
    label: `${label}_VS`,
    code: options.vertexShaderWGSL,
  });

  const fragmentModule = context.device.createShaderModule({
    label: `${label}_FS`,
    code: options.fragmentShaderWGSL,
  });

  this._context = context;
  this._vertexShaderWGSL = options.vertexShaderWGSL;
  this._fragmentShaderWGSL = options.fragmentShaderWGSL;
  this._vertexModule = vertexModule;
  this._fragmentModule = fragmentModule;
  this._vertexEntryPoint = vertexEntryPoint;
  this._fragmentEntryPoint = fragmentEntryPoint;
  this._label = label;

  /**
   * Unique numeric identifier for this program.
   * @type {number}
   */
  this.id = nextProgramId++;

  /**
   * Used by the shader cache to track release status.
   * @private
   */
  this._cachedShader = undefined;
}

Object.defineProperties(WebGPUShaderProgram.prototype, {
  /**
   * The compiled vertex {@link GPUShaderModule}.
   * @memberof WebGPUShaderProgram.prototype
   * @type {GPUShaderModule}
   */
  vertexModule: {
    get: function () {
      return this._vertexModule;
    },
  },

  /**
   * The compiled fragment {@link GPUShaderModule}.
   * @memberof WebGPUShaderProgram.prototype
   * @type {GPUShaderModule}
   */
  fragmentModule: {
    get: function () {
      return this._fragmentModule;
    },
  },

  /**
   * The entry-point function name in the vertex shader.
   * @memberof WebGPUShaderProgram.prototype
   * @type {string}
   */
  vertexEntryPoint: {
    get: function () {
      return this._vertexEntryPoint;
    },
  },

  /**
   * The entry-point function name in the fragment shader.
   * @memberof WebGPUShaderProgram.prototype
   * @type {string}
   */
  fragmentEntryPoint: {
    get: function () {
      return this._fragmentEntryPoint;
    },
  },

  /**
   * The WGSL vertex shader source.
   * @memberof WebGPUShaderProgram.prototype
   * @type {string}
   */
  vertexShaderWGSL: {
    get: function () {
      return this._vertexShaderWGSL;
    },
  },

  /**
   * The WGSL fragment shader source.
   * @memberof WebGPUShaderProgram.prototype
   * @type {string}
   */
  fragmentShaderWGSL: {
    get: function () {
      return this._fragmentShaderWGSL;
    },
  },
});

/**
 * Creates a {@link GPUVertexState} descriptor for use in a render-pipeline
 * descriptor, using this program's vertex module and entry point.
 *
 * @param {GPUVertexBufferLayout[]} [buffers=[]] Vertex buffer layout descriptors.
 * @returns {GPUVertexState}
 */
WebGPUShaderProgram.prototype.getVertexState = function (buffers) {
  return {
    module: this._vertexModule,
    entryPoint: this._vertexEntryPoint,
    buffers: buffers ?? [],
  };
};

/**
 * Creates a {@link GPUFragmentState} descriptor for use in a render-pipeline
 * descriptor, using this program's fragment module and entry point.
 *
 * @param {GPUColorTargetState[]} targets Colour-attachment target descriptors.
 * @returns {GPUFragmentState}
 */
WebGPUShaderProgram.prototype.getFragmentState = function (targets) {
  return {
    module: this._fragmentModule,
    entryPoint: this._fragmentEntryPoint,
    targets: targets,
  };
};

/**
 * @returns {boolean}
 */
WebGPUShaderProgram.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the shader modules held by this program.
 * GPU shader modules do not have an explicit `destroy()` in the WebGPU
 * specification, but we mark the JS object as destroyed for book-keeping.
 */
WebGPUShaderProgram.prototype.destroy = function () {
  return destroyObject(this);
};

export default WebGPUShaderProgram;
