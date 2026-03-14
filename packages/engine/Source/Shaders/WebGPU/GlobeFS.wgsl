// Globe fragment shader (WGSL)
// Corresponds to GlobeFS.glsl, simplified for the initial WebGPU port.
// Imagery blending with multiple texture layers is handled here.

// ─── Bind-group 0: per-view uniforms (shared with vertex) ─────────────────────
struct ViewUniforms {
  modelViewProjection : mat4x4<f32>,
  modelView           : mat4x4<f32>,
  center3D            : vec3<f32>,
  _pad0               : f32,
  tileRectangle       : vec4<f32>,
}

@group(0) @binding(0) var<uniform> view : ViewUniforms;

// ─── Bind-group 1: imagery layer (first layer) ────────────────────────────────
struct TileUniforms {
  dayTextureTranslationAndScale : vec4<f32>,  // xy = translation, zw = scale
  initialColor                  : vec4<f32>,
  dayTextureAlpha               : f32,
  _pad                          : vec3<f32>,
}

@group(1) @binding(0) var<uniform> tile : TileUniforms;
@group(1) @binding(1) var           dayTexture : texture_2d<f32>;
@group(1) @binding(2) var           dayTextureSampler : sampler;

// ─── Fragment input ───────────────────────────────────────────────────────────
struct FragmentInput {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       positionEC   : vec3<f32>,
  @location(1)       texCoords    : vec2<f32>,
  @location(2)       normalEC     : vec3<f32>,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Simple diffuse + ambient lighting
fn computeLighting(normalEC : vec3<f32>, lightDirectionEC : vec3<f32>) -> f32 {
  let nDotL = clamp(dot(normalize(normalEC), normalize(lightDirectionEC)), 0.0, 1.0);
  return 0.2 + 0.8 * nDotL;  // ambient + diffuse
}

// Apply imagery tile texture-coordinate transform
fn applyTextureTransform(uv : vec2<f32>, translationAndScale : vec4<f32>) -> vec2<f32> {
  return uv * translationAndScale.zw + translationAndScale.xy;
}

// ─── Entry point ──────────────────────────────────────────────────────────────
@fragment
fn fragmentMain(input : FragmentInput) -> @location(0) vec4<f32> {
  var color = tile.initialColor;

  // Sample the day imagery texture if it is present (non-zero alpha)
  let uvTransformed = applyTextureTransform(input.texCoords, tile.dayTextureTranslationAndScale);
  let dayColor = textureSample(dayTexture, dayTextureSampler, uvTransformed);

  // Alpha-blend the imagery over the initial color
  let alpha = dayColor.a * tile.dayTextureAlpha;
  color = mix(color, dayColor, alpha);

  // Basic diffuse lighting from a fixed sun direction in eye space
  let sunDirEC = normalize(vec3<f32>(0.0, 0.0, 1.0));
  let lighting = computeLighting(input.normalEC, sunDirEC);
  color = vec4<f32>(color.rgb * lighting, color.a);

  return color;
}
