import { BoardError } from './board.js';

export const OPERATIONS = Object.freeze(['state', 'poll', 'send', 'cancel']);

/**
 * Runs a board operation and ALWAYS returns a plain result:
 *   { ok: true, data }  |  { ok: false, status, code, message }
 * Expected errors (BoardError) are not thrown: crossing a Durable Object (RPC) boundary can lose the error's class,
 * and a plain result is not lost. An unexpected error does propagate.
 */
export function runBoard(board, op, input) {
  if (!OPERATIONS.includes(op)) return { ok: false, status: 400, code: 'bad_operation', message: 'Unknown operation.' };
  try {
    return { ok: true, data: op === 'state' ? board.state() : board[op](input) };
  } catch (err) {
    if (err instanceof BoardError) return { ok: false, status: err.status, code: err.code, message: err.message };
    throw err;
  }
}
