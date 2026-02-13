/**
 * Oscilloscope Renderer
 *
 * Draws a phosphor-green waveform from AnalyserNode time-domain data
 * onto a canvas element. Uses getByteTimeDomainData() for the waveform
 * and draws a polyline with glow effect.
 */

const PHOSPHOR_GREEN = "#33FF33";
const GLOW_COLOR = "rgba(51, 255, 51, 0.4)";
const LINE_WIDTH = 2;
const GLOW_WIDTH = 6;

export function drawOscilloscope(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
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
