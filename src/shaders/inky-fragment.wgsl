// inky-fragment.wgsl — Ink in water: soft ink drops with premultiplied alpha
// Particles darken the bright background where they pool

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) color : vec3<f32>,
    @location(2) alpha : f32,
    @location(3) brightness : f32,
    @location(4) glow_falloff : f32,
};

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    // Distance from center of quad (0,0 = center, 1 = edge)
    let centered = in.uv * 2.0 - 1.0;
    let dist2 = dot(centered, centered);

    // Discard pixels outside the circle
    if (dist2 > 1.0) {
        discard;
    }

    // Soft ink drop falloff — wider and gentler than nebula's glow
    let falloff = exp(-dist2 * in.glow_falloff);

    // Ink opacity: how much this particle darkens the background
    let ink_alpha = falloff * in.alpha * in.brightness * 0.35;

    // Premultiplied alpha output (blended with one, one-minus-src-alpha)
    return vec4(in.color * ink_alpha, ink_alpha);
}
