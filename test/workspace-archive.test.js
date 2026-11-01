import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAutosaveRecord, IndexedProjectStore } from '../src/components/ProjectStore.js';
import { createWorkspaceArchive, importProjectAsNew, importWorkspaceArchive, parseWorkspaceArchive } from '../src/components/WorkspaceArchive.js';

class MemoryStore {
  constructor() { this.projects = new Map(); this.models = new Map(); this.templates = new Map(); }
  async listProjects() { return [...this.projects.values()].map(p => ({ id: p.projectId, name: p.name })); }
  async loadProject(id) { return this.projects.get(id) || null; }
  async saveProject(id, record) { if (this.projects.has(id)) throw new Error('collision'); this.projects.set(id, { ...record, projectId: id }); }
  async deleteProject(id) { this.projects.delete(id); }
  async createProject(name) { const p = createAutosaveRecord({ name, timeline: { steps: [] }, sprites: [] }); p.projectId = `old-${this.projects.size}`; this.projects.set(p.projectId, p); return p; }
  async listCharacterTemplates() { return [...this.templates.values()]; }
  async listCharacterModelMetadata() { return [...this.models.values()].map(({ blob, ...m }) => ({ ...m, blobSize: blob.size })); }
  async getCharacterModel(id) { return this.models.get(id) || null; }
  async saveCharacterTemplate(record) { if (this.templates.has(record.id)) throw new Error('collision'); this.templates.set(record.id, record); }
  async deleteCharacterTemplate(id) { this.templates.delete(id); }
  async saveCharacterModel(record) { if (this.models.has(record.id)) throw new Error('collision'); this.models.set(record.id, record); }
  async deleteCharacterModel(id) { this.models.delete(id); }
}

const record = () => createAutosaveRecord({
  name: 'Original', timeline: { version: '1.0.0', playMode: 'sequential', steps: [] }, sprites: [],
  worldCharacterTemplates: [{ id: 'sheet', name: 'Sheet', blob: new Blob(['png'], { type: 'image/png' }), mimeType: 'image/png', fileName: 'sheet.png', columns: 1, rows: 1, fps: 12 }],
  worldCharacters: [{ id: 'actor2d', name: 'Actor', templateId: 'sheet', x: 0, y: 0, z: 0 }],
  characters3d: [{ id: 'actor3d', name: 'Model actor', modelId: 'model-1', position: { x: 0, y: 0, z: 0 }, rotationY: 0, walkSpeed: 4, wobbleIntensity: 1, visible: true }],
});

test('project backup import makes fresh named project, remaps template/model IDs, and preserves existing project', async () => {
  const store = new MemoryStore(); const original = await store.createProject('Current');
  store.models.set('model-1', { id: 'model-1', name: 'Model', blob: new Blob(['glb']), mimeType: 'model/gltf-binary', fileName: 'hero.glb' });
  const payload = { ...record(), portableModels: [{ id: 'model-1', name: 'Model', mimeType: 'model/gltf-binary', fileName: 'hero.glb', data: btoa('glb') }] };
  const imported = await importProjectAsNew(store, payload, { name: 'Imported' });
  assert.equal(imported.name, 'Imported'); assert.notEqual(imported.projectId, original.projectId);
  assert.equal(imported.worldCharacters[0].templateId, imported.worldCharacterTemplates[0].id);
  assert.notEqual(imported.worldCharacterTemplates[0].id, 'sheet');
  assert.notEqual(imported.characters3d[0].modelId, 'model-1');
  assert.ok(await store.loadProject(original.projectId));
});

test('workspace export/import round trips all projects and reusable assets additively', async () => {
  const source = new MemoryStore(); await source.createProject('Archive project');
  await source.saveCharacterTemplate({ id: 'shared2d', name: 'Shared', blob: new Blob(['png'], { type: 'image/png' }), mimeType: 'image/png', fileName: 'shared.png', columns: 1, rows: 1, fps: 12 });
  await source.saveCharacterModel({ id: 'shared3d', name: 'Model', blob: new Blob(['glb']), mimeType: 'model/gltf-binary', fileName: 'model.glb' });
  const archiveBlob = await createWorkspaceArchive(source);
  const parsed = parseWorkspaceArchive(await archiveBlob.text());
  assert.equal(parsed.projects.length, 1); assert.equal(parsed.templates.length, 1); assert.equal(parsed.models.length, 1);
  const destination = new MemoryStore(); const current = await destination.createProject('Keep me');
  const result = await importWorkspaceArchive(destination, parsed);
  assert.deepEqual(result.imported, { projects: 1, templates: 1, models: 1 });
  assert.ok(await destination.loadProject(current.projectId));
  assert.equal((await destination.listProjects()).length, 2);
  assert.equal(destination.templates.size, 1); assert.equal(destination.models.size, 1);
});

test('invalid archive is rejected before writes and duplicate identifiers are invalid', async () => {
  const store = new MemoryStore();
  assert.throws(() => parseWorkspaceArchive({ format: 'animationer-workspace', archiveVersion: 77, projects: [], templates: [], models: [] }), /sürümü/i);
  const source = new MemoryStore(); await source.createProject('One');
  const valid = JSON.parse(await (await createWorkspaceArchive(source)).text()); valid.projects.push(valid.projects[0]);
  assert.throws(() => parseWorkspaceArchive(valid), /yinelenen/i);
  assert.equal(store.projects.size + store.models.size + store.templates.size, 0);
});

test('workspace write failure compensates by deleting rows created by this import', async () => {
  const source = new MemoryStore(); await source.createProject('First'); await source.createProject('Second');
  const parsed = parseWorkspaceArchive(await (await createWorkspaceArchive(source)).text());
  const destination = new MemoryStore(); let saves = 0;
  destination.saveProject = async (id, p) => { if (++saves === 2) throw new Error('simulated failure'); destination.projects.set(id, { ...p, projectId: id }); };
  await assert.rejects(importWorkspaceArchive(destination, parsed), /eklenen kayıtlar temizlendi/i);
  assert.equal(destination.projects.size, 0);
});

test('archive controls are accessible home-only markup', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['home-import-project', 'home-export-workspace', 'home-import-workspace', 'home-project-backup-picker', 'home-workspace-archive-picker']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="home-archive-error" role="alert"/);
  assert.match(html, /id="home-archive-status" role="status" aria-live="polite"/);
});
