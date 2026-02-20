// forces.wgsl — SPH pressure/viscosity + attractor + gravity + mouse + drag
// Expects shared-structs.wgsl to be prepended

@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;
@group(0) @binding(2) var<storage, read> bin_offsets : array<u32>;
@group(0) @binding(3) var<storage, read> bin_counts : array<u32>;
@group(0) @binding(4) var<storage, read> balls : array<BallData>;

const SHED_THRESHOLD : f32 = 0.1;
const SOFTENING : f32 = 100.0;

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particle_count) { return; }

    var p = particles[idx];
    if ((p.flags & 1u) == 0u) { return; }

    let pos = p.pos_vel.xy;
    let vel = p.pos_vel.zw;
    let h = params.sph_radius;
    let h2 = params.sph_radius_sq;
    let my_density = max(p.color_density.w, 0.001);
    let my_pressure = p.pressure;
    let my_ball = p.ball_id;
    let spiky_scale = params.spiky_scale;  // -45/(PI*h^6), precomputed
    let visc_scale = params.visc_scale;    // 45/(PI*h^6), precomputed
    let fade = params.fade_alpha;

    var force = vec2(0.0);

    // --- SPH forces: pressure + viscosity from neighbors ---
    let inv_bs = params.inv_bin_size;
    let cx = clamp(u32(pos.x * inv_bs), 0u, params.bins_x - 1u);
    let cy = clamp(u32(pos.y * inv_bs), 0u, params.bins_y - 1u);

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
                let r2 = dot(diff, diff);
                if (r2 >= h2 || r2 < 0.000001) { continue; }

                let r = sqrt(r2);
                let q_density = max(q.color_density.w, 0.001);
                let h_minus_r = h - r;

                // Pressure force: spiky_scale * (h-r)^2 * (diff/r)
                let spiky_grad = spiky_scale * h_minus_r * h_minus_r * diff / r;
                let f_pressure = -(my_pressure + q.pressure) /
                    (2.0 * q_density) * spiky_grad;

                // Viscosity force: visc_scale * (h-r)
                let lap_v = visc_scale * h_minus_r;
                let f_visc = params.viscosity_param * (q.pos_vel.zw - vel) /
                    q_density * lap_v;

                force += (f_pressure + f_visc) * fade;
            }
        }
    }

    // --- Central attractor force (holds particles during spawn) ---
    if (my_ball < params.ball_count) {
        let ball = balls[my_ball];
        let to_center = ball.pos - pos;
        let dist2 = dot(to_center, to_center);
        let dist = max(sqrt(dist2), 1.0);
        // to_center / dist = normalize(to_center); * 1/dist for force
        let attractor_force = p.attractor_str * params.attractor_base *
            to_center / (dist * dist);
        force += attractor_force;

        // Combined attractor + tidal decay
        p.attractor_str *= (1.0 - params.attractor_decay * params.dt) *
                           (1.0 - params.tidal_stripping * dist * params.dt);
        p.attractor_str = max(p.attractor_str, 0.0);
    }

    // --- Inter-ball gravity (from all balls) ---
    for (var b = 0u; b < params.ball_count; b++) {
        let ball = balls[b];
        let to_ball = ball.pos - pos;
        let dist2 = dot(to_ball, to_ball) + SOFTENING;
        // Combine sqrt + normalize: to_ball / dist gives direction, / dist2 gives 1/r^2
        let inv_dist = inverseSqrt(dist2);
        let f_grav = params.gravity_constant * ball.mass * inv_dist * inv_dist *
            to_ball * inv_dist;
        force += f_grav;
    }

    // --- Mouse interaction ---
    if (params.mouse_force > 0.001) {
        let to_mouse = vec2(params.mouse_x, params.mouse_y) - pos;
        let mouse_len = length(to_mouse);
        let mouse_dist = mouse_len + 10.0;
        // Original: force/dist * normalize = force/(dist*len) * vec
        force += params.mouse_force / (mouse_dist * max(mouse_len, 0.001)) * to_mouse;
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
