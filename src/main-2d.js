import { Canvas2DScene } from './components/Canvas2DScene.js';
import { IndexedProjectStore, createAutosaveRecord, migrateProjectRecord } from './components/ProjectStore.js';
const store = new IndexedProjectStore();
const $ = (id) => document.getElementById(id);
function newId(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`; }
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
class Pure2DApp {
  constructor(record) {
    this.record = record; this.projectId = record.projectId; this.library = []; this.selectedCharacterId = null; this.drag = null; this.playing = false;
    this.scene = new Canvas2DScene($('scene-canvas'), { viewport: record.viewport || { width: 1280, height: 720 }, onChange: () => this.onSceneChange() });
    this.steps = Array.isArray(record.timeline?.steps) ? record.timeline.steps.filter((step) => ['WAIT', 'PLAY_SPRITE_ANIMATION', 'SET_LAYER_VISIBILITY'].includes(step.type)) : [];
    this._bind(); this.scene.loadRecord(record).then(() => this.refresh()).catch((error) => this.toast(error.message)); this.loadLibrary(); this._animate();
  }
  _bind() {
    addEventListener('resize', () => this.scene.resize());
    $('layer-picker').addEventListener('change', (event) => { void this._addLayer(event.target.files?.[0]); event.target.value = ''; });
    $('sprite-picker').addEventListener('change', (event) => { void this._addSprite(event.target.files); event.target.value = ''; });
    $('character-picker').addEventListener('change', (event) => { void this._createCharacter(event.target.files); event.target.value = ''; });
    $('character-visual-picker').addEventListener('change', (event) => { void this._addCharacterVisuals(event.target.files); event.target.value = ''; });
    $('btn-save-character-animation').addEventListener('click', () => void this._saveCharacterAnimation());
    $('btn-add-character-animation').addEventListener('click', () => void this._addLibraryAnimationToScene());
    $('character-animation-select').addEventListener('change', () => this._syncAnimationForm());
    $('btn-add-wait').addEventListener('click', () => { this.steps.push({ id: newId('step'), type: 'WAIT', title: '0.5 saniye bekle', data: { duration: 0.5 } }); this.refresh(); void this.save(); });
    $('btn-play').addEventListener('click', () => void this.playTimeline()); $('btn-delete').addEventListener('click', () => { if (this.scene.removeSelected()) void this.save(); });
    $('btn-export').addEventListener('click', () => void this.exportProject()); $('btn-save').addEventListener('click', () => void this.save()); $('btn-apply-viewport').addEventListener('click', () => void this._applyViewport());
    $('layer-visible').addEventListener('change', (event) => { const selected = this.scene.selected; if (selected?.type === 'layer') { this.scene.setLayerVisible(selected.id, event.target.checked); void this.save(); } });
    $('layer-opacity').addEventListener('input', (event) => this.scene.setSelectedOpacity(Number(event.target.value))); $('layer-opacity').addEventListener('change', () => void this.save());
    $('scene-canvas').tabIndex = 0; $('scene-canvas').addEventListener('keydown', (event) => { if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; const selected = this.scene._selected(); if (!selected) return; const amount = event.shiftKey ? 10 : 2; const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0; const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0; this.scene.setSelectedPosition(selected.x + dx, selected.y + dy); event.preventDefault(); void this.save(); }); $('scene-canvas').addEventListener('pointerdown', (event) => { const point = this._point(event); const target = this.scene.hitTest(point.x, point.y); this.scene.select(target); this.drag = target ? { offsetX: point.x - this.scene._selected().x, offsetY: point.y - this.scene._selected().y } : null; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); });
    $('scene-canvas').addEventListener('pointermove', (event) => { if (!this.drag) return; const point = this._point(event); this.scene.setSelectedPosition(point.x - this.drag.offsetX, point.y - this.drag.offsetY); });
    $('scene-canvas').addEventListener('pointerup', () => { if (this.drag) void this.save(); this.drag = null; });
  }
  async loadLibrary() { try { this.library = await store.listCharacterTemplates(); if (!this.selectedCharacterId) this.selectedCharacterId = this.library[0]?.id || null; this.refresh(); } catch (error) { this.toast(`Karakter kitaplığı okunamadı: ${error.message}`); } }
  async _createCharacter(files) {
    const selected = Array.from(files || []); if (!selected.length) return;
    try {
      const visuals = selected.map((file, index) => ({ id: `visual-${index + 1}`, name: file.name, blob: file.slice(0, file.size, file.type), mimeType: file.type, fileName: file.name }));
      const name = selected[0].name.replace(/\.(png|webp|jpe?g)$/i, '').slice(0, 48) || 'Yeni karakter';
      const record = await store.saveCharacterTemplate({ id: newId('character'), name, blob: visuals[0].blob, mimeType: visuals[0].mimeType, fileName: visuals[0].fileName, columns: 1, rows: 1, fps: 12, visuals, animations: [{ id: 'idle', name: 'Idle', fps: 12, preset: 'loop', frameIds: visuals.map((visual) => visual.id) }] });
      this.library = [...this.library.filter((item) => item.id !== record.id), record]; this.selectedCharacterId = record.id; this.refresh(); this.toast(`${name} karakter kitaplığına eklendi.`);
    } catch (error) { this.toast(error.message); }
  }
  async _addCharacterVisuals(files) {
    const selected = this.library.find((item) => item.id === this.selectedCharacterId); if (!selected) return this.toast('Önce karakter kitaplığından bir karakter seçin.');
    try { for (const file of Array.from(files || [])) await store.addCharacterVisual(selected.id, file); await this.loadLibrary(); this.toast('Karakter görselleri eklendi.'); } catch (error) { this.toast(error.message); }
  }
  _selectedCharacter() { return this.library.find((item) => item.id === this.selectedCharacterId) || null; }
  async _saveCharacterAnimation() {
    const character = this._selectedCharacter(); if (!character) return this.toast('Önce bir karakter seçin.');
    const values = $('character-animation-sequence').value.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value));
    if (!values.length || values.some((value) => value < 1 || value > character.visuals.length)) return this.toast(`Kare sırası 1–${character.visuals.length} arasında olmalı.`);
    try {
      const animation = { id: newId('animation'), name: $('character-animation-name').value.trim() || 'Yeni animasyon', fps: Number($('character-animation-fps').value), preset: $('character-animation-preset').value, frameIds: values.map((value) => character.visuals[value - 1].id) };
      const saved = await store.saveCharacterAnimation(character.id, animation); this.library = this.library.map((item) => item.id === saved.id ? saved : item); this.refresh(); this.toast(`${animation.name} kaydedildi.`);
    } catch (error) { this.toast(error.message); }
  }
  _syncAnimationForm() {
    const character = this._selectedCharacter(); const animation = character?.animations.find((item) => item.id === $('character-animation-select').value); if (!animation) return;
    $('character-animation-name').value = animation.name; $('character-animation-fps').value = animation.fps; $('character-animation-preset').value = animation.preset;
    $('character-animation-sequence').value = animation.frameIds.map((id) => character.visuals.findIndex((visual) => visual.id === id) + 1).join(',');
  }
  async _addLibraryAnimationToScene() {
    const character = this._selectedCharacter(); const animation = character?.animations.find((item) => item.id === $('character-animation-select').value) || character?.animations[0]; if (!character || !animation) return this.toast('Önce bir karakter animasyonu seçin.');
    try {
      const visuals = new Map(character.visuals.map((visual) => [visual.id, visual]));
      const files = animation.frameIds.map((id) => visuals.get(id)).filter(Boolean).map((visual) => new File([visual.blob], visual.fileName, { type: visual.mimeType }));
      await this.scene.addSpriteSequence(files, { fps: animation.fps, preset: animation.preset, name: `${character.name} · ${animation.name}`, character: true }); await this.save(); this.refresh();
    } catch (error) { this.toast(error.message); }
  }
  async _addLayer(file) { if (!file) return; try { await this.scene.addLayer(file); this.refresh(); await this.save(); } catch (error) { this.toast(error.message); } }
  async _applyViewport() { try { this.scene.setViewport(Number($('scene-width').value), Number($('scene-height').value)); await this.save(); this.refresh(); this.toast(`2D sahne ${this.scene.width} × ${this.scene.height} olarak ayarlandı.`); } catch (error) { this.toast(error.message); } }
  async _addSprite(files) { const selected = Array.from(files || []); if (!selected.length) return; try { const options = { columns: Number($('sprite-columns').value), rows: Number($('sprite-rows').value), fps: Number($('sprite-fps').value) }; if (selected.length > 1) await this.scene.addSpriteSequence(selected, options); else await this.scene.addSprite(selected[0], options); this.refresh(); await this.save(); } catch (error) { this.toast(error.message); } }
  async playTimeline() { if (this.playing || !this.steps.length) return; this.playing = true; this.refresh(); try { for (const step of this.steps) { if (step.type === 'WAIT') await new Promise((resolve) => setTimeout(resolve, Math.max(0.05, Math.min(30, Number(step.data?.duration) || 0.5)) * 1000)); if (step.type === 'PLAY_SPRITE_ANIMATION') this.scene.playSprite(step.actorId); if (step.type === 'SET_LAYER_VISIBILITY') this.scene.setLayerVisible(step.layerId || step.actorId, step.data?.visible !== false); } } finally { this.playing = false; this.refresh(); } }
  async save() { try { const layers = await this.scene.exportAssetsForStorage(); const sprites = await this.scene.exportSpriteAssetsForStorage(); const next = createAutosaveRecord({ projectId: this.projectId, name: this.record.name, projectTemplate: 'blank', timeline: { version: '2d-only', playMode: 'sequential', steps: this.steps }, sprites, layers, viewport: { width: this.scene.width, height: this.scene.height }, skyColor: this.scene.background, characters3d: [], selectedCharacter3dId: null, worldCharacterTemplates: [], worldCharacters: [], wallBoxes: [], cameraStations: [], sceneEdits: [], mapAsset: null }); this.record = await store.saveProject(this.projectId, next); this.setStatus('Kaydedildi'); } catch (error) { this.toast(`Kayıt başarısız: ${error.message}`); } }
  async exportProject() { const layers = await this.scene.exportAssetsForStorage(); const sprites = await this.scene.exportSpriteAssetsForStorage(); const portable = async (asset) => ({ ...asset, blob: undefined, data: await blobToBase64(asset.blob), ...(asset.frames ? { frames: await Promise.all(asset.frames.map(async (frame) => ({ ...frame, blob: undefined, data: await blobToBase64(frame.blob) }))) } : {}) }); const payload = { ...(await createAutosaveRecord({ projectId: this.projectId, name: this.record.name, projectTemplate: 'blank', timeline: { version: '2d-only', playMode: 'sequential', steps: this.steps }, sprites, layers, viewport: { width: this.scene.width, height: this.scene.height }, characters3d: [], worldCharacterTemplates: [], worldCharacters: [], wallBoxes: [], cameraStations: [], sceneEdits: [], mapAsset: null })), sprites: await Promise.all(sprites.map(portable)), layers: await Promise.all(layers.map(portable)) }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${this.record.name || 'animationer-2d'}.json`; link.click(); URL.revokeObjectURL(link.href); this.setStatus('2D proje dışa aktarıldı'); }
  refresh() {
    const items = this.scene.list(); $('item-list').replaceChildren(...items.map((item) => { const li = document.createElement('li'); li.textContent = `${item.type === 'layer' ? 'Katman' : (item.character ? '2D Karakter' : '2D Görsel')} · ${item.name}`; li.dataset.id = item.id; li.dataset.type = item.type; li.className = this.scene.selected?.id === item.id ? 'selected' : ''; li.addEventListener('click', () => { this.scene.select({ type: item.type, id: item.id }); this.refresh(); }); return li; }));
    $('timeline-list').replaceChildren(...this.steps.map((step) => { const li = document.createElement('li'); li.textContent = step.title || step.type; return li; }));
    const selected = this.scene._selected(); $('scene-width').value = String(this.scene.width); $('scene-height').value = String(this.scene.height); $('scene-size-label').textContent = `${this.scene.width} × ${this.scene.height} px`; $('layer-visible').checked = selected?.visible !== false; $('layer-opacity').value = String(selected?.opacity ?? 1); $('btn-play').textContent = this.playing ? 'Oynatılıyor…' : 'Timeline’ı oynat';
    this.refreshLibrary();
  }
  refreshLibrary() {
    const list = $('character-list'); if (!list) return; list.replaceChildren(...this.library.map((character) => { const li = document.createElement('li'); li.textContent = `${character.name} · ${character.visuals.length} görsel · ${character.animations.length} animasyon`; li.className = character.id === this.selectedCharacterId ? 'selected' : ''; li.addEventListener('click', () => { this.selectedCharacterId = character.id; this.refresh(); }); return li; }));
    const character = this._selectedCharacter(); const select = $('character-animation-select'); select.replaceChildren(...(character?.animations || []).map((animation) => { const option = document.createElement('option'); option.value = animation.id; option.textContent = `${animation.name} · ${animation.frameIds.length} kare · ${animation.fps} FPS`; return option; }));
    if (character?.animations?.length) { select.value = character.animations[0].id; this._syncAnimationForm(); }
  }
  onSceneChange() { this.scene.render(); this.refresh(); }
  _point(event) { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) * this.scene.width / Math.max(1, rect.width), y: (event.clientY - rect.top) * this.scene.height / Math.max(1, rect.height) }; }
  _animate() { let last = performance.now(); const tick = (now) => { const delta = Math.min(0.1, (now - last) / 1000); last = now; this.scene.update(delta); this.scene.render(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  setStatus(message) { $('status').textContent = message; clearTimeout(this.statusTimer); this.statusTimer = setTimeout(() => { $('status').textContent = 'Hazır'; }, 1800); }
  toast(message) { $('status').textContent = message; }
}
export async function boot() { let id = sessionStorage.getItem('animationer-open-project'); let record = id ? await store.loadProject(id).catch(() => null) : null; if (!record) record = await store.createProject('Yeni 2D Sahne', { template: 'blank' }); sessionStorage.removeItem('animationer-open-project'); $('project-name').textContent = record.name; window.animationerApp = new Pure2DApp(migrateProjectRecord(record)); }
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => { void boot(); }, { once: true });
