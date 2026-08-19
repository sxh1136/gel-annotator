export type LaneBound = { x0: number; x1: number };

export function parseLadderSizes(text: string): number[] {
  return text
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function buildEqualLanes(x0: number, x1: number, nLanes: number): LaneBound[] {
  const xs = Array.from({ length: nLanes + 1 }, (_, i) =>
    Math.round(x0 + ((x1 - x0) * i) / nLanes)
  );
  const out: LaneBound[] = [];
  for (let i = 0; i < nLanes; i++) out.push({ x0: xs[i], x1: xs[i + 1] });
  return out;
}

export function grayscaleFromImageData(img: ImageData): Float32Array {
  const g = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i];
    const gg = d[i + 1];
    const b = d[i + 2];
    g[p] = 0.299 * r + 0.587 * gg + 0.114 * b;
  }
  return g;
}

function boxBlur(gray: Float32Array, w: number, h: number, r = 1): Float32Array {
  if (r <= 0) return gray.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const k = 2 * r + 1;

  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) {
      const xx = Math.min(w - 1, Math.max(0, x));
      sum += gray[y * w + xx];
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / k;
      const xOut = x - r;
      const xIn = x + r + 1;
      if (xOut >= 0) sum -= gray[y * w + xOut];
      if (xIn < w) sum += gray[y * w + xIn];
      else sum += gray[y * w + (w - 1)];
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      const yy = Math.min(h - 1, Math.max(0, y));
      sum += tmp[yy * w + x];
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / k;
      const yOut = y - r;
      const yIn = y + r + 1;
      if (yOut >= 0) sum -= tmp[yOut * w + x];
      if (yIn < h) sum += tmp[yIn * w + x];
      else sum += tmp[(h - 1) * w + x];
    }
  }
  return out;
}

export function preprocessGray(gray: Float32Array, w: number, h: number, invert: boolean): Float32Array {
  const sm = boxBlur(gray, w, h, 1);
  if (!invert) return sm;
  const out = new Float32Array(sm.length);
  for (let i = 0; i < sm.length; i++) out[i] = 255 - sm[i];
  return out;
}

function smooth1D(arr: number[], radius = 2): number[] {
  if (radius <= 0) return arr.slice();
  const out = new Array(arr.length).fill(0);
  for (let i = 0; i < arr.length; i++) {
    let s = 0;
    let c = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < arr.length) {
        s += arr[j];
        c++;
      }
    }
    out[i] = s / Math.max(1, c);
  }
  return out;
}

export function detectLadderBands(
  prep: Float32Array,
  w: number,
  h: number,
  lane: LaneBound,
  expectedN: number,
  minDist = 8
): { peaks: number[]; strengths: number[]; mismatch: boolean } {
  const x0 = Math.max(0, Math.min(w - 1, lane.x0));
  const x1 = Math.max(1, Math.min(w, lane.x1));
  const width = Math.max(1, x1 - x0);

  const profile = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let s = 0;
    const row = y * w;
    for (let x = x0; x < x1; x++) s += prep[row + x];
    profile[y] = s / width;
  }

  const p = smooth1D(profile, 2);

  const candidates: { y: number; strength: number }[] = [];
  const promWindow = 20;

  for (let y = 1; y < h - 1; y++) {
    if (!(p[y] > p[y - 1] && p[y] >= p[y + 1])) continue;

    let leftMin = p[y];
    let rightMin = p[y];
    for (let k = 1; k <= promWindow; k++) {
      if (y - k >= 0) leftMin = Math.min(leftMin, p[y - k]);
      if (y + k < h) rightMin = Math.min(rightMin, p[y + k]);
    }
    const baseline = Math.max(leftMin, rightMin);
    const strength = p[y] - baseline;

    if (strength > 3) candidates.push({ y, strength });
  }

  candidates.sort((a, b) => a.y - b.y);

  const filtered: { y: number; strength: number }[] = [];
  for (const c of candidates) {
    if (filtered.length === 0) {
      filtered.push(c);
      continue;
    }
    const prev = filtered[filtered.length - 1];
    if (c.y - prev.y >= minDist) {
      filtered.push(c);
    } else if (c.strength > prev.strength) {
      filtered[filtered.length - 1] = c;
    }
  }

  let chosen = filtered;

  if (expectedN > 0 && chosen.length > expectedN) {
    chosen = [...chosen]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, expectedN)
      .sort((a, b) => a.y - b.y);
  }

  const peaks = chosen.map((c) => c.y);
  const strengths = chosen.map((c) => c.strength);

  return { peaks, strengths, mismatch: expectedN > 0 && peaks.length !== expectedN };
}