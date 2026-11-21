import type { Rng } from '../shared/rng';
import { Belief, applyEvent, beliefFor, seatOdds } from './knowledge';
import { Action, ActionKind, COST, GameState, SEATS, pairOf } from './logic';

export type Persona = 'careful' | 'pusher' | 'wild';

/** Chance that `seat` faces a loaded chamber after a hypothetical move. */
function oddsAfter(b: Belief, me: string, action: Action, seat: number): number {
  if (action.kind === 'peekPublic' || action.kind === 'peekPrivate') return seatOdds(b)[seat];
  const ev = { player: me, kind: action.kind, cost: COST[action.kind], seat: action.seat };
  return seatOdds(applyEvent(b, ev, me))[seat];
}

/**
 * Choose a move from what this bot knows:
 *  - likely facing a round → swap it onto a neighbour, or spin away
 *  - unsure → peek (privately if it can afford it)
 *  - fairly safe → spend as little as possible
 */
export function botAction(s: GameState, me: string, persona: Persona, rng: Rng): Action {
  const p = s.players.find((x) => x.id === me)!;
  const b = beliefFor(s.events, me, s.config.bullets);
  const odds = seatOdds(b);
  const mine = odds[p.seat];
  const afford = (k: ActionKind) => p.credits >= COST[k];
  const left = (p.seat + SEATS - 1) % SEATS; // pair (left, me)

  if (persona === 'wild' && rng() < 0.25) {
    const kinds = (['peekPublic', 'peekPrivate', 'spin1', 'spin2', 'swap'] as ActionKind[]).filter(afford);
    const kind = kinds[Math.floor(rng() * kinds.length)];
    return { kind, seat: Math.floor(rng() * SEATS) };
  }

  const danger = persona === 'careful' ? 0.3 : 0.45;
  if (mine >= danger) {
    // best escape among swaps with either neighbour and spins
    const moves: Action[] = [];
    if (afford('swap')) moves.push({ kind: 'swap', seat: p.seat }, { kind: 'swap', seat: left });
    if (afford('spin1')) moves.push({ kind: 'spin1' });
    if (afford('spin2')) moves.push({ kind: 'spin2' });
    let best: Action | null = null;
    let bestOdds = mine;
    for (const m of moves) {
      const o = oddsAfter(b, me, m, p.seat) + COST[m.kind] * 0.01;
      if (o < bestOdds - 0.1) {
        bestOdds = o;
        best = m;
      }
    }
    if (best) return best;
  }

  const uncertain = mine > 0.05 && mine < 0.95;
  if (uncertain && afford('peekPrivate') && (persona === 'careful' || p.credits > 6)) {
    // look at my own chamber and the less-known neighbour
    const right = (p.seat + 1) % SEATS;
    const pairSeat = Math.abs(odds[right] - 0.5) < Math.abs(odds[left] - 0.5) ? p.seat : left;
    return { kind: 'peekPrivate', seat: pairSeat };
  }
  // the pusher likes pushing a known round toward someone else
  if (persona === 'pusher' && afford('swap') && mine > 0.9) return { kind: 'swap', seat: p.seat };
  // cheapest move: peek publicly at the most uncertain pair
  let seat = 0;
  let bestU = -1;
  for (let k = 0; k < SEATS; k++) {
    const [a, c] = pairOf(k);
    const u = Math.min(odds[a], 1 - odds[a]) + Math.min(odds[c], 1 - odds[c]);
    if (u > bestU) {
      bestU = u;
      seat = k;
    }
  }
  return { kind: 'peekPublic', seat };
}
