import defined from "../../Core/defined.js";
import destroyObject from "../../Core/destroyObject.js";

// ── Inline WGSL shaders ───────────────────────────────────────────────────────
// These are duplicated from GlobePassVS.wgsl / GlobePassFS.wgsl and
// CloudPassVS.wgsl / CloudPassFS.wgsl.
// Inlining avoids a build-time dependency on a WGSL asset loader while the
// engine's shader-import pipeline is being developed for Phase 3.

// Cloud sphere altitude above the Earth surface, normalised to Earth radius = 1.
// 0.004 ≈ 25 km — visually distinct from the surface at typical zoom levels.
const CLOUD_HEIGHT = 0.004;

const GLOBE_PASS_VS = /* wgsl */ `
struct GlobeUniforms {
  mvp        : mat4x4<f32>,
  mv         : mat4x4<f32>,
  lightDirEC : vec3<f32>,
  time       : f32,
}
@group(0) @binding(0) var<uniform> u : GlobeUniforms;

struct VertIn {
  @location(0) pos  : vec3<f32>,
  @location(1) norm : vec3<f32>,
  @location(2) uv   : vec2<f32>,
}
struct VertOut {
  @builtin(position) clip   : vec4<f32>,
  @location(0)       posEC  : vec3<f32>,
  @location(1)       normEC : vec3<f32>,
  @location(2)       uv     : vec2<f32>,
}

@vertex
fn main(v : VertIn) -> VertOut {
  var out : VertOut;
  out.clip   = u.mvp * vec4<f32>(v.pos, 1.0);
  out.posEC  = (u.mv  * vec4<f32>(v.pos,  1.0)).xyz;
  out.normEC = normalize((u.mv * vec4<f32>(v.norm, 0.0)).xyz);
  out.uv     = v.uv;
  return out;
}
`;

// Earth sphere fragment shader — no cloud blending.
// Clouds are rendered separately on a higher-altitude cloud sphere.
const GLOBE_PASS_FS = /* wgsl */ `
struct GlobeUniforms {
  mvp        : mat4x4<f32>,
  mv         : mat4x4<f32>,
  lightDirEC : vec3<f32>,
  time       : f32,
}
@group(0) @binding(0) var<uniform> u : GlobeUniforms;
@group(1) @binding(0) var earthTex     : texture_2d<f32>;
@group(1) @binding(1) var earthSampler : sampler;

struct FragIn {
  @builtin(position) clip   : vec4<f32>,
  @location(0)       posEC  : vec3<f32>,
  @location(1)       normEC : vec3<f32>,
  @location(2)       uv     : vec2<f32>,
}

fn ss(e0 : f32, e1 : f32, x : f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

@fragment
fn main(f : FragIn) -> @location(0) vec4<f32> {
  // Normalize vertex UV u from the [0.5, 1.5] range back into [0, 1) before
  // passing to textureSample.  The vertex u was shifted +0.5 so that phi=0
  // (prime meridian, ECEF +X) maps to u=0.5 in a standard equirectangular
  // texture.  fract() collapses the range without a geometry seam; the
  // sampler's addressModeU:"repeat" then handles any sub-texel wrap.
  let uv = vec2<f32>(fract(f.uv.x), f.uv.y);
  let texColor = textureSample(earthTex, earthSampler, uv);
  var col = texColor.rgb;

  // Diffuse
  let N = normalize(f.normEC); let L = normalize(u.lightDirEC); let V = normalize(-f.posEC);
  let ndl = clamp(dot(N, L), 0.0, 1.0);
  col *= (0.15 + ndl * 0.85);

  // Ocean specular
  let isWater = ss(0.0, 0.09, texColor.b - texColor.r - 0.05);
  col += vec3<f32>(1.0, 0.97, 0.90)
       * pow(clamp(dot(N, normalize(L + V)), 0.0, 1.0), 65.0) * isWater * 0.22;

  // Atmosphere glow – simulates the blue limb brightening seen in WebGL's
  // SkyAtmosphere (now hidden).  The exponent 2.5 gives a broad halo that
  // starts well before the geometric horizon; 0.85 intensity and the blue-
  // shifted RGB (0.10, 0.38, 0.92) approximate the Rayleigh-scattered hue
  // visible from low Earth orbit.  Adjust intensity if the halo looks too
  // bright or too dim relative to the globe surface.
  let rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
  col += vec3<f32>(0.10, 0.38, 0.92) * rim * 0.85;

  // Night ambient – a very faint blue-black glow on the unlit hemisphere.
  col += vec3<f32>(0.003, 0.005, 0.018) * (1.0 - clamp(ndl * 2.2 + 0.35, 0.0, 1.0));

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

// ── Cloud sphere shaders ──────────────────────────────────────────────────────
// The cloud sphere is rendered at radius (1 + CLOUD_HEIGHT) above the Earth
// surface, using 3-D world-space FBM noise so there is NO UV-wrap seam.
// Animation is achieved by rotating the noise input around the Z-axis over
// time rather than scrolling a 2-D UV — this is inherently seamless.

const CLOUD_PASS_VS = /* wgsl */ `
struct CloudUniforms {
  mvp        : mat4x4<f32>,
  mv         : mat4x4<f32>,
  lightDirEC : vec3<f32>,
  time       : f32,
}
@group(0) @binding(0) var<uniform> u : CloudUniforms;

// Only position is needed; the unit-sphere direction is derived in the shader.
struct VertIn {
  @location(0) pos : vec3<f32>,   // position on cloud sphere (radius = 1 + h)
}
struct VertOut {
  @builtin(position) clip     : vec4<f32>,
  @location(0)       normEC   : vec3<f32>,   // eye-space normal (outward)
  @location(1)       posEC    : vec3<f32>,   // eye-space position
  @location(2)       posWorld : vec3<f32>,   // unit-sphere direction (world space)
}

@vertex
fn main(v : VertIn) -> VertOut {
  var out : VertOut;
  out.clip     = u.mvp * vec4<f32>(v.pos, 1.0);
  let dir      = normalize(v.pos);                          // unit outward direction
  out.normEC   = normalize((u.mv * vec4<f32>(dir, 0.0)).xyz);
  out.posEC    = (u.mv * vec4<f32>(v.pos, 1.0)).xyz;
  out.posWorld = dir;   // passed to FS for seamless 3-D noise
  return out;
}
`;

const CLOUD_PASS_FS = /* wgsl */ `
struct CloudUniforms {
  mvp        : mat4x4<f32>,
  mv         : mat4x4<f32>,
  lightDirEC : vec3<f32>,
  time       : f32,
}
@group(0) @binding(0) var<uniform> u : CloudUniforms;

struct FragIn {
  @builtin(position) clip     : vec4<f32>,
  @location(0)       normEC   : vec3<f32>,
  @location(1)       posEC    : vec3<f32>,
  @location(2)       posWorld : vec3<f32>,
}

// ── 3-D value noise (seamless: no UV wrap needed) ─────────────────────────────
fn hash3(p : vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(127.1, 311.7, 74.7));
  q += dot(q, q + vec3<f32>(19.19, 17.37, 23.41));
  return fract(q.x * q.y + q.y * q.z);
}
fn noise3(p : vec3<f32>) -> f32 {
  let i = floor(p); let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i),                      hash3(i + vec3<f32>(1.,0.,0.)), s.x),
        mix(hash3(i + vec3<f32>(0.,1.,0.)), hash3(i + vec3<f32>(1.,1.,0.)), s.x), s.y),
    mix(mix(hash3(i + vec3<f32>(0.,0.,1.)), hash3(i + vec3<f32>(1.,0.,1.)), s.x),
        mix(hash3(i + vec3<f32>(0.,1.,1.)), hash3(i + vec3<f32>(1.,1.,1.)), s.x), s.y),
    s.z);
}
fn fbm3(p_in : vec3<f32>) -> f32 {
  var p = p_in; var v = 0.0; var a = 0.5;
  for (var i = 0; i < 5; i++) { v += a * noise3(p); p *= 2.0; a *= 0.5; }
  return v;
}
fn ss(e0 : f32, e1 : f32, x : f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

@fragment
fn main(f : FragIn) -> @location(0) vec4<f32> {
  // Rotate the world-space unit-sphere direction around the Earth's Z-axis
  // to animate cloud drift.  This is inherently seamless — no UV wrap required.
  let t  = u.time * 0.003;
  let ct = cos(t); let st = sin(t);
  let rotDir = vec3<f32>(
    f.posWorld.x * ct - f.posWorld.y * st,
    f.posWorld.x * st + f.posWorld.y * ct,
    f.posWorld.z
  );

  // 3-D FBM cloud density — completely seamless, no meridian artifact.
  let density = ss(0.55, 0.65, fbm3(rotDir * 5.0));

  // Discard transparent fragments so the depth buffer is not dirtied.
  if (density < 0.02) { discard; }

  // Diffuse lighting for the cloud layer.
  let N   = normalize(f.normEC);
  let L   = normalize(u.lightDirEC);
  let V   = normalize(-f.posEC);
  let ndl = clamp(dot(N, L), 0.0, 1.0);
  let lit = 0.35 + ndl * 0.65;

  // Clouds are bright white; night-side clouds appear faintly dark.
  let cloudRGB = vec3<f32>(0.96, 0.97, 1.0) * lit;

  return vec4<f32>(cloudRGB, density * 0.90);
}
`;

// ── Uniform buffer layout (bytes) ────────────────────────────────────────────
// Offset   0: mat4x4<f32> mvp        (64 bytes)
// Offset  64: mat4x4<f32> mv         (64 bytes)
// Offset 128: vec3<f32>   lightDirEC (12 bytes)
// Offset 140: f32         time       (4 bytes)
// Total: 144 bytes → padded to UNIFORM_BUFFER_ALIGN = 256

const UNIFORM_BUFFER_SIZE = 256; // bytes, padded to device alignment

/**
 * Manages WebGPU GPU resources for rendering the Earth globe.
 *
 * Phase 2 implementation: takes an {@link ImageBitmap} (the geographic
 * equirectangular Earth texture), creates the sphere geometry, WGSL pipeline,
 * and bind groups.  Call {@link WebGPUGlobePass#render} once per frame with
 * the current camera transforms.
 *
 * @alias WebGPUGlobePass
 * @constructor
 * @private
 *
 * @param {WebGPUContext} context
 */
function WebGPUGlobePass(context) {
  this._context = context;
  // Earth sphere
  this._vertexBuffer = undefined;
  this._indexBuffer = undefined;
  this._indexCount = 0;
  this._uniformBuffer = undefined;
  // Pre-allocated uniform staging buffer (avoids per-frame allocation)
  this._uniformStagingBuf = new Float32Array(UNIFORM_BUFFER_SIZE / 4);
  this._texture = undefined;
  this._sampler = undefined;
  this._uniformBindGroup = undefined;
  this._textureBindGroup = undefined;
  this._pipeline = undefined;
  // Cloud sphere (rendered above the Earth at CLOUD_HEIGHT altitude)
  this._cloudVertexBuffer = undefined;
  this._cloudIndexBuffer = undefined;
  this._cloudIndexCount = 0;
  this._cloudPipeline = undefined;
  this._cloudUniformBindGroup = undefined;
  this._ready = false;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Asynchronously initialises the globe pass.
 *
 * @param {WebGPUContext} context
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} imageSource
 *   Equirectangular Earth imagery.
 * @returns {Promise<WebGPUGlobePass>}
 */
WebGPUGlobePass.create = async function (context, imageSource) {
  const pass = new WebGPUGlobePass(context);
  await pass._initialize(imageSource);
  return pass;
};

// ── Private initialisation ────────────────────────────────────────────────────

/**
 * @private
 */
WebGPUGlobePass.prototype._initialize = async function (imageSource) {
  const device = this._context.device;
  const canvasFormat = this._context.canvasFormat;

  // 1. Build UV-sphere geometry (Earth surface) ---------------------------------
  this._buildSphere(device, 80, 160);

  // 2. Build cloud sphere geometry (slightly larger radius) ---------------------
  this._buildCloudSphere(device, 80, 160);

  // 3. Uniform buffer -----------------------------------------------------------
  this._uniformBuffer = device.createBuffer({
    label: "GlobePassUniforms",
    size: UNIFORM_BUFFER_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // 4. Sampler ------------------------------------------------------------------
  this._sampler = device.createSampler({
    label: "GlobePassSampler",
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "clamp-to-edge",
    maxAnisotropy: 4,
  });

  // 5. Upload imagery texture ---------------------------------------------------
  await this._uploadTexture(device, imageSource);

  // 6. Create render pipelines --------------------------------------------------
  this._pipeline = await this._createPipeline(device, canvasFormat);
  this._cloudPipeline = await this._createCloudPipeline(device, canvasFormat);

  // 7. Create bind groups -------------------------------------------------------
  this._createBindGroups(device);

  this._ready = true;
};

/**
 * Builds an interleaved (position|normal|uv) UV sphere on the GPU.
 * @private
 */
WebGPUGlobePass.prototype._buildSphere = function (
  device,
  latSegments,
  lonSegments,
) {
  const numVerts = (latSegments + 1) * (lonSegments + 1);
  // Each vertex: pos(3) + norm(3) + uv(2) = 8 floats
  const vd = new Float32Array(numVerts * 8);
  let vi = 0;

  for (let i = 0; i <= latSegments; i++) {
    const theta = (i / latSegments) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j <= lonSegments; j++) {
      const phi = (j / lonSegments) * 2 * Math.PI;
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);
      // ECEF-compatible orientation so the sphere aligns with Cesium's world-space axes:
      //   phi=0 → x=+1  (ECEF +X = prime meridian at equator)
      //   theta=0 → z=+1 (ECEF +Z = geographic north pole, because cos(0)=1)
      const x = sinT * cosP;
      const y = sinT * sinP;
      const z = cosT;
      // position == normal for a unit sphere
      vd[vi++] = x;
      vd[vi++] = y;
      vd[vi++] = z;
      vd[vi++] = x;
      vd[vi++] = y;
      vd[vi++] = z;
      // UV: shift u by +0.5 so the prime meridian (phi=0, ECEF +X) maps to u=0.5,
      // which is the centre of a standard equirectangular Earth texture (lon=0°).
      // The u range [0.5, 1.5] is handled correctly by the repeat sampler and
      // by fract() in the fragment shader.
      vd[vi++] = j / lonSegments + 0.5; // u
      vd[vi++] = i / latSegments; // v: 0=north pole, 1=south pole
    }
  }

  const id = new Uint32Array(latSegments * lonSegments * 6);
  let ii = 0;
  for (let i = 0; i < latSegments; i++) {
    for (let j = 0; j < lonSegments; j++) {
      const a = i * (lonSegments + 1) + j;
      const b = a + lonSegments + 1;
      id[ii++] = a;
      id[ii++] = b;
      id[ii++] = a + 1;
      id[ii++] = b;
      id[ii++] = b + 1;
      id[ii++] = a + 1;
    }
  }
  this._indexCount = id.length;

  this._vertexBuffer = device.createBuffer({
    label: "GlobePassVB",
    size: vd.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(this._vertexBuffer.getMappedRange()).set(vd);
  this._vertexBuffer.unmap();

  this._indexBuffer = device.createBuffer({
    label: "GlobePassIB",
    size: id.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(this._indexBuffer.getMappedRange()).set(id);
  this._indexBuffer.unmap();
};

/**
 * Builds a position-only sphere for the cloud layer at radius (1 + CLOUD_HEIGHT).
 * The cloud shader derives the normal from the position, so no separate normal
 * attribute is needed, and there is no UV (3-D noise is used instead).
 * @private
 */
WebGPUGlobePass.prototype._buildCloudSphere = function (
  device,
  latSegments,
  lonSegments,
) {
  const r = 1.0 + CLOUD_HEIGHT;
  const numVerts = (latSegments + 1) * (lonSegments + 1);
  // Each vertex: pos(3) = 3 floats
  const vd = new Float32Array(numVerts * 3);
  let vi = 0;

  for (let i = 0; i <= latSegments; i++) {
    const theta = (i / latSegments) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j <= lonSegments; j++) {
      const phi = (j / lonSegments) * 2 * Math.PI;
      vd[vi++] = sinT * Math.cos(phi) * r; // x
      vd[vi++] = sinT * Math.sin(phi) * r; // y
      vd[vi++] = cosT * r; // z
    }
  }

  // The index topology is identical to the Earth sphere.
  const id = new Uint32Array(latSegments * lonSegments * 6);
  let ii = 0;
  for (let i = 0; i < latSegments; i++) {
    for (let j = 0; j < lonSegments; j++) {
      const a = i * (lonSegments + 1) + j;
      const b = a + lonSegments + 1;
      id[ii++] = a;
      id[ii++] = b;
      id[ii++] = a + 1;
      id[ii++] = b;
      id[ii++] = b + 1;
      id[ii++] = a + 1;
    }
  }
  this._cloudIndexCount = id.length;

  this._cloudVertexBuffer = device.createBuffer({
    label: "CloudPassVB",
    size: vd.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(this._cloudVertexBuffer.getMappedRange()).set(vd);
  this._cloudVertexBuffer.unmap();

  // The cloud sphere shares the index buffer with the Earth sphere.
  // Build a dedicated one here so the two can be destroyed independently.
  this._cloudIndexBuffer = device.createBuffer({
    label: "CloudPassIB",
    size: id.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(this._cloudIndexBuffer.getMappedRange()).set(id);
  this._cloudIndexBuffer.unmap();
};


/**
 * Uploads an image source to a GPU texture.
 * @private
 */
WebGPUGlobePass.prototype._uploadTexture = async function (device, source) {
  // Convert to ImageBitmap if needed
  let bmp;
  if (
    source instanceof ImageBitmap ||
    source instanceof HTMLCanvasElement ||
    source instanceof OffscreenCanvas
  ) {
    bmp = source;
  } else if (typeof source === "string" || source instanceof URL) {
    const resp = await fetch(source);
    const blob = await resp.blob();
    bmp = await createImageBitmap(blob);
  } else if (
    source instanceof HTMLImageElement ||
    source instanceof HTMLVideoElement
  ) {
    bmp = await createImageBitmap(source);
  } else {
    bmp = source; // assume already usable
  }

  const width = bmp.width ?? bmp.naturalWidth ?? 512;
  const height = bmp.height ?? bmp.naturalHeight ?? 256;

  this._texture = device.createTexture({
    label: "GlobeEarthTex",
    size: [width, height, 1],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: bmp, flipY: false },
    { texture: this._texture },
    [width, height],
  );
};

/**
 * Creates the render pipeline.
 * @private
 */
WebGPUGlobePass.prototype._createPipeline = async function (
  device,
  canvasFormat,
) {
  const vsMod = device.createShaderModule({
    label: "GlobePassVS",
    code: GLOBE_PASS_VS,
  });
  const fsMod = device.createShaderModule({
    label: "GlobePassFS",
    code: GLOBE_PASS_FS,
  });

  // Vertex buffer layout: pos(3f) | norm(3f) | uv(2f)
  const vertexLayout = {
    arrayStride: 8 * 4, // 8 floats × 4 bytes
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" }, // pos
      { shaderLocation: 1, offset: 3 * 4, format: "float32x3" }, // norm
      { shaderLocation: 2, offset: 6 * 4, format: "float32x2" }, // uv
    ],
  };

  return device.createRenderPipeline({
    label: "GlobePassPipeline",
    layout: "auto",
    vertex: {
      module: vsMod,
      entryPoint: "main",
      buffers: [vertexLayout],
    },
    fragment: {
      module: fsMod,
      entryPoint: "main",
      targets: [
        {
          format: canvasFormat,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: { srcFactor: "one", dstFactor: "zero" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });
};

/**
 * Creates the cloud sphere render pipeline.
 * The cloud sphere uses alpha blending and disables depth writes so that
 * partially transparent clouds do not occlude the terrain behind them.
 * @private
 */
WebGPUGlobePass.prototype._createCloudPipeline = async function (
  device,
  canvasFormat,
) {
  const vsMod = device.createShaderModule({
    label: "CloudPassVS",
    code: CLOUD_PASS_VS,
  });
  const fsMod = device.createShaderModule({
    label: "CloudPassFS",
    code: CLOUD_PASS_FS,
  });

  // Cloud sphere vertex buffer layout: pos(3f) only
  const cloudVertexLayout = {
    arrayStride: 3 * 4, // 3 floats × 4 bytes
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" }, // pos
    ],
  };

  return device.createRenderPipeline({
    label: "CloudPassPipeline",
    layout: "auto",
    vertex: {
      module: vsMod,
      entryPoint: "main",
      buffers: [cloudVertexLayout],
    },
    fragment: {
      module: fsMod,
      entryPoint: "main",
      targets: [
        {
          format: canvasFormat,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: { srcFactor: "one", dstFactor: "zero" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: {
      format: "depth24plus",
      // Do not write depth for the transparent cloud layer so that it does not
      // incorrectly occlude terrain drawn later at the same or lower depth.
      depthWriteEnabled: false,
      depthCompare: "less",
    },
  });
};


/**
 * Creates bind groups referencing the pipeline's auto-generated layout.
 * Both the Earth sphere and the cloud sphere bind groups are created here
 * since they share the same underlying uniform buffer.
 * @private
 */
WebGPUGlobePass.prototype._createBindGroups = function (device) {
  this._uniformBindGroup = device.createBindGroup({
    label: "GlobePassUniformBG",
    layout: this._pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: this._uniformBuffer,
          offset: 0,
          size: UNIFORM_BUFFER_SIZE,
        },
      },
    ],
  });

  this._textureBindGroup = device.createBindGroup({
    label: "GlobePassTextureBG",
    layout: this._pipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: this._texture.createView() },
      { binding: 1, resource: this._sampler },
    ],
  });

  // The cloud pipeline has its own auto-generated bind group layout but
  // references the same uniform buffer (same mvp / mv / lightDirEC / time).
  this._cloudUniformBindGroup = device.createBindGroup({
    label: "CloudPassUniformBG",
    layout: this._cloudPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: this._uniformBuffer,
          offset: 0,
          size: UNIFORM_BUFFER_SIZE,
        },
      },
    ],
  });
};

// ── Per-frame rendering ───────────────────────────────────────────────────────

/**
 * Records a render pass for the globe into the provided command encoder.
 *
 * @param {GPUCommandEncoder} commandEncoder
 * @param {GPUTextureView} colorView  Swap-chain texture view.
 * @param {GPUTextureView} depthView  Depth texture view.
 * @param {object} uniforms
 * @param {Float32Array} [uniforms.uniformArray]  Pre-packed 36-float array in the
 *   layout `[mvp(0..15), mv(16..31), lightDirEC(32..34), time(35)]`.  Used by
 *   `Scene.renderWebGPUGlobeFrame` for zero-allocation per-frame uploads.
 *   When provided the individual properties below are ignored.
 * @param {Float32Array} [uniforms.mvp]        Column-major 4×4 MVP matrix (legacy path).
 * @param {Float32Array} [uniforms.mv]         Column-major 4×4 MV matrix (legacy path).
 * @param {number[]}     [uniforms.lightDirEC] [x,y,z] sun direction in eye space (legacy path).
 * @param {number}       [uniforms.time]       Seconds since page load (legacy path).
 * @param {object}       [uniforms.clearColor]  Optional RGBA clear color.
 */
WebGPUGlobePass.prototype.render = function (
  commandEncoder,
  colorView,
  depthView,
  uniforms,
) {
  if (!this._ready) {
    return;
  }

  const device = this._context.device;

  // ── Write uniform buffer (reuse pre-allocated staging buffer) ───────────────
  const buf = this._uniformStagingBuf;
  buf.fill(0);
  if (uniforms.uniformArray) {
    // Fast path from Scene.renderWebGPUGlobeFrame: uniformArray is a 36-float
    // pre-packed Float32Array { mvp[0..15], mv[16..31], lightDirEC[32..34], time[35] }.
    buf.set(uniforms.uniformArray, 0);
  } else {
    // Legacy path used by the standalone demo (WebGPUCesiumViewer.html).
    // mvp (offset 0, 16 floats)
    buf.set(uniforms.mvp, 0);
    // mv (offset 16, 16 floats)
    buf.set(uniforms.mv, 16);
    // lightDirEC (offset 32, 3 floats)
    buf[32] = uniforms.lightDirEC[0];
    buf[33] = uniforms.lightDirEC[1];
    buf[34] = uniforms.lightDirEC[2];
    // time (offset 35)
    buf[35] = uniforms.time ?? 0;
  }
  device.queue.writeBuffer(this._uniformBuffer, 0, buf);

  // ── Record render pass ──────────────────────────────────────────────────────
  // WebGPU is the sole visual renderer; use an opaque deep-space background.
  // The WebGL canvas is hidden (visibility:hidden) so there is no need for
  // transparency compositing.  The RGB values (0.003, 0.004, 0.018) produce a
  // deep midnight blue – intentionally close to the night-ambient colour in the
  // fragment shader so the space around the globe blends seamlessly with the
  // unlit hemisphere rather than appearing as a hard-edged cut.
  const cc = uniforms.clearColor ?? { r: 0.003, g: 0.004, b: 0.018, a: 1.0 };
  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        loadOp: "clear",
        clearValue: cc,
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthLoadOp: "clear",
      depthClearValue: 1.0,
      depthStoreOp: "store",
    },
  });

  pass.setPipeline(this._pipeline);
  pass.setVertexBuffer(0, this._vertexBuffer);
  pass.setIndexBuffer(this._indexBuffer, "uint32");
  pass.setBindGroup(0, this._uniformBindGroup);
  pass.setBindGroup(1, this._textureBindGroup);
  pass.drawIndexed(this._indexCount);

  // ── Cloud sphere (rendered above the Earth surface, alpha-blended) ──────────
  pass.setPipeline(this._cloudPipeline);
  pass.setVertexBuffer(0, this._cloudVertexBuffer);
  pass.setIndexBuffer(this._cloudIndexBuffer, "uint32");
  pass.setBindGroup(0, this._cloudUniformBindGroup);
  pass.drawIndexed(this._cloudIndexCount);

  pass.end();
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * @returns {boolean}
 */
WebGPUGlobePass.prototype.isDestroyed = function () {
  return false;
};

/**
 * Releases all GPU resources held by this pass.
 */
WebGPUGlobePass.prototype.destroy = function () {
  if (defined(this._vertexBuffer)) {
    this._vertexBuffer.destroy();
  }
  if (defined(this._indexBuffer)) {
    this._indexBuffer.destroy();
  }
  if (defined(this._uniformBuffer)) {
    this._uniformBuffer.destroy();
  }
  if (defined(this._texture)) {
    this._texture.destroy();
  }
  if (defined(this._cloudVertexBuffer)) {
    this._cloudVertexBuffer.destroy();
  }
  if (defined(this._cloudIndexBuffer)) {
    this._cloudIndexBuffer.destroy();
  }
  return destroyObject(this);
};

export default WebGPUGlobePass;
