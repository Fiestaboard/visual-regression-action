// PNG blobs in, diff + mask PNG blobs out. Uses OffscreenCanvas, so the same
// code runs in the diff worker and, as a fallback, on the main thread.
import { diffRasters, type Raster } from './diff-core';

export interface DiffRequest {
  baseline: Blob;
  current: Blob;
  threshold: number;
}

export interface DiffResult {
  diff: Blob;
  mask: Blob;
}

async function decode(blob: Blob): Promise<Raster> {
  // No colour management or premultiplying: the raw pixels are what the action compared.
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width, height, data };
}

function encode(r: Raster): Promise<Blob> {
  const canvas = new OffscreenCanvas(r.width, r.height);
  canvas.getContext('2d')!.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export async function renderDiff({ baseline, current, threshold }: DiffRequest): Promise<DiffResult> {
  const [a, b] = await Promise.all([decode(baseline), decode(current)]);
  const { diff, mask } = diffRasters(a, b, threshold);
  const [diffBlob, maskBlob] = await Promise.all([encode(diff), encode(mask)]);
  return { diff: diffBlob, mask: maskBlob };
}
