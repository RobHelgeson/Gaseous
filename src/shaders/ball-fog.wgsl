// ball-fog.wgsl — Soft colored fog/glow around each ball center
// Expects shared-structs.wgsl to be prepended

@group(0) @binding(0) var<storage, read> balls : array<BallData>;
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
    let ball = balls[iid];
    let center = ball.pos;
    let color = ball.color;

    // Quad extends fog_size × ball radius for soft falloff
    let size = ball.radius * params.fog_size;

    let corner = QUAD_POS[vid];
    let world_pos = center + corner * size;

    // Convert pixel coords to clip space: [0, width] -> [-1, 1]
    let clip_x = (world_pos.x / params.canvas_width) * 2.0 - 1.0;
    let clip_y = 1.0 - (world_pos.y / params.canvas_height) * 2.0;

    var out : VertexOut;
    out.pos = vec4(clip_x, clip_y, 0.0, 1.0);
    out.uv = corner * 0.5 + 0.5;
    out.color = color;
    out.alpha = params.fade_alpha;
    return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    // Distance from center of quad (0,0 = center, 1 = edge)
    let centered = in.uv * 2.0 - 1.0;
    let dist2 = dot(centered, centered);

    // Gaussian falloff — no hard cutoff, tapers smoothly to zero
    let intensity = exp(-dist2 * params.fog_falloff) * params.fog_intensity;

    let hdr_color = in.color * intensity * in.alpha;

    return vec4(hdr_color, intensity * in.alpha);
}
