// density.wgsl — SPH density computation using Poly6 kernel
// Expects shared-structs.wgsl to be prepended
// Reads from sorted particle buffer, writes density + pressure back

@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;
@group(0) @binding(2) var<storage, read> bin_offsets : array<u32>;
@group(0) @binding(3) var<storage, read> bin_counts : array<u32>;

const PI : f32 = 3.14159265359;

// Poly6 kernel: W(r, h) = 315 / (64 * PI * h^9) * (h^2 - r^2)^3
fn poly6(r2: f32, h: f32) -> f32 {
    let h2 = h * h;
    if (r2 >= h2) { return 0.0; }
    let diff = h2 - r2;
    let h9 = h2 * h2 * h2 * h2 * h;
    return 315.0 / (64.0 * PI * h9) * diff * diff * diff;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particle_count) { return; }

    var p = particles[idx];
    if ((p.flags & 1u) == 0u) { return; }

    let pos = p.pos_vel.xy;
    let h = params.sph_radius;

    // Self-density contribution
    var density = poly6(0.0, h);

    // Determine which grid cell this particle is in
    let cx = clamp(u32(pos.x / params.bin_size), 0u, params.bins_x - 1u);
    let cy = clamp(u32(pos.y / params.bin_size), 0u, params.bins_y - 1u);

    // Search 3x3 neighborhood
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
                density += poly6(r2, h);
            }
        }
    }

    // Store density and compute pressure (equation of state)
    p.color_density.w = density;
    p.pressure = params.gas_constant * (density - params.rest_density);
    particles[idx] = p;
}
