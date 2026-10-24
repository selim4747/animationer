/**
 * main.js
 * Modüler Three.js WebGL & Capacitor mimarisini başlatan ana giriş noktası.
 * Reji / Zaman Çizelgesi (TimelineManager) ve sekmeli Monokrom Stüdyo HUD (UIManager)
 * bileşenlerini entegre eder.
 */

import * as THREE from 'three';
import { CollisionManager } from './components/CollisionManager.js';
import { MapLoader } from './components/MapLoader.js';
import { CharacterRoster } from './components/CharacterRoster.js';
import { Door } from './components/Door.js';
import { CameraManager } from './components/CameraManager.js';
import { TimelineManager, ACTION_TYPES } from './components/TimelineManager.js';
import { RecorderManager } from './components/RecorderManager.js';
import { UIManager } from './components/UIManager.js';
import { SpriteAnimationManager } from './components/SpriteAnimationManager.js';
import { WorldSpriteCharacterManager } from './components/WorldSpriteCharacterManager.js';
import { IndexedProjectStore } from './components/ProjectStore.js';
import { SceneBuilder } from './components/SceneBuilder.js';
import studioPanelHtml from './ui/studio-panel.html?raw';
class App {
  constructor() {
    this.projectStore = new IndexedProjectStore();
    this.container = document.getElementById('canvas-container');
    this.clock = new THREE.Clock();

    // Dokunma (Tap) vs Sürükleme (Drag) ayrımı için değişkenler
    this.pointerDownPos = { x: 0, y: 0 };
    this.pointerDownTime = 0;
    this.spriteDrag = null;
    this.pointerDragged = false;
    this.controlMode = 'tap';
    this.pressedDirections = new Set();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.testWalkableSurfaces = []; // Merdiven ve 2. kat yürünebilir yüzeyleri

    this._initScene();
    this._initLightingAndEnvironment();
    this._initComponents();
    this.sceneBuilder = new SceneBuilder(this.scene, this.collisionManager);
    this.sceneBuilder.buildMultiStoryArchitecture();
    this.sceneBuilder.buildTestFurniture();
    this.testWalkableSurfaces = this.sceneBuilder.walkableSurfaces;

    // Inject studio panel HTML (extracted from index.html for maintainability)
    const panelRoot = document.getElementById('studio-panel-root');
    if (panelRoot) {
      panelRoot.outerHTML = studioPanelHtml;
    }

    this._initUI();
    this._bindEvents();
    this.worldSpriteCharacterManager.loadLibrary().catch((error) => this.uiManager?.showToast(error.message || '2D karakter kitaplığı açılamadı.'));

    this._animate();
  }

  /**
   * Three.js sahne, kamera ve render motorunu başlatır
   * @private
   */
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080808);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(13, 11, 16);

    this.spriteScene = new THREE.Scene();
    this.spriteCamera = new THREE.OrthographicCamera(0, window.innerWidth, window.innerHeight, 0, 0.1, 100);
    this.spriteCamera.position.z = 10;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.appendChild(this.renderer.domElement);
  }

  /**
   * Katı monokrom ışıklandırma ve referans zemin ızgarası
   * @private
   */
  _initLightingAndEnvironment() {
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x111111, 1.0);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    this.dirLight.position.set(16, 28, 14);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.bias = -0.0004;

    const d = 26;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 100;
    this.scene.add(this.dirLight);

    this.gridHelper = new THREE.GridHelper(36, 36, 0x444444, 0x1a1a1a);
    this.gridHelper.position.y = -0.002;
    this.scene.add(this.gridHelper);

    // Zemin Gölge Düzlemi (Aynı zamanda zemin kat yürünebilir yüzeyidir)
    const shadowGeo = new THREE.PlaneGeometry(100, 100);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.groundShadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    this.groundShadowPlane.rotation.x = -Math.PI / 2;
    this.groundShadowPlane.position.y = -0.003;
    this.groundShadowPlane.receiveShadow = true;
    this.groundShadowPlane.name = 'ground_zero_plane';
    this.scene.add(this.groundShadowPlane);
  }

  /**
   * Modüler bileşenleri ilklendirir
   * @private
   */
  _initComponents() {
    // 1. Çarpışma ve Mekânsal Culling Yöneticisi
    this.collisionManager = new CollisionManager(this.scene);

    // Ana zemin düzlemini yürünebilir yüzey yap
    this.collisionManager.registerWalkableSurface(this.groundShadowPlane);

    // 2. Menteşeli Kapı & Kesit Mimarisi
    this.door = new Door(this.scene, this.collisionManager, (state) => {
      this._updateDoorHUD(state.isOpen);
    });

    // 3. Prosedürel Karakter (3D Navigasyon ve Floor Snapping)
    this.character = new CharacterRoster(this.scene, this.collisionManager, (state) => {
      this._updateCharacterHUD(this.character?.selectedCharacter?.isMoving || false);
      this.uiManager?.updateCharacterList(state.actors || this.character.list());
    });

    this.spriteAnimationManager = new SpriteAnimationManager(this.spriteScene, {
      width: window.innerWidth,
      height: window.innerHeight,
      onStateChange: (state) => this.uiManager?.updateSpriteList(state.actors, state.selectedId),
    });
    this.worldSpriteCharacterManager = new WorldSpriteCharacterManager(this.scene, this.collisionManager, {
      characterRoster: this.character,
      store: this.projectStore,
      onStateChange: (state) => this.uiManager?.updateWorldSpriteUI(state.templates, state.actors, state.selectedId, state.selectedTemplateId, state.activeControl),
    });

    // 4. Kamera Yöneticisi & CCTV İstasyonları
    this.cameraManager = new CameraManager(
      this.camera,
      this.renderer.domElement,
      (state) => {
        this._updateCameraHUD(state);
      }
    );

    // 5. Harita / Model Yükleyici (Büyük harita culling ve kat desteği)
    this.mapLoader = new MapLoader(this.scene, this.collisionManager, (status) => {
      this._updateMapHUD(status);
    });

    // 6. Reji / Zaman Çizelgesi Eylem Kuyruğu (TimelineManager)
    this.timelineManager = new TimelineManager({
      character: this.character,
      door: this.door,
      cameraManager: this.cameraManager,
      spriteAnimationManager: this.spriteAnimationManager,
      onStateChange: (state) => {
        if (this.uiManager) {
          this.uiManager.updateTimelineUI();
        }
      },
    });

    // 7. Video ve Ekran Görüntüsü Dışa Aktarma Yöneticisi (RecorderManager)
    this.recorderManager = new RecorderManager(this.renderer.domElement, {
      onStateChange: (state) => {
        if (this.uiManager) {
          this.uiManager.updateRecorderUI(state);
        }
      },
    });
  }

  /**
   * Monokrom Stüdyo Arayüzünü (UIManager) başlatır
   * @private
   */
  _initUI() {
    this.uiManager = new UIManager({
      timelineManager: this.timelineManager,
      character: this.character,
      door: this.door,
      cameraManager: this.cameraManager,
      mapLoader: this.mapLoader,
      recorderManager: this.recorderManager,
      spriteAnimationManager: this.spriteAnimationManager,
      worldSpriteCharacterManager: this.worldSpriteCharacterManager,
      projectStore: this.projectStore,
      characterManager: this.character,
      onControlModeChange: (mode) => this.setControlMode(mode),
      sceneHelpers: {
        gridHelper: this.gridHelper,
        dirLight: this.dirLight,
        hemiLight: this.hemiLight,
      },
    });
  }

  /**
   * Dokunma, Tıklama ve Sürükle-Bırak olaylarını dinler
   * @private
   */
  _bindEvents() {
    window.addEventListener('resize', () => this._onWindowResize());

    // Canvas üzerinde dokunma / fare tıklaması ayrımı
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', (e) => {
      const rect = dom.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (this.spriteAnimationManager.width / rect.width);
      const sy = (e.clientY - rect.top) * (this.spriteAnimationManager.height / rect.height);
      const sprite = this.spriteAnimationManager.hitTest(sx, sy);
      this.pointerDragged = false;
      if (sprite) {
        this.spriteAnimationManager.select(sprite.id);
        this.spriteDrag = { pointerId: e.pointerId, id: sprite.id, dx: sprite.x - sx, dy: sprite.y - sy };
        dom.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }
      this.pointerDownPos.x = e.clientX;
      this.pointerDownPos.y = e.clientY;
      this.pointerDownTime = performance.now();
    });

    dom.addEventListener('pointermove', (e) => {
      if (!this.spriteDrag || this.spriteDrag.pointerId !== e.pointerId) return;
      const rect = dom.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (this.spriteAnimationManager.width / rect.width);
      const sy = (e.clientY - rect.top) * (this.spriteAnimationManager.height / rect.height);
      if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 3) this.pointerDragged = true;
      this.spriteAnimationManager.setTransform(this.spriteDrag.id, { x: sx + this.spriteDrag.dx, y: sy + this.spriteDrag.dy });
      e.preventDefault();
    });
    const finishSpriteDrag = (e) => { if (this.spriteDrag?.pointerId === e.pointerId) this.spriteDrag = null; };
    dom.addEventListener('pointercancel', finishSpriteDrag);
    dom.addEventListener('pointerup', (e) => {
      const wasSpriteInteraction = Boolean(this.spriteDrag);
      const wasSpriteDrag = this.pointerDragged;
      finishSpriteDrag(e);
      const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      const elapsed = performance.now() - this.pointerDownTime;

      // Eğer 10 pikselden az hareket edildiyse ve süre < 350ms ise bu bir TAP (dokunma) hareketidir!
      if (!wasSpriteInteraction && !wasSpriteDrag && dist < 10 && elapsed < 350) {
        this._handleCanvasTap(e);
      }
    });
    this._bindCharacterControls();

    // Tam Ekran Sürükle-Bırak (Drag & Drop)
    const overlay = document.getElementById('drag-overlay');
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (overlay) overlay.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null && overlay) {
        overlay.classList.remove('active');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (overlay) overlay.classList.remove('active');

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        this.mapLoader.loadFile(file);
      }
    });
  }

  setControlMode(mode) {
    this.controlMode = ['tap', 'joystick', 'arrows'].includes(mode) ? mode : 'tap';
    this.character.setControlVector(0, 0);
    this.pressedDirections.clear();
    const joystick = document.getElementById('joystick-controls');
    const arrows = document.getElementById('arrow-controls');
    if (joystick) joystick.style.display = this.controlMode === 'joystick' ? 'block' : 'none';
    if (arrows) arrows.style.display = this.controlMode === 'arrows' ? 'grid' : 'none';
  }

  _bindCharacterControls() {
    const applyDirections = () => {
      const x = Number(this.pressedDirections.has('right')) - Number(this.pressedDirections.has('left'));
      const z = Number(this.pressedDirections.has('down')) - Number(this.pressedDirections.has('up'));
      this.character.setControlVector(x, z);
    };

    document.querySelectorAll('[data-direction]').forEach((button) => {
      const direction = button.dataset.direction;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        this.pressedDirections.add(direction);
        applyDirections();
      });
      const release = (event) => {
        event.preventDefault();
        this.pressedDirections.delete(direction);
        applyDirections();
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    });

    const keyDirections = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
    window.addEventListener('keydown', (event) => {
      if (this.controlMode !== 'arrows' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      const direction = keyDirections[event.code];
      if (!direction) return;
      event.preventDefault();
      this.pressedDirections.add(direction);
      applyDirections();
    });
    window.addEventListener('keyup', (event) => {
      const direction = keyDirections[event.code];
      if (!direction || !this.pressedDirections.has(direction)) return;
      this.pressedDirections.delete(direction);
      applyDirections();
    });
    window.addEventListener('blur', () => {
      this.pressedDirections.clear();
      this.character.setControlVector(0, 0);
    });

    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    let joystickPointer = null;
    const moveJoystick = (event) => {
      if (joystickPointer !== event.pointerId || !base || !knob) return;
      const rect = base.getBoundingClientRect();
      const radius = rect.width * 0.36;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const length = Math.hypot(dx, dy);
      const factor = length > radius ? radius / length : 1;
      const nx = dx * factor / radius;
      const nz = dy * factor / radius;
      knob.style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
      this.character.setControlVector(nx, nz);
    };
    if (base && knob) {
      base.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        joystickPointer = event.pointerId;
        base.setPointerCapture(event.pointerId);
        moveJoystick(event);
      });
      base.addEventListener('pointermove', moveJoystick);
      const resetJoystick = (event) => {
        if (joystickPointer !== event.pointerId) return;
        joystickPointer = null;
        knob.style.transform = 'translate(0, 0)';
        this.character.setControlVector(0, 0);
      };
      base.addEventListener('pointerup', resetJoystick);
      base.addEventListener('pointercancel', resetJoystick);
    }
    this.setControlMode('tap');
  }

  /**
   * Canvas'a tek dokunma/tıklama yapıldığında Raycasting uygular
   * @private
   */
  _handleCanvasTap(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // 1. Önce Menteşeli Kapı Tıklaması Denetimi
    const doorMesh = this.door.getInteractiveMesh();
    if (doorMesh) {
      const doorHits = this.raycaster.intersectObject(doorMesh, true);
      if (doorHits.length > 0) {
        const recordOnly = this.timelineManager?.isRecording && this.timelineManager?.playMode === 'scheduled';
        // Eğer Reji Kayıt Modu açıksa bu kapı tıklamasını adıma ekle
        if (this.timelineManager && this.timelineManager.isRecording) {
          this.timelineManager.recordClickAsStep(ACTION_TYPES.TRIGGER_DOOR, {
            action: this.door.isOpen ? 'close' : 'open',
          });
        }
        if (!recordOnly) this.door.toggle();
        if (this.uiManager) {
          this.uiManager.showToast(recordOnly ? 'Kapı eylemi zaman çizelgesine eklendi' : `Kapı ${this.door.isOpen ? 'Açıldı' : 'Kapatıldı'}`);
        }
        return;
      }
    }

    const worldSpriteHit = this.raycaster.intersectObjects(this.worldSpriteCharacterManager.actors.map((actor) => actor.sprite), false)[0];
    if (worldSpriteHit) {
      const actor = this.worldSpriteCharacterManager.getActorForSprite(worldSpriteHit.object);
      if (actor) {
        this.worldSpriteCharacterManager.select(actor.id);
        this.uiManager?.showToast(`2D dünya karakteri seçildi: ${actor.name}`);
      }
      return;
    }

    // 2. Yürünebilir Zeminler / Merdivenler / Katlar Denetimi
    const walkableList = [
      this.groundShadowPlane,
      ...this.testWalkableSurfaces,
      ...this.collisionManager.walkableSurfaces,
    ];

    const hits = this.raycaster.intersectObjects(walkableList, true);

    if (hits.length > 0) {
      const targetPoint = hits[0].point;

      // Eğer 2D dünya karakteri seçiliyse bu dokunuş yalnızca o aktörü yürütür.
      // Aksi durumda kayıt modu tıklanan 3D koordinatı zaman çizelgesine ekleyebilir.
        if (!this.worldSpriteCharacterManager.activeControl && this.timelineManager && this.timelineManager.isRecording) {
          this.timelineManager.recordClickAsStep(ACTION_TYPES.MOVE_TO, {
            x: Number(targetPoint.x.toFixed(2)),
            y: Number(targetPoint.y.toFixed(2)),
            z: Number(targetPoint.z.toFixed(2)),
          }, this.uiManager?.getTimelineActionOptions?.());
        }

      // Karakteri hedef noktaya yönlendir
      if (this.worldSpriteCharacterManager.activeControl) {
        this.worldSpriteCharacterManager.moveSelectedTo(targetPoint);
      } else if (this.controlMode === 'tap' && !(this.timelineManager?.isRecording && this.timelineManager?.playMode === 'scheduled')) {
        this.character.moveTo(targetPoint);
      }
    }
  }

  _updateCharacterHUD(isMoving) {
    const label = document.getElementById('label-char-mode');
    if (label) {
      label.textContent = isMoving ? 'Karakter: Yürüyor' : 'Karakter: Boşta';
    }
  }

  _updateDoorHUD(isOpen) {
    const label = document.getElementById('label-door-mode');
    const btn = document.getElementById('btn-quick-door');
    if (label) label.textContent = isOpen ? 'Kapı: Açık' : 'Kapı: Kapalı';
    if (btn) btn.textContent = isOpen ? 'Kapıyı Kapat' : 'Kapıyı Aç';
  }

  _updateCameraHUD(state) {
    const label = document.getElementById('label-camera-mode');
    if (label) {
      label.textContent = state.mode === 'free' ? 'Serbest Orbit' : (state.stationName || 'Sabit CCTV');
    }
    if (this.uiManager && state.stations) {
      this.uiManager.updateCameraList(state.stations, state.activeId);
    }
  }

  _updateMapHUD(status) {
    if (this.uiManager) {
      this.uiManager.showToast(status.message);
    }
  }

  _onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.spriteCamera.left = 0;
    this.spriteCamera.right = window.innerWidth;
    this.spriteCamera.top = window.innerHeight;
    this.spriteCamera.bottom = 0;
    this.spriteCamera.updateProjectionMatrix();
    this.spriteAnimationManager.resize(window.innerWidth, window.innerHeight);
  }

  /**
   * Ana Animasyon & Render Döngüsü (60 FPS)
   * @private
   */
  _animate() {
    requestAnimationFrame(() => this._animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const charPos = this.character.getPosition();
    const roomBounds = this.door.getRoomBounds();

    // 1. Karakter Navigasyonu ve Prosedürel Animasyon
    this.character.update(delta);
    this.worldSpriteCharacterManager.update(delta);
    this.spriteAnimationManager.update(delta);

    // 2. Menteşeli Kapı ve Kesit (Cutaway) Ön Duvarlar
    this.door.update(delta, charPos);

    // 3. Kamera Hareketi & Odaya Giriş/Çıkış CCTV Tetikleyicisi
    this.cameraManager.update(delta, charPos, roomBounds);

    // 4. 3D sahne ve üzerine saydam 2D spritesheet katmanı
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.spriteScene, this.spriteCamera);
  }
}

// Uygulamayı Başlat
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
