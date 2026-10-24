/**
 * CollisionManager.js
 * Çok katlı binalar (merdivenler, 2. kat, asma kat) ve devasa haritalar için:
 * 1. Mekânsal Filtreleme (Spatial Proximity Culling): Karakter etrafındaki (10m) engelleri tarayarak 60 FPS korur.
 * 2. Çok Katlı Dikey Çarpışma (Vertical Floor Snapping): Aşağı yönlü ışın (Downwards Raycast) ile basamak, rampa ve 2. kat zeminini algılar.
 * 3. Eksenel Kayma ve Kat Tabanı Ayrıştırma: 2. kattaki karakter zemin kattaki masaya çarpmaz.
 */

import * as THREE from 'three';

export class CollisionManager {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   */
  constructor(scene) {
    this.scene = scene;

    // Kayıtlı engeller ve BoundingBox'ları
    // { object: THREE.Object3D, box: THREE.Box3, center: THREE.Vector3 }
    this.registeredObstacles = [];

    // Yürünebilir zeminler (Zemin kat, merdiven basamakları, rampalar, 2. kat platformu)
    this.walkableSurfaces = [];

    // 2D Harita editörü tel kafes kutuları
    this.wallBoxes = [];

    // Raycast motorları
    this.downRaycaster = new THREE.Raycaster();
    this.downRaycaster.far = 15.0; // Dikey zemin algılama menzili

    this.horizontalRaycaster = new THREE.Raycaster();
    this.horizontalRaycaster.far = 2.0;

    // Geçici matematiksel yardımcılar (Sıfır Garbage Collection)
    this._downOrigin = new THREE.Vector3();
    this._downDir = new THREE.Vector3(0, -1, 0);
    this._tempBox = new THREE.Box3();
    this._tempCenter = new THREE.Vector3();

    // Mekânsal yakınlık yarıçapı (metre)
    this.proximityRadiusSq = 12.0 * 12.0;
  }

  /**
   * Yürünebilir bir yüzey mesh'i kaydeder (Basamak, rampa, kat döşemesi)
   * @param {THREE.Object3D} mesh
   */
  registerWalkableSurface(mesh) {
    if (!mesh) return;
    if (!this.walkableSurfaces.includes(mesh)) {
      this.walkableSurfaces.push(mesh);
    }
  }

  /**
   * Yürünebilir yüzeyi listeden çıkarır
   * @param {THREE.Object3D} mesh
   */
  unregisterWalkableSurface(mesh) {
    if (!mesh) return;
    const idx = this.walkableSurfaces.indexOf(mesh);
    if (idx !== -1) {
      this.walkableSurfaces.splice(idx, 1);
    }
  }

  clearWalkableSurfaces() {
    this.walkableSurfaces = [];
  }

  /**
   * Bir 3D nesneyi (Duvar, masa, korkuluk vb.) hacimsel engel (AABB) olarak kaydeder.
   * @param {THREE.Object3D} object3D
   * @returns {THREE.Box3}
   */
  registerObstacle(object3D) {
    if (!object3D) return null;

    object3D.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object3D);

    if (box.isEmpty() || !isFinite(box.min.x)) {
      return null;
    }

    const center = box.getCenter(new THREE.Vector3());

    const existing = this.registeredObstacles.find((item) => item.object === object3D);
    if (existing) {
      existing.box.copy(box);
      existing.center.copy(center);
      return existing.box;
    }

    this.registeredObstacles.push({
      object: object3D,
      box: box,
      center: center,
    });

    return box;
  }

  unregisterObstacle(object3D) {
    if (!object3D) return;
    const index = this.registeredObstacles.findIndex((item) => item.object === object3D);
    if (index !== -1) {
      this.registeredObstacles.splice(index, 1);
    }
  }

  addCollider(object) {
    this.registerObstacle(object);
  }

  removeCollider(object) {
    this.unregisterObstacle(object);
  }

  clearColliders() {
    this.registeredObstacles = [];
  }

  /**
   * 2D Harita için kullanıcı tarafından eklenen tel kafes engel kutusu oluşturur
   */
  addWallBox(x = 0, z = 0, width = 2.0, depth = 2.0, height = 2.0) {
    const geo = new THREE.BoxGeometry(width, height, depth);
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
    boxMesh.traverse((child) => {
      if (child === boxMesh) return;
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material?.dispose?.());
    });
    boxMesh.geometry?.dispose();
    if (boxMesh.material) boxMesh.material.dispose();
  }

  clearWallBoxes() {
    [...this.wallBoxes].forEach((box) => this.removeWallBox(box));
    this.wallBoxes = [];
  }

  updateObstacleBoxes() {
    for (let i = 0; i < this.registeredObstacles.length; i++) {
      const entry = this.registeredObstacles[i];
      if (entry.object && entry.object.visible !== false) {
        entry.box.setFromObject(entry.object);
        entry.box.getCenter(entry.center);
      }
    }
  }

  /**
   * Dikey Zemin Algılama (Vertical Floor Snapping):
   * Karakterin gövdesinden (pos.y + 1.2) aşağıya doğru (0, -1, 0) ışın fırlatarak
   * merdiven basamağı, rampa veya 2. kat zemin yüksekliğini tam olarak hesaplar.
   *
   * @param {THREE.Vector3} pos - Karakterin (X, Y, Z) konumu
   * @param {number} currentFloorY - Mevcut zemin yüksekliği
   * @returns {number} - Karakterin basması gereken hedef zemin Y yüksekliği
   */
  getFloorHeight(pos, currentFloorY = 0) {
    if (this.walkableSurfaces.length === 0) {
      return 0;
    }

    // Karakterin mevcut yüksekliğinin biraz üstünden aşağıya doğru ışın at
    const rayCastHeight = (pos.y || currentFloorY) + 1.2;
    this._downOrigin.set(pos.x, rayCastHeight, pos.z);
    this.downRaycaster.set(this._downOrigin, this._downDir);

    const activeSurfaces = this.walkableSurfaces.filter((s) => s && s.visible !== false);
    const hits = this.downRaycaster.intersectObjects(activeSurfaces, true);

    if (hits.length > 0) {
      for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        const hitY = hit.point.y;

        // Işın başlangıç noktasından daha yukarıdaki veya saçma derecede yüksek tavanları atla
        if (hitY > rayCastHeight + 0.1) continue;

        // Eğim / Tırmanma Açısı Kontrolü:
        // Yüzey normalinin dikey Y bileşeni en az 0.64 olmalı (yaklaşık 50 dereceden dik olamaz)
        let isWalkableSlope = true;
        if (hit.face) {
          const normalWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          if (normalWorld.y < 0.64) {
            isWalkableSlope = false; // Çok dik yüzey (duvar muamelesi)
          }
        }

        if (isWalkableSlope) {
          return hitY;
        }
      }
    }

    return 0; // Varsayılan zemin
  }

  /**
   * Hedef noktasını bir engelin içindeyse en yakın serbest noktaya kenetler.
   * Yükseklik bazlı filtreleme ile üst kattaki tıklamalarda alt kattaki masaya kenetlenmez.
   *
   * @param {THREE.Vector3} targetPoint - Hedef koordinat
   * @param {number} radius - Karakter yarıçapı
   * @returns {THREE.Vector3}
   */
  clampTargetOutsideObstacles(targetPoint, radius = 0.35) {
    const clamped = targetPoint.clone();
    const targetY = targetPoint.y || 0;

    for (let i = 0; i < this.registeredObstacles.length; i++) {
      const { object, box } = this.registeredObstacles[i];
      if (!object || object.visible === false) continue;

      // Yükseklik Kontrolü: Engel karakterin hedef Y kotunda değilse pas geç
      if (box.max.y < targetY + 0.1 || box.min.y > targetY + 1.5) {
        continue;
      }

      const expandedMinX = box.min.x - radius;
      const expandedMaxX = box.max.x + radius;
      const expandedMinZ = box.min.z - radius;
      const expandedMaxZ = box.max.z + radius;

      if (
        clamped.x >= expandedMinX &&
        clamped.x <= expandedMaxX &&
        clamped.z >= expandedMinZ &&
        clamped.z <= expandedMaxZ
      ) {
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
   * Çember (Karakter) ve Kutu (Engel) 2D kesişim testi
   * @private
   */
  _testCircleBoxOverlap(cx, cz, radius, box, charMinY, charMaxY) {
    // Dikey Y ekseni örtüşme kontrolü (Kat ayrıştırması):
    // Karakter 2. katta (y: 2.2m - 3.8m) iken zemin kattaki masa (y: 0m - 0.85m) ile ASLA örtüşmez!
    if (charMinY >= box.max.y || charMaxY <= box.min.y) {
      return false;
    }

    const closestX = THREE.MathUtils.clamp(cx, box.min.x, box.max.x);
    const closestZ = THREE.MathUtils.clamp(cz, box.min.z, box.max.z);

    const distX = cx - closestX;
    const distZ = cz - closestZ;
    const distSq = distX * distX + distZ * distZ;

    return distSq < radius * radius;
  }

  /**
   * Karakterin hareket adımını çözer.
   * MEKÂNSAL FİLTRELEME: Yalnızca karakterin 12 metre yakınındaki engeller taranır.
   * KAT FİLTRELEMESİ: Karakterin bulunduğu kat yüksekliğindeki engeller dikkate alınır.
   * EKSENEL KAYMA (Sliding): Duvar veya mobilya boyunca pürüzsüz kayma uygulanır.
   *
   * @param {THREE.Vector3} currentPos - Karakterin mevcut pozisyonu
   * @param {THREE.Vector3} stepVector - İstenen hareket adımı
   * @param {number} radius - Karakter yarıçapı (varsayılan 0.35m)
   * @param {number} height - Karakter boyu (varsayılan 1.6m)
   * @param {THREE.Object3D|null} ignoreObject - Hareket eden aktörün kendi collider'ı
   * @returns {{ resolvedStep: THREE.Vector3, isColliding: boolean }}
   */
  resolveMovement(currentPos, stepVector, radius = 0.35, height = 1.6, ignoreObject = null) {
    if (this.registeredObstacles.length === 0 || stepVector.lengthSq() < 0.000001) {
      return { resolvedStep: stepVector.clone(), isColliding: false };
    }

    const charMinY = currentPos.y + 0.05;
    const charMaxY = currentPos.y + height;
    const posX = currentPos.x;
    const posZ = currentPos.z;

    // 1. MEKÂNSAL FİLTRELEME (Spatial Partitioning / Proximity Filter):
    // Binlerce obje olsa dahi sadece karakterin 12 metre çevresindeki objeleri listeye al
    const nearbyObstacles = [];
    for (let i = 0; i < this.registeredObstacles.length; i++) {
      const entry = this.registeredObstacles[i];
      if (!entry.object || entry.object === ignoreObject || entry.object.visible === false) continue;

      const dx = posX - entry.center.x;
      const dz = posZ - entry.center.z;
      const distSq = dx * dx + dz * dz;

      // 12 metre yatay menzil içindeyse ve dikeyde karakterin kat seviyesindeyse listeye ekle
      if (distSq <= this.proximityRadiusSq) {
        if (charMinY < entry.box.max.y && charMaxY > entry.box.min.y) {
          nearbyObstacles.push(entry);
        }
      }
    }

    if (nearbyObstacles.length === 0) {
      return { resolvedStep: stepVector.clone(), isColliding: false };
    }

    const desiredDx = stepVector.x;
    const desiredDz = stepVector.z;
    let allowedDx = desiredDx;
    let allowedDz = desiredDz;
    let collisionOccurred = false;

    // 2. Eksenel Kayma (X Eksen Testi)
    const nextX = posX + desiredDx;
    for (let i = 0; i < nearbyObstacles.length; i++) {
      const { box } = nearbyObstacles[i];
      if (this._testCircleBoxOverlap(nextX, posZ, radius, box, charMinY, charMaxY)) {
        allowedDx = 0;
        collisionOccurred = true;
        break;
      }
    }

    // 3. Eksenel Kayma (Z Eksen Testi)
    const currentOrResolvedX = posX + allowedDx;
    const nextZ = posZ + desiredDz;
    for (let i = 0; i < nearbyObstacles.length; i++) {
      const { box } = nearbyObstacles[i];
      if (this._testCircleBoxOverlap(currentOrResolvedX, nextZ, radius, box, charMinY, charMaxY)) {
        allowedDz = 0;
        collisionOccurred = true;
        break;
      }
    }

    // 4. Çapraz Köşe Testi
    if (allowedDx !== 0 && allowedDz !== 0) {
      const diagonalX = posX + allowedDx;
      const diagonalZ = posZ + allowedDz;
      for (let i = 0; i < nearbyObstacles.length; i++) {
        const { box } = nearbyObstacles[i];
        if (this._testCircleBoxOverlap(diagonalX, diagonalZ, radius, box, charMinY, charMaxY)) {
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

    // 5. Gömülme Önleme (Depenetration Push-out)
    const finalX = posX + allowedDx;
    const finalZ = posZ + allowedDz;
    let pushX = 0;
    let pushZ = 0;

    for (let i = 0; i < nearbyObstacles.length; i++) {
      const { box } = nearbyObstacles[i];
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
