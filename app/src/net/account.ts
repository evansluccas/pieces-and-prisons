/** Talks to the game server's account API (same origin; the session lives in an HttpOnly cookie). */

/** The online table someone is seated at (only reported by `me`). */
export interface TableInfo { code: string; gameId: string; status: 'lobby' | 'playing' | 'over' }

export interface Me { name: string; username: string | null; guest: boolean; table?: TableInfo | null }

export class ApiError extends Error {}
/** The server isn't running or can't be reached — single-player still works. */
export class Offline extends Error {}

async function call(path: string, data?: unknown): Promise<Me | null> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, data === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  } catch {
    throw new Offline('The game server is offline.');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new Offline('The game server is offline.');
  const json = (await res.json()) as { user?: Me | null; error?: string };
  if (!res.ok) throw new ApiError(json.error ?? 'Something went wrong.');
  return json.user ?? null;
}

export const account = {
  me: () => call('me'),
  guest: (name: string) => call('guest', { name }),
  signup: (username: string, password: string) => call('signup', { username, password }),
  login: (username: string, password: string) => call('login', { username, password }),
  upgrade: (username: string, password: string) => call('upgrade', { username, password }),
  logout: () => call('logout', {}),
  remove: (password: string) => call('delete', { password }),
};

/** Read-only JSON from the server (history, leaderboards). */
async function read<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, { credentials: 'same-origin' });
  } catch {
    throw new Offline('The game server is offline.');
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new Offline('The game server is offline.');
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? 'Something went wrong.');
  return json;
}

export interface MatchSummary {
  id: number;
  gameId: string;
  startedAt: number;
  finishedAt: number;
  place: number | null;
  detail: string | null;
  players: { name: string; place: number | null; detail: string | null; you: boolean; bot: boolean }[];
}
export interface LeaderRow { rank: number; name: string; played: number; wins: number; winRate: number; avgPlace: number; you: boolean }

export const records = {
  matches: () => read<{ matches: MatchSummary[] }>('matches').then((r) => r.matches),
  leaderboard: (gameId: string | null) => read<{ rows: LeaderRow[] }>(`leaderboard${gameId ? `?game=${encodeURIComponent(gameId)}` : ''}`).then((r) => r.rows),
};
