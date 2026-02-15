// particle-vertex.wgsl — Instanced quad vertex shader
// Expects shared-structs.wgsl to be prepended

@group(0) @binding(0) var<storage, read> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) color : vec3<f32>,
    @location(2) alpha : f32,
};

// 6 vertices for a quad (two triangles)
const QUAD_POS = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),
    vec2(-1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2( 1.0,  1.0),
);

@vertex
fn vs_main(
    @builtin(vertex_index) vid : u32,
    @builtin(instance_index) iid : u32,
) -> VertexOut {
    let p = particles[iid];
    let pos2d = p.pos_vel.xy;
    let color = p.color_density.xyz;

    let alive = (p.flags & 1u) != 0u;
    let fading = (p.flags & 2u) != 0u;
    var alpha = select(0.0, 1.0, alive);
    // fading particles use attractor_str as fade alpha
    if (fading) {
        alpha = p.attractor_str;
    }

    // Quad size in pixels, scaled by particle_scale
    let size = 4.0 * params.particle_scale;

    let corner = QUAD_POS[vid];
    let world_pos = pos2d + corner * size;

    // Convert pixel coords to clip space: [0, width] -> [-1, 1]
    let clip_x = (world_pos.x / params.canvas_width) * 2.0 - 1.0;
    let clip_y = 1.0 - (world_pos.y / params.canvas_height) * 2.0;

    var out : VertexOut;
    out.pos = vec4(clip_x, clip_y, 0.0, 1.0);
    out.uv = corner * 0.5 + 0.5;
    out.color = color;
    out.alpha = alpha;
    return out;
}
