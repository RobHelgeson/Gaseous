// spatial-hash.wgsl — Bin counting and particle sorting
// Expects shared-structs.wgsl to be prepended
// Contains 3 entry points: clear_bins, count_bins, sort_particles

@group(0) @binding(0) var<storage, read_write> bin_counts : array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params : SimParams;

// --- Clear bins ---

@compute @workgroup_size(64)
fn clear_bins(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    let bin_count = params.bins_x * params.bins_y + 1u;
    if (idx >= bin_count) { return; }
    atomicStore(&bin_counts[idx], 0u);
}

// --- Count bins ---
// Separate bind group: particles (read) + bin_counts (read_write) + params

@group(0) @binding(2) var<storage, read> particles_in : array<Particle>;

@compute @workgroup_size(64)
fn count_bins(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particle_count) { return; }

    let p = particles_in[idx];
    if ((p.flags & 1u) == 0u) { return; }

    let pos = p.pos_vel.xy;
    let cx = clamp(u32(pos.x / params.bin_size), 0u, params.bins_x - 1u);
    let cy = clamp(u32(pos.y / params.bin_size), 0u, params.bins_y - 1u);
    let cell = cy * params.bins_x + cx;

    atomicAdd(&bin_counts[cell], 1u);
}

// --- Sort particles ---
// Uses bin offsets (after prefix sum) to place particles in sorted order

@group(0) @binding(3) var<storage, read> bin_offsets : array<u32>;
@group(0) @binding(4) var<storage, read_write> particles_out : array<Particle>;

@compute @workgroup_size(64)
fn sort_particles(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particle_count) { return; }

    let p = particles_in[idx];
    if ((p.flags & 1u) == 0u) {
        // Dead particles go to end — use last bin slot
        let last_bin = params.bins_x * params.bins_y;
        let slot = atomicAdd(&bin_counts[last_bin], 1u);
        // Don't write dead particles to sorted buffer
        return;
    }

    let pos = p.pos_vel.xy;
    let cx = clamp(u32(pos.x / params.bin_size), 0u, params.bins_x - 1u);
    let cy = clamp(u32(pos.y / params.bin_size), 0u, params.bins_y - 1u);
    let cell = cy * params.bins_x + cx;

    // Claim a slot within this bin's range
    let base_offset = bin_offsets[cell];
    let local_offset = atomicAdd(&bin_counts[cell], 1u);
    let dest = base_offset + local_offset;

    if (dest < params.particle_count) {
        particles_out[dest] = p;
    }
}
