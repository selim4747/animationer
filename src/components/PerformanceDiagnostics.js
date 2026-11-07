const DEFAULT_UPDATE_INTERVAL_MS = 500;

function safeCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export class PerformanceDiagnostics {
  constructor({ onUpdate = () => {}, updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS, now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
    this.onUpdate = onUpdate;
    this.updateIntervalMs = Number.isFinite(updateIntervalMs) && updateIntervalMs >= 100 ? updateIntervalMs : DEFAULT_UPDATE_INTERVAL_MS;
    this.now = now;
    this.enabled = false;
    this._lastUpdateAt = null;
    this._frameCount = 0;
    this._frameTimeTotal = 0;
    this.snapshot = this._emptySnapshot();
  }

  _emptySnapshot() {
    return {
      enabled: this.enabled,
      fps: null,
      frameTimeMs: null,
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
      jsHeapUsedMB: null,
      jsHeapLimitMB: null,
    };
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this.enabled) return this.snapshot;
    this.enabled = next;
    this._lastUpdateAt = next ? this.now() : null;
    this._frameCount = 0;
    this._frameTimeTotal = 0;
    this.snapshot = this._emptySnapshot();
    this.onUpdate({ ...this.snapshot });
    return this.snapshot;
  }

  recordFrame(frameTimeMs, rendererInfo, now = this.now()) {
    if (!this.enabled) return false;
    const safeFrameTime = Number.isFinite(frameTimeMs) && frameTimeMs >= 0 ? frameTimeMs : 0;
    this._frameCount += 1;
    this._frameTimeTotal += safeFrameTime;
    if (this._lastUpdateAt === null) this._lastUpdateAt = now;
    const elapsed = Math.max(0, now - this._lastUpdateAt);
    if (elapsed < this.updateIntervalMs) return true;

    const averageFrameTime = this._frameCount ? this._frameTimeTotal / this._frameCount : 0;
    const memory = rendererInfo?.memory || {};
    const render = rendererInfo?.render || {};
    const jsMemory = globalThis.performance?.memory;
    this.snapshot = {
      enabled: true,
      fps: averageFrameTime > 0 ? 1000 / averageFrameTime : 0,
      frameTimeMs: averageFrameTime,
      drawCalls: safeCount(render.calls),
      triangles: safeCount(render.triangles),
      geometries: safeCount(memory.geometries),
      textures: safeCount(memory.textures),
      jsHeapUsedMB: Number.isFinite(jsMemory?.usedJSHeapSize) ? jsMemory.usedJSHeapSize / (1024 * 1024) : null,
      jsHeapLimitMB: Number.isFinite(jsMemory?.jsHeapSizeLimit) ? jsMemory.jsHeapSizeLimit / (1024 * 1024) : null,
    };
    this.onUpdate({ ...this.snapshot });
    this._lastUpdateAt = now;
    this._frameCount = 0;
    this._frameTimeTotal = 0;
    return true;
  }
}
