import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { guest } from './auth';
import { openDb } from './db';
import { leaderboard, myMatches } from './stats';

/** Record a finished match: [userId | null (a bot), name, place]. */
function match(db: ReturnType<typeof openDb>, gameId: string, at: number, seats: [number | null, string, number][]) {
  const { lastInsertRowid } = db.prepare('INSERT INTO matches (game_id, started_at, finished_at) VALUES (?, ?, ?)').run(gameId, at - 60_000, at);
  seats.forEach(([user, name, place], seat) =>
    db.prepare('INSERT INTO match_players (match_id, user_id, name, seat, place, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Number(lastInsertRowid), user, name, seat, place, `place ${place}`));
}

describe('match history and leaderboards', () => {
  const db = openDb(':memory:');
  const ana = guest(db, 'Ana').user;
  const ben = guest(db, 'Ben').user;
  const cy = guest(db, 'Cy').user;
  match(db, 'dice-tower', 1000, [[ana.id, 'Ana', 1], [ben.id, 'Ben', 2], [null, 'Hana', 3]]);
  match(db, 'dice-tower', 2000, [[ben.id, 'Ben', 1], [ana.id, 'Ana', 2], [null, 'Hana', 3]]);
  match(db, 'dice-tower', 3000, [[ana.id, 'Ana', 1], [cy.id, 'Cy', 2], [null, 'Jun', 3]]);
  match(db, 'hex-sum', 4000, [[cy.id, 'Cy', 1], [ana.id, 'Ana', 2]]);

  it('shows each player their own matches, newest first, with everyone at the table', () => {
    const m = myMatches(db, ana.id);
    expect(m.map((x) => [x.gameId, x.place])).toEqual([['hex-sum', 2], ['dice-tower', 1], ['dice-tower', 2], ['dice-tower', 1]]);
    expect(m[1].players).toEqual([
      { name: 'Ana', place: 1, detail: 'place 1', you: true, bot: false },
      { name: 'Cy', place: 2, detail: 'place 2', you: false, bot: false },
      { name: 'Jun', place: 3, detail: 'place 3', you: false, bot: true },
    ]);
    expect(myMatches(db, ben.id)).toHaveLength(2);
  });

  it('ranks by wins, then win rate, then games played — bots never appear', () => {
    const dice = leaderboard(db, 'dice-tower', ana.id);
    expect(dice.map((r) => [r.name, r.wins, r.played, r.you])).toEqual([['Ana', 2, 3, true], ['Ben', 1, 2, false], ['Cy', 0, 1, false]]);
    expect(dice[0].avgPlace).toBe(1.3);
    const all = leaderboard(db, null, null);
    // Ben and Cy both won 1 of 2: a full tie, so the earlier player comes first
    expect(all.map((r) => r.name)).toEqual(['Ana', 'Ben', 'Cy']);
    expect(all.find((r) => r.name === 'Hana')).toBeUndefined();
  });

  it('is served over HTTP: matches need a session, leaderboards are public', async () => {
    const handle = createApp(db, { secureCookies: false });
    const call = (path: string) => new Promise<{ status: number; body: any }>((resolve) => {
      const res = {
        statusCode: 0, body: '',
        setHeader() {}, writeHead(s: number) { this.statusCode = s; }, end(b: string) { resolve({ status: this.statusCode, body: JSON.parse(b) }); },
      };
      void handle({ url: path, method: 'GET', headers: {}, socket: {} } as any, res as any);
    });
    expect((await call('/api/matches')).status).toBe(401);
    const lb = await call('/api/leaderboard?game=dice-tower');
    expect(lb.status).toBe(200);
    expect(lb.body.rows[0].name).toBe('Ana');
    expect((await call('/api/leaderboard?game=../../etc')).status).toBe(400);
  });
});
