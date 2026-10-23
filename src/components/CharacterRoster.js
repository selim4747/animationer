import { Character } from './Character.js';

const COLORS = [0xf4f4f4, 0xc9c9c9, 0x9e9e9e, 0x777777, 0xffffff];

/** Manages selectable procedural actors while preserving a selected-character facade. */
export class CharacterRoster {
  constructor(scene, collisionManager, onChange = () => {}) {
    this.scene = scene;
    this.collisionManager = collisionManager;
    this.onChange = onChange;
    this.actors = [];
    this.selectedId = null;
    this.nextId = 1;
    this.addCharacter('Karakter 1', { x: 0, y: 0, z: 0 });
  }

  get selectedCharacter() {
    return this.getCharacter(this.selectedId) || this.actors[0]?.character || null;
  }

  getCharacter(id = this.selectedId) {
    return this.actors.find((actor) => actor.id === id)?.character || null;
  }

  getActor(id = this.selectedId) {
    return this.actors.find((actor) => actor.id === id) || null;
  }

  list() {
    return this.actors.map(({ id, name, character }) => ({
      id,
      name,
      visible: character.rootGroup.visible,
      isMoving: character.isMoving,
      selected: id === this.selectedId,
    }));
  }

  addCharacter(name, position = null) {
    if (this.actors.length >= 20) throw new Error('En fazla 20 karakter eklenebilir.');
    const index = this.nextId++;
    const id = `character-${index}`;
    const character = new Character(this.scene, this.collisionManager, (state) => {
      this.onChange({ type: 'state', id, state, actors: this.list() });
    });
    character.rootGroup.name = id;
    character.bodyMesh.material.color.setHex(COLORS[(index - 1) % COLORS.length]);
    const spawn = position || { x: (this.actors.length % 4) * 1.35, y: 0, z: 0 };
    character.teleportTo(spawn.x, spawn.y, spawn.z);
    const actor = { id, name: name || `Karakter ${index}`, character };
    this.actors.push(actor);
    if (!this.selectedId) this.selectedId = id;
    this._syncSelectedAppearance();
    this.onChange({ type: 'added', id, actors: this.list() });
    return actor;
  }

  select(id) {
    if (!this.actors.some((actor) => actor.id === id)) return false;
    if (this.selectedId && this.selectedId !== id) this.getCharacter(this.selectedId)?.setControlVector(0, 0);
    this.selectedId = id;
    this._syncSelectedAppearance();
    this.onChange({ type: 'selected', id, actors: this.list() });
    return true;
  }

  removeCharacter(id = this.selectedId) {
    if (this.actors.length <= 1) return false;
    const index = this.actors.findIndex((actor) => actor.id === id);
    if (index < 0) return false;
    const [actor] = this.actors.splice(index, 1);
    actor.character.stopMotion();
    this.scene.remove(actor.character.rootGroup, actor.character.targetMarker);
    actor.character.targetMarker.geometry?.dispose?.();
    actor.character.targetMarker.material?.dispose?.();
    actor.character.rootGroup.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
      else object.material?.dispose?.();
    });
    if (this.selectedId === id) this.selectedId = this.actors[Math.max(0, index - 1)].id;
    this._syncSelectedAppearance();
    this.onChange({ type: 'removed', id, actors: this.list() });
    return true;
  }

  update(delta) {
    for (const actor of this.actors) actor.character.update(delta);
  }

  getPosition() { return this.selectedCharacter.getPosition(); }
  moveTo(point) { return this.selectedCharacter.moveTo(point); }
  moveToPromise(point, options) { return this.selectedCharacter.moveToPromise(point, options); }
  playEmotePromise(type) { return this.selectedCharacter.playEmotePromise(type); }
  setSpeed(speed) { return this.selectedCharacter.setSpeed(speed); }
  setWobbleIntensity(value) { return this.selectedCharacter.setWobbleIntensity(value); }
  teleportTo(x, y, z) { return this.selectedCharacter.teleportTo(x, y, z); }
  setControlVector(x, z) { return this.selectedCharacter.setControlVector(x, z); }

  followCharacter(followerId, targetId, options) {
    const follower = this.getCharacter(followerId);
    const target = this.getCharacter(targetId);
    if (!follower || !target || follower === target) return Promise.resolve(false);
    return follower.startFollowing(target, options);
  }

  setVisible(id, visible) {
    const character = this.getCharacter(id);
    if (!character) return false;
    character.setVisible(visible);
    this.onChange({ type: 'visibility', id, actors: this.list() });
    return true;
  }

  setDirectControlForSelected(x, z) { this.setControlVector(x, z); }

  _syncSelectedAppearance() {
    for (const actor of this.actors) {
      const active = actor.id === this.selectedId;
      actor.character.bodyMesh.material.emissive?.setHex(active ? 0x252525 : 0x000000);
      actor.character.targetMarker.material.color.setHex(active ? 0xffffff : 0x888888);
    }
  }

  pauseAll(paused) {
    for (const actor of this.actors) actor.character.setTimelinePaused(paused);
  }

  stopAllMotions() {
    for (const actor of this.actors) actor.character.stopMotion();
  }
}
