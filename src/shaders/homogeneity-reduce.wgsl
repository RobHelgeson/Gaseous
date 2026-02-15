// homogeneity-reduce.wgsl — Compute global color variance from cell accumulators
// Standalone shader (no shared-structs needed)
// Single thread loops over 256 cells — trivial cost, runs every ~30 frames

const CELL_COUNT : u32 = 256u;
const CELL_STRIDE : u32 = 4u;
const FP_SCALE : f32 = 1000.0;

@group(0) @binding(0) var<storage, read> cells : array<u32>;
@group(0) @binding(1) var<storage, read_write> result : array<f32>;

@compute @workgroup_size(1)
fn reduce_variance(@builtin(global_invocation_id) gid : vec3<u32>) {
    // Pass 1: compute global mean color across occupied cells
    var global_sum = vec3(0.0);
    var occupied = 0.0;

    for (var i = 0u; i < CELL_COUNT; i++) {
        let base = i * CELL_STRIDE;
        let count = f32(cells[base + 3u]);
        if (count > 0.0) {
            let inv = 1.0 / (FP_SCALE * count);
            global_sum += vec3(
                f32(cells[base + 0u]) * inv,
                f32(cells[base + 1u]) * inv,
                f32(cells[base + 2u]) * inv,
            );
            occupied += 1.0;
        }
    }

    let global_mean = global_sum / max(occupied, 1.0);

    // Pass 2: sum of squared deviations from global mean
    var variance = 0.0;
    for (var i = 0u; i < CELL_COUNT; i++) {
        let base = i * CELL_STRIDE;
        let count = f32(cells[base + 3u]);
        if (count > 0.0) {
            let inv = 1.0 / (FP_SCALE * count);
            let cell_mean = vec3(
                f32(cells[base + 0u]) * inv,
                f32(cells[base + 1u]) * inv,
                f32(cells[base + 2u]) * inv,
            );
            let diff = cell_mean - global_mean;
            variance += dot(diff, diff);
        }
    }

    result[0] = variance / max(occupied, 1.0);
}
