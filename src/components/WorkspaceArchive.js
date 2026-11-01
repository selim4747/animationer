import { migrateProjectRecord, validateCharacterModelRecord, validateCharacterTemplateRecord, PROJECT_SCHEMA_VERSION, MAX_PROJECT_BYTES, MAX_CHARACTER_MODEL_BYTES, MAX_CHARACTER_TEMPLATE_BYTES } from './ProjectStore.js';

export const WORKSPACE_ARCHIVE_FORMAT = 'animationer-workspace';
export const WORKSPACE_ARCHIVE_VERSION = 1;
export const MAX_WORKSPACE_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const id = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const blobToData = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
};
const dataToBlob = (data, type = 'application/octet-stream') => {
  if (typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Arşivde bozuk base64 varlık verisi var.');
  const binary = atob(data); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
};
const portable = async ({ blob, ...meta }) => ({ ...meta, data: await blobToData(blob) });
const hydrate = ({ data, blob, mimeType, ...meta }) => ({ ...meta, mimeType, blob: blob instanceof Blob ? blob : dataToBlob(data, mimeType) });
const byteCount = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Serialize every named project and both shared libraries to a portable archive. */
export async function createWorkspaceArchive(store, { onProgress = () => {} } = {}) {
  const [entries, templates, models] = await Promise.all([store.listProjects(), store.listCharacterTemplates(), store.listCharacterModelMetadata()]);
  const projects = [];
  for (let i = 0; i < entries.length; i++) {
    const record = await store.loadProject(entries[i].id);
    if (!record) throw new Error(`“${entries[i].name}” projesi okunamadı; dışa aktarma durduruldu.`);
    projects.push(await projectToPortable(record));
    onProgress({ phase: 'read', current: i + 1, total: entries.length });
  }
  const portableTemplates = await Promise.all(templates.map(portable));
  const portableModels = await Promise.all(models.map(async (meta) => portable(await store.getCharacterModel(meta.id))));
  const archive = { format: WORKSPACE_ARCHIVE_FORMAT, archiveVersion: WORKSPACE_ARCHIVE_VERSION, exportedAt: new Date().toISOString(), projects, templates: portableTemplates, models: portableModels };
  const text = JSON.stringify(archive);
  const size = new TextEncoder().encode(text).byteLength;
  if (size > MAX_WORKSPACE_ARCHIVE_BYTES) throw new Error('Workspace arşivi 1 GiB sınırını aşıyor.');
  return new Blob([text], { type: 'application/json' });
}

async function projectToPortable(record) {
  const copy = { ...record, sprites: await Promise.all(record.sprites.map(portable)), worldCharacterTemplates: await Promise.all(record.worldCharacterTemplates.map(portable)), mapAsset: record.mapAsset?.blob ? await portable(record.mapAsset) : record.mapAsset };
  return copy;
}

export function parseWorkspaceArchive(input) {
  const archive = typeof input === 'string' ? JSON.parse(input) : input;
  if (!archive || archive.format !== WORKSPACE_ARCHIVE_FORMAT || archive.archiveVersion !== WORKSPACE_ARCHIVE_VERSION) throw new Error('Workspace arşiv biçimi veya sürümü desteklenmiyor.');
  if (!Array.isArray(archive.projects) || !Array.isArray(archive.templates) || !Array.isArray(archive.models)) throw new Error('Workspace arşivinde proje veya kitaplık listeleri eksik.');
  const projects = archive.projects.map((raw) => hydrateAndValidateProject(raw));
  const templates = archive.templates.map((raw) => validateCharacterTemplateRecord(hydrate(raw)));
  const models = archive.models.map((raw) => validateCharacterModelRecord(hydrate(raw)));
  const projectBytes = projects.reduce((sum, p) => sum + p.bytes, 0);
  const libBytes = [...templates, ...models].reduce((sum, asset) => sum + asset.blob.size, 0);
  if (projectBytes + libBytes > MAX_WORKSPACE_ARCHIVE_BYTES) throw new Error('Workspace arşivi içerik toplamı 1 GiB sınırını aşıyor.');
  const duplicate = (items) => new Set(items).size !== items.length;
  if (duplicate(projects.map((p) => p.record.projectId)) || duplicate(templates.map((a) => a.id)) || duplicate(models.map((a) => a.id))) throw new Error('Arşivde yinelenen proje veya varlık kimliği var.');
  const modelIds = new Set(models.map((model) => model.id));
  for (const { record } of projects) {
    if (record.characters3d.some((actor) => actor.modelId && !modelIds.has(actor.modelId))) throw new Error(`“${record.name}” projesi arşivde bulunmayan bir 3D model kimliğine başvuruyor.`);
  }
  return { projects: projects.map((p) => p.record), templates, models, byteSize: projectBytes + libBytes };
}

function hydrateAndValidateProject(raw) {
  if (raw?.format !== 'animationer-project') throw new Error('Arşivde geçersiz proje kaydı var.');
  const parsed = { ...raw, sprites: (raw.sprites || []).map(hydrate), worldCharacterTemplates: (raw.worldCharacterTemplates || []).map(hydrate), mapAsset: raw.mapAsset?.data ? hydrate(raw.mapAsset) : raw.mapAsset };
  const record = migrateProjectRecord(parsed);
  const bytes = record.sprites.reduce((n, a) => n + a.blob.size, 0) + record.worldCharacterTemplates.reduce((n, a) => n + a.blob.size, 0) + (record.mapAsset?.blob?.size || 0) + new TextEncoder().encode(JSON.stringify(record.timeline)).byteLength;
  if (bytes > MAX_PROJECT_BYTES) throw new Error(`“${record.name}” projesi 100 MB sınırını aşıyor.`);
  return { record, bytes };
}

/** Create one portable backup as a distinct project. Never touches the active project. */
export async function importProjectAsNew(store, input, { name = '', onProgress = () => {} } = {}) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (raw?.format !== 'animationer-project') throw new Error('Bu dosya animationer-project yedeği değil.');
  const sourceVersion = raw.schemaVersion ?? raw.projectVersion ?? 1;
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > PROJECT_SCHEMA_VERSION) throw new Error('Bu proje sürümü desteklenmiyor.');
  const stagedModels = [];
  let createdProjectId = null;
  try {
    const validated = hydrateAndValidateProject(raw).record;
    const modelMap = new Map();
    const portableModels = raw.portableModels || [];
    for (let i = 0; i < portableModels.length; i++) {
      const item = portableModels[i];
      const model = validateCharacterModelRecord({ ...item, id: id('model-import'), blob: dataToBlob(item.data, item.mimeType || 'model/gltf-binary') });
      await store.saveCharacterModel(model);
      stagedModels.push(model.id);
      modelMap.set(item.id, model.id);
      onProgress({ phase: 'assets', current: i + 1, total: portableModels.length });
    }
    const usedMissing = validated.characters3d.some((actor) => actor.modelId && !modelMap.has(actor.modelId));
    if (usedMissing) throw new Error('Yedekte kullanılan 3D modelin portableModels verisi eksik.');
    const projectIds = new Set((await store.listProjects()).map((p) => p.id));
    let projectId; do { projectId = id('project'); } while (projectIds.has(projectId));
    const project = { ...validated, projectId, name: String(name || validated.name || 'İçe aktarılan proje').trim().slice(0, 64) || 'İçe aktarılan proje', createdAt: new Date().toISOString(), favorite: false,
      characters3d: validated.characters3d.map((actor) => ({ ...actor, modelId: actor.modelId ? modelMap.get(actor.modelId) : null })),
      worldCharacterTemplates: validated.worldCharacterTemplates.map((template) => ({ ...template, id: id('template-import') })) };
    const templateMap = new Map(validated.worldCharacterTemplates.map((t, i) => [t.id, project.worldCharacterTemplates[i].id]));
    project.worldCharacters = validated.worldCharacters.map((actor) => ({ ...actor, templateId: templateMap.get(actor.templateId) }));
    await store.saveProject(projectId, project);
    createdProjectId = projectId;
    onProgress({ phase: 'complete', current: 1, total: 1 });
    return project;
  } catch (error) {
    if (createdProjectId) try { await store.deleteProject(createdProjectId); } catch {}
    for (const assetId of stagedModels.reverse()) try { await store.deleteCharacterModel(assetId); } catch {}
    throw error;
  }
}

/** Import all archive rows additively. Every incoming ID is remapped; on errors remove rows created by this call. */
export async function importWorkspaceArchive(store, parsed, { onProgress = () => {} } = {}) {
  const archive = parsed && Array.isArray(parsed.projects) && Array.isArray(parsed.templates) && Array.isArray(parsed.models)
    && Object.hasOwn(parsed, 'byteSize') ? parsed : parseWorkspaceArchive(parsed);
  const made = { projects: [], templates: [], models: [] };
  try {
    const modelMap = new Map(); const templateMap = new Map();
    for (const [i, source] of archive.models.entries()) {
      const item = { ...source, id: id('model-import') }; await store.saveCharacterModel(item); made.models.push(item.id); modelMap.set(source.id, item.id); onProgress({ phase: 'models', current: i + 1, total: archive.models.length });
    }
    for (const [i, source] of archive.templates.entries()) {
      const item = { ...source, id: id('template-import') }; await store.saveCharacterTemplate(item); made.templates.push(item.id); templateMap.set(source.id, item.id); onProgress({ phase: 'templates', current: i + 1, total: archive.templates.length });
    }
    const currentIds = new Set((await store.listProjects()).map((p) => p.id));
    for (const [i, source] of archive.projects.entries()) {
      let projectId; do { projectId = id('project'); } while (currentIds.has(projectId)); currentIds.add(projectId);
      const templates = source.worldCharacterTemplates.map((t) => ({ ...t, id: id('template-local-import') }));
      const localTemplateMap = new Map(source.worldCharacterTemplates.map((t, n) => [t.id, templates[n].id]));
      const project = { ...source, projectId, name: source.name.slice(0, 56) + ' (içe aktarıldı)', createdAt: new Date().toISOString(), favorite: false,
        worldCharacterTemplates: templates, worldCharacters: source.worldCharacters.map((actor) => ({ ...actor, templateId: localTemplateMap.get(actor.templateId) })),
        characters3d: source.characters3d.map((actor) => ({ ...actor, modelId: actor.modelId ? modelMap.get(actor.modelId) || actor.modelId : null })) };
      await store.saveProject(projectId, project); made.projects.push(projectId); onProgress({ phase: 'projects', current: i + 1, total: archive.projects.length });
    }
    return { imported: { projects: made.projects.length, templates: made.templates.length, models: made.models.length } };
  } catch (error) {
    for (const projectId of made.projects.reverse()) try { await store.deleteProject(projectId); } catch {}
    for (const assetId of made.templates.reverse()) try { await store.deleteCharacterTemplate(assetId); } catch {}
    for (const assetId of made.models.reverse()) try { await store.deleteCharacterModel(assetId); } catch {}
    throw new Error(`Workspace aktarımı tamamlanamadı; eklenen kayıtlar temizlendi: ${error.message}`);
  }
}
