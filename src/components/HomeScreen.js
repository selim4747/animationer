import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { IndexedProjectStore, MAX_CHARACTER_MODEL_BYTES, MAX_CHARACTER_TEMPLATE_BYTES } from './ProjectStore.js';
import { loadImage } from '../utils/load-image.js';

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function randomId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Tarih bilgisi yok';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function disposeObject(root) {
  root?.traverse?.((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}

/** Main landing screen for saved projects and shared character assets. */
export class HomeScreen {
  constructor(root, { store = new IndexedProjectStore(), onOpenProject = () => {} } = {}) {
    this.root = root;
    this.store = store;
    this.onOpenProject = onOpenProject;
    this.activeKind = '3d';
    this.projects = [];
    this.models = [];
    this.templates = [];
    this.selectedAsset = null;
    this.pendingAction = null;
    this.previewRenderer = null;
    this.previewScene = null;
    this.previewCamera = null;
    this.previewRoot = null;
    this.previewFrame = 0;
    this.previewObjectUrl = null;
    this.toastTimer = null;
    this._cacheElements();
    this._bindEvents();
  }

  _cacheElements() {
    const byId = (id) => this.root.querySelector(`#${id}`);
    this.dom = {
      projectList: byId('home-project-list'), projectCount: byId('home-project-count'), projectEmpty: byId('home-project-empty'), projectError: byId('home-project-error'),
      characterList: byId('home-character-list'), characterEmpty: byId('home-character-empty'), libraryError: byId('home-library-error'),
      modelPicker: byId('home-model-picker'), spritePicker: byId('home-sprite-picker'), add3d: byId('home-add-3d'), add2d: byId('home-add-2d'),
      previewCanvas: byId('home-character-canvas'), previewImage: byId('home-character-image'), previewPlaceholder: byId('home-preview-placeholder'),
      previewName: byId('home-preview-name'), previewDetail: byId('home-preview-detail'), toast: byId('home-toast'),
      dialog: byId('home-dialog'), dialogForm: byId('home-dialog-form'), dialogEyebrow: byId('home-dialog-eyebrow'), dialogTitle: byId('home-dialog-title'),
      dialogMessage: byId('home-dialog-message'), dialogNameLabel: byId('home-dialog-name-label'), dialogName: byId('home-dialog-name'),
      dialogTargetLabel: byId('home-dialog-target-label'), dialogTarget: byId('home-dialog-target'), dialogSubmit: byId('home-dialog-submit'), dialogCancel: byId('home-dialog-cancel'),
      createProject: byId('home-create-project'), spriteSettings: byId('home-sprite-settings'),
      columns: byId('home-sprite-columns'), rows: byId('home-sprite-rows'), fps: byId('home-sprite-fps'),
    };
  }

  _bindEvents() {
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button === this.dom.createProject) return this._showDialog('create');
      if (button === this.dom.add3d) return this.dom.modelPicker.click();
      if (button === this.dom.add2d) return this.dom.spritePicker.click();
      const tab = button.closest('[data-library-kind]');
      if (tab) {
        this.activeKind = tab.dataset.libraryKind === '2d' ? '2d' : '3d';
        this._renderCharacters();
        this._syncLibraryControls();
        return;
      }
      const card = button.closest('[data-character-id]');
      if (card && ['asset-rename','asset-edit','asset-replace','asset-delete'].includes(button.dataset.action)) { void this._assetAction(button.dataset.action, card.dataset.characterId); return; }
      if (button.dataset.action === 'use-character' && card) return this._showDialog('use-character', card.dataset.characterId);
      if (card) return void this._selectCharacter(card.dataset.characterId);
      const projectCard = button.closest('[data-project-id]');
      if (!projectCard) return;
      const { projectId } = projectCard.dataset;
      if (button.dataset.action === 'open-project' || button === projectCard.querySelector('.home-project-open')) return this._openProject(projectId);
      if (button.dataset.action === 'rename') return this._showDialog('rename', projectId);
      if (button.dataset.action === 'duplicate') return this._showDialog('duplicate', projectId);
      if (button.dataset.action === 'delete') return this._showDialog('delete', projectId);
      if (button.dataset.action === 'favorite') { void this.store.setProjectFavorite(projectId, button.getAttribute('aria-pressed') !== 'true').then(() => this.refresh()).catch((error) => this._setError(this.dom.projectError, error.message)); return; }
    });

    this._ensureProjectControls();
    this.dom.dialogCancel.addEventListener('click', () => this.dom.dialog.close('cancel'));
    this.dom.dialogForm.addEventListener('submit', (event) => { event.preventDefault(); void this._submitDialog(); });
    this.dom.modelPicker.addEventListener('change', (event) => { void this._add3dModel(event.target.files?.[0]); });
    this.dom.spritePicker.addEventListener('change', (event) => { void this._add2dTemplate(event.target.files?.[0]); });
  }

  async init() {
    try {
      await this.store.importLegacyAutosave?.();
      await this.refresh();
    } catch (error) {
      this._setError(this.dom.projectError, error.message || 'Yerel proje kitaplığı açılamadı.');
    }
  }

  async refresh() {
    this._clearError(this.dom.projectError);
    this._clearError(this.dom.libraryError);
    const [projects, models, templates] = await Promise.all([
      this.store.listProjects(),
      this.store.listCharacterModelMetadata(),
      this.store.listCharacterTemplateMetadata(),
    ]);
    this.projects = projects;
    this.models = models;
    this.templates = templates;
    this._renderProjects();
    this._renderCharacters();
    this._syncLibraryControls();
  }

  _renderProjects() {
    const { projectList, projectCount, projectEmpty } = this.dom;
    projectList.replaceChildren();
    const query=(this.projectQuery||'').trim().toLocaleLowerCase('tr');
    const projects=this.projects.filter((p)=>p.name.toLocaleLowerCase('tr').includes(query));
    if (this.projectSort==='name') projects.sort((a,b)=>a.name.localeCompare(b.name,'tr'));
    if (this.projectSort==='favorite') projects.sort((a,b)=>Number(b.favorite===true)-Number(a.favorite===true) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    projectCount.textContent = projects.length === this.projects.length ? `${projects.length} PROJE` : `${projects.length}/${this.projects.length} PROJE`;
    projectEmpty.hidden = projects.length > 0;
    projectEmpty.textContent = query && this.projects.length ? 'Aramanızla eşleşen proje bulunamadı.' : 'Henüz kayıtlı projen yok. “Yeni Proje” ile bir sahne oluştur.';
    for (const project of projects) {
      const card = element('article', 'home-project-card');
      card.dataset.projectId = project.id;
      const open = element('button', 'home-project-open');
      open.type = 'button';
      open.dataset.action = 'open-project';
      open.setAttribute('aria-label', `${project.name} projesini aç`);
      const topline = element('span', 'home-project-topline');
      topline.append(element('span', 'home-project-type', 'SAHNE PROJESİ'));
      topline.append(element('span', 'home-project-map', project.mapFileName || (project.mapKind === 'demo-gallery' ? 'Örnek 3D galeri' : 'Harita eklenmemiş')));
      open.append(topline, element('h3', '', project.name), element('span', 'home-project-date', `Son düzenleme · ${formatDate(project.updatedAt)}`));
      const metrics = element('div', 'home-project-metrics');
      metrics.append(
        element('span', 'home-project-metric', `${project.character3dCount || 0} · 3D`),
        element('span', 'home-project-metric', `${project.character2dCount || 0} · 2D`),
        element('span', 'home-project-metric', `${project.timelineStepCount || 0} · REJİ`),
      );
      if (project.wallBoxCount) metrics.append(element('span', 'home-project-metric', `${project.wallBoxCount} · ENGEL`));
      const actions = element('div', 'home-project-actions');
      const favorite = element('button', '', project.favorite ? '★ Favori' : '☆ Favorile'); favorite.type = 'button'; favorite.dataset.action = 'favorite'; favorite.setAttribute('aria-pressed', String(project.favorite === true)); actions.append(favorite);
      for (const [action, label] of [['rename', 'Adını değiştir'], ['duplicate', 'Kopyala'], ['delete', 'Sil']]) {
        const button = element('button', '', label);
        button.type = 'button';
        button.dataset.action = action;
        button.setAttribute('aria-label', `${project.name}: ${label}`);
        actions.append(button);
      }
      card.append(open, metrics, actions);
      projectList.append(card);
    }
  }

  _ensureProjectControls() {
    if (this.dom.projectList.parentElement.querySelector('[data-home-project-controls]')) return;
    const controls = element('div', 'home-project-controls'); controls.dataset.homeProjectControls = 'true';
    const search = element('input'); search.type='search'; search.placeholder='Projelerde ara'; search.setAttribute('aria-label','Projelerde ara');
    const sort = element('select'); sort.setAttribute('aria-label','Projeleri sırala');
    for (const [value,label] of [['recent','En yeni'],['name','Ada göre'],['favorite','Favoriler önce']]) { const option=element('option','',label); option.value=value; sort.append(option); }
    search.addEventListener('input',()=>{ this.projectQuery=search.value; this._renderProjects(); });
    sort.addEventListener('change',()=>{ this.projectSort=sort.value; this._renderProjects(); });
    controls.append(search,sort); this.dom.projectList.parentElement.insertBefore(controls,this.dom.projectList);
  }

  _currentAssets() { return this.activeKind === '2d' ? this.templates : this.models; }

  _renderCharacters() {
    const assets = this._currentAssets();
    this.dom.characterList.replaceChildren();
    this.dom.characterEmpty.hidden = assets.length > 0;
    for (const asset of assets) {
      const item = element('article', 'home-character-item');
      item.dataset.characterId = asset.id;
      const card = element('button', `home-character-card${this.selectedAsset?.id === asset.id && this.selectedAsset?.kind === this.activeKind ? ' is-selected' : ''}`);
      card.type = 'button';
      card.setAttribute('aria-label', `${asset.name} karakterini önizle`);
      const thumb = element('span', 'home-character-thumb', this.activeKind === '3d' ? '3D GLB' : '2D PNG');
      const info = element('span', 'home-character-info');
      info.append(element('strong', '', asset.name));
      info.append(element('span', '', this.activeKind === '3d' ? `${formatBytes(asset.blobSize)} · ${asset.fileName}` : `${asset.columns}×${asset.rows} kare · ${asset.fps} FPS`));
      card.append(thumb, info);
      const use = element('button', 'home-character-use', '＋ Bu karakteri projeye ekle');
      use.type = 'button';
      use.dataset.action = 'use-character';
      use.setAttribute('aria-label', `${asset.name} karakterini bir projeye ekle`);
      item.append(card, use);
      const actions = element('div', 'home-character-actions');
      const actionDefs = this.activeKind === '2d' ? [['asset-rename','Ad'],['asset-edit','Grid/FPS'],['asset-replace','Dosya'],['asset-delete','Sil']] : [['asset-rename','Ad'],['asset-replace','Dosya'],['asset-delete','Sil']];
      for (const [action,label] of actionDefs) { const button = element('button','',label); button.type='button'; button.dataset.action=action; actions.append(button); }
      item.append(actions);
      this.dom.characterList.append(item);
    }
  }

  _syncLibraryControls() {
    for (const button of this.root.querySelectorAll('[data-library-kind]')) {
      const active = button.dataset.libraryKind === this.activeKind;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    this.dom.add3d.hidden = this.activeKind !== '3d';
    this.dom.add2d.hidden = this.activeKind !== '2d';
    this.dom.spriteSettings.hidden = this.activeKind !== '2d';
  }

  async _selectCharacter(id) {
    const asset = this._currentAssets().find((item) => item.id === id);
    if (!asset) return;
    this.selectedAsset = { ...asset, kind: this.activeKind };
    this.dom.previewName.textContent = asset.name;
    this.dom.previewPlaceholder.hidden = true;
    this._renderCharacters();
    this._clearError(this.dom.libraryError);
    try {
      if (this.activeKind === '3d') {
        const model = await this.store.getCharacterModel(id);
        if (!model) throw new Error('3D karakter kaydı bulunamadı.');
        this.dom.previewImage.hidden = true;
        this.dom.previewCanvas.hidden = false;
        this.dom.previewDetail.textContent = `GLB · ${formatBytes(model.blobSize || model.blob.size)}`;
        await this._previewModel(model.blob);
      } else {
        const template = await this.store.getCharacterTemplate(id);
        if (!template) throw new Error('2D karakter kaydı bulunamadı.');
        this._stopPreviewAnimation();
        if (this.previewRoot) {
          this.previewScene?.remove(this.previewRoot);
          disposeObject(this.previewRoot);
          this.previewRoot = null;
        }
        if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
        this.previewObjectUrl = URL.createObjectURL(template.blob);
        this.dom.previewImage.src = this.previewObjectUrl;
        this.dom.previewImage.hidden = false;
        this.dom.previewCanvas.hidden = true;
        this.dom.previewDetail.textContent = `2D · ${template.columns}×${template.rows} kare · ${template.fps} FPS`;
      }
    } catch (error) {
      this._setError(this.dom.libraryError, error.message || 'Karakter önizlemesi açılamadı.');
    }
  }

  _ensurePreviewRenderer() {
    if (this.previewRenderer) return;
    this.previewRenderer = new THREE.WebGLRenderer({ canvas: this.dom.previewCanvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    this.previewRenderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio || 1));
    this.previewRenderer.setSize(520, 280, false);
    this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.previewScene = new THREE.Scene();
    this.previewScene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 2.1));
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(4, 7, 5);
    this.previewScene.add(light);
    this.previewCamera = new THREE.PerspectiveCamera(32, 520 / 280, 0.1, 100);
  }

  async _previewModel(blob) {
    this._ensurePreviewRenderer();
    this._stopPreviewAnimation();
    if (this.previewRoot) {
      this.previewScene.remove(this.previewRoot);
      disposeObject(this.previewRoot);
      this.previewRoot = null;
    }
    const loader = new GLTFLoader();
    const buffer = await blob.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height <= 0.01) {
      disposeObject(model);
      throw new Error('Bu GLB karakterin ölçüleri önizlenemiyor.');
    }
    model.scale.multiplyScalar(2.2 / height);
    model.updateMatrixWorld(true);
    const scaledBounds = new THREE.Box3().setFromObject(model);
    const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
    model.position.x -= scaledCenter.x;
    model.position.z -= scaledCenter.z;
    model.position.y -= scaledBounds.min.y;
    model.rotation.y = 0.28;
    model.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    this.previewRoot = model;
    this.previewScene.add(model);
    const framing = Math.max(2, scaledBounds.max.y - scaledBounds.min.y);
    this.previewCamera.position.set(framing * 0.9, framing * 0.65, framing * 3.8);
    this.previewCamera.lookAt(0, framing * 0.48, 0);
    this.previewCamera.aspect = 520 / 280;
    this.previewCamera.updateProjectionMatrix();
    this._startPreviewAnimation();
  }

  _startPreviewAnimation() {
    if (this.previewFrame || !this.previewRenderer) return;
    const draw = () => {
      if (!this.previewRenderer) return;
      if (!this.dom.previewCanvas.hidden && this.previewRoot) {
        this.previewRoot.rotation.y += 0.004;
        this.previewRenderer.render(this.previewScene, this.previewCamera);
      }
      this.previewFrame = requestAnimationFrame(draw);
    };
    this.previewFrame = requestAnimationFrame(draw);
  }

  _stopPreviewAnimation() {
    if (this.previewFrame) cancelAnimationFrame(this.previewFrame);
    this.previewFrame = 0;
  }

  _showDialog(action, projectId = null) {
    this.pendingAction = { action, projectId };
    const project = this.projects.find((item) => item.id === projectId);
    const titles = {
      create: ['YENİ SAHNE', 'Yeni Proje', 'Projene bir ad ver.'],
      rename: ['PROJE AYARLARI', 'Projeyi yeniden adlandır', 'Bu ad yalnızca proje kartını değiştirir.'],
      duplicate: ['PROJE KOPYASI', 'Projeyi kopyala', 'Harita, karakterler ve reji adımları yeni bir projeye kopyalanır.'],
      delete: ['PROJEYİ SİL', 'Projeyi sil?', 'Bu işlem projeyi bu cihazdan kaldırır ve geri alınamaz.'],
      'use-character': ['KARAKTER KİTAPLIĞI', 'Projede kullan', 'Karakteri eklemek istediğin projeyi seç.'],
    };
    const [eyebrow, title, message] = titles[action] || titles.create;
    this.dom.dialogEyebrow.textContent = eyebrow;
    this.dom.dialogTitle.textContent = title;
    this.dom.dialogMessage.textContent = message;
    this.dom.dialogNameLabel.hidden = !['create', 'rename', 'duplicate'].includes(action);
    this.dom.dialogTargetLabel.hidden = action !== 'use-character';
    this.dom.dialogSubmit.textContent = action === 'delete' ? 'Projeyi sil' : action === 'use-character' ? 'Projeyi aç ve ekle' : 'Kaydet';
    this.dom.dialogSubmit.classList.toggle('is-destructive', action === 'delete');
    this.dom.dialogName.value = action === 'rename' ? (project?.name || '') : action === 'duplicate' ? `${project?.name || 'Proje'} kopyası`.slice(0, 64) : '';
    this.dom.dialogTarget.replaceChildren();
    if (action === 'use-character') {
      for (const item of this.projects) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        this.dom.dialogTarget.append(option);
      }
      this.dom.dialogTarget.disabled = this.projects.length === 0;
    }
    this.dom.dialog.showModal();
    if (this.dom.dialogNameLabel.hidden && !this.dom.dialogTargetLabel.hidden) this.dom.dialogTarget.focus();
    else if (!this.dom.dialogNameLabel.hidden) this.dom.dialogName.focus();
  }

  async _submitDialog() {
    const pending = this.pendingAction;
    if (!pending) return;
    this._clearError(this.dom.projectError);
    try {
      if (pending.action === 'create') {
        const project = await this.store.createProject(this.dom.dialogName.value || 'Yeni Proje');
        this.dom.dialog.close();
        this._openProject(project.projectId);
      } else if (pending.action === 'rename') {
        await this.store.renameProject(pending.projectId, this.dom.dialogName.value);
        this.dom.dialog.close();
        await this.refresh();
        this._showToast('Proje adı güncellendi.');
      } else if (pending.action === 'duplicate') {
        const project = await this.store.duplicateProject(pending.projectId, this.dom.dialogName.value);
        this.dom.dialog.close();
        await this.refresh();
        this._showToast(`“${project.name}” kopyası oluşturuldu.`);
      } else if (pending.action === 'delete') {
        await this.store.deleteProject(pending.projectId);
        this.dom.dialog.close();
        await this.refresh();
        this._showToast('Proje bu cihazdan silindi.');
      } else if (pending.action === 'use-character') {
        const projectId = this.dom.dialogTarget.value;
        if (!projectId) throw new Error('Önce bir proje oluşturun.');
        const item = { kind: this.selectedAsset.kind, id: this.selectedAsset.id };
        this.dom.dialog.close();
        this._openProject(projectId, item);
      }
    } catch (error) {
      this._setError(this.dom.projectError, error.message || 'İşlem tamamlanamadı.');
    }
  }

  async _assetAction(action, id) {
    const kind=this.activeKind; const is2d=kind==='2d'; const store=this.store;
    try {
      if (action==='asset-rename') {
        const asset=(is2d?this.templates:this.models).find((a)=>a.id===id); const name=globalThis.prompt?.('Yeni ad',asset?.name||'');
        if (name == null) return; if (is2d) await store.renameCharacterTemplate(id,name); else await store.renameCharacterModel(id,name);
      } else if (action==='asset-edit' && is2d) {
        const a=await store.getCharacterTemplate(id); const columns=Number(globalThis.prompt?.('Sütun sayısı',String(a.columns))); if (!Number.isFinite(columns)) return;
        const rows=Number(globalThis.prompt?.('Satır sayısı',String(a.rows))); if (!Number.isFinite(rows)) return;
        const fps=Number(globalThis.prompt?.('FPS',String(a.fps))); if (!Number.isFinite(fps)) return;
        const url=URL.createObjectURL(a.blob);
        try { const image=await loadImage(url); if (image.naturalWidth % columns || image.naturalHeight % rows) throw new Error('Görsel boyutları seçilen kolon ve satır sayısına tam bölünmeli.'); }
        finally { URL.revokeObjectURL(url); }
        await store.updateCharacterTemplateMetadata(id,{columns,rows,fps});
      } else if (action==='asset-replace') {
        const input=element('input'); input.type='file'; input.accept=is2d?'.png,.webp,.jpg,.jpeg':'.glb';
        const file=await new Promise((resolve)=>{input.onchange=()=>resolve(input.files?.[0]||null);input.oncancel=()=>resolve(null);input.click();}); if (!file) return;
        if (is2d) {
          const old=await store.getCharacterTemplate(id); const url=URL.createObjectURL(file);
          try { const image=await loadImage(url); if (image.naturalWidth % old.columns || image.naturalHeight % old.rows) throw new Error(`Yeni görsel mevcut ${old.columns}×${old.rows} ızgaraya tam bölünmüyor.`); }
          finally { URL.revokeObjectURL(url); }
          await store.replaceCharacterTemplate(id,file);
        } else {
          if (!/\.glb$/i.test(file.name||'') || !file.size || file.size>MAX_CHARACTER_MODEL_BYTES) throw new Error('50 MB’a kadar geçerli bir .glb dosyası seçin.');
          const loader=new GLTFLoader(); const buffer=await file.arrayBuffer(); const gltf=await new Promise((resolve,reject)=>loader.parse(buffer,'',resolve,reject));
          if (!gltf?.scene) throw new Error('GLB dosyası çözümlenemedi.');
          disposeObject(gltf.scene); await store.replaceCharacterModel(id,file);
        }
      } else if (action==='asset-delete') {
        const usages=is2d?await store.getCharacterTemplateUsages(id):await store.getCharacterModelUsages(id);
        const detail = usages.length ? `\nKullanım: ${usages.map((u) => `${u.projectName} (${u.count}: ${u.characters.join(', ')})`).join('; ')}` : '\nKullanılmıyor.';
        if (!globalThis.confirm?.(`Bu kitaplık varlığı silinsin mi?${detail}`)) return;
        if (is2d) await store.deleteCharacterTemplate(id); else await store.deleteCharacterModel(id);
      }
      await this.refresh(); this._showToast('Karakter kitaplığı güncellendi.');
    } catch(error) { this._setError(this.dom.libraryError,error.message||'Kitaplık işlemi tamamlanamadı.'); }
  }

  async _add3dModel(file) {
    this.dom.modelPicker.value = '';
    if (!file) return;
    this._clearError(this.dom.libraryError);
    try {
      if (!/\.glb$/i.test(file.name || '') || file.size > MAX_CHARACTER_MODEL_BYTES) throw new Error('50 MB’a kadar tek dosyalı .glb karakter seçin.');
      const blob = file.slice(0, file.size, file.type || 'model/gltf-binary');
      const loader = new GLTFLoader();
      const buffer = await blob.arrayBuffer();
      const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
      if (!gltf?.scene) throw new Error('GLB dosyasından karakter sahnesi okunamadı.');
      disposeObject(gltf.scene);
      const name = (file.name || '3D Karakter').replace(/\.glb$/i, '').slice(0, 48);
      const saved = await this.store.saveCharacterModel({ id: randomId('model'), name: name || '3D Karakter', blob, mimeType: blob.type, fileName: file.name });
      await this.refresh();
      this.activeKind = '3d';
      this._syncLibraryControls();
      await this._selectCharacter(saved.id);
      this._showToast(`“${saved.name}” karakter kitaplığına eklendi.`);
    } catch (error) {
      this._setError(this.dom.libraryError, error.message || '3D karakter eklenemedi.');
    }
  }

  async _add2dTemplate(file) {
    this.dom.spritePicker.value = '';
    if (!file) return;
    this._clearError(this.dom.libraryError);
    try {
      const columns = Number(this.dom.columns.value);
      const rows = Number(this.dom.rows.value);
      const fps = Number(this.dom.fps.value);
      if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type) || file.size > MAX_CHARACTER_TEMPLATE_BYTES) throw new Error('50 MB’a kadar PNG, WebP veya JPEG spritesheet seçin.');
      if (!Number.isInteger(columns) || columns < 1 || columns > 64 || !Number.isInteger(rows) || rows < 1 || rows > 64 || columns * rows > 4096) throw new Error('Satır ve sütun sayısı 1–64 aralığında olmalı.');
      if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('FPS 1–60 arasında olmalı.');
      const url = URL.createObjectURL(file);
      try {
        const image = await loadImage(url);
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth % columns || image.naturalHeight % rows) throw new Error('Görsel boyutları satır ve sütun sayısına tam bölünmeli.');
      } finally { URL.revokeObjectURL(url); }
      const name = (file.name || '2D Karakter').replace(/\.(png|webp|jpe?g)$/i, '').slice(0, 48);
      const saved = await this.store.saveCharacterTemplate({
        id: randomId('world2d'), name: name || '2D Karakter', blob: file.slice(0, file.size, file.type), mimeType: file.type,
        fileName: file.name, columns, rows, fps,
      });
      await this.refresh();
      this.activeKind = '2d';
      this._syncLibraryControls();
      await this._selectCharacter(saved.id);
      this._showToast(`“${saved.name}” 2D karakter kitaplığına eklendi.`);
    } catch (error) {
      this._setError(this.dom.libraryError, error.message || '2D karakter eklenemedi.');
    }
  }

  _openProject(id, asset = null) {
    if (!id) return;
    this.dispose();
    this.onOpenProject(id, asset);
  }

  _setError(target, message) {
    target.textContent = message;
    target.hidden = false;
  }

  _clearError(target) {
    target.textContent = '';
    target.hidden = true;
  }

  _showToast(message) {
    this.dom.toast.textContent = message;
    this.dom.toast.classList.add('is-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.dom.toast.classList.remove('is-visible'), 3000);
  }

  dispose() {
    this._stopPreviewAnimation();
    if (this.previewRoot) disposeObject(this.previewRoot);
    this.previewRoot = null;
    this.previewRenderer?.dispose();
    this.previewRenderer = null;
    if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
    this.previewObjectUrl = null;
  }
}
