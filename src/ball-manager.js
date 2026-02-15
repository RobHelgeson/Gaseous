// ball-manager.js — CPU-side ball state: positions, velocities, wall bounce, GPU upload

const MAX_BALLS = 5;
const BALL_BYTE_SIZE = 48; // matches BallData struct: 2+2+3+1+1+1+1+1 = 12 floats

const PALETTE = [
  [0.9, 0.2, 0.4],  // Ruby
  [0.2, 0.4, 0.9],  // Sapphire
  [0.1, 0.8, 0.5],  // Emerald
  [0.8, 0.3, 0.9],  // Amethyst
  [0.9, 0.7, 0.1],  // Topaz
  [0.1, 0.7, 0.9],  // Aquamarine
];

export class BallManager {
  #balls = [];
  #canvasW = 0;
  #canvasH = 0;

  constructor(ballCount, particleCount, canvasW, canvasH) {
    this.#canvasW = canvasW;
    this.#canvasH = canvasH;
    this.respawn(ballCount, particleCount);
  }

  /** Create a fresh set of balls */
  respawn(ballCount, particleCount) {
    this.#balls = [];
    const particlesPerBall = Math.floor(particleCount / ballCount);
    const area = this.#canvasW * this.#canvasH;
    const scaleFactor = 0.15;

    // Shuffle palette for no-repeat color selection
    const shuffled = [...PALETTE].sort(() => Math.random() - 0.5);

    for (let i = 0; i < ballCount; i++) {
      // Spawn along edges with inward velocity
      const edge = Math.floor(Math.random() * 4);
      let x, y, vx, vy;
      const speed = 80 + Math.random() * 60;

      switch (edge) {
        case 0: // top
          x = Math.random() * this.#canvasW;
          y = 50;
          vx = (Math.random() - 0.5) * speed;
          vy = speed;
          break;
        case 1: // bottom
          x = Math.random() * this.#canvasW;
          y = this.#canvasH - 50;
          vx = (Math.random() - 0.5) * speed;
          vy = -speed;
          break;
        case 2: // left
          x = 50;
          y = Math.random() * this.#canvasH;
          vx = speed;
          vy = (Math.random() - 0.5) * speed;
          break;
        default: // right
          x = this.#canvasW - 50;
          y = Math.random() * this.#canvasH;
          vx = -speed;
          vy = (Math.random() - 0.5) * speed;
          break;
      }

      const radius = Math.sqrt(area / ballCount) * scaleFactor;

      this.#balls.push({
        x, y, vx, vy,
        color: shuffled[i % shuffled.length],
        attractorStrength: 1.0,
        mass: particlesPerBall * 0.5,
        radius,
        particleStart: i * particlesPerBall,
        particleCount: particlesPerBall,
      });
    }
  }

  /** Step ball positions (Euler + wall bounce) */
  update(dt, bounceDamping) {
    for (const b of this.#balls) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Wall bounce
      if (b.x < b.radius) {
        b.x = b.radius;
        b.vx = Math.abs(b.vx) * bounceDamping;
      } else if (b.x > this.#canvasW - b.radius) {
        b.x = this.#canvasW - b.radius;
        b.vx = -Math.abs(b.vx) * bounceDamping;
      }
      if (b.y < b.radius) {
        b.y = b.radius;
        b.vy = Math.abs(b.vy) * bounceDamping;
      } else if (b.y > this.#canvasH - b.radius) {
        b.y = this.#canvasH - b.radius;
        b.vy = -Math.abs(b.vy) * bounceDamping;
      }
    }
  }

  /** Pack ball data into ArrayBuffer matching BallData struct */
  toGpuData() {
    const buf = new ArrayBuffer(MAX_BALLS * BALL_BYTE_SIZE);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    const STRIDE = BALL_BYTE_SIZE / 4; // 12 floats per ball

    for (let i = 0; i < this.#balls.length; i++) {
      const b = this.#balls[i];
      const base = i * STRIDE;
      f32[base + 0] = b.x;
      f32[base + 1] = b.y;
      f32[base + 2] = b.vx;
      f32[base + 3] = b.vy;
      f32[base + 4] = b.color[0];
      f32[base + 5] = b.color[1];
      f32[base + 6] = b.color[2];
      f32[base + 7] = b.attractorStrength;
      f32[base + 8] = b.mass;
      f32[base + 9] = b.radius;
      u32[base + 10] = b.particleStart;
      u32[base + 11] = b.particleCount;
    }

    return buf;
  }

  updateCanvasSize(w, h) {
    this.#canvasW = w;
    this.#canvasH = h;
  }

  get balls() { return this.#balls; }
  get count() { return this.#balls.length; }
}
