/**
 * Minimal store with selector-based subscription.
 *
 *   const unsub = store.subscribe(s => [s.ui.sheet], ([sheet]) => ...);
 *
 * The selector returns an array of dependencies; the callback only runs
 * when one of them changes (Object.is), so each component reacts only to its own.
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

  /** Updates a sub-object of the state: patch('ui', { sheet: null }). */
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
