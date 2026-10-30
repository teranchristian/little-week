export type IconScope = 'activity' | 'family';
export interface CustomIcon { id: string; name: string; tag: string; image: string; scope: IconScope }

export const customIconsStorageKey = 'our-week-custom-icons-v1';
export const isCustomIcon = (icon: string) => icon.startsWith('custom:');

export function readCustomIcons(): CustomIcon[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(customIconsStorageKey) ?? '[]');
    return Array.isArray(saved) ? saved.filter((item): item is CustomIcon =>
      item && typeof item.id === 'string' && isCustomIcon(item.id) &&
      typeof item.name === 'string' && typeof item.image === 'string' &&
      item.image.startsWith('data:image/png;base64,')).map(item => ({
        ...item, tag: typeof item.tag === 'string' ? item.tag : '',
        scope: item.scope === 'family' ? 'family' : 'activity',
      })) : [];
  } catch { return []; }
}

export function saveCustomIcons(icons: CustomIcon[]): void {
  localStorage.setItem(customIconsStorageKey, JSON.stringify(icons));
}

export function validateIconFile(file: File): void {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('Choose a PNG, JPG, WebP, or GIF image.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
}

export interface ImageCrop { zoom: number; x: number; y: number; rotation: number }

export function fitImageScale(width: number, height: number, squareSize: number): number {
  return Math.min(squareSize / width, squareSize / height);
}

export async function imageFromFile(file: File | string, crop: ImageCrop): Promise<string> {
  if (typeof file !== 'string') validateIconFile(file);

  const objectUrl = typeof file === 'string' ? file : URL.createObjectURL(file);
  try {
    const source = new Image();
    source.src = objectUrl;
    await source.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not process the image.');
    const scale = fitImageScale(source.naturalWidth, source.naturalHeight, 128) * crop.zoom;
    const width = source.naturalWidth * scale;
    const height = source.naturalHeight * scale;
    context.translate(64 + crop.x * 128 / 240, 64 + crop.y * 128 / 240);
    context.rotate(crop.rotation * Math.PI / 180);
    context.drawImage(source, -width / 2, -height / 2, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    if (typeof file !== 'string') URL.revokeObjectURL(objectUrl);
  }
}
