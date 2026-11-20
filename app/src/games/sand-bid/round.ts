/**
 * The live round as a small event-driven state machine.
 *
 * Inputs are only `press`, `release` and `tick`, each with a timestamp. That
 * keeps the rules identical whether events come from the local player, from
 * bots, or (later) from other players over the network: a server would own a
 * LiveRound, apply events in arrival order and broadcast the stage changes.
 *
 * Stages:
 *   gathering  waiting until every active player is pressing
 *   countdown  3 s; letting go now = sitting out (bid 0)
 *   running    clock runs; each release locks that player's bid
 *   over       nobody is holding any more; bids are final
 */

export const COUNTDOWN_MS = 3000;

export type HoldStatus = 'waiting' | 'holding' | 'released' | 'out';
export type RoundStage = 'gathering' | 'countdown' | 'running' | 'over';

export interface Holder {
  status: HoldStatus;
  bid: number; // ms; final once status is 'released' or 'out'
}

export interface LiveRound {
  stage: RoundStage;
  countdownAt: number | null;
  runAt: number | null;
  endAt: number | null; // when the last player let go
  banks: Record<string, number>;
  holders: Record<string, Holder>;
}

/** Players with an empty bank are out from the start. */
export function openRound(banks: Record<string, number>): LiveRound {
  const holders: Record<string, Holder> = {};
  for (const [id, bank] of Object.entries(banks)) holders[id] = { status: bank > 0 ? 'waiting' : 'out', bid: 0 };
  const r: LiveRound = { stage: 'gathering', countdownAt: null, runAt: null, endAt: null, banks, holders };
  return Object.values(holders).every((h) => h.status === 'out') ? { ...r, stage: 'over' } : r;
}

const set = (r: LiveRound, id: string, h: Holder): LiveRound => ({ ...r, holders: { ...r.holders, [id]: h } });
const anyHolding = (r: LiveRound) => Object.values(r.holders).some((h) => h.status === 'holding');

export function press(r: LiveRound, id: string, now: number): LiveRound {
  const h = r.holders[id];
  if (r.stage !== 'gathering' || h?.status !== 'waiting') return r;
  const next = set(r, id, { ...h, status: 'holding' });
  const ready = Object.values(next.holders).every((x) => x.status === 'holding' || x.status === 'out');
  return ready ? { ...next, stage: 'countdown', countdownAt: now } : next;
}

export function release(r: LiveRound, id: string, now: number): LiveRound {
  const h = r.holders[id];
  if (h?.status !== 'holding') return r;
  if (r.stage === 'gathering') return set(r, id, { ...h, status: 'waiting' }); // not ready after all
  if (r.stage === 'countdown') return set(r, id, { status: 'released', bid: 0 });
  if (r.stage === 'running') {
    const bid = Math.min(r.banks[id], Math.max(0, now - r.runAt!));
    return finishIfDone(set(r, id, { status: 'released', bid: Math.round(bid) }), now);
  }
  return r;
}

/** Advance time: end the countdown, auto-release empty banks, close the round. */
export function tick(r: LiveRound, now: number): LiveRound {
  let next = r;
  if (next.stage === 'countdown' && now - next.countdownAt! >= COUNTDOWN_MS) {
    const runAt = next.countdownAt! + COUNTDOWN_MS;
    next = { ...next, stage: 'running', runAt };
    if (!anyHolding(next)) return { ...next, stage: 'over', endAt: runAt };
  }
  if (next.stage === 'running') {
    for (const [id, h] of Object.entries(next.holders)) {
      if (h.status === 'holding' && now - next.runAt! >= next.banks[id]) {
        next = set(next, id, { status: 'released', bid: next.banks[id] });
      }
    }
    next = finishIfDone(next, now);
  }
  return next;
}

function finishIfDone(r: LiveRound, now: number): LiveRound {
  if (r.stage !== 'running' || anyHolding(r)) return r;
  const longest = Math.max(0, ...Object.values(r.holders).map((h) => h.bid));
  return { ...r, stage: 'over', endAt: Math.min(now, r.runAt! + longest) };
}

export function bidsOf(r: LiveRound): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, h] of Object.entries(r.holders)) out[id] = h.bid;
  return out;
}

/** How long the round clock has run (frozen once the round is over). */
export function clockMs(r: LiveRound, now: number): number {
  if (r.runAt === null) return 0;
  return Math.max(0, (r.endAt ?? now) - r.runAt);
}
