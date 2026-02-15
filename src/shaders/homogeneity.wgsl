// homogeneity.wgsl — Color variance detection for cycle transitions
// Divides screen into 16×16 grid, accumulates particle colors per cell via atomics
// Expects shared-structs.wgsl to be prepended

const GRID_X : u32 = 16u;
const GRID_Y : u32 = 16u;
const CELL_COUNT : u32 = 256u;
const CELL_STRIDE : u32 = 4u;   // r_sum, g_sum, b_sum, count per cell
const TOTAL_U32S : u32 = 1024u; // CELL_COUNT * CELL_STRIDE
const FP_SCALE : f32 = 1000.0;  // fixed-point scale for atomic float emulation

@group(0) @binding(0) var<storage, read_write> cells : array<atomic<u32>>;
@group(0) @binding(1) var<storage, read> particles_in : array<Particle>;
@group(0) @binding(2) var<uniform> sim_params : SimParams;

// --- Entry point: clear_cells ---
// Zero out all cell accumulators before a new measurement
@compute @workgroup_size(64)
fn clear_cells(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= TOTAL_U32S) { return; }
    atomicStore(&cells[idx], 0u);
}

// --- Entry point: accumulate ---
// Each alive particle adds its color (fixed-point) to its grid cell
@compute @workgroup_size(64)
fn accumulate(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= sim_params.particle_count) { return; }

    let p = particles_in[idx];
    if ((p.flags & 1u) == 0u) { return; } // skip dead particles

    let pos = p.pos_vel.xy;
    let cell_x = min(u32(pos.x / sim_params.canvas_width * f32(GRID_X)), GRID_X - 1u);
    let cell_y = min(u32(pos.y / sim_params.canvas_height * f32(GRID_Y)), GRID_Y - 1u);
    let cell = cell_y * GRID_X + cell_x;
    let base = cell * CELL_STRIDE;

    let color = p.color_density.xyz;
    atomicAdd(&cells[base + 0u], u32(color.x * FP_SCALE));
    atomicAdd(&cells[base + 1u], u32(color.y * FP_SCALE));
    atomicAdd(&cells[base + 2u], u32(color.z * FP_SCALE));
    atomicAdd(&cells[base + 3u], 1u);
}
