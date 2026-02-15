// nebula-background.wgsl — Procedural star field for nebula theme

struct BgParams {
    canvas_width: f32,
    canvas_height: f32,
    star_density: f32,
    star_brightness: f32,
    nebula_glow: f32,
    time: f32,
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var<uniform> bg : BgParams;

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

// Simple hash for star placement
fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, vec3(p3.y + 33.33, p3.z + 33.33, p3.x + 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
    return vec2(hash21(p), hash21(p + vec2(127.1, 311.7)));
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    // Deep purple-black base
    let base_color = vec3(0.01, 0.005, 0.02);

    // Star field: divide screen into grid cells, place one potential star per cell
    let pixel = in.uv * vec2(bg.canvas_width, bg.canvas_height);
    let cell_size = 8.0; // pixels per cell
    let cell = floor(pixel / cell_size);
    let cell_uv = fract(pixel / cell_size);

    // Random star position and brightness within cell
    let star_rand = hash22(cell);
    let star_pos = star_rand;
    let star_dist = length(cell_uv - star_pos);

    // Only some cells have visible stars (controlled by density)
    let has_star = hash21(cell * 17.31) < bg.star_density;
    let star_size = hash21(cell * 7.77) * 0.03 + 0.01;

    // Star brightness with slight twinkle
    let twinkle = 0.8 + 0.2 * sin(bg.time * (1.0 + hash21(cell * 3.33) * 3.0));
    let star_intensity = select(0.0, 1.0, has_star) *
                         smoothstep(star_size, 0.0, star_dist) *
                         bg.star_brightness * twinkle;

    // Star color: mostly white with slight hue variation
    let star_hue = hash21(cell * 13.13);
    let star_color = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.7), star_hue);

    // Subtle nebula glow (large-scale noise)
    let glow_coord = in.uv * 3.0;
    let glow = (sin(glow_coord.x * 2.1 + 0.3) * sin(glow_coord.y * 1.7 + 0.7) + 1.0) * 0.5;
    let nebula = vec3(0.05, 0.01, 0.08) * glow * bg.nebula_glow;

    let final_color = base_color + star_color * star_intensity + nebula;
    return vec4(final_color, 1.0);
}
