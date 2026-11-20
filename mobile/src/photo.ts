// Bench photos are downscaled before they are stored or sent: a phone camera's 12 MP JPEG is
// several MB, and a protocol needs to show what was on the bench, not a print.
const MAX_SIDE = 2000;

export async function photo(file: File): Promise<{ filename: string; base64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo'))), 'image/jpeg', 0.85));
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const stem = (file.name || '').replace(/\.[^.]*$/, '') || `photo-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  return { filename: `${stem}.jpg`, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}
