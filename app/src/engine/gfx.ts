import { Category, getSheet } from './atlas';

export interface HitRegion { id: string; x: number; y: number; w: number; h: number }

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  shadow?: string | false;
  alpha?: number;
}

export const COLORS = {
  ink: '#f1e4c3',
  muted: '#a6a2ad',
  gold: '#f5cd5b',
  ruby: '#f2687a',
  emerald: '#6edd8c',
  sapphire: '#70adf2',
  amethyst: '#bf89ea',
  night: '#120c22',
  shadow: '#0f0e14',
};

/**
 * Drawing context handed to a stage's draw function. All coordinates are in
 * logical (unscaled) pixels; the stage applies the integer scale.
 */
export class Gfx {
  readonly hits: HitRegion[] = [];

  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly width: number,
    readonly height: number,
    readonly hover: string | null,
    readonly time: number,
  ) {}

  sprite(cat: Category, name: string, x: number, y: number, opts: { scale?: number; alpha?: number } = {}) {
    const { image, frames } = getSheet(cat);
    const f = frames[name];
    if (!f) throw new Error(`missing sprite ${cat}/${name}`);
    const s = opts.scale ?? 1;
    const { ctx } = this;
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    ctx.drawImage(image, f.x, f.y, f.w, f.h, Math.round(x), Math.round(y), f.w * s, f.h * s);
    ctx.globalAlpha = 1;
  }

  size(cat: Category, name: string): { w: number; h: number } {
    const f = getSheet(cat).frames[name];
    return { w: f.w, h: f.h };
  }

  /** 9-slice draw of a UI sprite (corners kept, edges/centre stretched). */
  panel(name: string, x: number, y: number, w: number, h: number, slice = 4, cat: Category = 'ui') {
    const { image, frames } = getSheet(cat);
    const f = frames[name];
    const s = slice;
    const sx = [f.x, f.x + s, f.x + f.w - s];
    const sw = [s, f.w - 2 * s, s];
    const sy = [f.y, f.y + s, f.y + f.h - s];
    const sh = [s, f.h - 2 * s, s];
    const dx = [x, x + s, x + w - s];
    const dw = [s, w - 2 * s, s];
    const dy = [y, y + s, y + h - s];
    const dh = [s, h - 2 * s, s];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++)
        this.ctx.drawImage(image, sx[i], sy[j], sw[i], sh[j], dx[i], dy[j], dw[i], dh[j]);
  }

  tile(cat: Category, name: string, x: number, y: number, w: number, h: number) {
    const { w: tw, h: th } = this.size(cat, name);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.ctx.clip();
    for (let yy = y; yy < y + h; yy += th) for (let xx = x; xx < x + w; xx += tw) this.sprite(cat, name, xx, yy);
    this.ctx.restore();
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1) {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
    this.ctx.globalAlpha = 1;
  }

  frame(x: number, y: number, w: number, h: number, color: string, t = 1) {
    this.rect(x, y, w, t, color);
    this.rect(x, y + h - t, w, t, color);
    this.rect(x, y, t, h, color);
    this.rect(x + w - t, y, t, h, color);
  }

  text(str: string, x: number, y: number, o: TextOpts = {}) {
    const { ctx } = this;
    ctx.font = `${o.size ?? 8}px "DotGothic16", monospace`;
    ctx.textAlign = o.align ?? 'left';
    ctx.textBaseline = o.baseline ?? 'top';
    ctx.globalAlpha = o.alpha ?? 1;
    if (o.shadow !== false) {
      ctx.fillStyle = o.shadow ?? COLORS.shadow;
      ctx.fillText(str, x + 0.5, y + 0.5);
    }
    ctx.fillStyle = o.color ?? COLORS.ink;
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  /** Canvas button drawn from the UI sprites, registered as a hit region. */
  button(id: string, label: string, x: number, y: number, w: number, opts: { color?: 'blue' | 'red'; disabled?: boolean } = {}) {
    const h = 14;
    const pressed = this.hover === id && !opts.disabled;
    const name = opts.disabled ? 'button_disabled' : `button_${opts.color ?? 'blue'}${pressed ? '_pressed' : ''}`;
    this.panel(name, x, y, w, h, 4);
    this.text(label, x + w / 2, y + (pressed ? 7 : 6), {
      align: 'center', baseline: 'middle', size: 8, color: opts.disabled ? COLORS.muted : COLORS.ink,
    });
    if (!opts.disabled) this.hit(id, x, y, w, h);
  }

  hit(id: string, x: number, y: number, w: number, h: number) {
    this.hits.push({ id, x, y, w, h });
  }

  isHover(id: string) {
    return this.hover === id;
  }
}
