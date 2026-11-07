export const MOTION_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'greet-and-move',
    name: 'Yaklaş ve Selam Ver',
    description: 'Karakteri kısa bir mesafe ilerletir, duraklatır ve el sallatır.',
    steps: Object.freeze([
      Object.freeze({ type: 'MOVE_TO', title: 'Sunum Noktasına İlerle', data: Object.freeze({ x: 0, y: 0, z: -2 }) }),
      Object.freeze({ type: 'WAIT', title: 'Kısa Duraklama', data: Object.freeze({ duration: 0.6 }) }),
      Object.freeze({ type: 'PLAY_EMOTE', title: 'Selam Ver', data: Object.freeze({ emote: 'wave' }) }),
    ]),
  }),
  Object.freeze({
    id: 'door-entry',
    name: 'Kapıdan Giriş',
    description: 'Kapıyı açar, kısa süre bekler ve karakteri giriş noktasına taşır.',
    steps: Object.freeze([
      Object.freeze({ type: 'TRIGGER_DOOR', title: 'Kapıyı Aç', data: Object.freeze({ action: 'open' }) }),
      Object.freeze({ type: 'WAIT', title: 'Kapının Açılmasını Bekle', data: Object.freeze({ duration: 0.8 }) }),
      Object.freeze({ type: 'MOVE_TO', title: 'Giriş Noktasına İlerle', data: Object.freeze({ x: 0, y: 0, z: -1.8 }) }),
    ]),
  }),
  Object.freeze({
    id: 'short-intro',
    name: 'Kısa Tanıtım',
    description: 'Kısa bir bekleme, küçük bir hareket ve zıplama emotesi ekler.',
    steps: Object.freeze([
      Object.freeze({ type: 'WAIT', title: 'Tanıtım Öncesi Bekle', data: Object.freeze({ duration: 0.5 }) }),
      Object.freeze({ type: 'MOVE_TO', title: 'Kameraya Yaklaş', data: Object.freeze({ x: 1, y: 0, z: -1 }) }),
      Object.freeze({ type: 'PLAY_EMOTE', title: 'Zıpla', data: Object.freeze({ emote: 'jump' }) }),
    ]),
  }),
]);

export function getMotionTemplate(templateId) {
  const template = MOTION_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return null;
  return {
    ...template,
    steps: template.steps.map((step) => ({ ...step, data: { ...step.data } })),
  };
}
