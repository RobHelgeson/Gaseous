// cycle-manager.js — Autonomous cycle state machine: spawn, simulate, detect mixing, fade, repeat

const MIN_ACTIVE_TIME = 10;       // seconds before homogeneity can trigger transition
const FADE_OUT_DURATION = 3;      // seconds for old particles to fade out
const FADE_IN_DURATION = 2;       // seconds for new particles to fade in
const HOMOG_CHECK_INTERVAL = 30;  // frames between homogeneity checks

export class CycleManager {
  #state = 'SPAWNING';
  #timer = 0;
  #fadeAlpha = 0;
  #homogeneityValue = 1.0;
  #config;
  #ballManager;
  #onRespawn;

  constructor(config, ballManager, onRespawn) {
    this.#config = config;
    this.#ballManager = ballManager;
    this.#onRespawn = onRespawn;
  }

  get fadeAlpha() { return this.#fadeAlpha; }
  get state() { return this.#state; }

  /** Advance the cycle state machine. Call once per frame. */
  update(dt) {
    this.#timer += dt;

    switch (this.#state) {
      case 'SPAWNING':
        // Fade in new particles
        this.#fadeAlpha = Math.min(this.#timer / FADE_IN_DURATION, 1.0);
        if (this.#timer >= FADE_IN_DURATION) {
          this.#state = 'ACTIVE';
          this.#timer = 0;
          this.#fadeAlpha = 1.0;
        }
        break;

      case 'ACTIVE':
        this.#fadeAlpha = 1.0;
        // Transition when colors are well-mixed (after minimum active time)
        if (this.#timer >= MIN_ACTIVE_TIME &&
            this.#homogeneityValue < this.#config.get('homogeneityThreshold')) {
          console.log(`Cycle: mixed (variance=${this.#homogeneityValue.toFixed(4)}), fading out`);
          this.#state = 'FADING';
          this.#timer = 0;
        }
        break;

      case 'FADING':
        // Fade out all particles
        this.#fadeAlpha = Math.max(1.0 - this.#timer / FADE_OUT_DURATION, 0.0);
        if (this.#timer >= FADE_OUT_DURATION) {
          this.#doRespawn();
        }
        break;
    }
  }

  /** Returns true if a homogeneity check should run this frame */
  shouldCheckHomogeneity(frameNumber) {
    return this.#state === 'ACTIVE' && frameNumber % HOMOG_CHECK_INTERVAL === 0;
  }

  /** Receive async homogeneity readback result */
  onHomogeneityResult(value) {
    if (value !== null && value !== undefined) {
      this.#homogeneityValue = value;
    }
  }

  /** Immediately restart the cycle (R key) */
  restart() {
    this.#doRespawn();
  }

  #doRespawn() {
    this.#ballManager.respawn(
      this.#config.get('ballCount'),
      this.#config.get('particleCount'),
    );
    this.#homogeneityValue = 1.0;
    this.#state = 'SPAWNING';
    this.#timer = 0;
    this.#fadeAlpha = 0;
    console.log('Cycle: respawning');
    if (this.#onRespawn) this.#onRespawn();
  }
}
