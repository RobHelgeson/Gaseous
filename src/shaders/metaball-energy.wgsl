// metaball-energy.wgsl — Energy accumulation fragment shader for metaball theme
// Outputs vec4(color * energy, energy) with additive blending to build scalar field

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

    // Discard outside unit circle
    if (dist2 > 1.0) {
        discard;
    }

    // Energy field: Gaussian falloff from center
    let energy = exp(-dist2 * in.glow_falloff) * in.brightness * in.alpha;

    // Output color weighted by energy + raw energy in alpha
    // Additive blending accumulates both channels across overlapping particles
    return vec4(in.color * energy, energy);
}
