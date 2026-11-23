/**
 * Saving running tables, so a restart (every deploy) doesn't throw away the
 * games in progress.
 *
 * Game states are plain data plus a few things JSON can't hold: the seeded
 * random generators (saved as their one-number state), Maps and Sets. Those
 * are written in a tagged form and turned back on reading. Anything else that
 * JSON can't hold (another function, say) makes `encode` throw, so a table
 * that can't be restored exactly is not saved at all — it's never restored
 * half-broken.
 */
import { rngState, seededRng } from '../src/games/shared/rng';
import type { Db } from './db';

export function encode(value: unknown): string {
  return JSON.stringify(value, function (key, v) {
    // `this[key]` is the value before any toJSON
    const raw = (this as Record<string, unknown>)[key];
    if (typeof raw === 'function') {
      const state = rngState(raw);
      if (state === null) throw new Error(`can't save a function (${key})`);
      return { $rng: state };
    }
    if (raw instanceof Map) return { $map: [...raw.entries()] };
    if (raw instanceof Set) return { $set: [...raw.values()] };
    if (typeof raw === 'number' && !Number.isFinite(raw)) return { $num: String(raw) };
    return v;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1) {
        if (keys[0] === '$rng') return seededRng(v.$rng);
        if (keys[0] === '$map') return new Map(v.$map);
        if (keys[0] === '$set') return new Set(v.$set);
        if (keys[0] === '$num') return Number(v.$num);
      }
    }
    return v;
  }) as T;
}

/** Replace the saved tables with these. */
export function saveTables(db: Db, tables: { code: string; data: string }[], now: number) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM saved_tables').run();
    const put = db.prepare('INSERT INTO saved_tables (code, data, saved_at) VALUES (?, ?, ?)');
    for (const t of tables) put.run(t.code, t.data, now);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** The saved tables, removed from the database as they're read (each is restored once). */
export function takeTables(db: Db): { code: string; data: string; savedAt: number }[] {
  const rows = db.prepare('SELECT code, data, saved_at AS savedAt FROM saved_tables').all() as { code: string; data: string; savedAt: number }[];
  db.prepare('DELETE FROM saved_tables').run();
  return rows;
}
