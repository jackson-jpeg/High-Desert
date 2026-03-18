/**
 * TV-static noise renderer (green-tinted)
 *
 * Used during radio tuning transitions. ImageData is cached
 * to avoid per-frame allocation and GC pressure on mobile.
 */

let cachedImageData: ImageData | null = null;
let cachedImageWidth = 0;
let cachedImageHeight = 0;

function getImageData(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): ImageData {
  if (!cachedImageData || cachedImageWidth !== w || cachedImageHeight !== h) {
    cachedImageData = ctx.createImageData(w, h);
    cachedImageWidth = w;
    cachedImageHeight = h;
  }
  return cachedImageData;
}

/** Draw TV-static noise (green-tinted) for tuning transition */
export function drawStatic(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const imageData = getImageData(ctx, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 255;
    data[i] = v * 0.2; // R — dim
    data[i + 1] = v * 0.8; // G — green tint
    data[i + 2] = v * 0.15; // B — dim
    data[i + 3] = 180 + Math.random() * 75; // A
  }

  ctx.putImageData(imageData, 0, 0);

  // Overlay scanlines
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  for (let y = 0; y < height; y += 3) {
    ctx.fillRect(0, y, width, 1);
  }
}
