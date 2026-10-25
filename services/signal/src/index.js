import { DurableObject } from 'cloudflare:workers';
import { createBoard } from './board.js';
import { createSqlStorage } from './sqlStorage.js';
import { handle } from './http.js';
import { runBoard } from './rpc.js';

/**
 * A single instance. Signals live in the object's SQLite (they are written rarely); who is listening
 * lives only in memory (it is written on every poll, and if the object restarts it recovers in ≤30 s).
 */
export class SignalBoard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.board = createBoard({ storage: createSqlStorage(ctx.storage.sql) });
  }

  /** Single entry point (RPC): { ok, data } or { ok:false, status, code, message }. */
  async run(op, input) {
    const result = runBoard(this.board, op, input);
    await this.#scheduleCleanup();
    return result;
  }

  /** Cleanup of expired signals, so the database does not grow even if nobody queries it. */
  async alarm() {
    this.board.state();
    await this.#scheduleCleanup();
  }

  async #scheduleCleanup() {
    const next = this.board.nextExpiry();
    if (next === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next + 1000) await this.ctx.storage.setAlarm(next + 1000);
  }
}

export default {
  fetch(request, env) {
    return handle(request, env, {
      // A single board. The name stays "main" so the already-deployed Durable Object keeps being used. A
      // `?room=...` from old links or shortcuts is simply ignored.
      getBoard: () => {
        const stub = env.SIGNAL_BOARD.get(env.SIGNAL_BOARD.idFromName('main'));
        return { run: (op, input) => stub.run(op, input) };
      }
    });
  }
};
