// Cloud sphere vertex shader — Phase 2
//
// Renders the cloud layer on a sphere at radius (1 + CLOUD_HEIGHT) above the
// Earth surface.  Only a position attribute is needed; the outward normal is
// derived from the position in the shader, and UV coordinates are not used
// (the fragment shader uses 3-D world-space noise to avoid UV-wrap seams).
//
// Bind-group layout:
//   @group(0) @binding(0)  CloudUniforms  (uniform buffer, shared with FS)

struct CloudUniforms {
  mvp        : mat4x4<f32>,   // model–view–projection
  mv         : mat4x4<f32>,   // model–view (lighting in eye space)
  lightDirEC : vec3<f32>,     // sun direction in eye space (unit vector)
  time       : f32,           // seconds since page load (for cloud animation)
}

@group(0) @binding(0) var<uniform> u : CloudUniforms;

struct VertIn {
  @location(0) pos : vec3<f32>,   // position on cloud sphere (radius = 1 + h)
}

struct VertOut {
  @builtin(position) clip     : vec4<f32>,
  @location(0)       normEC   : vec3<f32>,   // eye-space outward normal
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
