// Loads the packed sprite sheets produced by tools/build_assets.py.

export interface Frame { x: number; y: number; w: number; h: number }
export interface Sheet { image: HTMLImageElement; frames: Record<string, Frame> }

export const CATEGORIES = [
  'cards', 'coins', 'dice', 'items', 'board', 'gems', 'tokens', 'portraits', 'icons', 'monsters', 'ui', 'party',
] as const;
export type Category = (typeof CATEGORIES)[number];

const BASE = import.meta.env.BASE_URL;
const sheets = new Map<Category, Sheet>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function loadSheet(cat: Category): Promise<Sheet> {
  const hit = sheets.get(cat);
  if (hit) return hit;
  const meta = await fetch(`${BASE}sheets/${cat}.json`).then((r) => r.json());
  const image = await loadImage(`${BASE}sheets/${cat}.png`);
  const sheet = { image, frames: meta.frames as Record<string, Frame> };
  sheets.set(cat, sheet);
  return sheet;
}

export async function loadAll(): Promise<void> {
  await Promise.all(CATEGORIES.map(loadSheet));
  // Make sure the pixel font is ready before the first canvas paint.
  if (document.fonts?.load) await document.fonts.load('16px "DotGothic16"').catch(() => undefined);
}

export function getSheet(cat: Category): Sheet {
  const s = sheets.get(cat);
  if (!s) throw new Error(`sheet ${cat} not loaded`);
  return s;
}

/** URL of a single sprite (for DOM <img>), optionally the 4x copy. */
export function spriteUrl(cat: Category, name: string, big = false): string {
  return `${BASE}${big ? 'sprites@4x' : 'sprites'}/${cat}/${name}.png`;
}
