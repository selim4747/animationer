/**
 * SceneBuilder.js
 * Demo sahne kurulumu: çok katlı mimari (merdiven + 2. kat) ve test mobilyaları.
 * main.js içindeki büyük kurulum mantığını buraya taşıyarak giriş noktasını sadeleştirir.
 */

import * as THREE from 'three';

function markSceneEditable(root, prefix) {
  let index = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (!object.name) object.name = `${prefix} ${index + 1}`;
    object.userData.sceneEditorId = `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${object.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    object.userData.sceneEditorLabel = object.name.replaceAll('_', ' ');
    index++;
  });
}

export class SceneBuilder {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./CollisionManager.js').CollisionManager} collisionManager
   */
  constructor(scene, collisionManager) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.walkableSurfaces = [];
  }

  /**
   * Çok katlı test mimarisini oluşturur: 5 basamaklı merdiven, 2. kat platformu ve korkuluklar.
   * @returns {THREE.Group}
   */
  buildMultiStoryArchitecture() {
    const multiStoryGroup = new THREE.Group();
    multiStoryGroup.name = 'MultiStory_Architecture';

    const stepMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.4,
      metalness: 0.1,
    });
    const floor2Mat = new THREE.MeshStandardMaterial({
      color: 0x181818,
      roughness: 0.35,
      metalness: 0.1,
    });
    const railingMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.2,
      metalness: 0.8,
    });

    // --- 1. 5 BASAMAKLI MERDİVEN ---
    const stepCount = 5;
    const stepWidth = 1.8;
    const stepDepth = 0.55;
    const stepHeight = 0.35;
    const startZ = 0.2;
    const startX = -5.0;

    for (let i = 0; i < stepCount; i++) {
      const currentH = (i + 1) * stepHeight;
      const stepGeo = new THREE.BoxGeometry(stepWidth, currentH, stepDepth);
      const stepMesh = new THREE.Mesh(stepGeo, stepMat);

      const posZ = startZ - i * stepDepth;
      const posY = currentH / 2;
      stepMesh.position.set(startX, posY, posZ);
      stepMesh.castShadow = true;
      stepMesh.receiveShadow = true;
      stepMesh.name = `Stairs_Step_${i + 1}`;

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(stepGeo),
        new THREE.LineBasicMaterial({ color: 0x555555 })
      );
      stepMesh.add(edges);

      multiStoryGroup.add(stepMesh);
      this.collisionManager.registerWalkableSurface(stepMesh);
      this.walkableSurfaces.push(stepMesh);
    }

    // --- 2. 2. KAT PLATFORMU ---
    const platformW = 5.6;
    const platformD = 5.6;
    const platformThickness = 0.2;
    const platformY = stepCount * stepHeight;

    const floor2Geo = new THREE.BoxGeometry(platformW, platformThickness, platformD);
    const floor2Mesh = new THREE.Mesh(floor2Geo, floor2Mat);
    const platformPosZ = startZ - stepCount * stepDepth - platformD / 2 + 0.1;
    floor2Mesh.position.set(startX - 1.2, platformY - platformThickness / 2, platformPosZ);
    floor2Mesh.castShadow = true;
    floor2Mesh.receiveShadow = true;
    floor2Mesh.name = 'Floor_2_Platform';

    const floor2Edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(floor2Geo),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    floor2Mesh.add(floor2Edges);

    multiStoryGroup.add(floor2Mesh);
    this.collisionManager.registerWalkableSurface(floor2Mesh);
    this.walkableSurfaces.push(floor2Mesh);

    // --- 3. KORKULUKLAR ---
    const railingH = 0.9;
    const railingThickness = 0.08;

    const railLeftGeo = new THREE.BoxGeometry(railingThickness, railingH, platformD);
    const railLeft = new THREE.Mesh(railLeftGeo, railingMat);
    railLeft.position.set(
      floor2Mesh.position.x - platformW / 2,
      platformY + railingH / 2,
      floor2Mesh.position.z
    );
    railLeft.castShadow = true;
    multiStoryGroup.add(railLeft);
    this.collisionManager.registerObstacle(railLeft);

    const railBackGeo = new THREE.BoxGeometry(platformW, railingH, railingThickness);
    const railBack = new THREE.Mesh(railBackGeo, railingMat);
    railBack.position.set(
      floor2Mesh.position.x,
      platformY + railingH / 2,
      floor2Mesh.position.z - platformD / 2
    );
    railBack.castShadow = true;
    multiStoryGroup.add(railBack);
    this.collisionManager.registerObstacle(railBack);

    const rightRailD = platformD - 1.8;
    const railRightGeo = new THREE.BoxGeometry(railingThickness, railingH, rightRailD);
    const railRight = new THREE.Mesh(railRightGeo, railingMat);
    railRight.position.set(
      floor2Mesh.position.x + platformW / 2,
      platformY + railingH / 2,
      floor2Mesh.position.z - 0.9
    );
    railRight.castShadow = true;
    multiStoryGroup.add(railRight);
    this.collisionManager.registerObstacle(railRight);

    this.scene.add(multiStoryGroup);
    markSceneEditable(multiStoryGroup, 'demo-architecture');
    return multiStoryGroup;
  }

  /**
   * Zemin kattaki test mobilyalarını (masa + kanepe) oluşturur.
   */
  buildTestFurniture() {
    const furnitureGroup = new THREE.Group();
    furnitureGroup.name = 'Ground_Living_Furniture';

    const furnitureMat = new THREE.MeshStandardMaterial({
      color: 0x242424,
      roughness: 0.3,
      metalness: 0.2,
    });

    const tableTopGeo = new THREE.BoxGeometry(2.2, 0.1, 1.2);
    const tableTop = new THREE.Mesh(tableTopGeo, furnitureMat);
    tableTop.name = 'Table Top';
    tableTop.position.set(4.2, 0.55, 1.0);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    furnitureGroup.add(tableTop);

    const tableLegMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, metalness: 0.9 });
    [-0.95, 0.95].forEach((lx) => {
      [-0.45, 0.45].forEach((lz) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 16), tableLegMat);
        leg.name = `Table Leg ${lx < 0 ? 'L' : 'R'} ${lz < 0 ? 'Front' : 'Back'}`;
        leg.position.set(4.2 + lx, 0.25, 1.0 + lz);
        leg.castShadow = true;
        furnitureGroup.add(leg);
      });
    });

    const sofaBase = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.45, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.6 })
    );
    sofaBase.name = 'Sofa Base';
    sofaBase.position.set(4.2, 0.225, 2.5);
    sofaBase.castShadow = true;
    furnitureGroup.add(sofaBase);

    const sofaBack = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.5, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.6 })
    );
    sofaBack.name = 'Sofa Back';
    sofaBack.position.set(4.2, 0.6, 2.88);
    sofaBack.castShadow = true;
    furnitureGroup.add(sofaBack);

    this.scene.add(furnitureGroup);

    this.collisionManager.registerObstacle(tableTop);
    this.collisionManager.registerObstacle(sofaBase);
    this.collisionManager.registerObstacle(sofaBack);
    markSceneEditable(furnitureGroup, 'demo-furniture');

    return furnitureGroup;
  }
}
