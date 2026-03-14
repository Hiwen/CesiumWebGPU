// Simple per-instance color primitive vertex shader (WGSL)
// Used as the WebGPU equivalent of a basic vertex-colored mesh.

struct ViewUniforms {
  modelViewProjection : mat4x4<f32>,
  modelView           : mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> view : ViewUniforms;

struct InstanceUniforms {
  modelMatrix : mat4x4<f32>,
  color       : vec4<f32>,
}

@group(1) @binding(0) var<uniform> instance : InstanceUniforms;

struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
}

struct VertexOutput {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0)       positionEC   : vec3<f32>,
  @location(1)       normalEC     : vec3<f32>,
  @location(2)       color        : vec4<f32>,
}

@vertex
fn vertexMain(input : VertexInput) -> VertexOutput {
  var output : VertexOutput;

  let worldPos = instance.modelMatrix * vec4<f32>(input.position, 1.0);
  output.clipPosition = view.modelViewProjection * worldPos;
  output.positionEC   = (view.modelView * worldPos).xyz;
  output.normalEC     = (view.modelView * (instance.modelMatrix * vec4<f32>(input.normal, 0.0))).xyz;
  output.color        = instance.color;

  return output;
}
