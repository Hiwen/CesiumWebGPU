// Globe rendering vertex shader — Phase 2
//
// Used by WebGPUGlobePass for the standalone globe renderer.  Accepts a simple
// interleaved vertex buffer (position, normal, UV) and a uniform block with
// the MVP / MV matrices and a light direction pre-transformed to eye space.
//
// Bind-group layout:
//   @group(0) @binding(0)  GlobeUniforms  (uniform buffer, shared with FS)
//   @group(1) @binding(0)  earthTex       (texture_2d<f32>)
//   @group(1) @binding(1)  earthSampler   (sampler)

struct GlobeUniforms {
  mvp        : mat4x4<f32>,   // model–view–projection
  mv         : mat4x4<f32>,   // model–view (lighting in eye space)
  lightDirEC : vec3<f32>,     // sun direction in eye space (unit vector)
  time       : f32,           // seconds since page load (for cloud animation)
}

@group(0) @binding(0) var<uniform> u : GlobeUniforms;

struct VertIn {
  @location(0) pos  : vec3<f32>,   // unit-sphere position = normal
  @location(1) norm : vec3<f32>,   // same as pos for a unit sphere
  @location(2) uv   : vec2<f32>,   // equirectangular UVs [0,1]²
}

struct VertOut {
  @builtin(position) clip   : vec4<f32>,
  @location(0)       posEC  : vec3<f32>,   // eye-space position
  @location(1)       normEC : vec3<f32>,   // eye-space normal
  @location(2)       uv     : vec2<f32>,
}

@vertex
fn main(v : VertIn) -> VertOut {
  var out : VertOut;
  out.clip   = u.mvp * vec4<f32>(v.pos, 1.0);
  out.posEC  = (u.mv * vec4<f32>(v.pos, 1.0)).xyz;
  out.normEC = normalize((u.mv * vec4<f32>(v.norm, 0.0)).xyz);
  out.uv     = v.uv;
  return out;
}
