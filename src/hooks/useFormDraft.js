// Keeps an unfinished form in this browser so a refresh or a closed tab does not lose it.
// Field values go to localStorage; picked files (too big for localStorage) go to IndexedDB.
// Call clear() once the record is saved in the backend.
//
//   const draft = useFormDraft(`customer:${id || 'new'}`, { exclude: ['login_password'] });
//   draft.load()            -> { values, savedAt } | null
//   draft.setBase(values)   -> values the form started with; matching them means "nothing to keep"
//   draft.save(values)      -> debounced
//   draft.saveFiles(list) / draft.loadFiles()
//   draft.clear()
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../store/authStore.js';

const PREFIX = 'slx-draft:';
const MAX_AGE_MS = 14 * 24 * 3600 * 1000; // drafts older than two weeks are dropped

const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---- tiny IndexedDB wrapper for files
let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('No IndexedDB')); return; }
      const req = indexedDB.open('slx-drafts', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('files', mode);
    const out = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const strip = (values, exclude) => {
  const copy = JSON.parse(JSON.stringify(values ?? {}));
  exclude.forEach((k) => { delete copy[k]; });
  return copy;
};

export function useFormDraft(name, { exclude = [], delay = 600 } = {}) {
  const userId = useAuth((s) => s.user?.id || 'anon');
  const key = `${PREFIX}${userId}:${name}`;
  const excludeKey = exclude.join(',');
  const ex = useMemo(() => (excludeKey ? excludeKey.split(',') : []), [excludeKey]);
  const base = useRef(null);
  const timer = useRef(null);

  // Drop old drafts once in a while.
  useEffect(() => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => {
        const d = ls.get(k);
        if (!d?.savedAt || Date.now() - new Date(d.savedAt).getTime() > MAX_AGE_MS) ls.del(k);
      });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const load = useCallback(() => {
    const d = ls.get(key);
    return d?.values ? d : null;
  }, [key]);

  const setBase = useCallback((values) => { base.current = JSON.stringify(strip(values, ex)); }, [ex]);

  const save = useCallback((values) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const clean = strip(values, ex);
      // Back to how the form started: nothing worth keeping.
      if (base.current && JSON.stringify(clean) === base.current) { ls.del(key); return; }
      ls.set(key, { values: clean, savedAt: new Date().toISOString() });
    }, delay);
  }, [key, ex, delay]);

  /** files: [{ key, docType, note, file: File }] */
  const saveFiles = useCallback(async (files) => {
    try {
      if (!files.length) { await idb('readwrite', (st) => st.delete(key)); return; }
      const rows = files.map(({ file, ...rest }) => ({ ...rest, name: file.name, type: file.type, blob: file }));
      await idb('readwrite', (st) => st.put(rows, key));
    } catch { /* files simply are not kept */ }
  }, [key]);

  const loadFiles = useCallback(async () => {
    try {
      const rows = (await idb('readonly', (st) => st.get(key))) || [];
      return rows.map(({ name: n, type, blob, ...rest }) => ({ ...rest, file: new File([blob], n, { type }) }));
    } catch { return []; }
  }, [key]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    ls.del(key);
    idb('readwrite', (st) => st.delete(key)).catch(() => {});
  }, [key]);

  return { load, setBase, save, saveFiles, loadFiles, clear };
}
