// inky-background.wgsl — Warm paper/water background for ink theme

struct BgParams {
    canvas_width: f32,
    canvas_height: f32,
    paper_grain: f32,
    water_ripple: f32,
    warmth: f32,
    time: f32,
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var<uniform> bg : BgParams;

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

// Simple hash for paper texture
fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, vec3(p3.y + 33.33, p3.z + 33.33, p3.x + 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    let pixel = in.uv * vec2(bg.canvas_width, bg.canvas_height);

    // Warm white base
    var base = vec3(0.96, 0.94, 0.91) + vec3(bg.warmth);

    // Subtle paper grain — fine noise per 2px cell
    let grain_cell = floor(pixel / 2.0);
    let grain = (hash21(grain_cell) - 0.5) * bg.paper_grain;
    base += vec3(grain);

    // Gentle water caustic ripples (slow-moving)
    let t = bg.time * 0.3;
    let caustic_uv = in.uv * 5.0;
    let ripple1 = sin(caustic_uv.x * 3.7 + t) * sin(caustic_uv.y * 4.3 + t * 0.7);
    let ripple2 = sin(caustic_uv.x * 2.3 - t * 0.5) * sin(caustic_uv.y * 3.1 + t * 1.1);
    let caustic = (ripple1 + ripple2 + 2.0) * 0.25; // normalize to [0, 1]
    base += vec3(caustic * 0.4, caustic * 0.45, caustic * 0.6) * bg.water_ripple;

    return vec4(clamp(base, vec3(0.0), vec3(1.0)), 1.0);
}
