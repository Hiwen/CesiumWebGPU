// Globe rendering fragment shader — Phase 2
//
// Samples real imagery from an equirectangular texture, applies FBM cloud
// noise (same equations as GlobeFS.wgsl), Blinn-Phong diffuse + specular,
// and a Fresnel atmospheric rim.

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

// ── FBM cloud noise (identical to GlobeFS.wgsl) ──────────────────────────────

fn hash(p : vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

fn noise2(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);  // smoothstep
  return mix(
    mix(hash(i),                    hash(i + vec2<f32>(1.0, 0.0)), s.x),
    mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), s.x),
    s.y
  );
}

fn fbm(p_in : vec2<f32>) -> f32 {
  var p = p_in;
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 5; i++) {
    v += a * noise2(p);
    p  *= 2.0;
    a  *= 0.5;
  }
  return v;
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

  // ── Animated cloud layer (same fbm as GlobeFS.wgsl) ─────────────────────────
  let cuv   = uv + vec2<f32>(u.time * 0.004, 0.0);
  let cloud = ss(0.60, 0.68, fbm(cuv * vec2<f32>(5.0, 8.0)));
  col = mix(col, vec3<f32>(0.97, 0.98, 1.0), cloud * 0.60);

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
  let rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2) * 0.48;
  col    += vec3<f32>(0.08, 0.20, 0.68) * rim;

  // ── Night-side ambient ───────────────────────────────────────────────────────
  let night = 1.0 - clamp(ndl * 2.2 + 0.35, 0.0, 1.0);
  col      += vec3<f32>(0.003, 0.005, 0.018) * night;

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
