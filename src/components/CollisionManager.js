/**
 * CollisionManager.js
 * Gelişmiş AABB Hacim Çarpışması ve Duvar/Mobilya Kayma (Wall/Prop Sliding) Sistemi.
 * Masalar, sehpalar, koltuklar, sandalyeler ve duvarlar dahil tüm sahne nesnelerini
 * 3D hacimsel sınır kutuları (Axis-Aligned Bounding Box) olarak ele alır.
 * Karakterin silindir kütlesinin (radius: 0.35m, height: 1.6m) mobilyaların içine
 * girmesini kesin olarak engeller.
 */

import * as THREE from 'three';

export class CollisionManager {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   */
  constructor(scene) {
    this.scene = scene;

    // Kayıtlı nesneler ve bunların dünya uzayındaki BoundingBox'ları
    // { object: THREE.Object3D, box: THREE.Box3, isStatic: boolean }
    this.registeredObstacles = [];

    // Kullanıcının 2D harita editöründen eklediği tel kafes engel kutuları
    this.wallBoxes = [];

    // Raycast ve geçici vektörler
    this.raycaster = new THREE.Raycaster();
    this._tempBox = new THREE.Box3();
    this._tempVec = new THREE.Vector3();
  }

  /**
   * Bir 3D nesneyi (Masa, sandalye, duvar vb.) hacimsel engel olarak kaydeder.
   * Nesnenin ve tüm alt parçalarının (bacaklar, tabla) dünya BoundingBox'ını çıkarır.
   * @param {THREE.Object3D} object3D
   * @returns {THREE.Box3}
   */
  registerObstacle(object3D) {
    if (!object3D) return null;

    // Nesnenin ve tüm alt çocuklarının dünya matrisini güncelle
    object3D.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(object3D);

    // Boş kutuları veya geçersiz geometrileri filtrele
    if (box.isEmpty() || !isFinite(box.min.x)) {
      return null;
    }

    // Zaten kayıtlıysa kutuyu güncelle
    const existing = this.registeredObstacles.find((item) => item.object === object3D);
    if (existing) {
      existing.box.copy(box);
      return existing.box;
    }

    this.registeredObstacles.push({
      object: object3D,
      box: box,
    });

    return box;
  }

  /**
   * Engeli kayıttan kaldırır
   * @param {THREE.Object3D} object3D
   */
  unregisterObstacle(object3D) {
    if (!object3D) return;
    const index = this.registeredObstacles.findIndex((item) => item.object === object3D);
    if (index !== -1) {
      this.registeredObstacles.splice(index, 1);
    }
  }

  /**
   * Geriye dönük uyumluluk: addCollider çağrılarını registerObstacle'a yönlendirir
   * @param {THREE.Object3D} object
   */
  addCollider(object) {
    this.registerObstacle(object);
  }

  /**
   * Geriye dönük uyumluluk: removeCollider çağrılarını unregisterObstacle'a yönlendirir
   * @param {THREE.Object3D} object
   */
  removeCollider(object) {
    this.unregisterObstacle(object);
  }

  /**
   * Tüm kayıtlı engelleri temizler
   */
  clearColliders() {
    this.registeredObstacles = [];
  }

  /**
   * 2D Harita için kullanıcı tarafından eklenen tel kafes engel kutusu oluşturur
   * @param {number} x - Merkez X
   * @param {number} z - Merkez Z
   * @param {number} width - Genişlik (X)
   * @param {number} depth - Derinlik (Z)
   * @param {number} height - Yükseklik (Y)
   * @returns {THREE.Mesh}
   */
  addWallBox(x = 0, z = 0, width = 2.0, depth = 2.0, height = 2.0) {
    const geo = new THREE.BoxGeometry(width, height, depth);

    // Monokrom yarı saydam dolgu
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1f1f1f,
      roughness: 0.5,
      transparent: true,
      opacity: 0.4,
      wireframe: false,
    });

    const boxMesh = new THREE.Mesh(geo, mat);
    boxMesh.position.set(x, height / 2, z);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    boxMesh.userData = { isWallBox: true, width, depth, height };

    // Tel kafes beyaz kenarlık
    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff });
    const wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
    boxMesh.add(wireframe);

    this.scene.add(boxMesh);
    this.registerObstacle(boxMesh);
    this.wallBoxes.push(boxMesh);

    return boxMesh;
  }

  removeWallBox(boxMesh) {
    if (!boxMesh) return;
    this.unregisterObstacle(boxMesh);
    const idx = this.wallBoxes.indexOf(boxMesh);
    if (idx !== -1) {
      this.wallBoxes.splice(idx, 1);
    }
    this.scene.remove(boxMesh);
    boxMesh.geometry?.dispose();
    if (boxMesh.material) boxMesh.material.dispose();
  }

  clearWallBoxes() {
    [...this.wallBoxes].forEach((box) => this.removeWallBox(box));
    this.wallBoxes = [];
  }

  /**
   * Tüm engellerin dünya koordinat kutularını günceller
   * (Hareketli kapılar veya dönen nesneler için çağrılabilir)
   */
  updateObstacleBoxes() {
    for (let i = 0; i < this.registeredObstacles.length; i++) {
      const entry = this.registeredObstacles[i];
      if (entry.object && entry.object.visible !== false) {
        entry.box.setFromObject(entry.object);
      }
    }
  }

  /**
   * Tıklanan hedef noktasının bir masanın veya engelin içinde olup olmadığını denetler.
   * Eğer içindeyse, hedefi engelin dışındaki en yakın serbest noktaya öteler.
   * Böylece karakter masanın üstüne tırmanmaz veya içine girmeye çalışmaz.
   *
   * @param {THREE.Vector3} targetPoint - Kullanıcının tıkladığı zemin koordinatı
   * @param {number} radius - Karakter çarpışma yarıçapı
   * @returns {THREE.Vector3} - Düzeltilmiş güvenli hedef noktası
   */
  clampTargetOutsideObstacles(targetPoint, radius = 0.35) {
    const clamped = targetPoint.clone();
    clamped.y = 0;

    for (let i = 0; i < this.registeredObstacles.length; i++) {
      const { object, box } = this.registeredObstacles[i];
      if (!object || object.visible === false) continue;

      // Zemin hizasında kontrol et
      if (box.max.y <= 0.1 || box.min.y >= 2.0) continue;

      const expandedMinX = box.min.x - radius;
      const expandedMaxX = box.max.x + radius;
      const expandedMinZ = box.min.z - radius;
      const expandedMaxZ = box.max.z + radius;

      // Eğer hedef nokta engelin genişletilmiş kutusunun içindeyse
      if (
        clamped.x >= expandedMinX &&
        clamped.x <= expandedMaxX &&
        clamped.z >= expandedMinZ &&
        clamped.z <= expandedMaxZ
      ) {
        // En yakın dış kenara ötele
        const distLeft = Math.abs(clamped.x - expandedMinX);
        const distRight = Math.abs(expandedMaxX - clamped.x);
        const distBack = Math.abs(clamped.z - expandedMinZ);
        const distFront = Math.abs(expandedMaxZ - clamped.z);

        const minDist = Math.min(distLeft, distRight, distBack, distFront);

        if (minDist === distLeft) clamped.x = expandedMinX - 0.05;
        else if (minDist === distRight) clamped.x = expandedMaxX + 0.05;
        else if (minDist === distBack) clamped.z = expandedMinZ - 0.05;
        else clamped.z = expandedMaxZ + 0.05;
      }
    }

    return clamped;
  }

  /**
   * Karakterin dairesel silindir kütlesi ile kutu (AABB) arasındaki 2D kesişimi test eder.
   * @private
   * @param {number} cx - Karakter X
   * @param {number} cz - Karakter Z
   * @param {number} radius - Karakter yarıçapı
   * @param {THREE.Box3} box - Engel kutusu
   * @param {number} charMinY - Karakter taban Y
   * @param {number} charMaxY - Karakter tavan Y
   * @returns {boolean}
   */
  _testCircleBoxOverlap(cx, cz, radius, box, charMinY, charMaxY) {
    // Dikey Y ekseni örtüşme kontrolü:
    // Masa 0.0m - 0.9m arasında, karakter 0.0m - 1.6m arasında -> Örtüşür!
    if (charMinY >= box.max.y || charMaxY <= box.min.y) {
      return false;
    }

    // XZ düzleminde AABB'ye en yakın noktayı bul
    const closestX = THREE.MathUtils.clamp(cx, box.min.x, box.max.x);
    const closestZ = THREE.MathUtils.clamp(cz, box.min.z, box.max.z);

    const distX = cx - closestX;
    const distZ = cz - closestZ;
    const distSq = distX * distX + distZ * distZ;

    return distSq < radius * radius;
  }

  /**
   * Karakterin bir sonraki hareket adımını (stepVector) tüm kayıtlı mobilya ve duvarlara karşı çözer.
   * Eksenel Ayrıştırma (Axis-Separated Sliding):
   * Eğer X eksenindeki hareket masaya çarpıyorsa X sıfırlanır, Z serbestçe devam eder (veya tersi).
   * Böylece karakter masanın kenarına takılmadan pürüzsüzce duvar/masa boyunca kayar.
   *
   * @param {THREE.Vector3} currentPos - Karakterin mevcut pozisyonu
   * @param {THREE.Vector3} stepVector - İstenen hareket adımı
   * @param {number} radius - Karakter yarıçapı (varsayılan 0.35m)
   * @param {number} height - Karakter boyu (varsayılan 1.6m)
   * @returns {{ resolvedStep: THREE.Vector3, isColliding: boolean }}
   */
  resolveMovement(currentPos, stepVector, radius = 0.35, height = 1.6) {
    if (this.registeredObstacles.length === 0 || stepVector.lengthSq() < 0.000001) {
      return { resolvedStep: stepVector.clone(), isColliding: false };
    }

    const charMinY = currentPos.y + 0.05;
    const charMaxY = currentPos.y + height;

    let posX = currentPos.x;
    let posZ = currentPos.z;

    const desiredDx = stepVector.x;
    const desiredDz = stepVector.z;

    let allowedDx = desiredDx;
    let allowedDz = desiredDz;
    let collisionOccurred = false;

    // 1. ADIM: Sadece X eksenindeki hareketi test et
    const nextX = posX + desiredDx;
    for (let i = 0; i < this.registeredObstacles.length; i++) {
      const { object, box } = this.registeredObstacles[i];
      if (!object || object.visible === false) continue;

      if (this._testCircleBoxOverlap(nextX, posZ, radius, box, charMinY, charMaxY)) {
        // X ekseninde çarpışma var: X adımını engelle
        allowedDx = 0;
        collisionOccurred = true;
        break;
      }
    }

    // 2. ADIM: Sadece Z eksenindeki hareketi test et (X adımı uygulanmışken)
    const currentOrResolvedX = posX + allowedDx;
    const nextZ = posZ + desiredDz;
    for (let i = 0; i < this.registeredObstacles.length; i++) {
      const { object, box } = this.registeredObstacles[i];
      if (!object || object.visible === false) continue;

      if (this._testCircleBoxOverlap(currentOrResolvedX, nextZ, radius, box, charMinY, charMaxY)) {
        // Z ekseninde çarpışma var: Z adımını engelle
        allowedDz = 0;
        collisionOccurred = true;
        break;
      }
    }

    // 3. ADIM: Çapraz Köşe Kontrolü (Diagonal Corner Verification)
    // Nadir köşeli durumlarda X ve Z tek tek serbest olsa bile ikisi birden köşeye batabilir
    if (allowedDx !== 0 && allowedDz !== 0) {
      const diagonalX = posX + allowedDx;
      const diagonalZ = posZ + allowedDz;
      for (let i = 0; i < this.registeredObstacles.length; i++) {
        const { object, box } = this.registeredObstacles[i];
        if (!object || object.visible === false) continue;

        if (this._testCircleBoxOverlap(diagonalX, diagonalZ, radius, box, charMinY, charMaxY)) {
          // Çaprazda temas var: daha büyük olan ekseni koru, diğerini sıfırla
          collisionOccurred = true;
          if (Math.abs(desiredDx) > Math.abs(desiredDz)) {
            allowedDz = 0;
          } else {
            allowedDx = 0;
          }
          break;
        }
      }
    }

    // 4. ADIM: Gömülme Önleme ve Geri İtme (Depenetration Push-out)
    // Karakter bir nesnenin içine biraz sıkışmışsa, en yakın dış sınıra hafifçe itilir
    const finalX = posX + allowedDx;
    const finalZ = posZ + allowedDz;
    let pushX = 0;
    let pushZ = 0;

    for (let i = 0; i < this.registeredObstacles.length; i++) {
      const { object, box } = this.registeredObstacles[i];
      if (!object || object.visible === false) continue;

      if (charMinY >= box.max.y || charMaxY <= box.min.y) continue;

      const closestX = THREE.MathUtils.clamp(finalX, box.min.x, box.max.x);
      const closestZ = THREE.MathUtils.clamp(finalZ, box.min.z, box.max.z);
      const diffX = finalX - closestX;
      const diffZ = finalZ - closestZ;
      const dist = Math.hypot(diffX, diffZ);

      if (dist < radius) {
        collisionOccurred = true;
        const penetration = radius - dist;
        if (dist > 0.0001) {
          pushX += (diffX / dist) * penetration;
          pushZ += (diffZ / dist) * penetration;
        } else {
          // Karakter tamamen kutunun iç merkezine denk geldiyse en yakın kenara it
          const dLeft = Math.abs(finalX - box.min.x);
          const dRight = Math.abs(box.max.x - finalX);
          const dBack = Math.abs(finalZ - box.min.z);
          const dFront = Math.abs(box.max.z - finalZ);
          const minD = Math.min(dLeft, dRight, dBack, dFront);
          if (minD === dLeft) pushX -= (radius + 0.02);
          else if (minD === dRight) pushX += (radius + 0.02);
          else if (minD === dBack) pushZ -= (radius + 0.02);
          else pushZ += (radius + 0.02);
        }
      }
    }

    const resolvedStep = new THREE.Vector3(
      allowedDx + pushX,
      0,
      allowedDz + pushZ
    );

    return {
      resolvedStep: resolvedStep,
      isColliding: collisionOccurred,
    };
  }
}
