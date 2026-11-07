export const SCENE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'product-display',
    name: 'Ürün Sunum Seti',
    description: 'Platform, kaide ve ürün için küresel bir şekil içeren sade bir sunum sahnesi.',
    primitives: Object.freeze([
      Object.freeze({ type: 'box', name: 'Sunum Platformu', width: 7, height: 0.25, depth: 5, radius: 1, color: '#343434', position: Object.freeze({ x: 0, y: 0.125, z: -2 }) }),
      Object.freeze({ type: 'cylinder', name: 'Ürün Kaidesi', width: 1, height: 1, depth: 1, radius: 0.65, color: '#777777', position: Object.freeze({ x: 0, y: 0.75, z: -2 }) }),
      Object.freeze({ type: 'sphere', name: 'Örnek Ürün', width: 1, height: 1, depth: 1, radius: 0.55, color: '#c9c9c9', position: Object.freeze({ x: 0, y: 1.9, z: -2 }) }),
    ]),
  }),
  Object.freeze({
    id: 'stage-blocks',
    name: 'Sahne Blokları',
    description: 'Farklı yüksekliklerde üç düzenlenebilir blokla başlangıç kompozisyonu.',
    primitives: Object.freeze([
      Object.freeze({ type: 'box', name: 'Sol Sahne Bloğu', width: 1.5, height: 1, depth: 1.5, radius: 1, color: '#555555', position: Object.freeze({ x: -2, y: 0.5, z: -2 }) }),
      Object.freeze({ type: 'box', name: 'Orta Sahne Bloğu', width: 1.5, height: 2, depth: 1.5, radius: 1, color: '#888888', position: Object.freeze({ x: 0, y: 1, z: -2 }) }),
      Object.freeze({ type: 'box', name: 'Sağ Sahne Bloğu', width: 1.5, height: 1.4, depth: 1.5, radius: 1, color: '#b8b8b8', position: Object.freeze({ x: 2, y: 0.7, z: -2 }) }),
    ]),
  }),
]);

function newPrimitiveId() {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `primitive:template-${token}`;
}

export function buildSceneTemplateEdits(templateId) {
  const template = SCENE_TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error('Sahne şablonu bulunamadı.');
  return template.primitives.map(({ position, ...primitive }) => ({
    id: newPrimitiveId(),
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    label: primitive.name,
    visible: true,
    locked: false,
    primitive: { ...primitive },
  }));
}
