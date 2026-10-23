/**
 * Store mínimo con suscripción por selectores.
 *
 *   const unsub = store.subscribe(s => [s.ui.sheet], ([sheet]) => ...);
 *
 * El selector devuelve un arreglo de dependencias; el callback solo corre
 * cuando alguna cambia (Object.is), así cada componente reacciona a lo suyo.
 */
export function createStore(initialState) {
  let state = initialState;
  const subs = new Set();

  const get = () => state;

  function set(partial) {
    const prev = state;
    const next = typeof partial === 'function' ? partial(prev) : partial;
    state = { ...prev, ...next };
    for (const sub of [...subs]) sub(state);
  }

  /** Actualiza un sub-objeto del estado: patch('ui', { sheet: null }). */
  function patch(key, partial) {
    set((s) => ({ [key]: { ...s[key], ...partial } }));
  }

  function subscribe(selector, listener, { immediate = true } = {}) {
    let last = selector(state);
    const sub = (s) => {
      const deps = selector(s);
      if (deps.length === last.length && deps.every((d, i) => Object.is(d, last[i]))) return;
      last = deps;
      listener(deps, s);
    };
    subs.add(sub);
    if (immediate) listener(last, state);
    return () => subs.delete(sub);
  }

  return { get, set, patch, subscribe };
}
