import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const requireThat = (condition, message, status) => {
  if (!condition) throw new DomainError(message, status);
};
export const id = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
export const now = () => new Date().toISOString();
export function event(state, type, subject, detail) {
  state.events.unshift({ id: id('evt'), type, subject, detail, at: now() });
}

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)',
    );
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (1, ?)').run(
      JSON.stringify({
        schemaVersion: 1,
        runs: [],
        projects: [],
        releases: [],
        campaigns: [],
        reservations: [],
        feedback: [],
        ledger: [],
        events: [],
      }),
    );
  }
  read() {
    return JSON.parse(this.db.prepare('SELECT value FROM state WHERE id=1').get().value);
  }
  change(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      const result = fn(state);
      // All money-like quantities are integer demo credits. Reservations and awards share one transaction.
      for (const campaign of state.campaigns) {
        const reserved = state.reservations
          .filter(
            (r) => r.campaignId === campaign.id && ['reserved', 'submitted'].includes(r.status),
          )
          .reduce((sum, r) => sum + r.reward, 0);
        const awarded = state.ledger
          .filter((r) => r.campaignId === campaign.id)
          .reduce((sum, r) => sum + r.amount, 0);
        requireThat(reserved + awarded <= campaign.budget, 'Reward pool invariant failed', 500);
      }
      this.db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
