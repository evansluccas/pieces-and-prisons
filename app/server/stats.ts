/**
 * What the saved matches tell us: each player's own history ("My matches")
 * and the leaderboards. Only real players count — bots, and seats a bot took
 * over, have no user and are left out. Names are the players' names today.
 */
import type { Db } from './db';

export interface MatchSummary {
  id: number;
  gameId: string;
  startedAt: number;
  finishedAt: number;
  place: number | null;
  detail: string | null;
  players: { name: string; place: number | null; detail: string | null; you: boolean; bot: boolean }[];
}

/** The latest matches this player finished, newest first. */
export function myMatches(db: Db, userId: number, limit = 50): MatchSummary[] {
  const mine = db.prepare(`
    SELECT m.id, m.game_id AS gameId, m.started_at AS startedAt, m.finished_at AS finishedAt, mp.place, mp.detail
    FROM match_players mp JOIN matches m ON m.id = mp.match_id
    WHERE mp.user_id = ? AND m.finished_at IS NOT NULL
    ORDER BY m.finished_at DESC, m.id DESC LIMIT ?`).all(userId, limit) as Omit<MatchSummary, 'players'>[];
  const everyone = db.prepare(`
    SELECT mp.name, mp.place, mp.detail, mp.user_id AS userId FROM match_players mp WHERE mp.match_id = ? ORDER BY mp.place, mp.seat`);
  return mine.map((m) => ({
    ...m,
    players: (everyone.all(m.id) as { name: string; place: number | null; detail: string | null; userId: number | null }[])
      .map((p) => ({ name: p.name, place: p.place, detail: p.detail, you: p.userId === userId, bot: p.userId === null })),
  }));
}

export interface LeaderRow { rank: number; name: string; played: number; wins: number; winRate: number; avgPlace: number; you: boolean }

/** Most wins, then the best win rate, then the most games. `gameId` null = every game together. */
export function leaderboard(db: Db, gameId: string | null, me: number | null, limit = 20): LeaderRow[] {
  const rows = db.prepare(`
    SELECT u.id AS userId, u.display_name AS name,
           COUNT(*) AS played,
           SUM(CASE WHEN mp.place = 1 THEN 1 ELSE 0 END) AS wins,
           AVG(mp.place) AS avgPlace
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id
    JOIN users u ON u.id = mp.user_id
    WHERE m.finished_at IS NOT NULL AND (? IS NULL OR m.game_id = ?)
    GROUP BY u.id
    ORDER BY wins DESC, CAST(wins AS REAL) / COUNT(*) DESC, played DESC, u.id
    LIMIT ?`).all(gameId, gameId, limit) as { userId: number; name: string; played: number; wins: number; avgPlace: number }[];
  return rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    played: r.played,
    wins: r.wins,
    winRate: r.played ? r.wins / r.played : 0,
    avgPlace: Math.round(r.avgPlace * 10) / 10,
    you: r.userId === me,
  }));
}
