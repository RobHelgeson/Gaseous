// nebula-fragment.wgsl — Nebula theme particle fragment shader
// Gaussian falloff with glow for luminous cloud effect

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) color : vec3<f32>,
    @location(2) alpha : f32,
    @location(3) brightness : f32,
};

const GLOW_FALLOFF : f32 = 2.5;

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    // Distance from center of quad (0,0 = center, 1 = edge)
    let centered = in.uv * 2.0 - 1.0;
    let dist2 = dot(centered, centered);

    // Discard pixels outside the circle
    if (dist2 > 1.0) {
        discard;
    }

    // Gaussian falloff: bright core fading to translucent edges
    let intensity = exp(-dist2 * GLOW_FALLOFF) * in.brightness;

    // HDR color — can exceed 1.0 for bloom-like effect via additive blending
    let hdr_color = in.color * intensity * in.alpha * 0.6;

    return vec4(hdr_color, intensity * in.alpha);
}
