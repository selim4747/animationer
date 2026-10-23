/**
 * MapLoader.js
 * 3D (.glb, .gltf) ve 2D (.png, .jpg, .webp) harita/zemin yükleyici sınıfı.
 * Yüklenen 3D modellerdeki duvarları ve 2D harita için kullanıcı engel kutularını
 * CollisionManager'a otomatik kaydeder.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class MapLoader {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   * @param {CollisionManager} collisionManager - Çarpışma yöneticisi
   * @param {Function} onStatusChange - Bildirim geri çağırma işlevi
   */
  constructor(scene, collisionManager = null, onStatusChange = () => {}) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.onStatusChange = onStatusChange;

    this.currentLoadedObject = null;
    this.currentObjectType = 'none'; // '3d' | '2d' | 'none'
    this.currentTexture = null;
    this.currentPlane = null;
    this.registered3DColliders = [];

    this.imageAspectRatio = 1.0;
    this.isGroundOrientation = true;
    this.baseWidth = 16.0;
    this.currentScale = 16.0;
    this.currentOpacity = 1.0;

    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
  }

  setCollisionManager(collisionManager) {
    this.collisionManager = collisionManager;
  }

  /**
   * Sahnede var olan haritayı/modeli ve ilgili çarpışma nesnelerini temizler
   */
  clear() {
    // 3D Model ile eklenen collider'ları CollisionManager'dan kaldır
    if (this.collisionManager && this.registered3DColliders.length > 0) {
      this.registered3DColliders.forEach((col) => this.collisionManager.removeCollider(col));
      this.registered3DColliders = [];
    }

    if (this.currentLoadedObject) {
      this.scene.remove(this.currentLoadedObject);
      this.currentLoadedObject.traverse((node) => {
        if (node.isMesh) {
          node.geometry?.dispose();
          if (Array.isArray(node.material)) {
            node.material.forEach((mat) => mat.dispose());
          } else {
            node.material?.dispose();
          }
        }
      });
      this.currentLoadedObject = null;
    }

    if (this.currentTexture) {
      this.currentTexture.dispose();
      this.currentTexture = null;
    }

    this.currentPlane = null;
    this.currentObjectType = 'none';
    this.onStatusChange({ type: 'cleared', name: null });
  }

  /**
   * 3D GLB veya GLTF dosyasını yükler ve duvarları çarpışma sistemine bağlar
   * @param {string} url - Dosya ObjectURL veya bağlantısı
   * @param {string} fileName - Dosya adı
   */
  loadGLTF(url, fileName = 'Model.glb') {
    this.clear();
    this.onStatusChange({ type: 'loading', name: fileName });

    this.gltfLoader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        this.currentLoadedObject = model;
        this.currentObjectType = '3d';

        // BoundingBox hesapla: X ve Z ekseninde ortala, tabanı Y = 0 zeminine oturt
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= box.min.y;

        // Gölgeleri aç ve duvar/engel mesh'lerini CollisionManager'a kaydet
        const wallRegex = /wall|duvar|obstacle|col|barrier|pillar|sutun|border/i;
        model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;

            // Eğer adı duvar içeriyorsa veya zemin olmayan dikey bir nesneyse collider yap
            const isNamedObstacle = wallRegex.test(node.name);
            const isVerticalObstacle = node.geometry && !/floor|ground|zemin|plane/i.test(node.name);

            if (isNamedObstacle || isVerticalObstacle) {
              if (this.collisionManager) {
                this.collisionManager.addCollider(node);
                this.registered3DColliders.push(node);
              }
            }
          }
        });

        this.scene.add(model);
        this.onStatusChange({
          type: 'loaded',
          category: '3d',
          name: fileName,
          object: model,
          box: new THREE.Box3().setFromObject(model),
          colliderCount: this.registered3DColliders.length,
        });
      },
      undefined,
      (error) => {
        console.error('GLTF Yükleme Hatası:', error);
        this.onStatusChange({ type: 'error', message: '3D Model yüklenemedi!' });
      }
    );
  }

  /**
   * 2D Görseli (PNG, JPG, WEBP) yükler ve orijinal en-boy oranıyla PlaneGeometry oluşturur
   * @param {string} url - Görsel ObjectURL veya bağlantısı
   * @param {string} fileName - Dosya adı
   */
  loadImage(url, fileName = 'Gorsel.png') {
    this.clear();
    this.onStatusChange({ type: 'loading', name: fileName });

    this.textureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        this.currentTexture = texture;
        this.currentObjectType = '2d';

        const width = texture.image?.width || 1200;
        const height = texture.image?.height || 800;
        this.imageAspectRatio = width / height;

        const planeW = this.baseWidth;
        const planeH = this.baseWidth / this.imageAspectRatio;

        const geometry = new THREE.PlaneGeometry(planeW, planeH);

        // Şeffaf PNG desteği: transparent: true, alphaTest: 0.1
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.1,
          depthWrite: true,
          side: THREE.DoubleSide,
          roughness: 0.5,
          metalness: 0.05,
          opacity: this.currentOpacity,
        });

        this.currentPlane = new THREE.Mesh(geometry, material);
        this.currentPlane.receiveShadow = true;
        this.currentPlane.castShadow = false;

        this.currentLoadedObject = this.currentPlane;
        this.scene.add(this.currentPlane);

        // Varsayılan olarak yatay zemin (XZ) ayarla
        this.setOrientation(this.isGroundOrientation);

        this.onStatusChange({
          type: 'loaded',
          category: '2d',
          name: fileName,
          object: this.currentPlane,
          aspectRatio: this.imageAspectRatio,
        });
      },
      undefined,
      (error) => {
        console.error('Görsel Yükleme Hatası:', error);
        this.onStatusChange({ type: 'error', message: 'Görsel yüklenemedi!' });
      }
    );
  }

  /**
   * 2D Görselin yatay (zemin XZ) veya dikey (arka plan XY) açısını değiştirir
   * @param {boolean} isGround
   */
  setOrientation(isGround) {
    if (!this.currentPlane) return;
    this.isGroundOrientation = isGround;

    const width = this.currentScale;
    const height = this.currentScale / this.imageAspectRatio;

    this.currentPlane.geometry.dispose();
    this.currentPlane.geometry = new THREE.PlaneGeometry(width, height);

    if (isGround) {
      this.currentPlane.rotation.x = -Math.PI / 2;
      this.currentPlane.rotation.y = 0;
      this.currentPlane.rotation.z = 0;
      this.currentPlane.position.set(0, 0.012, 0);
    } else {
      this.currentPlane.rotation.x = 0;
      this.currentPlane.rotation.y = 0;
      this.currentPlane.rotation.z = 0;
      this.currentPlane.position.set(0, height / 2, 0);
    }
  }

  setScale(scale) {
    this.currentScale = scale;
    if (this.currentPlane) {
      this.setOrientation(this.isGroundOrientation);
    }
  }

  setOpacity(opacity) {
    this.currentOpacity = opacity;
    if (this.currentPlane && this.currentPlane.material) {
      this.currentPlane.material.opacity = opacity;
      this.currentPlane.material.transparent = opacity < 1.0 || true;
    }
  }

  handleFile(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    const url = URL.createObjectURL(file);

    if (name.endsWith('.glb') || name.endsWith('.gltf')) {
      this.loadGLTF(url, file.name);
    } else if (
      name.endsWith('.png') ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.webp')
    ) {
      this.loadImage(url, file.name);
    } else {
      this.onStatusChange({
        type: 'error',
        message: 'Desteklenmeyen dosya türü! (.glb, .gltf, .png, .jpg, .webp)',
      });
    }
  }

  /**
   * Kullanıcının 2D harita üzerine monokrom tel kafes engel kutusu eklemesini sağlar
   * @param {number} x
   * @param {number} z
   * @param {number} w
   * @param {number} d
   */
  createWallBox(x = 0, z = 0, w = 2.0, d = 0.5) {
    if (!this.collisionManager) return null;
    const box = this.collisionManager.addWallBox(x, z, w, d, 2.0);
    this.onStatusChange({ type: 'wallBoxAdded', box, count: this.collisionManager.wallBoxes.length });
    return box;
  }

  clearAllWallBoxes() {
    if (this.collisionManager) {
      this.collisionManager.clearWallBoxes();
      this.onStatusChange({ type: 'wallBoxesCleared' });
    }
  }

  /**
   * 2D Kat planı demosunu ve sınır engel kutularını otomatik kurar
   */
  loadDemoFloorPlan() {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    const rooms = [
      { name: 'KORİDOR / GİRİŞ', x: 80, y: 80, w: 420, h: 480 },
      { name: 'ANA SALON', x: 520, y: 80, w: 1000, h: 480 },
      { name: 'OFİS', x: 80, y: 580, w: 580, h: 340 },
      { name: 'LABORATUVAR', x: 680, y: 580, w: 840, h: 340 },
    ];

    rooms.forEach((r) => {
      ctx.fillStyle = '#181818';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(r.name, r.x + 20, r.y + 40);

      ctx.fillStyle = '#888888';
      ctx.font = '13px monospace';
      ctx.fillText(`${(r.w / 100).toFixed(1)}m × ${(r.h / 100).toFixed(1)}m`, r.x + 20, r.y + 66);
    });

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.strokeRect(80, 80, 1440, 840);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      this.loadImage(url, 'Demo_Kat_Plani.png');

      // 2D planın sınırlarına ve iç bölmelerine otomatik tel kafes engel kutuları yerleştir
      if (this.collisionManager) {
        this.clearAllWallBoxes();
        // Dış sınır duvarları
        this.createWallBox(0, 4.8, 16.0, 0.4);   // Ön duvar
        this.createWallBox(0, -4.8, 16.0, 0.4);  // Arka duvar
        this.createWallBox(-7.8, 0, 0.4, 10.0);  // Sol duvar
        this.createWallBox(7.8, 0, 0.4, 10.0);   // Sağ duvar
        // İç oda bölme duvarı (kapı aralıklı)
        this.createWallBox(-2.5, 0.5, 0.4, 4.5);
        this.createWallBox(2.5, 0.5, 0.4, 4.5);
      }
    });
  }

  /**
   * Monokrom 3D Galeri ve duvar engellerini oluşturur
   */
  loadDemo3DGallery() {
    this.clear();
    const group = new THREE.Group();

    // Zemin
    const floorGeo = new THREE.BoxGeometry(22, 0.4, 18);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.4 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = 0.2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    group.add(floor);

    // Arka Duvar (Engel)
    const wallGeo = new THREE.BoxGeometry(22, 7, 0.5);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 3.7, -8.7);
    wall.receiveShadow = true;
    wall.name = 'backWall';
    group.add(wall);

    // Yan Duvar (Engel)
    const sideWallGeo = new THREE.BoxGeometry(0.5, 7, 18);
    const sideWall = new THREE.Mesh(sideWallGeo, wallMat);
    sideWall.position.set(-10.7, 3.7, 0);
    sideWall.receiveShadow = true;
    sideWall.name = 'sideWall';
    group.add(sideWall);

    // Monokrom Heykel Kaidesi (Engel)
    const pedGeo = new THREE.CylinderGeometry(1.6, 2.0, 1.2, 32);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 });
    const pedestal = new THREE.Mesh(pedGeo, pedMat);
    pedestal.position.set(0, 1.0, 0);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    pedestal.name = 'pedestal_obstacle';
    group.add(pedestal);

    // Heykel
    const knotGeo = new THREE.TorusKnotGeometry(0.9, 0.28, 128, 32);
    const knotMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.15,
      metalness: 0.95,
    });
    const knot = new THREE.Mesh(knotGeo, knotMat);
    knot.position.set(0, 2.7, 0);
    knot.castShadow = true;
    group.add(knot);

    // Duvarları CollisionManager'a ekle
    if (this.collisionManager) {
      this.collisionManager.addCollider(wall);
      this.collisionManager.addCollider(sideWall);
      this.collisionManager.addCollider(pedestal);
      this.registered3DColliders.push(wall, sideWall, pedestal);
    }

    this.currentLoadedObject = group;
    this.currentObjectType = '3d';
    this.scene.add(group);

    this.onStatusChange({
      type: 'loaded',
      category: '3d',
      name: '3D Galeri (Örnek)',
      object: group,
      box: new THREE.Box3().setFromObject(group),
      colliderCount: this.registered3DColliders.length,
    });
  }

  getWalkableObjects() {
    const list = [];
    if (this.currentPlane && this.isGroundOrientation) {
      list.push(this.currentPlane);
    }
    if (this.currentLoadedObject && this.currentObjectType === '3d') {
      this.currentLoadedObject.traverse((node) => {
        if (node.isMesh) list.push(node);
      });
    }
    return list;
  }
}
