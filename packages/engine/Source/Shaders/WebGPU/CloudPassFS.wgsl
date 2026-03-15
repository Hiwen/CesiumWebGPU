// Cloud sphere fragment shader — Phase 2
//
// Renders the cloud layer using 3-D world-space FBM noise so there is NO
// UV-wrap seam anywhere on the sphere.  Animation is achieved by rotating the
// noise input around the Earth's Z-axis over time rather than scrolling a 2-D
// UV offset — this is inherently seamless.
//
// Bind-group layout:
//   @group(0) @binding(0)  CloudUniforms  (uniform buffer, shared with VS)

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

// ── Entry point ───────────────────────────────────────────────────────────────

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
