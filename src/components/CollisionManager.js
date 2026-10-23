/**
 * CollisionManager.js
 * Hafif ve saf Three.js Raycasting & BoundingBox çarpışma sistemi.
 * Harici fizik motoru (Cannon/Ammo) gerektirmez.
 * Duvar tespiti ve duvar boyunca kayma (Wall Sliding) matematiği içerir.
 */

import * as THREE from 'three';

export class CollisionManager {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   */
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // Çarpışma nesneleri dizisi
    this.wallBoxes = []; // Kullanıcının 2D harita üzerine eklediği engel kutuları

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 2.0;

    // Geçici hesaplama vektörleri (GC baskısını önlemek için önceden tahsis edildi)
    this._tempRayOrigin = new THREE.Vector3();
    this._tempRayDir = new THREE.Vector3();
    this._tempBox = new THREE.Box3();
  }

  /**
   * Çarpışma listesine bir mesh veya nesne ekler
   * @param {THREE.Object3D} object
   */
  addCollider(object) {
    if (!object) return;
    if (!this.colliders.includes(object)) {
      this.colliders.push(object);
    }
  }

  /**
   * Çarpışma listesinden nesneyi çıkarır (örn. kapı açıldığında)
   * @param {THREE.Object3D} object
   */
  removeCollider(object) {
    if (!object) return;
    const index = this.colliders.indexOf(object);
    if (index !== -1) {
      this.colliders.splice(index, 1);
    }
  }

  /**
   * Belirli bir isim veya userData içeren collider'ları temizler
   */
  clearColliders() {
    this.colliders = [];
  }

  /**
   * 2D Harita editörü için sahneye görünmez/yarı saydam tel kafes engel kutusu ekler
   * @param {number} x - Merkez X
   * @param {number} z - Merkez Z
   * @param {number} width - Genişlik (X ekseni)
   * @param {number} depth - Derinlik (Z ekseni)
   * @param {number} height - Yükseklik (Y ekseni, varsayılan 2.5)
   * @returns {THREE.Mesh}
   */
  addWallBox(x = 0, z = 0, width = 2.0, depth = 2.0, height = 2.5) {
    const geo = new THREE.BoxGeometry(width, height, depth);

    // Monokrom yarı saydam tel kafes (wireframe) materyal
    const mat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.5,
      transparent: true,
      opacity: 0.45,
      wireframe: false,
    });

    const boxMesh = new THREE.Mesh(geo, mat);
    boxMesh.position.set(x, height / 2, z);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    boxMesh.userData = { isWallBox: true, width, depth, height };

    // Tel kafes kenar çizgisi (Monokrom beyaz kenarlık)
    const edgesGeo = new THREE.EdgesGeometry(geo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 });
    const wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
    boxMesh.add(wireframe);

    this.scene.add(boxMesh);
    this.colliders.push(boxMesh);
    this.wallBoxes.push(boxMesh);

    return boxMesh;
  }

  /**
   * Belirtilen engel kutusunu sahneden ve listeden kaldırır
   * @param {THREE.Mesh} boxMesh
   */
  removeWallBox(boxMesh) {
    if (!boxMesh) return;
    this.removeCollider(boxMesh);
    const idx = this.wallBoxes.indexOf(boxMesh);
    if (idx !== -1) {
      this.wallBoxes.splice(idx, 1);
    }
    this.scene.remove(boxMesh);
    boxMesh.geometry?.dispose();
    if (boxMesh.material) boxMesh.material.dispose();
  }

  /**
   * Tüm kullanıcı engel kutularını temizler
   */
  clearWallBoxes() {
    [...this.wallBoxes].forEach((box) => this.removeWallBox(box));
    this.wallBoxes = [];
  }

  /**
   * Karakterin hareket adımını çarpışmalara karşı denetler ve
   * duvara çarpma anında "Duvar Boyunca Kayma (Wall Sliding)" vektörünü hesaplar.
   *
   * @param {THREE.Vector3} currentPos - Karakterin mevcut konumu
   * @param {THREE.Vector3} stepVector - Bu frame'de atılmak istenen hareket adımı
   * @param {number} radius - Karakterin çarpışma yarıçapı (varsayılan 0.32m)
   * @returns {{ resolvedStep: THREE.Vector3, isColliding: boolean }}
   */
  resolveMovement(currentPos, stepVector, radius = 0.32) {
    if (this.colliders.length === 0 || stepVector.lengthSq() < 0.00001) {
      return { resolvedStep: stepVector.clone(), isColliding: false };
    }

    const moveDist = stepVector.length();
    const moveDir = stepVector.clone().normalize();
    let collisionDetected = false;
    let hitNormal = null;

    // 1. Raycasting ile İleriye Doğru Engel Kontrolü (Gövde hizası: y = 0.6)
    // Karakterin merkezinden ve hafif sağ/sol açılardan 3 ışın gönderilir
    const rayAngles = [0, -0.35, 0.35]; // Radyan cinsinden fan ışınları
    const checkDist = moveDist + radius;

    for (const angle of rayAngles) {
      this._tempRayOrigin.set(currentPos.x, currentPos.y + 0.6, currentPos.z);
      this._tempRayDir.copy(moveDir);

      if (angle !== 0) {
        this._tempRayDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      }

      this.raycaster.set(this._tempRayOrigin, this._tempRayDir);
      this.raycaster.far = checkDist + 0.1;

      // Sadece görünür ve aktif collider'ları test et
      const activeColliders = this.colliders.filter((c) => c && c.visible !== false);
      const intersects = this.raycaster.intersectObjects(activeColliders, true);

      if (intersects.length > 0) {
        const hit = intersects[0];
        if (hit.distance <= checkDist) {
          collisionDetected = true;

          // Çarpılan yüzeyin dünya uzayındaki normal vektörünü al
          if (hit.face) {
            hitNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
            hitNormal.y = 0;
            hitNormal.normalize();
          } else {
            // Yüzey normali yoksa çarpışma noktasından merkeze doğru normal türet
            hitNormal = new THREE.Vector3().subVectors(this._tempRayOrigin, hit.point);
            hitNormal.y = 0;
            hitNormal.normalize();
          }
          break;
        }
      }
    }

    // 2. BoundingBox Kutu Çarpışma Testi (Engel Kutuları ve AABB Nesneleri)
    const proposedPos = currentPos.clone().add(stepVector);
    for (const collider of this.colliders) {
      if (!collider || collider.visible === false) continue;

      this._tempBox.setFromObject(collider);
      // Karakterin yarıçapı kadar genişletilmiş kutu
      this._tempBox.expandByScalar(radius);

      // Sadece karakter hizasındaki Y aralığını kontrol et
      if (
        proposedPos.x >= this._tempBox.min.x &&
        proposedPos.x <= this._tempBox.max.x &&
        proposedPos.z >= this._tempBox.min.z &&
        proposedPos.z <= this._tempBox.max.z &&
        this._tempBox.max.y >= currentPos.y + 0.1 &&
        this._tempBox.min.y <= currentPos.y + 1.6
      ) {
        collisionDetected = true;

        // En yakın yüzeyin normalini hesapla
        const dx1 = Math.abs(proposedPos.x - this._tempBox.min.x);
        const dx2 = Math.abs(this._tempBox.max.x - proposedPos.x);
        const dz1 = Math.abs(proposedPos.z - this._tempBox.min.z);
        const dz2 = Math.abs(this._tempBox.max.z - proposedPos.z);
        const minVal = Math.min(dx1, dx2, dz1, dz2);

        if (!hitNormal) {
          hitNormal = new THREE.Vector3();
          if (minVal === dx1) hitNormal.set(-1, 0, 0);
          else if (minVal === dx2) hitNormal.set(1, 0, 0);
          else if (minVal === dz1) hitNormal.set(0, 0, -1);
          else hitNormal.set(0, 0, 1);
        }
        break;
      }
    }

    // 3. Duvar Boyunca Kayma (Wall Sliding Matematiği)
    if (collisionDetected && hitNormal) {
      // Hız vektörünün duvar normaline izdüşümü: dot = v · n
      const dot = stepVector.dot(hitNormal);

      if (dot < 0) {
        // v_slide = v - (v · n) * n
        const slideVector = stepVector.clone().sub(hitNormal.clone().multiplyScalar(dot));

        // Kayma vektörünün de başka bir duvara çarpıp çarpmadığını doğrula (Köşe kontrolü)
        const secondCheckDir = slideVector.clone().normalize();
        this._tempRayOrigin.set(currentPos.x, currentPos.y + 0.6, currentPos.z);
        this.raycaster.set(this._tempRayOrigin, secondCheckDir);
        this.raycaster.far = slideVector.length() + radius;

        const secondHits = this.raycaster.intersectObjects(this.colliders, true);
        if (secondHits.length > 0 && secondHits[0].distance <= slideVector.length() + radius) {
          // İki duvarın köşesine sıkıştı: Hareketi tamamen durdur
          return { resolvedStep: new THREE.Vector3(0, 0, 0), isColliding: true };
        }

        return { resolvedStep: slideVector, isColliding: true };
      }
    }

    return { resolvedStep: stepVector.clone(), isColliding: false };
  }
}
