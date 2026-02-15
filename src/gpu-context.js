// gpu-context.js — WebGPU device/adapter initialization and canvas configuration

export class GpuContext {
  /** @type {GPUDevice} */
  device = null;
  /** @type {GPUCanvasContext} */
  ctx = null;
  /** @type {GPUTextureFormat} */
  format = 'bgra8unorm';
  /** @type {HTMLCanvasElement} */
  canvas = null;
  /** @type {boolean} */
  hasTimestampQuery = false;

  /**
   * Initialize WebGPU. Returns false if unsupported.
   * @param {HTMLCanvasElement} canvas
   */
  async init(canvas) {
    this.canvas = canvas;

    if (!navigator.gpu) {
      this.#showError();
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) {
      this.#showError();
      return false;
    }

    // Request timestamp-query if available (for adaptive performance)
    const features = [];
    if (adapter.features.has('timestamp-query')) {
      features.push('timestamp-query');
    }

    this.device = await adapter.requestDevice({
      requiredFeatures: features,
    });
    this.hasTimestampQuery = this.device.features.has('timestamp-query');

    this.device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message);
      if (info.reason !== 'destroyed') {
        // Attempt re-init
        this.init(canvas);
      }
    });

    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.ctx.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    this.#syncSize();
    return true;
  }

  /** Update canvas backing resolution to match display size */
  #syncSize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Call each frame to handle resize */
  handleResize() {
    const oldW = this.canvas.width;
    const oldH = this.canvas.height;
    this.#syncSize();
    return this.canvas.width !== oldW || this.canvas.height !== oldH;
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  #showError() {
    const overlay = document.getElementById('error-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  destroy() {
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
  }
}
