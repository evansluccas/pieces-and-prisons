import { describe, expect, it } from 'vitest';
import { seededRng } from '../shared/rng';
import {
  BOARD, BoardState, DUEL_STAKE, FFA_PRIZES, MOST_WINS_BONUS, PASS_GATE, START_PIECES, TEAM_PRIZE, botDuelPick, current, newBoard,
  payMinigame, pickDuel, roll, roundMatch, standings, startRoundMatch,
} from './logic';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 }));
/** A generator that always gives `v` (so the die shows 1 + floor(v*6)). */
const fixed = (v: number) => () => v;
const dieOf = (face: number) => fixed((face - 1) / 6 + 0.01);
/** Put the current player `steps` short of a space of `kind`, then roll exactly that. */
function landOn(s: BoardState, kind: (typeof BOARD)[number], face = 3): BoardState {
  const id = current(s)!;
  const target = BOARD.findIndex((k, i) => k === kind && i >= face);
  return roll({ ...s, pos: { ...s.pos, [id]: target - face } }, id, dieOf(face));
}

describe('party board', () => {
  it('needs 2, 4, 6 or 8 players', () => {
    expect(() => newBoard(players(3), seededRng(1))).toThrow(/2, 4, 6 or 8/);
    const s = newBoard(players(4), seededRng(1));
    expect(Object.values(s.pieces)).toEqual([START_PIECES, START_PIECES, START_PIECES, START_PIECES]);
    expect(s.phase).toBe('roll');
  });

  it('only the player whose turn it is rolls; spaces pay out', () => {
    let s = newBoard(players(4), seededRng(2));
    const first = current(s)!;
    const other = s.order[1];
    expect(() => roll(s, other, seededRng(1))).toThrow(/your roll/);
    s = landOn(s, 'blue');
    expect(s.pieces[first]).toBe(START_PIECES + 3);
    expect(current(s)).toBe(other);
    s = landOn(s, 'red');
    expect(s.pieces[other]).toBe(START_PIECES - 3);
    expect(s.vault).toBe(5 + 3);
  });

  it('passing the gate pays, and the vault empties into whoever lands on it', () => {
    let s = newBoard(players(2), seededRng(3));
    const id = current(s)!;
    s = roll({ ...s, pos: { ...s.pos, [id]: BOARD.length - 2 } }, id, dieOf(3)); // through the gate to space 1 (blue)
    expect(s.pieces[id]).toBe(START_PIECES + PASS_GATE + 3);
    const next = current(s)!;
    s = landOn({ ...s, vault: 12 }, 'vault');
    expect(s.pieces[next]).toBe(START_PIECES + 12);
    expect(s.vault).toBe(0);
  });

  it('prison fines go to the vault; someone who can’t pay misses a roll', () => {
    let s = newBoard(players(2), seededRng(4));
    const id = current(s)!;
    s = landOn({ ...s, pieces: { ...s.pieces, [id]: 2 } }, 'prison');
    expect(s.pieces[id]).toBe(0);
    expect(s.skip[id]).toBe(true);
    // play round to the minigame and back
    s = roll(s, current(s)!, dieOf(1));
    while (s.phase === 'duelPick') s = pickDuel(s, current(s)!, botDuelPick(s, current(s)!));
  });

  it('a duel: the roller picks a rival; the winner takes the stake', () => {
    let s = newBoard(players(4), seededRng(5));
    const id = current(s)!;
    s = landOn(s, 'duel');
    expect(s.phase).toBe('duelPick');
    const rival = botDuelPick(s, id);
    expect(() => pickDuel(s, id, id)).toThrow();
    s = pickDuel(s, id, rival);
    expect(s.match).toEqual({ kind: 'duel', seats: [id, rival], teams: null });
    s = payMinigame(s, { [id]: 1, [rival]: 2 }, seededRng(1));
    expect(s.pieces[id]).toBe(START_PIECES + DUEL_STAKE);
    expect(s.pieces[rival]).toBe(START_PIECES - DUEL_STAKE);
    expect(s.phase).toBe('roll');
    expect(current(s)).toBe(s.order[1]);
  });

  it('after everyone moves comes the round mini-game; prizes go by place', () => {
    let s = newBoard(players(4), seededRng(6));
    for (let i = 0; i < 4; i++) {
      s = landOn(s, 'blue', 1);
    }
    expect(s.phase).toBe('minigame');
    const before = { ...s.pieces };
    s = startRoundMatch(s, { kind: 'ffa', seats: [...s.order], teams: null });
    const places = Object.fromEntries(s.order.map((id, i) => [id, i + 1]));
    s = payMinigame(s, places, seededRng(1));
    s.order.forEach((id, i) => expect(s.pieces[id] - before[id]).toBe(FFA_PRIZES[i]));
    expect(s.round).toBe(2);
    expect(s.wins[s.order[0]]).toBe(1);
  });

  it('teams: every member of the better team gets the prize', () => {
    let s = newBoard(players(4), seededRng(7));
    const [a, b, c, d] = s.order;
    s = startRoundMatch({ ...s, phase: 'minigame', turn: 4 }, { kind: 'teams', seats: [a, b, c, d], teams: [[a, b], [c, d]] });
    s = payMinigame(s, { [a]: 1, [b]: 4, [c]: 2, [d]: 3 }, seededRng(1)); // blue avg 2.5, red avg 2.5 → tie
    expect(s.pieces[a]).toBe(START_PIECES + 2);
    s = startRoundMatch({ ...s, phase: 'minigame', turn: 4 }, { kind: 'teams', seats: [a, b, c, d], teams: [[a, b], [c, d]] });
    s = payMinigame(s, { [a]: 1, [b]: 2, [c]: 3, [d]: 4 }, seededRng(1));
    expect(s.pieces[b]).toBe(START_PIECES + 2 + TEAM_PRIZE);
    expect(s.pieces[c]).toBe(START_PIECES + 2);
  });

  it('teams are drawn only with 4 or more, halves of the table', () => {
    const two = newBoard(players(2), seededRng(8));
    for (let i = 0; i < 20; i++) expect(roundMatch(two, seededRng(i)).kind).toBe('ffa');
    const eight = newBoard(players(8), seededRng(9));
    const kinds = Array.from({ length: 60 }, (_, i) => roundMatch(eight, seededRng(i)));
    const teams = kinds.filter((m) => m.kind === 'teams');
    expect(teams.length).toBeGreaterThan(5);
    for (const t of teams) expect(t.teams!.map((x) => x.length)).toEqual([4, 4]);
  });

  it('a whole party plays out; the most mini-game wins earns the bonus', () => {
    const rng = seededRng(10);
    let s = newBoard(players(6), rng, 3);
    let guard = 0;
    while (s.phase !== 'over' && guard++ < 500) {
      if (s.phase === 'roll') s = roll(s, current(s)!, rng);
      else if (s.phase === 'duelPick') s = pickDuel(s, current(s)!, botDuelPick(s, current(s)!));
      else if (s.phase === 'minigame') {
        const m = s.match ?? roundMatch(s, rng);
        if (!s.match) s = startRoundMatch(s, m);
        // the first seat always wins
        s = payMinigame(s, Object.fromEntries(m.seats.map((id, i) => [id, i + 1])), rng);
      }
    }
    expect(s.phase).toBe('over');
    expect(s.notes.some((n) => n.text.includes(`+${MOST_WINS_BONUS}`))).toBe(true);
    expect(Object.values(s.pieces).every((p) => p >= 0)).toBe(true);
    expect(standings(s)[0].pieces).toBe(Math.max(...Object.values(s.pieces)));
  });
});
