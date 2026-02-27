/**
 * Oscilloscope Renderer
 *
 * Draws a phosphor-green waveform from AnalyserNode time-domain data
 * onto a canvas element. Uses getByteTimeDomainData() for the waveform
 * and draws a polyline with glow effect.
 *
 * All typed arrays and ImageData are cached to avoid per-frame allocation
 * which causes GC pressure crashes on mobile.
 */

const PHOSPHOR_GREEN = "#33FF33";
const GLOW_COLOR = "rgba(51, 255, 51, 0.4)";
const LINE_WIDTH = 2;
const GLOW_WIDTH = 6;

// Cached buffers — reused across frames to avoid GC pressure
let cachedDataArray: Uint8Array<ArrayBuffer> | null = null;
let cachedBufferLength = 0;
let cachedImageData: ImageData | null = null;
let cachedImageWidth = 0;
let cachedImageHeight = 0;

function getDataArray(length: number): Uint8Array<ArrayBuffer> {
  if (!cachedDataArray || cachedBufferLength !== length) {
    cachedDataArray = new Uint8Array(length);
    cachedBufferLength = length;
  }
  return cachedDataArray;
}

function getImageData(ctx: CanvasRenderingContext2D, w: number, h: number): ImageData {
  if (!cachedImageData || cachedImageWidth !== w || cachedImageHeight !== h) {
    cachedImageData = ctx.createImageData(w, h);
    cachedImageWidth = w;
    cachedImageHeight = h;
  }
  return cachedImageData;
}

export function drawOscilloscope(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = getDataArray(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Draw glow layer (thicker, translucent)
  ctx.lineWidth = GLOW_WIDTH;
  ctx.strokeStyle = GLOW_COLOR;
  ctx.beginPath();
  drawWaveform(ctx, dataArray, bufferLength, width, height);
  ctx.stroke();

  // Draw main line (sharp, bright)
  ctx.lineWidth = LINE_WIDTH;
  ctx.strokeStyle = PHOSPHOR_GREEN;
  ctx.shadowColor = PHOSPHOR_GREEN;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  drawWaveform(ctx, dataArray, bufferLength, width, height);
  ctx.stroke();

  // Reset shadow
  ctx.shadowBlur = 0;
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  dataArray: Uint8Array,
  bufferLength: number,
  width: number,
  height: number,
): void {
  const sliceWidth = width / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0; // Normalize 0-255 to 0-2
    const y = (v * height) / 2;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x += sliceWidth;
  }
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
    data[i] = v * 0.2;       // R — dim
    data[i + 1] = v * 0.8;   // G — green tint
    data[i + 2] = v * 0.15;  // B — dim
    data[i + 3] = 180 + Math.random() * 75; // A
  }

  ctx.putImageData(imageData, 0, 0);

  // Overlay scanlines
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  for (let y = 0; y < height; y += 3) {
    ctx.fillRect(0, y, width, 1);
  }
}

/** Draw a breathing line with subtle noise (idle state) */
export function drawIdleLine(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const y = height / 2;
  const t = Date.now() * 0.001; // time in seconds

  // Breathing amplitude (subtle wobble when idle)
  const breathe = Math.sin(t * 0.8) * 2;

  // Glow
  ctx.lineWidth = GLOW_WIDTH;
  ctx.strokeStyle = GLOW_COLOR;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    // Subtle noise + sine breathing
    const noise = (Math.sin(x * 0.05 + t * 3) + Math.sin(x * 0.08 + t * 1.7)) * 0.5;
    const py = y + noise * breathe;
    if (x === 0) ctx.moveTo(x, py);
    else ctx.lineTo(x, py);
  }
  ctx.stroke();

  // Main line
  ctx.lineWidth = LINE_WIDTH;
  ctx.strokeStyle = PHOSPHOR_GREEN;
  ctx.shadowColor = PHOSPHOR_GREEN;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const noise = (Math.sin(x * 0.05 + t * 3) + Math.sin(x * 0.08 + t * 1.7)) * 0.5;
    const py = y + noise * breathe;
    if (x === 0) ctx.moveTo(x, py);
    else ctx.lineTo(x, py);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}
