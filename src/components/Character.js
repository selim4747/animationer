/**
 * Character.js
 * Çok katlı binalar ve merdivenler için 3 Boyutlu Navigasyon ve Prosedürel Animasyon Karakteri.
 * Timeline/Reji sistemi için async/Promise tabanlı komut yürütme (moveToPromise, playEmotePromise)
 * ve ayarlanabilir hız ile sallantı şiddeti (wobbleIntensity) desteği içerir.
 */

import * as THREE from 'three';

export class Character {
  /**
   * @param {THREE.Scene} scene - Three.js sahnesi
   * @param {CollisionManager} collisionManager - Çarpışma yöneticisi referansı
   * @param {Function} onStateChange - Durum değişim bildirim işlevi
   */
  constructor(scene, collisionManager = null, onStateChange = () => {}) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.onStateChange = onStateChange;

    // Karakter silindir boyutları
    this.collisionRadius = 0.35; // Metre
    this.characterHeight = 1.6;  // Metre

    // Ana pozisyon grubu (Dünya koordinatları X, Y, Z ve Y-ekseni yönü)
    this.rootGroup = new THREE.Group();
    this.rootGroup.position.set(0, 0, 0);

    // Animasyon görsel grubu (Bobbing, roll, pitch, squash dönüşümleri)
    this.visualGroup = new THREE.Group();
    this.rootGroup.add(this.visualGroup);

    // 3 Boyutlu Hareket Durumu
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.currentFloorY = 0; // Karakterin bastığı dikey zemin kotu
    this.isMoving = false;
    this.walkSpeed = 4.2; // m/s (1 - 10 arası ayarlanabilir)
    this.wobbleIntensity = 1.0; // Sallantı şiddeti çarpanı (0 - 2x)
    this.walkTime = 0;
    this.idleTime = 0;
    this.controlVector = new THREE.Vector2();
    this.activeMoveDuration = null;
    this.activeMoveElapsed = 0;
    this.followState = null;
    this.timelinePaused = false;

    // Timeline / Async Promise Takibi
    this.activeMovePromise = null;
    this.moveResolve = null;

    // Emote Durumu
    this.isEmoting = false;
    this.emoteType = null;
    this.emoteTime = 0;
    this.emoteDuration = 1.2;
    this.emoteResolve = null;

    // Karakter geometrilerini ve hedef halkasını oluştur
    this._buildCharacterMesh();
    this._buildTargetMarker();

    this.scene.add(this.rootGroup);
  }

  setCollisionManager(collisionManager) {
    this.collisionManager = collisionManager;
  }

  setModel(model, animations = []) {
    if (!model?.isObject3D) throw new Error('Dosyada kullanılabilir bir 3D model bulunamadı.');
    const bounds = new THREE.Box3().setFromObject(model);
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height < 0.05) throw new Error('Modelin ölçüleri geçersiz.');

    [this.bodyMesh, this.visorMesh, this.packMesh].forEach((mesh) => {
      this.visualGroup.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    });
    model.scale.multiplyScalar(1.6 / height);
    model.updateMatrixWorld(true);
    const scaledBounds = new THREE.Box3().setFromObject(model);
    model.position.y -= scaledBounds.min.y;
    model.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.visualGroup.add(model);
    this.modelRoot = model;

    if (this.animationMixer) this.animationMixer.stopAllAction();
    this.animationMixer = animations.length ? new THREE.AnimationMixer(model) : null;
    this.walkAction = null;
    this.idleAction = null;
    this.activeAnimationAction = null;
    this.animationState = null;
    if (this.animationMixer) {
      const walkClip = animations.find((clip) => /walk|run|locomotion/i.test(clip.name)) || (animations.length > 1 ? animations[0] : null);
      const idleClip = animations.find((clip) => /idle|stand|rest/i.test(clip.name)) || animations.find((clip) => clip !== walkClip);
      this.walkAction = walkClip ? this.animationMixer.clipAction(walkClip) : null;
      this.idleAction = idleClip ? this.animationMixer.clipAction(idleClip) : null;
      this._setModelAnimationState(false, true);
    }
  }

  _setModelAnimationState(isMoving, immediate = false) {
    const next = isMoving ? this.walkAction : this.idleAction;
    if (next === this.activeAnimationAction) return;
    if (!next) {
      this.activeAnimationAction?.fadeOut(immediate ? 0 : 0.18);
      this.activeAnimationAction = null;
      this.animationState = isMoving ? 'walk' : 'idle';
      return;
    }
    next.reset().play();
    if (immediate) next.fadeIn(0);
    else next.fadeIn(0.18);
    this.activeAnimationAction?.fadeOut(immediate ? 0 : 0.18);
    this.activeAnimationAction = next;
    this.animationState = isMoving ? 'walk' : 'idle';
  }

  /**
   * Monokrom stilize kapsül karakter geometrisini oluşturur
   * @private
   */
  _buildCharacterMesh() {
    // 1. Gövde (Minimalist Beyaz Kapsül)
    const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.82, 16, 24);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf4f4f4,
      roughness: 0.25,
      metalness: 0.1,
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0.77;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.visualGroup.add(this.bodyMesh);

    // 2. Parlak Siyah Vizör / Baş Bandı
    const visorGeo = new THREE.BoxGeometry(0.42, 0.14, 0.22);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.08,
      metalness: 0.95,
    });
    this.visorMesh = new THREE.Mesh(visorGeo, visorMat);
    this.visorMesh.position.set(0, 1.02, 0.23);
    this.visorMesh.castShadow = true;
    this.visualGroup.add(this.visorMesh);

    // 3. Sırt Modülü (Koyu Gri Minimalist Detay)
    const packGeo = new THREE.BoxGeometry(0.3, 0.4, 0.14);
    const packMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.5,
      metalness: 0.2,
    });
    this.packMesh = new THREE.Mesh(packGeo, packMat);
    this.packMesh.position.set(0, 0.75, -0.26);
    this.packMesh.castShadow = true;
    this.visualGroup.add(this.packMesh);

    // 4. Zemin Yumuşak Temas Gölgesi
    const shadowGeo = new THREE.RingGeometry(0, 0.44, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.015;
    this.rootGroup.add(this.contactShadow);
  }

  /**
   * Tıklanan noktada beliren 3D hedef halkası
   * @private
   */
  _buildTargetMarker() {
    const ringGeo = new THREE.RingGeometry(0.24, 0.34, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetMarker = new THREE.Mesh(ringGeo, ringMat);
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.targetMarker.position.set(0, 0.02, 0);
    this.targetMarker.visible = false;
    this.scene.add(this.targetMarker);

    this.markerActive = false;
    this.markerStartTime = 0;
  }

  /**
   * Karakteri 3D uzaydaki (X, Y, Z) hedef noktasına yönlendirir.
   * @param {THREE.Vector3} point - 3D zemin/basamak/kat koordinatı
   */
  moveTo(point) {
    this.followState = null;
    this.activeMoveDuration = null;
    this.activeMoveElapsed = 0;
    this.controlVector.set(0, 0);
    let safeTarget = point.clone();

    // Eğer tıklanan nokta bir engelin içindeyse dış kenara ötele
    if (this.collisionManager) {
      safeTarget = this.collisionManager.clampTargetOutsideObstacles(
        safeTarget,
        this.collisionRadius
      );
    }

    this.targetPosition.copy(safeTarget);

    // Yatay mesafe kontrolü (X ve Z)
    const currentPos = this.rootGroup.position;
    const horizontalDist = Math.hypot(
      safeTarget.x - currentPos.x,
      safeTarget.z - currentPos.z
    );

    if (horizontalDist > 0.15 || Math.abs(safeTarget.y - currentPos.y) > 0.2) {
      this.isMoving = true;
      this.onStateChange({ isMoving: true });

      // Hedef halkasını tam hedef yüksekliğinde (Y) göster
      this.targetMarker.position.set(safeTarget.x, safeTarget.y + 0.02, safeTarget.z);
      this.targetMarker.scale.set(0.5, 0.5, 0.5);
      this.targetMarker.material.opacity = 0.95;
      this.targetMarker.visible = true;
      this.markerActive = true;
      this.markerStartTime = performance.now();
    } else {
      // Zaten oradayız
      this.isMoving = false;
      this._resolveMovePromise(true);
    }
  }

  /**
   * Reji / Zaman çizelgesi için Promise döndüren yürüme metodu.
   * Karakter hedefe vardığında (veya duvarda sıkıştığında) resolve olur.
   * @param {THREE.Vector3|Object} point
   * @returns {Promise<boolean>}
   */
  moveToPromise(point, { duration = null } = {}) {
    const targetVec = point instanceof THREE.Vector3
      ? point
      : new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0);

    // Varsa önceki bekleyen hareketi sonlandır
    this._resolveMovePromise(false);

    return new Promise((resolve) => {
      this.moveResolve = resolve;
      this.moveTo(targetVec);
      if (Number.isFinite(duration) && duration > 0) {
        this.activeMoveDuration = duration;
        this.activeMoveElapsed = 0;
      }

      // Hedefe zaten çok yakınsa hemen bitir
      if (!this.isMoving) {
        this._resolveMovePromise(true);
      }
    });
  }

  /**
   * @private
   */
  _resolveMovePromise(success) {
    if (this.moveResolve) {
      const res = this.moveResolve;
      this.moveResolve = null;
      res(success);
    }
  }

  setControlVector(x = 0, z = 0) {
    const vector = new THREE.Vector2(Number(x) || 0, Number(z) || 0);
    if (vector.lengthSq() > 1) vector.normalize();
    const wasControlled = this.controlVector.lengthSq() > 0.0001;
    this.controlVector.copy(vector);
    if (vector.lengthSq() > 0.0001) {
      this.followState = null;
      this.activeMoveDuration = null;
      this._resolveMovePromise(false);
      if (!this.isMoving) this.onStateChange({ isMoving: true });
      this.isMoving = true;
    } else if (wasControlled) {
      this.targetPosition.copy(this.rootGroup.position);
      this.isMoving = false;
      this.onStateChange({ isMoving: false });
    }
  }

  startFollowing(targetCharacter, { duration = 10, offset = { x: 0, y: 0, z: 1.2 } } = {}) {
    this._resolveMovePromise(false);
    this.controlVector.set(0, 0);
    this.activeMoveDuration = null;
    this.followState = {
      targetCharacter,
      duration: Math.max(0.1, duration),
      elapsed: 0,
      offset: new THREE.Vector3(offset.x || 0, offset.y || 0, offset.z || 0),
    };
    this.isMoving = true;
    this.onStateChange({ isMoving: true });
    return new Promise((resolve) => {
      this.moveResolve = resolve;
    });
  }

  setVisible(visible) {
    this.rootGroup.visible = Boolean(visible);
    if (!visible && this.targetMarker) this.targetMarker.visible = false;
  }

  setTimelinePaused(paused) {
    this.timelinePaused = Boolean(paused);
  }

  stopMotion() {
    this.controlVector.set(0, 0);
    this.followState = null;
    this.activeMoveDuration = null;
    this.isMoving = false;
    this.isEmoting = false;
    this.targetPosition.copy(this.rootGroup.position);
    this._resolveMovePromise(false);
    if (this.emoteResolve) {
      const resolve = this.emoteResolve;
      this.emoteResolve = null;
      resolve();
    }
    this.onStateChange({ isMoving: false });
  }

  /**
   * Prosedürel Emote Animasyonu Başlatır (Promise döner)
   * @param {'jump'|'wave'|'spin'} type
   * @returns {Promise<void>}
   */
  playEmotePromise(type = 'jump') {
    if (this.emoteResolve) {
      this.emoteResolve();
      this.emoteResolve = null;
    }

    this.isEmoting = true;
    this.emoteType = type;
    this.emoteTime = 0;
    this.emoteDuration = type === 'spin' ? 1.0 : type === 'jump' ? 0.9 : 1.2;

    return new Promise((resolve) => {
      this.emoteResolve = resolve;
    });
  }

  /**
   * Her render karesinde 3D hareketi, merdiven tırmanışını ve prosedürel animasyonu günceller
   * @param {number} delta - Geçen kare süresi (saniye)
   */
  update(delta) {
    if (this.timelinePaused) return;
    this.animationMixer?.update(delta);
    if (this.animationMixer && this.animationState !== (this.isMoving ? 'walk' : 'idle')) {
      this._setModelAnimationState(this.isMoving);
    }
    // 1. Hedef halkası animasyonu (büyüme ve sönümlenme)
    if (this.markerActive) {
      const elapsed = (performance.now() - this.markerStartTime) / 1000;
      if (elapsed < 0.55) {
        const scale = 0.5 + elapsed * 1.4;
        this.targetMarker.scale.set(scale, scale, scale);
        this.targetMarker.material.opacity = Math.max(0, 0.95 - elapsed / 0.55);
      } else {
        this.targetMarker.visible = false;
        this.markerActive = false;
      }
    }

    const currentPos = this.rootGroup.position;
    if (this.followState) {
      this.followState.elapsed += delta;
      const targetPos = this.followState.targetCharacter.getPosition();
      this.targetPosition.set(
        targetPos.x + this.followState.offset.x,
        targetPos.y + this.followState.offset.y,
        targetPos.z + this.followState.offset.z
      );
      if (this.followState.elapsed >= this.followState.duration) {
        this.followState = null;
        this._resolveMovePromise(true);
      }
    }

    // 2. Emote animasyonu işleme
    if (this.isEmoting) {
      this.emoteTime += delta;
      const progress = Math.min(1.0, this.emoteTime / this.emoteDuration);

      if (this.emoteType === 'jump') {
        // Çift zıplama ve squash
        const jumpPhase = Math.sin(progress * Math.PI * 2);
        const jumpH = Math.max(0, jumpPhase) * 0.45;
        this.visualGroup.position.y = jumpH;
        this.visualGroup.scale.set(
          1 - jumpH * 0.4,
          1 + jumpH * 0.7,
          1 - jumpH * 0.4
        );
      } else if (this.emoteType === 'spin') {
        // 360 derece hızlı dönüş ve neşe sıçraması
        this.rootGroup.rotation.y += delta * Math.PI * 4;
        const bounce = Math.sin(progress * Math.PI) * 0.25;
        this.visualGroup.position.y = bounce;
      } else {
        // Wave / Selam: Sağa sola neşeli sallanma
        const wave = Math.sin(progress * Math.PI * 4) * 0.25;
        this.visualGroup.rotation.z = wave;
        this.visualGroup.position.y = Math.abs(wave) * 0.15;
      }

      if (progress >= 1.0) {
        this.isEmoting = false;
        this.visualGroup.position.y = 0;
        this.visualGroup.rotation.z = 0;
        this.visualGroup.scale.set(1, 1, 1);
        if (this.emoteResolve) {
          const res = this.emoteResolve;
          this.emoteResolve = null;
          res();
        }
      }
      return; // Emote yaparken yürümeyi duraklat
    }

    // 3. Yürüme Mantığı
    // Yatay yön ve mesafe (X ve Z)
    const toTargetX = this.targetPosition.x - currentPos.x;
    const toTargetZ = this.targetPosition.z - currentPos.z;
    const horizontalDist = Math.hypot(toTargetX, toTargetZ);

    const hasDirectControl = this.controlVector.lengthSq() > 0.0001;
    if (hasDirectControl || (this.isMoving && horizontalDist > 0.12)) {
      // İstenen yatay hareket adımı
      let directionX = horizontalDist > 0.0001 ? toTargetX / horizontalDist : 0;
      let directionZ = horizontalDist > 0.0001 ? toTargetZ / horizontalDist : 0;
      let stepDist = Math.min(horizontalDist, this.walkSpeed * delta);
      if (hasDirectControl) {
        directionX = this.controlVector.x;
        directionZ = this.controlVector.y;
        stepDist = this.walkSpeed * delta;
      } else if (this.activeMoveDuration) {
        const remaining = Math.max(0.001, this.activeMoveDuration - this.activeMoveElapsed);
        stepDist = Math.min(horizontalDist, (horizontalDist / remaining) * delta);
        this.activeMoveElapsed += delta;
      }
      const rawStep = new THREE.Vector3(
        directionX * stepDist,
        0,
        directionZ * stepDist
      );

      // Çarpışma Denetimi ve Duvar/Mobilya Boyunca Kayma (Sliding)
      let resolvedStep = rawStep;
      if (this.collisionManager) {
        const collisionResult = this.collisionManager.resolveMovement(
          currentPos,
          rawStep,
          this.collisionRadius,
          this.characterHeight
        );
        resolvedStep = collisionResult.resolvedStep;

        if (collisionResult.isColliding && resolvedStep.lengthSq() < 0.000005) {
          if (this.isMoving) this.onStateChange({ isMoving: false });
          this.isMoving = false;
          this._resolveMovePromise(false);
        }
      }

      // Yatay pozisyonu güncelle
      if (resolvedStep.lengthSq() > 0.000005) {
        if (!this.isMoving) {
          this.isMoving = true;
          this.onStateChange({ isMoving: true });
        }
        const moveDir = resolvedStep.clone().normalize();
        const targetAngle = Math.atan2(moveDir.x, moveDir.z);
        let angleDiff = targetAngle - this.rootGroup.rotation.y;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        this.rootGroup.rotation.y += angleDiff * Math.min(1.0, delta * 12.0);

        currentPos.x += resolvedStep.x;
        currentPos.z += resolvedStep.z;

        // Prosedürel Yürüme Matematiği (wobbleIntensity ile ölçekli)
        this.walkTime += delta * (this.walkSpeed * 2.8);

        // a) Dikey Zıplama (Bobbing): |sin(t)| ile adımlama sıçraması
        const bob = Math.abs(Math.sin(this.walkTime)) * (0.12 * this.wobbleIntensity);
        this.visualGroup.position.y = bob;

        // b) Beşik Sallantısı (Roll): sin(t) ile sağa-sola adımlama yatışı
        const roll = Math.sin(this.walkTime) * (0.07 * this.wobbleIntensity);
        this.visualGroup.rotation.z = roll;

        // c) Hız Eğimi (Pitch/Lean): Gövdenin hareket yönüne 6-7 derece öne yatması
        const targetPitch = 0.11 * Math.min(1.5, this.walkSpeed / 4.0);
        this.visualGroup.rotation.x = THREE.MathUtils.lerp(
          this.visualGroup.rotation.x,
          targetPitch,
          delta * 10.0
        );

        // d) Squash & Stretch: Yere basma anında Y basılması ve X/Z genişlemesi
        const squash = Math.cos(this.walkTime * 2.0) * (0.05 * this.wobbleIntensity);
        this.visualGroup.scale.set(1.0 + squash * 0.5, 1.0 - squash, 1.0 + squash * 0.5);

        this.contactShadow.scale.set(1.0 - bob * 1.5, 1.0 - bob * 1.5, 1.0 - bob * 1.5);
      }
    } else {
      // Karakter durdu (Hedefe vardı veya idle)
      if (this.isMoving && !hasDirectControl && !this.followState) {
        this.isMoving = false;
        this.activeMoveDuration = null;
        this.onStateChange({ isMoving: false });
        this._resolveMovePromise(true);
      }

      this.idleTime += delta * 2.2;

      // Salınımları sönümle ve hafif nefes alma (breathing) hareketine geç
      const breathe = Math.sin(this.idleTime) * 0.015;
      this.visualGroup.position.y = THREE.MathUtils.lerp(this.visualGroup.position.y, breathe, delta * 8.0);
      this.visualGroup.rotation.z = THREE.MathUtils.lerp(this.visualGroup.rotation.z, 0, delta * 8.0);
      this.visualGroup.rotation.x = THREE.MathUtils.lerp(this.visualGroup.rotation.x, 0, delta * 8.0);
      this.visualGroup.scale.set(
        THREE.MathUtils.lerp(this.visualGroup.scale.x, 1.0 - breathe * 0.5, delta * 8.0),
        THREE.MathUtils.lerp(this.visualGroup.scale.y, 1.0 + breathe, delta * 8.0),
        THREE.MathUtils.lerp(this.visualGroup.scale.z, 1.0 - breathe * 0.5, delta * 8.0)
      );
      this.contactShadow.scale.set(1.0, 1.0, 1.0);
    }

    // 4. ÇOK KATLI DİKEY ZEMİN KOTU YAKALAMA (Vertical Floor Snapping):
    if (this.collisionManager) {
      const targetFloorY = this.collisionManager.getFloorHeight(
        currentPos,
        this.currentFloorY
      );

      // Merdiven basamakları arasında yumuşak dikey geçiş
      this.currentFloorY = THREE.MathUtils.lerp(
        this.currentFloorY,
        targetFloorY,
        Math.min(1.0, delta * 14.0)
      );

      this.rootGroup.position.y = this.currentFloorY;
    }
  }

  /**
   * Karakterin 3D dünya koordinatını döndürür
   * @returns {THREE.Vector3}
   */
  getPosition() {
    return this.rootGroup.position;
  }

  /**
   * Karakteri belirtilen konuma ışınlar / sıfırlar
   */
  teleportTo(x = 0, y = 0, z = 0) {
    this.rootGroup.position.set(x, y, z);
    this.targetPosition.set(x, y, z);
    this.currentFloorY = y;
    this.isMoving = false;
    this.isEmoting = false;
    this.visualGroup.position.set(0, 0, 0);
    this.visualGroup.rotation.set(0, 0, 0);
    this.visualGroup.scale.set(1, 1, 1);
    this._resolveMovePromise(true);
    this.onStateChange({ isMoving: false });
  }

  resetPosition(x = 0, y = 0, z = 0) {
    this.teleportTo(x, y, z);
  }

  /**
   * Yürüme hızını ayarlar (0.2 - 12.0 m/s)
   * @param {number} speed
   */
  setSpeed(speed) {
    this.walkSpeed = Math.max(0.2, Math.min(12.0, speed));
  }

  /**
   * Sallantı şiddetini ayarlar (0.0 - 2.0x)
   * @param {number} intensity
   */
  setWobbleIntensity(intensity) {
    this.wobbleIntensity = Math.max(0.0, Math.min(2.5, intensity));
  }
}
