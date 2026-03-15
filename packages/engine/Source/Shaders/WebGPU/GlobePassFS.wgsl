// Globe rendering fragment shader — Phase 2
//
// Samples real imagery from an equirectangular texture, applies Blinn-Phong
// diffuse + specular, and a Fresnel atmospheric rim.
//
// Cloud rendering has been moved to a separate cloud sphere pass (CloudPassFS.wgsl)
// to give clouds a realistic altitude above the Earth's surface and to avoid
// the UV-wrap seam that affected the previous 2-D noise approach.

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

// ── Entry point ───────────────────────────────────────────────────────────────

@fragment
fn main(f : FragIn) -> @location(0) vec4<f32> {
  // Normalize vertex UV u from the [0.5, 1.5] range back into [0, 1) before
  // passing to textureSample.  The vertex u was shifted +0.5 so that phi=0
  // (prime meridian, ECEF +X) maps to u=0.5 in a standard equirectangular
  // texture.  fract() collapses the range; the sampler's repeat mode handles
  // any sub-texel wrap.
  let uv = vec2<f32>(fract(f.uv.x), f.uv.y);
  let texColor = textureSample(earthTex, earthSampler, uv);
  var col = texColor.rgb;

  // ── Diffuse lighting ─────────────────────────────────────────────────────────
  let N   = normalize(f.normEC);
  let L   = normalize(u.lightDirEC);
  let V   = normalize(-f.posEC);
  let ndl = clamp(dot(N, L), 0.0, 1.0);
  col    *= (0.15 + ndl * 0.85);

  // ── Ocean Blinn-Phong specular ───────────────────────────────────────────────
  let raw     = texColor.rgb;
  let isWater = ss(0.0, 0.09, raw.b - raw.r - 0.05);
  let H_      = normalize(L + V);
  let spec    = pow(clamp(dot(N, H_), 0.0, 1.0), 65.0) * isWater * 0.22;
  col        += vec3<f32>(1.0, 0.97, 0.90) * spec;

  // ── Fresnel atmospheric rim ──────────────────────────────────────────────────
  let rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5) * 0.85;
  col    += vec3<f32>(0.10, 0.38, 0.92) * rim;

  // ── Night-side ambient ───────────────────────────────────────────────────────
  let night = 1.0 - clamp(ndl * 2.2 + 0.35, 0.0, 1.0);
  col      += vec3<f32>(0.003, 0.005, 0.018) * night;

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
