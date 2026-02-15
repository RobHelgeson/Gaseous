// prefix-sum.wgsl — Parallel inclusive prefix sum (Hillis-Steele)
// Ping-pongs between two buffers over ceil(log2(N)) iterations
// After all iterations, result is inclusive. Frame.js converts to exclusive
// by shifting: exclusive[i] = inclusive[i-1], exclusive[0] = 0.

@group(0) @binding(0) var<storage, read> input_buf : array<u32>;
@group(0) @binding(1) var<storage, read_write> output_buf : array<u32>;

struct PrefixParams {
    count: u32,
    offset: u32,  // stride for this iteration: 1, 2, 4, 8, ...
};

@group(0) @binding(2) var<uniform> pparams : PrefixParams;

@compute @workgroup_size(64)
fn prefix_sum(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= pparams.count) { return; }

    let stride = pparams.offset;

    if (idx >= stride) {
        output_buf[idx] = input_buf[idx] + input_buf[idx - stride];
    } else {
        output_buf[idx] = input_buf[idx];
    }
}

// Convert inclusive prefix sum to exclusive by shifting right by 1
// exclusive[0] = 0, exclusive[i] = inclusive[i-1]
@compute @workgroup_size(64)
fn make_exclusive(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= pparams.count) { return; }

    if (idx == 0u) {
        output_buf[0u] = 0u;
    } else {
        output_buf[idx] = input_buf[idx - 1u];
    }
}
