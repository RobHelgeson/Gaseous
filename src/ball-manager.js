// ball-manager.js — CPU-side ball state: positions, velocities, wall bounce, GPU upload

import { getActiveTheme } from './themes/theme-registry.js';

const MAX_BALLS = 5;
const BALL_BYTE_SIZE = 48; // matches BallData struct: 2+2+3+1+1+1+1+1 = 12 floats
const SOFTENING = 10000;   // gravity softening (pixels^2) to prevent singularities

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
    const palette = getActiveTheme().colors.palette;
    const shuffled = [...palette].sort(() => Math.random() - 0.5);

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
        mass: particlesPerBall * 2.0,
        radius,
        particleStart: i * particlesPerBall,
        particleCount: particlesPerBall,
      });
    }
  }

  /** Step ball positions (Euler + inter-ball gravity + wall bounce) */
  update(dt, bounceDamping, gravityConstant) {
    // Inter-ball gravity
    for (let i = 0; i < this.#balls.length; i++) {
      const a = this.#balls[i];
      for (let j = i + 1; j < this.#balls.length; j++) {
        const b = this.#balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + SOFTENING;
        const dist = Math.sqrt(dist2);
        const f = gravityConstant / (dist2 * dist);
        const fx = f * dx;
        const fy = f * dy;
        a.vx += fx * b.mass * dt;
        a.vy += fy * b.mass * dt;
        b.vx -= fx * a.mass * dt;
        b.vy -= fy * a.mass * dt;
      }
    }

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
