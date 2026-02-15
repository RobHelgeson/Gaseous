// forces.wgsl — SPH pressure/viscosity + attractor + gravity + mouse + drag
// Expects shared-structs.wgsl to be prepended

@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;
@group(0) @binding(2) var<storage, read> bin_offsets : array<u32>;
@group(0) @binding(3) var<storage, read> bin_counts : array<u32>;
@group(0) @binding(4) var<storage, read> balls : array<BallData>;

const PI : f32 = 3.14159265359;
const SHED_THRESHOLD : f32 = 0.1;
const TIDAL_FACTOR : f32 = 0.0005;
const SOFTENING : f32 = 100.0;  // Gravity softening (pixels^2)

// Spiky kernel gradient: -45/(PI*h^6) * (h-r)^2 * (r_vec/r)
fn grad_spiky(diff: vec2<f32>, r: f32, h: f32) -> vec2<f32> {
    if (r >= h || r < 0.001) { return vec2(0.0); }
    let coeff = -45.0 / (PI * pow(h, 6.0)) * pow(h - r, 2.0);
    return coeff * diff / r;
}

// Viscosity kernel Laplacian: 45/(PI*h^6) * (h-r)
fn lap_viscosity(r: f32, h: f32) -> f32 {
    if (r >= h) { return 0.0; }
    return 45.0 / (PI * pow(h, 6.0)) * (h - r);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particle_count) { return; }

    var p = particles[idx];
    if ((p.flags & 1u) == 0u) { return; }

    let pos = p.pos_vel.xy;
    let vel = p.pos_vel.zw;
    let h = params.sph_radius;
    let my_density = max(p.color_density.w, 0.001);
    let my_pressure = p.pressure;
    let my_ball = p.ball_id;

    var force = vec2(0.0);

    // --- SPH forces: pressure + viscosity from neighbors ---
    let cx = clamp(u32(pos.x / params.bin_size), 0u, params.bins_x - 1u);
    let cy = clamp(u32(pos.y / params.bin_size), 0u, params.bins_y - 1u);

    let min_cx = select(0u, cx - 1u, cx > 0u);
    let min_cy = select(0u, cy - 1u, cy > 0u);
    let max_cx = min(cx + 1u, params.bins_x - 1u);
    let max_cy = min(cy + 1u, params.bins_y - 1u);

    for (var ny = min_cy; ny <= max_cy; ny++) {
        for (var nx = min_cx; nx <= max_cx; nx++) {
            let cell = ny * params.bins_x + nx;
            let start = bin_offsets[cell];
            let count = bin_counts[cell];

            for (var j = start; j < start + count; j++) {
                if (j == idx) { continue; }
                if (j >= params.particle_count) { break; }

                let q = particles[j];
                if ((q.flags & 1u) == 0u) { continue; }

                let diff = pos - q.pos_vel.xy;
                let r = length(diff);

                if (r >= h) { continue; }

                let q_density = max(q.color_density.w, 0.001);

                // Pressure force (Spiky kernel)
                let f_pressure = -(my_pressure + q.pressure) /
                    (2.0 * q_density) * grad_spiky(diff, r, h);
                force += f_pressure;

                // Viscosity force
                let f_visc = params.viscosity_param * (q.pos_vel.zw - vel) /
                    q_density * lap_viscosity(r, h);
                force += f_visc;
            }
        }
    }

    // --- Central attractor force ---
    if (my_ball < params.ball_count) {
        let ball = balls[my_ball];
        let to_center = ball.pos - pos;
        let dist = max(length(to_center), 1.0);
        let attractor_force = p.attractor_str * normalize(to_center) *
            params.attractor_base / dist;
        force += attractor_force;

        // Attractor decay
        p.attractor_str *= (1.0 - params.drag_coefficient * params.dt);

        // Tidal stripping: distance-dependent decay
        p.attractor_str *= (1.0 - TIDAL_FACTOR * dist * params.dt);
        p.attractor_str = max(p.attractor_str, 0.0);
    }

    // --- Inter-ball gravity (from all balls) ---
    for (var b = 0u; b < params.ball_count; b++) {
        let ball = balls[b];
        let to_ball = ball.pos - pos;
        let dist2 = dot(to_ball, to_ball) + SOFTENING;
        let dist = sqrt(dist2);
        let f_grav = params.gravity_constant * ball.mass / dist2 * normalize(to_ball);
        force += f_grav;
    }

    // --- Mouse interaction ---
    if (params.mouse_force > 0.001) {
        let to_mouse = vec2(params.mouse_x, params.mouse_y) - pos;
        let mouse_dist = length(to_mouse) + 10.0;
        force += params.mouse_force / mouse_dist * normalize(to_mouse);
    }

    // --- Drag for shed particles ---
    if (p.attractor_str < SHED_THRESHOLD) {
        force -= params.drag_coefficient * vel;
    }

    // Apply force as acceleration (mass = 1)
    let new_vel = vel + force * params.dt;
    p.pos_vel = vec4(pos, new_vel);
    particles[idx] = p;
}
