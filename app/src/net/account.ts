/** Talks to the game server's account API (same origin; the session lives in an HttpOnly cookie). */

export interface Me { name: string; username: string | null; guest: boolean }

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
