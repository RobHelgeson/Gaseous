// background-vertex.wgsl — Fullscreen triangle vertex shader
// Uses vertex_index to generate a single triangle covering the entire screen

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VertexOut {
    // Fullscreen triangle: 3 vertices that cover [-1,1] clip space
    let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;

    var out : VertexOut;
    out.pos = vec4(x, y, 0.0, 1.0);
    // UV: [0,0] top-left to [1,1]+ bottom-right (clipped by rasterizer)
    out.uv = vec2((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}
