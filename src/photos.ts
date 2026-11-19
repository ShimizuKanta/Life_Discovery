// Photos stay on-device. Re-encoding also strips source metadata.
export async function preparePhoto(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024 || !file.type.startsWith('image/')) throw new Error('Invalid image');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', .8);
    if (result.length > 3 * 1024 * 1024) throw new Error('Image too large');
    return result;
  } finally { URL.revokeObjectURL(url); }
}
export async function validatePhotos(items: { photo?: string | null }[]): Promise<void> {
  for (const item of items) {
    if (!item.photo) continue;
    const image = new Image(); image.src = item.photo; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid image');
  }
}
