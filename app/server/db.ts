/**
 * The database: one SQLite file, opened with Node's built-in driver.
 *
 * We keep as little as possible about people: a username (or, for guests,
 * just a display name), a password hash for accounts, and their sessions.
 * Match history tables are ready for multiplayer results.
 *
 * Schema changes go in MIGRATIONS, in order; `PRAGMA user_version` records
 * how many have run, so an existing file is upgraded in place.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// Loaded with require: Vite (which runs the tests) doesn't know `node:sqlite` is built in yet.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT UNIQUE COLLATE NOCASE,   -- NULL for guests
    display_name  TEXT NOT NULL,
    password_hash TEXT,                         -- NULL for guests
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,               -- sha-256 of the cookie value; the token itself is never stored
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE matches (
    id           INTEGER PRIMARY KEY,
    game_id      TEXT NOT NULL,
    started_at   INTEGER NOT NULL,
    finished_at  INTEGER
  );

  CREATE TABLE match_players (
    match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,                   -- the name shown at the table, kept if the account is deleted
    seat       INTEGER NOT NULL,
    place      INTEGER,                         -- 1 = winner
    detail     TEXT,                            -- e.g. "42 chips"
    PRIMARY KEY (match_id, seat)
  );
  CREATE INDEX match_players_user ON match_players(user_id);
  `,
];

export type Db = DatabaseSyncType;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const { user_version: done } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = done; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
