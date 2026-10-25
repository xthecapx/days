import { BoardError } from './board.js';

export const OPERATIONS = Object.freeze(['state', 'poll', 'send', 'cancel']);

/**
 * Ejecuta una operación del tablero y devuelve SIEMPRE un resultado plano:
 *   { ok: true, data }  |  { ok: false, status, code, message }
 * Los errores esperados (BoardError) no se lanzan: cruzar la frontera de un Durable Object (RPC) puede perder la clase
 * del error, y un resultado plano no se pierde. Un error inesperado sí se propaga.
 */
export function runBoard(board, op, input) {
  if (!OPERATIONS.includes(op)) return { ok: false, status: 400, code: 'bad_operation', message: 'Operación desconocida.' };
  try {
    return { ok: true, data: op === 'state' ? board.state() : board[op](input) };
  } catch (err) {
    if (err instanceof BoardError) return { ok: false, status: err.status, code: err.code, message: err.message };
    throw err;
  }
}
