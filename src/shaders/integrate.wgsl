// integrate.wgsl — Symplectic Euler position integration + boundary handling
// Forces shader has already updated velocity. This shader applies vel to pos.
// Expects shared-structs.wgsl to be prepended

@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : SimParams;

const BOUNCE_DAMPING : f32 = 0.7;
const SHED_THRESHOLD : f32 = 0.1;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particle_count) { return; }

    var p = particles[idx];
    if ((p.flags & 1u) == 0u) { return; }

    var vel = p.pos_vel.zw;
    var new_pos = p.pos_vel.xy + vel * params.dt;

    let is_bound = p.attractor_str > SHED_THRESHOLD;

    if (is_bound) {
        // Bound particles: damped bounce off walls
        if (new_pos.x < 0.0) {
            new_pos.x = -new_pos.x;
            vel.x = abs(vel.x) * BOUNCE_DAMPING;
        } else if (new_pos.x > params.canvas_width) {
            new_pos.x = 2.0 * params.canvas_width - new_pos.x;
            vel.x = -abs(vel.x) * BOUNCE_DAMPING;
        }
        if (new_pos.y < 0.0) {
            new_pos.y = -new_pos.y;
            vel.y = abs(vel.y) * BOUNCE_DAMPING;
        } else if (new_pos.y > params.canvas_height) {
            new_pos.y = 2.0 * params.canvas_height - new_pos.y;
            vel.y = -abs(vel.y) * BOUNCE_DAMPING;
        }
    } else {
        // Shed particles: toroidal wrap
        if (new_pos.x < 0.0) { new_pos.x += params.canvas_width; }
        else if (new_pos.x > params.canvas_width) { new_pos.x -= params.canvas_width; }
        if (new_pos.y < 0.0) { new_pos.y += params.canvas_height; }
        else if (new_pos.y > params.canvas_height) { new_pos.y -= params.canvas_height; }
    }

    p.pos_vel = vec4(new_pos, vel);
    particles[idx] = p;
}
