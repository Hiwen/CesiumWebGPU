// Simple per-instance color primitive fragment shader (WGSL)

struct FragmentInput {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       positionEC   : vec3<f32>,
  @location(1)       normalEC     : vec3<f32>,
  @location(2)       color        : vec4<f32>,
}

@fragment
fn fragmentMain(input : FragmentInput) -> @location(0) vec4<f32> {
  // Simple diffuse lighting
  let sunDirEC = normalize(vec3<f32>(0.0, 1.0, 1.0));
  let nDotL = clamp(dot(normalize(input.normalEC), sunDirEC), 0.0, 1.0);
  let lighting = 0.3 + 0.7 * nDotL;
  return vec4<f32>(input.color.rgb * lighting, input.color.a);
}
