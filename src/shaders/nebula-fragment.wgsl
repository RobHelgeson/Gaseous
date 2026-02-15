// nebula-fragment.wgsl — Nebula theme particle fragment shader
// Gaussian falloff with glow for luminous cloud effect

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) @interpolate(flat) color : vec3<f32>,
    @location(2) @interpolate(flat) alpha : f32,
    @location(3) @interpolate(flat) brightness : f32,
    @location(4) @interpolate(flat) glow_falloff : f32,
};

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    // Distance from center of quad (0,0 = center, 1 = edge)
    let centered = in.uv * 2.0 - 1.0;
    let dist2 = dot(centered, centered);

    // Smooth falloff to zero at circle edge (no discard needed)
    let circle = max(1.0 - dist2, 0.0);

    // Gaussian falloff: bright core fading to translucent edges
    let intensity = exp(-dist2 * in.glow_falloff) * in.brightness * circle;

    // HDR color — can exceed 1.0 for bloom-like effect via additive blending
    let hdr_color = in.color * intensity * in.alpha * 0.6;

    return vec4(hdr_color, intensity * in.alpha);
}
