/**
 * PARTY — the board game that strings the mini-games together (our own).
 *
 * - 2, 4, 6 or 8 players (bots fill seats). Everyone starts with 10 Pieces
 *   on the GATE of a 28-space loop. 8 rounds.
 * - A round: each player in turn rolls a die and moves that many spaces
 *   clockwise, then the space they stop on does something:
 *     GATE   +5 (also when you pass it)     BLUE   +3
 *     RED    −3 into the VAULT              EVENT  a surprise (good or bad)
 *     DUEL   pick a rival for a 1-on-1 mini-game; the winner takes 5 Pieces
 *     PRISON pay 5 into the VAULT; can't pay it all → miss your next roll
 *     VAULT  take everything in it
 * - After everyone has moved, the whole table plays a MINI-GAME: everyone
 *   for themselves (1st +8, 2nd +5, 3rd +3, 4th +1) or, with 4+ players,
 *   two teams drawn at random (each winner +5).
 * - At the end the player who won the most mini-games gets +10. Most Pieces
 *   wins; the fewest goes to prison.
 *
 * This file is the board only. Mini-games are played by the server, which
 * reports each one's finishing order back here (see `payMinigame`).
 */
import type { Rng } from '../shared/rng';

export type SpaceKind = 'gate' | 'blue' | 'red' | 'event' | 'duel' | 'prison' | 'vault';

/** The loop, clockwise from the gate (28 spaces). */
export const BOARD: SpaceKind[] = [
  'gate', 'blue', 'blue', 'event', 'red', 'blue', 'duel', 'blue', 'blue',
  'prison', 'blue', 'event', 'blue', 'red',
  'vault', 'blue', 'blue', 'duel', 'blue', 'red', 'event', 'blue', 'blue',
  'prison', 'blue', 'event', 'red', 'duel',
];
export const SIZE = BOARD.length;

export const START_PIECES = 10;
export const ROUNDS = 8;
export const PASS_GATE = 5;
export const BLUE = 3;
export const RED = 3;
export const PRISON_FINE = 5;
export const DUEL_STAKE = 5;
export const VAULT_START = 5;
export const FFA_PRIZES = [8, 5, 3, 1];
export const TEAM_PRIZE = 5;
export const TEAM_DRAW = 2;
export const MOST_WINS_BONUS = 10;

export interface Player { id: string; name: string; isBot: boolean }

export type Kind = 'ffa' | 'teams' | 'duel';

/** One line of what happened, for the log ("Ana rolled 4 → Blue +3"). */
export interface Note { round: number; text: string; who?: string; delta?: Record<string, number> }

export type Phase = 'roll' | 'duelPick' | 'minigame' | 'over';

export interface BoardState {
  players: Player[];
  order: string[];               // turn order
  pos: Record<string, number>;
  pieces: Record<string, number>;
  skip: Record<string, boolean>; // misses their next roll (prison)
  wins: Record<string, number>;  // mini-games won
  vault: number;
  round: number;                 // 1-based
  rounds: number;
  turn: number;                  // index into `order` during 'roll'
  phase: Phase;
  /** The last move, for drawing: who, the die, the spaces passed through. */
  lastMove: { who: string; die: number; path: number[] } | null;
  /** During 'minigame': what kind, who plays, and the teams. */
  match: { kind: Kind; seats: string[]; teams: [string[], string[]] | null } | null;
  notes: Note[];
}

export function newBoard(players: Player[], rng: Rng, rounds = ROUNDS): BoardState {
  if (![2, 4, 6, 8].includes(players.length)) throw new Error('A party needs 2, 4, 6 or 8 players — add or remove a bot.');
  const order = shuffle(players.map((p) => p.id), rng);
  const each = <T>(v: T) => Object.fromEntries(players.map((p) => [p.id, v])) as Record<string, T>;
  return {
    players, order, pos: each(0), pieces: each(START_PIECES), skip: each(false), wins: each(0),
    vault: VAULT_START, round: 1, rounds, turn: 0, phase: 'roll', lastMove: null, match: null, notes: [],
  };
}

function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const current = (s: BoardState) => (s.phase === 'roll' || s.phase === 'duelPick' ? s.order[s.turn] : null);
const nameOf = (s: BoardState, id: string) => s.players.find((p) => p.id === id)?.name ?? id;

function note(s: BoardState, text: string, delta?: Record<string, number>, who?: string): BoardState {
  return { ...s, notes: [...s.notes, { round: s.round, text, delta, who }].slice(-60) };
}

/** Change someone's Pieces (never below 0); returns how much actually changed. */
function give(s: BoardState, id: string, amount: number): [BoardState, number] {
  const before = s.pieces[id];
  const after = Math.max(0, before + amount);
  return [{ ...s, pieces: { ...s.pieces, [id]: after } }, after - before];
}

// ------------------------------------------------------------- the turn ----

/** Roll and move the player whose turn it is. A duel space waits for `pickDuel`. */
export function roll(s: BoardState, id: string, rng: Rng): BoardState {
  if (s.phase !== 'roll' || current(s) !== id) throw new Error('It isn’t your roll.');
  if (s.skip[id]) {
    s = note({ ...s, skip: { ...s.skip, [id]: false } }, `${nameOf(s, id)} is in prison and misses this roll`, undefined, id);
    return nextTurn(s);
  }
  const die = 1 + Math.floor(rng() * 6);
  return move(s, id, die, rng, `${nameOf(s, id)} rolled ${die}`);
}

/** Move `steps` spaces, paying for the gate on the way, then land. */
function move(s: BoardState, id: string, steps: number, rng: Rng, intro: string): BoardState {
  const path: number[] = [];
  let at = s.pos[id];
  let passed = 0;
  for (let k = 0; k < steps; k++) {
    at = (at + 1) % SIZE;
    path.push(at);
    if (at === 0 && k < steps - 1) passed++;
  }
  s = { ...s, pos: { ...s.pos, [id]: at }, lastMove: { who: id, die: steps, path } };
  let gateBonus = 0;
  for (let i = 0; i < passed; i++) {
    const [n, d] = give(s, id, PASS_GATE);
    s = n;
    gateBonus += d;
  }
  return land(s, id, rng, gateBonus ? `${intro}, passed the gate +${gateBonus}` : intro);
}

/** What the space does. */
function land(s: BoardState, id: string, rng: Rng, intro: string): BoardState {
  const who = nameOf(s, id);
  const kind = BOARD[s.pos[id]];
  switch (kind) {
    case 'gate': {
      const [n, d] = give(s, id, PASS_GATE);
      return nextTurn(note(n, `${intro} → the gate +${d}`, { [id]: d }, id));
    }
    case 'blue': {
      const [n, d] = give(s, id, BLUE);
      return nextTurn(note(n, `${intro} → blue +${d}`, { [id]: d }, id));
    }
    case 'red': {
      const [n, d] = give(s, id, -RED);
      return nextTurn(note({ ...n, vault: n.vault - d }, `${intro} → red ${d} (into the vault)`, { [id]: d }, id));
    }
    case 'prison': {
      const [n, d] = give(s, id, -PRISON_FINE);
      const short = -d < PRISON_FINE;
      const next = { ...n, vault: n.vault - d, skip: { ...n.skip, [id]: short ? true : n.skip[id] } };
      return nextTurn(note(next, `${intro} → prison: paid ${-d}${short ? ' and misses the next roll' : ''}`, { [id]: d }, id));
    }
    case 'vault': {
      const take = s.vault;
      const [n] = give({ ...s, vault: 0 }, id, take);
      return nextTurn(note(n, `${intro} → the vault: +${take}!`, { [id]: take }, id));
    }
    case 'duel':
      return note({ ...s, phase: 'duelPick' }, `${intro} → a duel! ${who} picks a rival`, undefined, id);
    case 'event':
      return event(s, id, rng, intro);
  }
}

export const EVENTS = ['find', 'pickpocket', 'tax', 'swap', 'tailwind', 'fine'] as const;
export type EventKind = (typeof EVENTS)[number];

function event(s: BoardState, id: string, rng: Rng, intro: string): BoardState {
  const who = nameOf(s, id);
  const kind = EVENTS[Math.floor(rng() * EVENTS.length)];
  const others = s.order.filter((x) => x !== id);
  switch (kind) {
    case 'find': {
      const [n, d] = give(s, id, 5);
      return nextTurn(note(n, `${intro} → event: a lucky find +${d}`, { [id]: d }, id));
    }
    case 'pickpocket': {
      // steal 3 from whoever has the most (not yourself)
      const leader = [...others].sort((a, b) => s.pieces[b] - s.pieces[a])[0];
      const [n1, lost] = give(s, leader, -3);
      const [n2, got] = give(n1, id, -lost);
      return nextTurn(note(n2, `${intro} → event: pickpocket! ${who} takes ${got} from ${nameOf(s, leader)}`, { [id]: got, [leader]: lost }, id));
    }
    case 'tax': {
      let n = s;
      const delta: Record<string, number> = {};
      for (const p of s.order) {
        const [m, d] = give(n, p, -1);
        n = { ...m, vault: m.vault - d };
        delta[p] = d;
      }
      return nextTurn(note(n, `${intro} → event: tax day — everyone pays 1 into the vault`, delta, id));
    }
    case 'swap': {
      const other = others[Math.floor(rng() * others.length)];
      const pos = { ...s.pos, [id]: s.pos[other], [other]: s.pos[id] };
      return nextTurn(note({ ...s, pos }, `${intro} → event: ${who} swaps places with ${nameOf(s, other)}`, undefined, id));
    }
    case 'tailwind':
      return move(note(s, `${intro} → event: a tailwind, 3 more spaces`, undefined, id), id, 3, rng, `${who} rides the wind`);
    case 'fine': {
      const [n, d] = give(s, id, -4);
      return nextTurn(note({ ...n, vault: n.vault - d }, `${intro} → event: a fine ${d} (into the vault)`, { [id]: d }, id));
    }
  }
}

/** On a duel space: pick who to duel. The server then plays the duel and calls `payDuel`. */
export function pickDuel(s: BoardState, id: string, rival: string): BoardState {
  if (s.phase !== 'duelPick' || current(s) !== id) throw new Error('It isn’t your duel.');
  if (rival === id || !s.order.includes(rival)) throw new Error('Pick someone else at the table.');
  return note({ ...s, phase: 'minigame', match: { kind: 'duel', seats: [id, rival], teams: null } },
    `${nameOf(s, id)} challenges ${nameOf(s, rival)} to a duel`, undefined, id);
}

/** A bot's pick: the richest rival (there's the most to win). */
export const botDuelPick = (s: BoardState, id: string) =>
  s.order.filter((x) => x !== id).sort((a, b) => s.pieces[b] - s.pieces[a] || s.order.indexOf(a) - s.order.indexOf(b))[0];

/** Next player; after the last one, the round's mini-game. */
function nextTurn(s: BoardState): BoardState {
  if (s.phase === 'over') return s;
  const turn = s.turn + 1;
  if (turn < s.order.length) return { ...s, phase: 'roll', turn };
  return { ...s, phase: 'minigame', turn: s.order.length, match: null };
}

// ---------------------------------------------------------- mini-games ----

/** Everyone for themselves, or (4+ players, about one round in three) two teams drawn at random. */
export function roundMatch(s: BoardState, rng: Rng): NonNullable<BoardState['match']> {
  const everyone = [...s.order];
  if (everyone.length >= 4 && rng() < 1 / 3) {
    const mixed = shuffle(everyone, rng);
    const half = mixed.length / 2;
    return { kind: 'teams', seats: everyone, teams: [mixed.slice(0, half), mixed.slice(half)] };
  }
  return { kind: 'ffa', seats: everyone, teams: null };
}

/** Start the round's mini-game (the server picks which game). */
export const startRoundMatch = (s: BoardState, match: NonNullable<BoardState['match']>): BoardState =>
  ({ ...s, phase: 'minigame', match });

/** A finished mini-game's order: place per seat (1 = best; equal places tie). */
export type Places = Record<string, number>;

/** Pay out the mini-game in `s.match`, then carry on (next turn after a duel, next round after the round's game). */
export function payMinigame(s: BoardState, places: Places, rng: Rng): BoardState {
  const m = s.match;
  if (s.phase !== 'minigame' || !m) throw new Error('No mini-game to pay.');
  const best = Math.min(...m.seats.map((id) => places[id] ?? Infinity));
  const winners = m.seats.filter((id) => places[id] === best);
  let n: BoardState = { ...s, wins: { ...s.wins } };
  for (const w of winners) if (m.kind !== 'teams') n.wins[w] = (n.wins[w] ?? 0) + 1;
  const delta: Record<string, number> = {};
  const add = (id: string, amount: number) => {
    const [next, d] = give(n, id, amount);
    n = next;
    delta[id] = (delta[id] ?? 0) + d;
  };

  if (m.kind === 'duel') {
    const [a, b] = m.seats;
    if (places[a] === places[b]) n = note(n, `The duel between ${nameOf(s, a)} and ${nameOf(s, b)} is a draw`);
    else {
      const [win, lose] = places[a] < places[b] ? [a, b] : [b, a];
      const [m1, lost] = give(n, lose, -DUEL_STAKE);
      n = m1;
      add(win, -lost);
      delta[lose] = lost;
      n = note(n, `${nameOf(s, win)} wins the duel and takes ${-lost} from ${nameOf(s, lose)}`, delta, win);
    }
    return nextTurn({ ...n, match: null, phase: 'roll' });
  }

  if (m.kind === 'teams') {
    const [blue, red] = m.teams!;
    const avg = (team: string[]) => team.reduce((t, id) => t + (places[id] ?? 99), 0) / team.length;
    const [bv, rv] = [avg(blue), avg(red)];
    if (bv === rv) {
      for (const id of m.seats) add(id, TEAM_DRAW);
      n = note(n, `The teams tie — everyone +${TEAM_DRAW}`, delta);
    } else {
      const won = bv < rv ? blue : red;
      for (const id of won) {
        add(id, TEAM_PRIZE);
        n.wins[id] = (n.wins[id] ?? 0) + 1;
      }
      n = note(n, `Team ${bv < rv ? 'blue' : 'red'} wins: ${won.map((id) => nameOf(s, id)).join(', ')} +${TEAM_PRIZE} each`, delta);
    }
  } else {
    // everyone for themselves: prizes by place (ties share the better prize)
    for (const id of m.seats) {
      const prize = FFA_PRIZES[(places[id] ?? 99) - 1] ?? 0;
      if (prize) add(id, prize);
    }
    const order = [...m.seats].sort((a, b) => (places[a] ?? 99) - (places[b] ?? 99));
    n = note(n, `Mini-game: ${order.map((id) => `${places[id]}. ${nameOf(s, id)}${delta[id] ? ` +${delta[id]}` : ''}`).join(' · ')}`, delta);
  }
  return nextRound({ ...n, match: null }, rng);
}

/** After the round's mini-game: the next round, or the end. */
function nextRound(s: BoardState, _rng: Rng): BoardState {
  if (s.round >= s.rounds) return finish(s);
  return note({ ...s, round: s.round + 1, turn: 0, phase: 'roll' }, `— Round ${s.round + 1} —`);
}

/** The bonus for the most mini-games won, then the end. */
function finish(s: BoardState): BoardState {
  const most = Math.max(...s.order.map((id) => s.wins[id] ?? 0));
  let n = s;
  if (most > 0) {
    const top = s.order.filter((id) => (s.wins[id] ?? 0) === most);
    const delta: Record<string, number> = {};
    for (const id of top) {
      const [m, d] = give(n, id, MOST_WINS_BONUS);
      n = m;
      delta[id] = d;
    }
    n = note(n, `Bonus for the most mini-games won (${most}): ${top.map((id) => nameOf(s, id)).join(', ')} +${MOST_WINS_BONUS}`, delta);
  }
  return { ...n, phase: 'over', match: null };
}

/** Most Pieces first, then most mini-games won, then turn order. */
export function standings(s: BoardState) {
  return s.order
    .map((id, i) => ({ ...s.players.find((p) => p.id === id)!, pieces: s.pieces[id], wins: s.wins[id] ?? 0, i }))
    .sort((a, b) => b.pieces - a.pieces || b.wins - a.wins || a.i - b.i);
}
