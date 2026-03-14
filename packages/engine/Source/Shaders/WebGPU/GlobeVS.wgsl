// Globe vertex shader (WGSL)
// Corresponds to GlobeVS.glsl but adapted for WebGPU.
// This is the base shader; complex variants (fog, atmosphere, etc.) are
// handled by feature-flag specialisation constants or separate pipelines.

// ─── Bind-group 0: per-view uniforms ─────────────────────────────────────────
struct ViewUniforms {
  modelViewProjection : mat4x4<f32>,
  modelView           : mat4x4<f32>,
  center3D            : vec3<f32>,
  _pad0               : f32,
  tileRectangle       : vec4<f32>,  // xmin, ymin, xmax, ymax (radians)
}

@group(0) @binding(0) var<uniform> view : ViewUniforms;

// ─── Vertex input ─────────────────────────────────────────────────────────────
struct VertexInput {
  @location(0) position3DAndHeight : vec4<f32>,  // xyz = ECEF, w = height
  @location(1) textureCoordAndNormals : vec4<f32>, // xy = uv, zw = encoded normal
}

// ─── Vertex output / fragment input ───────────────────────────────────────────
struct VertexOutput {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       positionEC   : vec3<f32>,
  @location(1)       texCoords    : vec2<f32>,
  @location(2)       normalEC     : vec3<f32>,
}

// ─── Octahedron-encoded normal decode ─────────────────────────────────────────
fn octDecode(encoded : vec2<f32>) -> vec3<f32> {
  var result = vec3<f32>(encoded, 1.0 - abs(encoded.x) - abs(encoded.y));
  if (result.z < 0.0) {
    let xy = result.xy;
    result = vec3<f32>(
      (1.0 - abs(xy.y)) * select(-1.0, 1.0, xy.x >= 0.0),
      (1.0 - abs(xy.x)) * select(-1.0, 1.0, xy.y >= 0.0),
      result.z
    );
  }
  return normalize(result);
}

// ─── Entry point ──────────────────────────────────────────────────────────────
@vertex
fn vertexMain(input : VertexInput) -> VertexOutput {
  var output : VertexOutput;

  let positionMC = input.position3DAndHeight.xyz;

  // Transform to clip space
  output.clipPosition = view.modelViewProjection * vec4<f32>(positionMC, 1.0);

  // Eye-space position
  let posEC4 = view.modelView * vec4<f32>(positionMC, 1.0);
  output.positionEC = posEC4.xyz;

  // Texture coordinates (x = west-east, y = south-north within tile)
  output.texCoords = input.textureCoordAndNormals.xy;

  // Decode surface normal from oct-encoding (stored in zw of input) and
  // transform to eye space for lighting calculations in the fragment shader.
  let normalMC = octDecode(input.textureCoordAndNormals.zw);
  output.normalEC = normalize((view.modelView * vec4<f32>(normalMC, 0.0)).xyz);

  return output;
}
