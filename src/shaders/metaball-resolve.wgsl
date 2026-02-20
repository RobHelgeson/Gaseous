// metaball-resolve.wgsl — Fullscreen resolve pass for metaball theme
// Thresholds the energy field into sharp blobs with gradient-based lighting

@group(0) @binding(0) var energy_texture : texture_2d<f32>;
@group(0) @binding(1) var energy_sampler : sampler;

struct ResolveParams {
    width : f32,
    height : f32,
    threshold : f32,
    edge_softness : f32,
    specular_intensity : f32,
    light_x : f32,
    light_y : f32,
    _pad : f32,
};
@group(0) @binding(2) var<uniform> params : ResolveParams;

struct VertexOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

// Fullscreen triangle vertex shader (same pattern as tonemap.wgsl)
@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VertexOut {
    let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;

    var out : VertexOut;
    out.pos = vec4(x, y, 0.0, 1.0);
    out.uv = vec2((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    // Sample energy texture: rgb = weighted color sum, a = energy sum
    let sample = textureSample(energy_texture, energy_sampler, in.uv);
    let energy = sample.a;

    // Sharp metaball edge via smoothstep threshold
    let lo = params.threshold - params.edge_softness;
    let hi = params.threshold + params.edge_softness;
    let alpha = smoothstep(lo, hi, energy);

    if (alpha < 0.001) {
        discard;
    }

    // Recover weighted average color
    let base_color = sample.rgb / max(energy, 0.001);

    // Screen-space gradient of energy field for fake surface normals
    let tx = 1.0 / params.width;
    let ty = 1.0 / params.height;
    let e_right = textureSample(energy_texture, energy_sampler, in.uv + vec2(tx, 0.0)).a;
    let e_left  = textureSample(energy_texture, energy_sampler, in.uv - vec2(tx, 0.0)).a;
    let e_up    = textureSample(energy_texture, energy_sampler, in.uv + vec2(0.0, ty)).a;
    let e_down  = textureSample(energy_texture, energy_sampler, in.uv - vec2(0.0, ty)).a;

    let dx = (e_right - e_left) * 0.5;
    let dy = (e_up - e_down) * 0.5;

    // Construct normal from gradient (pointing "out" of the surface)
    let n = normalize(vec3(-dx, -dy, 0.15));

    // Light direction (normalized)
    let light_dir = normalize(vec3(params.light_x, params.light_y, 0.6));

    // Diffuse lighting
    let ndl = max(dot(n, light_dir), 0.0);
    let diffuse = 0.4 + 0.6 * ndl;

    // Specular highlight (Blinn-Phong)
    let view_dir = vec3(0.0, 0.0, 1.0);
    let half_dir = normalize(light_dir + view_dir);
    let spec = pow(max(dot(n, half_dir), 0.0), 32.0) * params.specular_intensity;

    let lit_color = base_color * diffuse + vec3(spec);

    // Output premultiplied alpha
    return vec4(lit_color * alpha, alpha);
}
