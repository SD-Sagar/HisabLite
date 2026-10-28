import { encode } from 'uqr';

/**
 * A QR code as a PNG data URL. PNG rather than SVG so that a saved copy opens from the gallery
 * in GPay or PhonePe ("scan from photo").
 */
export function qrPng(text: string, scale = 8): string {
  const { data } = encode(text, { ecc: 'M', border: 2 });
  const size = data.length * scale;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  data.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect(x * scale, y * scale, scale, scale)));
  return canvas.toDataURL('image/png');
}
