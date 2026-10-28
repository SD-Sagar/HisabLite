import { tr } from '../i18n';

export interface PreparedImage {
  blob: Blob;
  base64: string;
  mediaType: 'image/jpeg';
}

async function toBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // older Safari: fall back to an <img>, which also honours EXIF rotation
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Any file as base64, for the AI: a PDF goes up as it is, no drawing needed. */
export const fileBase64 = (file: Blob) => blobToBase64(file);

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Downscales a camera photo to a JPEG no longer than maxSide on its long edge. */
export async function prepareImage(file: Blob, maxSide: number, quality: number): Promise<PreparedImage> {
  const src = await toBitmap(file);
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if ('close' in src) src.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr().errors.imageRead))), 'image/jpeg', quality),
  );
  return { blob, base64: await blobToBase64(blob), mediaType: 'image/jpeg' };
}

/** A shop's logo for the ফর্দ: a small PNG data URL, see-through parts kept, light enough to sync. */
export async function logoDataUrl(file: Blob, maxSide = 220): Promise<string> {
  const src = await toBitmap(file);
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  if (!w || !h) throw new Error(tr().errors.imageRead);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  if ('close' in src) src.close();
  return canvas.toDataURL('image/png');
}
