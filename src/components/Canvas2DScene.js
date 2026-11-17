const MAX_FILE_SIZE = 50 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(['image/png', 'image/webp', 'image/jpeg']);

function assetSize(asset) {
  return asset?.sourceFile?.size || asset?.blob?.size || 0;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Görsel okunamadı.')); };
    image.src = url;
  });
}

export class Canvas2DScene {
  static DEFAULT_LAYER_ID = 'layer-0';

  constructor(canvas, { onChange = () => {}, viewport = null } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.onChange = onChange;
    this.layers = [];
    this.sprites = [];
    this.selected = null;
    this.nextLayerId = 0;
    this.nextSpriteId = 1;
    this.background = '#101114';
    this.grid = { enabled: false, size: 32, snap: false, color: '#2b313d' };
    this.bounds = { enabled: true, collision: false, spacing: 0 };
    this.width = Number.isFinite(Number(viewport?.width)) ? Math.max(64, Math.min(8192, Math.round(Number(viewport.width)))) : 1;
    this.height = Number.isFinite(Number(viewport?.height)) ? Math.max(64, Math.min(8192, Math.round(Number(viewport.height)))) : 1;
    this.customViewport = Boolean(viewport?.width && viewport?.height);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!this.customViewport) {
      this.width = Math.max(1, Math.floor(rect.width || window.innerWidth));
      this.height = Math.max(1, Math.floor(rect.height || window.innerHeight));
    }
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  setViewport(width, height) {
    const nextWidth = Number(width);
    const nextHeight = Number(height);
    if (!Number.isInteger(nextWidth) || !Number.isInteger(nextHeight) || nextWidth < 64 || nextHeight < 64 || nextWidth > 8192 || nextHeight > 8192) {
      throw new Error('2D sahne boyutu 64–8192 piksel arasında tam sayı olmalı.');
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.customViewport = true;
    for (const item of [...this.layers, ...this.sprites]) {
      const isSprite = item.displayHeight !== undefined;
      const halfWidth = isSprite ? this._spriteDimensions(item).width / 2 : item.width / 2;
      const halfHeight = isSprite ? this._spriteDimensions(item).height / 2 : item.height / 2;
      item.x = Math.max(halfWidth, Math.min(this.width - halfWidth, item.x));
      item.y = Math.max(halfHeight, Math.min(this.height - halfHeight, item.y));
    }
    this.resize();
    this._changed('viewport-changed');
  }

  async addLayer(file, options = {}) {
    this._validateFile(file);
    const image = await loadImage(file);
    const id = options.id || this._nextLayerId();
    const layer = {
      id,
      name: String(options.name || file.name || 'Katman').replace(/\.(png|webp|jpe?g)$/i, '').slice(0, 48) || 'Katman',
      image,
      sourceFile: file,
      x: Number.isFinite(Number(options.x)) ? Number(options.x) : this.width / 2,
      y: Number.isFinite(Number(options.y)) ? Number(options.y) : this.height / 2,
      width: Number.isFinite(Number(options.width)) ? Math.max(1, Number(options.width)) : Math.min(this.width * 0.8, image.naturalWidth),
      height: Number.isFinite(Number(options.height)) ? Math.max(1, Number(options.height)) : Math.min(this.height * 0.8, image.naturalHeight),
      opacity: Number.isFinite(Number(options.opacity)) ? Math.max(0, Math.min(1, Number(options.opacity))) : 1,
      visible: options.visible !== false,
      locked: options.locked === true,
      order: Number.isInteger(options.order) ? options.order : this.layers.length,
    };
    this.layers.push(layer);
    this.layers.sort((a, b) => a.order - b.order);
    this._reorderLayers();
    this.selected = { type: 'layer', id };
    this._changed('layer-added');
    return id;
  }

  async addSprite(file, { columns = 1, rows = 1, fps = 12, ...options } = {}) {
    this._validateFile(file);
    const image = await loadImage(file);
    columns = Number(columns); rows = Number(rows); fps = Number(fps);
    if (!Number.isInteger(columns) || columns < 1 || columns > 64 || !Number.isInteger(rows) || rows < 1 || rows > 64 || columns * rows > 4096) throw new Error('Spritesheet satır/sütun bilgisi geçersiz.');
    if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('Spritesheet FPS değeri 1–60 arasında olmalı.');
    const id = options.id || `sprite-${this.nextSpriteId++}`;
    const frameWidth = image.naturalWidth / columns;
    const frameHeight = image.naturalHeight / rows;
    if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight)) throw new Error('Görsel boyutları satır ve sütunlara tam bölünmeli.');
    const displayHeight = Number.isFinite(Number(options.displayHeight)) ? Number(options.displayHeight) : Math.min(180, Math.max(32, frameHeight));
    const sprite = {
      id,
      layerId: options.layerId || Canvas2DScene.DEFAULT_LAYER_ID,
      name: String(options.name || file.name || 'Spritesheet').replace(/\.(png|webp|jpe?g)$/i, '').slice(0, 48) || 'Spritesheet',
      image,
      sourceFile: file,
      frameFiles: [file],
      frames: [image],
      sequence: false,
      columns, rows, fps,
      frameCount: columns * rows,
      character: options.character === true,
      frame: 0,
      elapsed: 0,
      x: Number.isFinite(Number(options.x)) ? Number(options.x) : this.width / 2,
      y: Number.isFinite(Number(options.y)) ? Number(options.y) : this.height / 2,
      displayHeight,
      isPlaying: false,
      loop: true,
      locked: options.locked === true,
    };
    this.sprites.push(sprite);
    this.selected = { type: 'sprite', id };
    this._changed('sprite-added');
    return id;
  }

  async addSpriteSequence(files, { fps = 12, preset = 'loop', ...options } = {}) {
    const sources = Array.from(files || []);
    if (sources.length < 2 || sources.length > 256) throw new Error('Aynı karakter için 2–256 görsel seçin.');
    sources.forEach((file) => this._validateFile(file));
    fps = Number(fps);
    if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('Animasyon FPS değeri 1–60 arasında olmalı.');
    const frames = await Promise.all(sources.map(loadImage));
    const width = frames[0].naturalWidth; const height = frames[0].naturalHeight;
    if (frames.some((frame) => frame.naturalWidth !== width || frame.naturalHeight !== height)) throw new Error('Karakter karelerinin görsel boyutları aynı olmalı.');
    const id = options.id || `sprite-${this.nextSpriteId++}`;
    const displayHeight = Number.isFinite(Number(options.displayHeight)) ? Number(options.displayHeight) : Math.min(180, Math.max(32, height));
    const animationPreset = ['loop', 'once', 'ping-pong'].includes(preset) ? preset : 'loop';
    const sprite = { id, layerId: options.layerId || Canvas2DScene.DEFAULT_LAYER_ID, name: String(options.name || sources[0].name || 'Karakter animasyonu').replace(/\.(png|webp|jpe?g)$/i, '').slice(0, 48) || 'Karakter animasyonu', image: frames[0], frames, sourceFile: sources[0], frameFiles: sources, sequence: true, columns: 1, rows: 1, fps, preset: animationPreset, frameCount: frames.length, character: options.character === true, frame: 0, direction: 1, elapsed: 0, x: Number.isFinite(Number(options.x)) ? Number(options.x) : this.width / 2, y: Number.isFinite(Number(options.y)) ? Number(options.y) : this.height / 2, displayHeight, isPlaying: false, locked: options.locked === true, loop: animationPreset !== 'once' };
    this.sprites.push(sprite); this.selected = { type: 'sprite', id }; this._changed('sprite-sequence-added'); return id;
  }

  async loadRecord(record) {
    this.layers = [];
    this.sprites = [];
    for (const layer of record.layers || []) await this.addLayer(this._assetToFile(layer), layer);
    for (const sprite of record.sprites || []) {
      if (Array.isArray(sprite.frames) && sprite.frames.length > 1) await this.addSpriteSequence(sprite.frames.map((frame) => this._assetToFile(frame)), { ...sprite, preset: sprite.preset || 'loop' });
      else await this.addSprite(this._assetToFile(sprite), sprite);
    }
    this.selected = null;
    this.render();
    this._changed('loaded');
  }

  async exportAssetsForStorage() {
    return this.layers.map((layer) => ({ id: layer.id, name: layer.name, mimeType: layer.sourceFile.type, fileName: layer.sourceFile.name, blob: layer.sourceFile.slice(0, layer.sourceFile.size, layer.sourceFile.type), x: layer.x, y: layer.y, width: layer.width, height: layer.height, visible: layer.visible, locked: layer.locked === true, opacity: layer.opacity, order: layer.order }));
  }

  async exportSpriteAssetsForStorage() {
    return this.sprites.map((sprite) => ({ id: sprite.id, layerId: sprite.layerId, name: sprite.name, character: sprite.character === true, columns: sprite.columns, rows: sprite.rows, fps: sprite.fps, preset: sprite.preset || 'loop', x: sprite.x, y: sprite.y, displayHeight: sprite.displayHeight, locked: sprite.locked === true, mimeType: sprite.sourceFile.type, fileName: sprite.sourceFile.name, blob: sprite.sourceFile.slice(0, sprite.sourceFile.size, sprite.sourceFile.type), ...(sprite.sequence ? { frames: sprite.frameFiles.map((file) => ({ mimeType: file.type, fileName: file.name, blob: file.slice(0, file.size, file.type) })) } : {}) }));
  }

  update(delta) {
    for (const sprite of this.sprites) {
      if (!sprite.isPlaying) continue;
      sprite.elapsed += delta;
      const frame = Math.floor(sprite.elapsed * sprite.fps);
      if (sprite.preset === 'ping-pong') {
        const cycle = Math.max(1, sprite.frameCount * 2 - 2);
        const position = frame % cycle;
        sprite.frame = position < sprite.frameCount ? position : cycle - position;
        continue;
      }
      if (frame >= sprite.frameCount) {
        if (!sprite.loop) { sprite.frame = sprite.frameCount - 1; sprite.isPlaying = false; }
        else { sprite.elapsed %= sprite.frameCount / sprite.fps; sprite.frame = frame % sprite.frameCount; }
      } else sprite.frame = frame;
    }
  }

  render() {
    const ctx = this.context;
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, this.width, this.height);
    for (const layer of this.layers) this._drawImage(layer, layer.visible, layer.opacity, layer.image, layer.x, layer.y, layer.width, layer.height);
    for (const sprite of this.sprites) {
      const frameImage = sprite.sequence ? sprite.frames[sprite.frame] : sprite.image;
      const frameWidth = sprite.sequence ? frameImage.naturalWidth : sprite.image.naturalWidth / sprite.columns;
      const frameHeight = sprite.sequence ? frameImage.naturalHeight : sprite.image.naturalHeight / sprite.rows;
      const column = sprite.frame % sprite.columns;
      const row = Math.floor(sprite.frame / sprite.columns);
      const width = sprite.displayHeight * frameWidth / frameHeight;
      this._drawImage(sprite, true, 1, frameImage, sprite.x, sprite.y, width, sprite.displayHeight, sprite.sequence ? 0 : column * frameWidth, sprite.sequence ? 0 : row * frameHeight, frameWidth, frameHeight);
    }
    if (this.grid.enabled) this._drawGrid();
    if (this.selected) this._drawSelection(this.selected);
    ctx.restore();
  }

  hitTest(x, y) {
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const sprite = this.sprites[i];
      const frameImage = sprite.sequence ? sprite.frames[sprite.frame] : sprite.image;
      const width = sprite.displayHeight * (sprite.sequence ? frameImage.naturalWidth / frameImage.naturalHeight : (sprite.image.naturalWidth / sprite.columns) / (sprite.image.naturalHeight / sprite.rows));
      if (this._inside(x, y, sprite.x, sprite.y, width, sprite.displayHeight)) return { type: 'sprite', id: sprite.id };
    }
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (layer.visible && this._inside(x, y, layer.x, layer.y, layer.width, layer.height)) return { type: 'layer', id: layer.id };
    }
    return null;
  }

  select(target) { this.selected = target; this.render(); this._changed('selected'); }
  setSelectedPosition(x, y) { const item = this._selected(); if (!item || item.locked) return; const dimensions = item.displayHeight !== undefined ? this._spriteDimensions(item) : { width: item.width, height: item.height }; const snap = (value) => this.grid.snap ? Math.round(Number(value) / this.grid.size) * this.grid.size : Number(value); const nextX = this.bounds.enabled ? Math.max(dimensions.width / 2, Math.min(this.width - dimensions.width / 2, snap(x))) : snap(x); const nextY = this.bounds.enabled ? Math.max(dimensions.height / 2, Math.min(this.height - dimensions.height / 2, snap(y))) : snap(y); if (this.bounds.collision && item.displayHeight !== undefined && this.sprites.some((other) => other !== item && this._rectsOverlap(nextX, nextY, dimensions.width, dimensions.height, other.x, other.y, this._spriteDimensions(other).width, this._spriteDimensions(other).height))) return; item.x = nextX; item.y = nextY; this.render(); this._changed('transformed'); }
  setSelectedOpacity(opacity) { const item = this._selected(); if (!item || item.type === 'sprite' || item.locked) return; item.opacity = Math.max(0, Math.min(1, Number(opacity))); this.render(); this._changed('opacity'); }
  updateSelectedTransform(values = {}) { const item = this._selected(); if (!item || item.locked) return false; const dimensions = item.displayHeight !== undefined ? this._spriteDimensions(item) : item; if (Number.isFinite(Number(values.x))) item.x = Number(values.x); if (Number.isFinite(Number(values.y))) item.y = Number(values.y); if (item.displayHeight !== undefined && Number.isFinite(Number(values.height))) item.displayHeight = Math.max(1, Number(values.height)); if (item.displayHeight === undefined) { if (Number.isFinite(Number(values.width))) item.width = Math.max(1, Number(values.width)); if (Number.isFinite(Number(values.height))) item.height = Math.max(1, Number(values.height)); } if (this.bounds.enabled) this.setSelectedPosition(item.x, item.y); else { this.render(); this._changed('transformed'); } return true; }
  setSelectedLocked(locked) { const item = this._selected(); if (!item) return false; item.locked = Boolean(locked); this.render(); this._changed('locked'); return true; }
  setGrid({ enabled = this.grid.enabled, size = this.grid.size, snap = this.grid.snap } = {}) { this.grid.enabled = Boolean(enabled); this.grid.size = Math.max(4, Math.min(256, Number(size) || 32)); this.grid.snap = Boolean(snap); this.render(); this._changed('grid'); }
  setBounds({ enabled = this.bounds.enabled, collision = this.bounds.collision, spacing = this.bounds.spacing } = {}) { this.bounds.enabled = Boolean(enabled); this.bounds.collision = Boolean(collision); this.bounds.spacing = Math.max(0, Math.min(256, Number(spacing) || 0)); this.render(); this._changed('bounds'); }
  reorderSelected(direction) { const item = this._selected(); if (!item || item.type !== 'layer' || item.locked) return false; const index = this.layers.indexOf(item); const next = index + direction; if (next < 0 || next >= this.layers.length) return false; [this.layers[index], this.layers[next]] = [this.layers[next], this.layers[index]]; this._reorderLayers(); this.render(); this._changed('reordered'); return true; }
  getEditorState() { return { grid: { ...this.grid }, bounds: { ...this.bounds } }; }
  applyEditorState(state = {}) { if (state.grid) this.setGrid(state.grid); if (state.bounds) this.setBounds(state.bounds); }
  exportFrame(type = 'image/png', quality) { return this.canvas.toDataURL(type, quality); }
  removeSelected() { const item = this._selected(); if (!item) return false; if (item.type === 'layer') this.layers = this.layers.filter((entry) => entry.id !== item.id); else this.sprites = this.sprites.filter((entry) => entry.id !== item.id); this.selected = null; this.render(); this._changed('removed'); return true; }
  playSprite(id) { const sprite = this.sprites.find((entry) => entry.id === id); if (!sprite) return false; sprite.isPlaying = true; sprite.elapsed = 0; sprite.frame = 0; this._changed('playing'); return true; }
  setLayerVisible(id, visible) { const layer = this.layers.find((entry) => entry.id === id); if (!layer) return false; layer.visible = Boolean(visible); this.render(); this._changed('visibility'); return true; }

  list() { return [...this.layers.map((item) => ({ type: 'layer', id: item.id, name: item.name, x: item.x, y: item.y, width: item.width, height: item.height, opacity: item.opacity, visible: item.visible, locked: item.locked === true, order: item.order })), ...this.sprites.map((item) => ({ type: 'sprite', character: item.character === true, id: item.id, name: item.name, x: item.x, y: item.y, displayHeight: item.displayHeight, playing: item.isPlaying, locked: item.locked === true }))]; }

  _assetToFile(asset) {
    if (asset.blob instanceof Blob) return new File([asset.blob], asset.fileName || `${asset.name || 'asset'}.png`, { type: asset.mimeType || asset.blob.type || 'image/png' });
    const binary = atob(asset.data || '');
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new File([bytes], asset.fileName || `${asset.name || 'asset'}.png`, { type: asset.mimeType || 'image/png' });
  }
  _validateFile(file) { if (!file || !SUPPORTED_TYPES.has(file.type) || !file.size || file.size > MAX_FILE_SIZE) throw new Error('PNG, WebP veya JPEG görsel seçin; dosya 50 MB altında olmalı.'); }
  _nextLayerId() { while (this.layers.some((layer) => layer.id === `layer-${this.nextLayerId}`)) this.nextLayerId++; return `layer-${this.nextLayerId++}`; }
  _selected() { if (!this.selected) return null; return this.selected.type === 'layer' ? this.layers.find((item) => item.id === this.selected.id) : this.sprites.find((item) => item.id === this.selected.id); }
  _inside(x, y, cx, cy, width, height) { return Math.abs(x - cx) <= width / 2 && Math.abs(y - cy) <= height / 2; }
  _rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) { const gap = this.bounds.spacing; return Math.abs(ax - bx) < (aw + bw) / 2 + gap && Math.abs(ay - by) < (ah + bh) / 2 + gap; }
  _spriteDimensions(sprite) { const frameImage = sprite.sequence ? sprite.frames[sprite.frame] : sprite.image; const frameWidth = sprite.sequence ? frameImage.naturalWidth : sprite.image.naturalWidth / sprite.columns; const frameHeight = sprite.sequence ? frameImage.naturalHeight : sprite.image.naturalHeight / sprite.rows; return { width: sprite.displayHeight * frameWidth / frameHeight, height: sprite.displayHeight }; }
  _drawImage(item, visible, opacity, image, x, y, width, height, sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight) { if (!visible) return; this.context.globalAlpha = opacity; this.context.drawImage(image, sx, sy, sw, sh, x - width / 2, y - height / 2, width, height); this.context.globalAlpha = 1; }
  _drawSelection(target) { const item = target.type === 'layer' ? this.layers.find((entry) => entry.id === target.id) : this.sprites.find((entry) => entry.id === target.id); if (!item) return; const frameImage = target.type === 'sprite' && item.sequence ? item.frames[item.frame] : item.image; const width = target.type === 'sprite' ? item.displayHeight * (item.sequence ? frameImage.naturalWidth / frameImage.naturalHeight : (item.image.naturalWidth / item.columns) / (item.image.naturalHeight / item.rows)) : item.width; const height = target.type === 'sprite' ? item.displayHeight : item.height; this.context.strokeStyle = '#f4f4f4'; this.context.lineWidth = 1; this.context.setLineDash([6, 4]); this.context.strokeRect(item.x - width / 2 - 4, item.y - height / 2 - 4, width + 8, height + 8); this.context.setLineDash([]); }
  _drawGrid() { const ctx = this.context; ctx.save(); ctx.strokeStyle = this.grid.color; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; for (let x = 0; x <= this.width; x += this.grid.size) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke(); } for (let y = 0; y <= this.height; y += this.grid.size) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke(); } ctx.restore(); }
  _reorderLayers() { this.layers.forEach((layer, index) => { layer.order = index; }); }
  _changed(type) { this.onChange({ type, selected: this.selected, items: this.list() }); }
}
