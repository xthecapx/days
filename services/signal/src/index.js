import { DurableObject } from 'cloudflare:workers';
import { createBoard } from './board.js';
import { createSqlStorage } from './sqlStorage.js';
import { handle } from './http.js';
import { runBoard } from './rpc.js';

/**
 * Una instancia por sala ("main", "dev"). Las señales viven en el SQLite del objeto (se escriben poco); quién escucha
 * vive solo en memoria (se escribe en cada sondeo, y si el objeto se reinicia se recupera en ≤30 s).
 */
export class SignalBoard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.board = createBoard({ storage: createSqlStorage(ctx.storage.sql) });
  }

  /** Única puerta de entrada (RPC): { ok, data } o { ok:false, status, code, message }. */
  async run(op, input) {
    const result = runBoard(this.board, op, input);
    await this.#scheduleCleanup();
    return result;
  }

  /** Limpieza de señales vencidas, para que la base no crezca aunque nadie consulte. */
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
      getBoard: (room) => {
        const stub = env.SIGNAL_BOARD.get(env.SIGNAL_BOARD.idFromName(room));
        return { run: (op, input) => stub.run(op, input) };
      }
    });
  }
};
