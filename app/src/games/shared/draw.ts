import { COLORS, Gfx } from '../../engine/gfx';

/** Star icon plus a count, centred on cx. */
export function starCount(g: Gfx, cx: number, y: number, n: number, color: string) {
  g.sprite('icons', 'star', cx - 18, y - 4);
  g.text(`${n}`, cx + 2, y, { color, shadow: false, size: 8 });
}

export interface StandingRow {
  name: string;
  detail: string;
}

/** End-of-match overlay: ranked rows, a verdict line and a Play again button. */
export function standingsPanel(g: Gfx, rows: StandingRow[], verdict: string, buttonId = 'again') {
  const W = g.width;
  g.rect(0, 0, W, g.height, COLORS.night, 0.75);
  g.panel('panel_parchment', 120, 30, 240, 210, 4);
  g.text('FINAL RESULT', W / 2, 42, { align: 'center', size: 12, color: '#5e3a24', shadow: false });
  const step = rows.length > 5 ? 20 : 24;
  rows.forEach((r, i) => {
    const y = 66 + i * step;
    const last = i === rows.length - 1;
    g.sprite('icons', i === 0 ? 'crown' : last ? 'prison' : 'star', 136, y - 4);
    g.text(`${i + 1}. ${r.name}`, 158, y, { color: '#3a2216', shadow: false, size: 10 });
    g.text(r.detail, 340, y, { align: 'right', color: '#5e3a24', shadow: false, size: 9 });
  });
  g.text(verdict, W / 2, 196, { align: 'center', color: '#86192f', shadow: false, size: 10 });
  g.button(buttonId, 'Play again', W / 2 - 40, 216, 80);
}

/** Standard header strip used by every game screen. */
export function topBar(g: Gfx, parts: { text: string; color?: string }[], title: string) {
  g.panel('panel_night', 4, 4, g.width - 8, 22, 4);
  let x = 12;
  for (const p of parts) {
    g.text(p.text, x, 10, { color: p.color ?? COLORS.ink, size: 8 });
    x += g.ctx.measureText(p.text).width + 12;
  }
  g.text(title, g.width - 12, 10, { align: 'right', color: COLORS.amethyst, size: 8 });
}
