// particle-vertex.wgsl — Instanced quad vertex shader
// Expects shared-structs.wgsl to be prepended

@group(0) @binding(0) var<storage, read> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;
@group(0) @binding(2) var<storage, read> balls : array<BallData>;

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) @interpolate(flat) color : vec3<f32>,
    @location(2) @interpolate(flat) alpha : f32,
    @location(3) @interpolate(flat) brightness : f32,
    @location(4) @interpolate(flat) glow_falloff : f32,
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

    let flags = p.flags;
    let alive = (flags & 1u) != 0u;
    let fading = (flags & 2u) != 0u;
    var alpha = select(0.0, select(1.0, p.attractor_str, fading), alive);
    alpha *= params.fade_alpha;

    // Distance-based falloff: min normalized distance-squared to nearest ball
    var brightness = 1.0;
    if (params.intensity_falloff > 0.0 || params.brightness_falloff > 0.0) {
        var min_nd2 = 1e12;
        for (var b = 0u; b < params.ball_count; b++) {
            let d = pos2d - balls[b].pos;
            let inv_r = 1.0 / max(balls[b].radius, 1.0);
            min_nd2 = min(min_nd2, dot(d, d) * inv_r * inv_r);
        }
        if (params.intensity_falloff > 0.0) {
            alpha *= max(params.intensity_floor,
                         exp(-min_nd2 * params.intensity_falloff * 0.1));
        }
        if (params.brightness_falloff > 0.0) {
            brightness = max(params.brightness_floor,
                             exp(-min_nd2 * params.brightness_falloff * 0.1));
        }
    }

    let size = 4.0 * params.particle_scale;
    let corner = QUAD_POS[vid];
    let world_pos = pos2d + corner * size;

    // Convert pixel coords to clip space: [0, width] -> [-1, 1]
    let clip_x = (world_pos.x / params.canvas_width) * 2.0 - 1.0;
    let clip_y = 1.0 - (world_pos.y / params.canvas_height) * 2.0;

    var out : VertexOut;
    out.pos = vec4(clip_x, clip_y, 0.0, 1.0);
    out.uv = corner * 0.5 + 0.5;
    out.color = p.color_density.xyz;
    out.alpha = alpha;
    out.brightness = brightness;
    out.glow_falloff = params.glow_falloff;
    return out;
}
