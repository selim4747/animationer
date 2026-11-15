import { Canvas2DScene } from './components/Canvas2DScene.js';
import { IndexedProjectStore, createAutosaveRecord, migrateProjectRecord } from './components/ProjectStore.js';

const store = new IndexedProjectStore();
const $ = (id) => document.getElementById(id);

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

class Pure2DApp {
  constructor(record) {
    this.record = record;
    this.projectId = record.projectId;
    this.scene = new Canvas2DScene($('scene-canvas'), { onChange: (state) => this.onSceneChange(state) });
    this.steps = Array.isArray(record.timeline?.steps) ? record.timeline.steps.filter((step) => ['WAIT', 'PLAY_SPRITE_ANIMATION', 'SET_LAYER_VISIBILITY'].includes(step.type)) : [];
    this.playing = false;
    this.drag = null;
    this._bind();
    this.scene.loadRecord(record).then(() => this.refresh()).catch((error) => this.toast(error.message));
    this._animate();
  }

  _bind() {
    addEventListener('resize', () => this.scene.resize());
    $('layer-picker').addEventListener('change', (event) => { void this._addLayer(event.target.files?.[0]); event.target.value = ''; });
    $('sprite-picker').addEventListener('change', (event) => { void this._addSprite(event.target.files?.[0]); event.target.value = ''; });
    $('btn-add-wait').addEventListener('click', () => { this.steps.push({ id: `step-${Date.now()}`, type: 'WAIT', title: '0.5 saniye bekle', data: { duration: 0.5 } }); this.refresh(); void this.save(); });
    $('btn-play').addEventListener('click', () => void this.playTimeline());
    $('btn-delete').addEventListener('click', () => { if (this.scene.removeSelected()) void this.save(); });
    $('btn-export').addEventListener('click', () => void this.exportProject());
    $('btn-save').addEventListener('click', () => void this.save());
    $('layer-visible').addEventListener('change', (event) => { const selected = this.scene.selected; if (selected?.type === 'layer') { this.scene.setLayerVisible(selected.id, event.target.checked); void this.save(); } });
    $('layer-opacity').addEventListener('input', (event) => { this.scene.setSelectedOpacity(Number(event.target.value)); });
    $('layer-opacity').addEventListener('change', () => void this.save());
    $('scene-canvas').addEventListener('pointerdown', (event) => { const point = this._point(event); const target = this.scene.hitTest(point.x, point.y); this.scene.select(target); this.drag = target ? { target, offsetX: point.x - this.scene._selected().x, offsetY: point.y - this.scene._selected().y } : null; event.currentTarget.setPointerCapture(event.pointerId); });
    $('scene-canvas').addEventListener('pointermove', (event) => { if (!this.drag) return; const point = this._point(event); this.scene.setSelectedPosition(point.x - this.drag.offsetX, point.y - this.drag.offsetY); });
    $('scene-canvas').addEventListener('pointerup', () => { if (this.drag) void this.save(); this.drag = null; });
  }

  async _addLayer(file) { if (!file) return; try { await this.scene.addLayer(file); this.refresh(); await this.save(); } catch (error) { this.toast(error.message); } }
  async _addSprite(file) { if (!file) return; try { await this.scene.addSprite(file, { columns: Number($('sprite-columns').value), rows: Number($('sprite-rows').value), fps: Number($('sprite-fps').value) }); this.refresh(); await this.save(); } catch (error) { this.toast(error.message); } }

  async playTimeline() {
    if (this.playing || !this.steps.length) return;
    this.playing = true; this.refresh();
    try {
      for (const step of this.steps) {
        if (step.type === 'WAIT') await new Promise((resolve) => setTimeout(resolve, Math.max(0.05, Math.min(30, Number(step.data?.duration) || 0.5)) * 1000));
        if (step.type === 'PLAY_SPRITE_ANIMATION') this.scene.playSprite(step.actorId);
        if (step.type === 'SET_LAYER_VISIBILITY') this.scene.setLayerVisible(step.layerId || step.actorId, step.data?.visible !== false);
      }
    } finally { this.playing = false; this.refresh(); }
  }

  async save() {
    try {
      const layers = await this.scene.exportAssetsForStorage();
      const sprites = await this.scene.exportSpriteAssetsForStorage();
      const next = createAutosaveRecord({ projectId: this.projectId, name: this.record.name, projectTemplate: 'blank', timeline: { version: '2d-only', playMode: 'sequential', steps: this.steps }, sprites, layers, viewport: { width: this.scene.width, height: this.scene.height }, skyColor: this.scene.background, characters3d: [], selectedCharacter3dId: null, worldCharacterTemplates: [], worldCharacters: [], wallBoxes: [], cameraStations: [], sceneEdits: [], mapAsset: null });
      this.record = await store.saveProject(this.projectId, next);
      this.setStatus('Kaydedildi');
    } catch (error) { this.toast(`Kayıt başarısız: ${error.message}`); }
  }

  async exportProject() {
    const layers = await this.scene.exportAssetsForStorage();
    const sprites = await this.scene.exportSpriteAssetsForStorage();
    const portable = async (asset) => ({ ...asset, blob: undefined, data: await blobToBase64(asset.blob) });
    const payload = { ...(await createAutosaveRecord({ projectId: this.projectId, name: this.record.name, projectTemplate: 'blank', timeline: { version: '2d-only', playMode: 'sequential', steps: this.steps }, sprites, layers, viewport: { width: this.scene.width, height: this.scene.height }, characters3d: [], worldCharacterTemplates: [], worldCharacters: [], wallBoxes: [], cameraStations: [], sceneEdits: [], mapAsset: null })), sprites: await Promise.all(sprites.map(portable)), layers: await Promise.all(layers.map(portable)) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${this.record.name || 'animationer-2d'}.json`; link.click(); URL.revokeObjectURL(link.href);
    this.setStatus('2D proje dışa aktarıldı');
  }

  refresh() {
    $('item-list').replaceChildren(...this.scene.list().map((item) => { const li = document.createElement('li'); li.textContent = `${item.type === 'layer' ? 'Katman' : 'Spritesheet'} · ${item.name}`; li.dataset.id = item.id; li.dataset.type = item.type; li.className = this.scene.selected?.id === item.id ? 'selected' : ''; li.addEventListener('click', () => { this.scene.select({ type: item.type, id: item.id }); this.refresh(); }); return li; }));
    $('timeline-list').replaceChildren(...this.steps.map((step) => { const li = document.createElement('li'); li.textContent = step.title || step.type; return li; }));
    const selected = this.scene._selected();
    $('layer-visible').checked = selected?.visible !== false;
    $('layer-opacity').value = String(selected?.opacity ?? 1);
    $('btn-play').textContent = this.playing ? 'Oynatılıyor…' : 'Timeline’ı oynat';
  }

  onSceneChange() { this.scene.render(); this.refresh(); }
  _point(event) { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  _animate() { let last = performance.now(); const tick = (now) => { const delta = Math.min(0.1, (now - last) / 1000); last = now; this.scene.update(delta); this.scene.render(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  setStatus(message) { $('status').textContent = message; clearTimeout(this.statusTimer); this.statusTimer = setTimeout(() => { $('status').textContent = 'Hazır'; }, 1800); }
  toast(message) { $('status').textContent = message; }
}

async function boot() {
  let id = sessionStorage.getItem('animationer-open-project');
  let record = id ? await store.loadProject(id).catch(() => null) : null;
  if (!record) {
    record = await store.createProject('Yeni 2D Sahne', { template: 'blank' });
    id = record.projectId;
  }
  sessionStorage.removeItem('animationer-open-project');
  $('project-name').textContent = record.name;
  window.animationerApp = new Pure2DApp(migrateProjectRecord(record));
}

addEventListener('DOMContentLoaded', () => { void boot(); });
