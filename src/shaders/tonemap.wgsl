// tonemap.wgsl — ACES tonemapping + gamma correction + blue-noise dither

@group(0) @binding(0) var hdr_texture : texture_2d<f32>;
@group(0) @binding(1) var hdr_sampler : sampler;

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

// Fullscreen triangle vertex shader (inline to avoid separate file)
@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VertexOut {
    let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;

    var out : VertexOut;
    out.pos = vec4(x, y, 0.0, 1.0);
    out.uv = vec2((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

// ACES filmic tonemapping (approximate fit)
fn aces_tonemap(x: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3(0.0), vec3(1.0));
}

// Simple dither to reduce banding in dark gradients
fn dither(uv: vec2<f32>) -> f32 {
    let p = fract(uv * vec2(443.8975, 397.2973));
    let p2 = p + dot(p, p + 19.19);
    return fract(p2.x * p2.y) / 255.0;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    let hdr = textureSample(hdr_texture, hdr_sampler, in.uv).rgb;

    // ACES tonemap
    var ldr = aces_tonemap(hdr);

    // Gamma correction (linear -> sRGB)
    ldr = pow(ldr, vec3(1.0 / 2.2));

    // Dither to reduce banding
    let d = dither(in.pos.xy);
    ldr = ldr + vec3(d) - 0.5 / 255.0;

    return vec4(ldr, 1.0);
}
