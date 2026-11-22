import type { Rng } from '../shared/rng';
import { COMPANIES, GameState, Orders, knows, orderCash } from './logic';

export type Persona = 'analyst' | 'trend' | 'gambler';

/**
 * What a bot expects a company to do next round, using only what it may know:
 * the rule if it was published or bought, otherwise the recent price history.
 */
export function expectedMove(s: GameState, me: string, i: number, persona: Persona): number {
  const p = s.prices[i];
  if (knows(s, me, i)) {
    const r = s.rules[i];
    const h = s.history;
    const last = h.length >= 2 ? h[h.length - 1].map((x, k) => x - h[h.length - 2][k]) : COMPANIES.map(() => 0);
    switch (r.kind) {
      case 'climber': return 800;
      case 'zigzag': return s.round % 2 === 1 ? 2000 : -1500;
      case 'crowd': return 400;        // its own buying pushes it up
      case 'contrarian': return -400;  // and down here
      case 'echo': return last[r.follows!];
      case 'boom': return s.round % 4 === 0 ? -p * 0.6 : p * 0.12;
      case 'drifter': return 0;
      case 'magnet': return p > 12_000 ? -2500 : p < 8_000 ? 2500 : 1000;
    }
  }
  const h = s.history.slice(-4);
  if (h.length < 2) return persona === 'gambler' ? 300 : 0;
  const changes = h.slice(1).map((x, k) => x[i] - h[k][i]);
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  const lastC = changes[changes.length - 1];
  return persona === 'trend' ? lastC * 0.8 + avg * 0.2 : avg * 0.6;
}

export type BotTurn = { rumor: number | null; orders: Orders };

export function botTurn(s: GameState, me: string, persona: Persona, rng: Rng): BotTurn {
  const p = s.players.find((x) => x.id === me)!;
  let cash = p.cash;

  // analysts buy a private rumor on the most puzzling company
  let rumor: number | null = null;
  const unknown = COMPANIES.map((c) => c.id).filter((i) => !knows(s, me, i));
  const wantsRumor = persona === 'analyst' ? 0.45 : persona === 'trend' ? 0.12 : 0.08;
  if (unknown.length && cash >= s.config.rumorCost * 3 && s.round < s.config.rounds - 2 && rng() < wantsRumor) {
    rumor = unknown[Math.floor(rng() * unknown.length)];
    cash -= s.config.rumorCost;
  }
  const view = rumor === null ? s : { ...s, players: s.players.map((x) => (x.id === me ? { ...x, rumors: [...x.rumors, rumor!] } : x)) };

  const noise = persona === 'gambler' ? 0.06 : 0.01;
  const ret = COMPANIES.map((c) => expectedMove(view, me, c.id, persona) / s.prices[c.id] + (rng() - 0.5) * noise);

  const orders: Orders = {};
  // sell what looks set to fall
  COMPANIES.forEach((c) => {
    if (p.shares[c.id] > 0 && ret[c.id] < -0.01) {
      orders[c.id] = -p.shares[c.id];
      cash += p.shares[c.id] * s.prices[c.id];
    }
  });
  // buy the best one or two
  const share = persona === 'gambler' ? 0.9 : persona === 'trend' ? 0.6 : 0.7;
  const ranked = COMPANIES.map((c) => c.id).filter((i) => ret[i] > 0.02 && !(orders[i] < 0)).sort((a, b) => ret[b] - ret[a]);
  let budget = cash * share;
  for (const i of ranked.slice(0, 2)) {
    const q = Math.floor((budget * (i === ranked[0] ? 0.7 : 1)) / s.prices[i]);
    if (q > 0) {
      orders[i] = q;
      budget -= q * s.prices[i];
    }
  }
  // safety: never send orders we can't pay for
  if (orderCash(view, me, orders, rumor === null ? 0 : 1) === null) return { rumor, orders: {} };
  return { rumor, orders };
}
