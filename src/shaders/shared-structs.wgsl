// shared-structs.wgsl — Prepended to every shader at pipeline creation time

struct Particle {
    pos_vel: vec4<f32>,        // xy=position, zw=velocity
    color_density: vec4<f32>,  // xyz=color, w=density
    pressure: f32,
    attractor_str: f32,
    ball_id: u32,
    flags: u32,                // bit 0: alive, bit 1: fading
};

struct SimParams {
    dt: f32,
    particle_count: u32,
    ball_count: u32,
    canvas_width: f32,
    canvas_height: f32,
    sph_radius: f32,
    rest_density: f32,
    gas_constant: f32,
    viscosity_param: f32,
    attractor_base: f32,
    gravity_constant: f32,
    drag_coefficient: f32,
    bin_size: f32,
    bins_x: u32,
    bins_y: u32,
    mouse_x: f32,
    mouse_y: f32,
    mouse_force: f32,
    frame_number: u32,
    particle_scale: f32,
    fade_alpha: f32,
    attractor_decay: f32,
    bounce_damping: f32,
    tidal_stripping: f32,
    fog_intensity: f32,
    fog_falloff: f32,
    fog_size: f32,
    intensity_falloff: f32,
    intensity_floor: f32,
    brightness_falloff: f32,
    brightness_floor: f32,
    glow_falloff: f32,
    // Precomputed kernel coefficients (avoid per-interaction pow/division)
    poly6_scale: f32,       // 315 / (64 * PI * h^9)
    spiky_scale: f32,       // -45 / (PI * h^6)
    visc_scale: f32,        // 45 / (PI * h^6)
    inv_bin_size: f32,      // 1.0 / bin_size
    sph_radius_sq: f32,     // sph_radius * sph_radius
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

struct BallData {
    pos: vec2<f32>,
    vel: vec2<f32>,
    color: vec3<f32>,
    attractor_strength: f32,
    mass: f32,
    radius: f32,
    particle_start: u32,
    particle_count_val: u32,
};
