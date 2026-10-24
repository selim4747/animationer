/** Convert a top-left CSS rectangle to Three.js renderer viewport coordinates. */
export function toRendererViewport(rect, canvasWidth, canvasHeight) {
  const left = Math.max(0, Math.floor(rect.left));
  const top = Math.max(0, Math.floor(rect.top));
  const width = Math.max(0, Math.min(Math.floor(rect.width), Math.floor(canvasWidth - left)));
  const height = Math.max(0, Math.min(Math.floor(rect.height), Math.floor(canvasHeight - top)));
  return { x: left, y: Math.floor(canvasHeight - top - height), width, height };
}
