// input.js — Keyboard, mouse, fullscreen, cursor auto-hide

const CURSOR_HIDE_DELAY = 3000; // ms

export class Input {
  /** @type {Config} */
  #config;
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {Function|null} */
  #onPause = null;
  /** @type {Function|null} */
  #onRestart = null;
  /** @type {Function|null} */
  #onToggleUI = null;

  mouseX = 0;
  mouseY = 0;
  paused = false;

  #cursorTimer = null;

  constructor(canvas, config) {
    this.#canvas = canvas;
    this.#config = config;
    this.#bindKeyboard();
    this.#bindMouse();
    this.#startCursorHide();
  }

  onPause(fn) { this.#onPause = fn; }
  onRestart(fn) { this.#onRestart = fn; }
  onToggleUI(fn) { this.#onToggleUI = fn; }

  #bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.paused = !this.paused;
          if (this.#onPause) this.#onPause(this.paused);
          break;

        case 'KeyH':
          if (this.#onToggleUI) this.#onToggleUI();
          break;

        case 'KeyF':
          this.#toggleFullscreen();
          break;

        case 'KeyR':
          if (this.#onRestart) this.#onRestart();
          break;

        case 'Escape':
          this.#showCursor();
          break;
      }
    });
  }

  #bindMouse() {
    const dpr = window.devicePixelRatio || 1;

    this.#canvas.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX * dpr;
      this.mouseY = e.clientY * dpr;
      this.#showCursor();
      this.#resetCursorTimer();
    });

    this.#canvas.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) {
        this.mouseX = t.clientX * dpr;
        this.mouseY = t.clientY * dpr;
      }
    }, { passive: true });
  }

  #toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.#canvas.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  #startCursorHide() {
    this.#resetCursorTimer();
  }

  #resetCursorTimer() {
    clearTimeout(this.#cursorTimer);
    this.#cursorTimer = setTimeout(() => {
      this.#canvas.style.cursor = 'none';
    }, CURSOR_HIDE_DELAY);
  }

  #showCursor() {
    this.#canvas.style.cursor = '';
    this.#resetCursorTimer();
  }

  destroy() {
    clearTimeout(this.#cursorTimer);
  }
}
