/**
 * Preprocess a cropped ticket-number image for OCR: grayscale, Otsu
 * binarization, and upscale so Tesseract sees large, clean digits.
 */
export function preprocessForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx0 = source.getContext('2d')!;
  const { width, height } = source;
  const imgData = ctx0.getImageData(0, 0, width, height);
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = 0.299 * imgData.data[o] + 0.587 * imgData.data[o + 1] + 0.114 * imgData.data[o + 2];
  }

  const threshold = otsuThreshold(gray);

  const targetH = 200;
  const scale = Math.max(1, targetH / height);
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);

  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const sctx = small.getContext('2d')!;
  const outImg = sctx.createImageData(width, height);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] > threshold ? 255 : 0;
    const o = i * 4;
    outImg.data[o] = v;
    outImg.data[o + 1] = v;
    outImg.data[o + 2] = v;
    outImg.data[o + 3] = 255;
  }
  sctx.putImageData(outImg, 0, 0);

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = true;
  octx.drawImage(small, 0, 0, outW, outH);
  return out;
}

function otsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let max = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Extract candidate 6-digit lottery numbers from raw OCR text. */
export function extractSixDigitCandidates(text: string): string[] {
  const digitsOnly = text.replace(/[^0-9]/g, ' ');
  const runs = digitsOnly.split(/\s+/).filter(Boolean);
  const found = new Set<string>();

  for (const run of runs) {
    if (run.length === 6) {
      found.add(run);
    } else if (run.length > 6) {
      // Long digit runs (barcode) are noisy; still surface sliding windows
      // as low-priority candidates in case the number was glued to noise.
      for (let i = 0; i + 6 <= run.length; i++) found.add(run.slice(i, i + 6));
    }
  }

  const exact = runs.filter((r) => r.length === 6);
  const rest = [...found].filter((c) => !exact.includes(c));
  return [...new Set([...exact, ...rest])].slice(0, 12);
}
