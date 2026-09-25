/* LaunchLab browser SDK. Fixed event names only; consent precedes collection. */
(() => {
  if (globalThis.LaunchLab) return;
  let config, consent = false, identity, pending, version = 0, timer, flushing = false, retries = 0;
  let accepted = new Set(), queued = new Map();
  const subscribers = new Set();
  const storage = { get(key) { try { return sessionStorage.getItem(key); } catch { return null; } }, set(key,value) { try { sessionStorage.setItem(key,value); } catch { /* session remains in memory */ } } };
  const notify = (message) => { for (const fn of subscribers) fn({ tracking: consent, message }); };
  const params = new URLSearchParams(location.search);
  const actor = params.get('test') === '1' ? 'test' : params.get('actor') === 'agent' ? 'agent' : 'human';
  const source = ['community','okx','incentivized'].includes(params.get('source')) ? params.get('source') : 'direct';
  const key = () => 'launchlab:' + config.project + ':' + config.experiment.id;
  async function api(path, body, token) {
    const response = await fetch(config.apiBase + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), keepalive: true });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not save. Please try again.');
    return value;
  }
  async function session() {
    if (identity?.expiresAt * 1000 > Date.now()) return identity;
    if (pending) return pending;
    const generation = version, tokenKey = `${key()}:${actor}:${source}:${consent}`;
    const current = (async () => {
      let stored;
      try { stored = JSON.parse(storage.get(tokenKey)); } catch { /* new session */ }
      const id = stored?.expiresAt > Date.now() ? stored.id : crypto.randomUUID();
      const value = await api('/sessions', { id, actor, source, tracking: consent, experimentId: config.experiment.id });
      if (generation !== version) return session();
      storage.set(tokenKey, JSON.stringify({ id, expiresAt: value.expiresAt * 1000 })); identity = value; return value;
    })().finally(() => { if (pending === current) pending = undefined; });
    pending = current; return current;
  }
  async function flush() {
    if (!config || !consent || !queued.size || flushing) return;
    flushing = true; const generation = version, batch = [...queued].slice(0, 20); let saved = false;
    try {
      const who = await session();
      if (generation !== version || !consent) return;
      await api('/events', { events: batch.map(([id, type]) => ({ id, type })) }, who.token);
      if (generation === version) { batch.forEach(([id]) => queued.delete(id)); saved = true; retries = 0; notify('Activity saved.'); }
    } catch { retries++; notify('Activity has not synced yet. Retrying safely; choose Allow again if it remains pending.'); }
    finally { flushing = false; if (consent && queued.size && (saved || generation !== version || retries <= 3)) { clearTimeout(timer); timer = setTimeout(() => void flush(), saved ? 500 : Math.min(8000, 1000 * 2 ** retries)); } }
  }
  function track(type) {
    if (!config || !consent || !accepted.has(type)) return false;
    if (queued.size >= 200) { notify('Activity queue is full. Some new actions could not be recorded.'); return false; }
    queued.set(crypto.randomUUID(), type); clearTimeout(timer); timer = setTimeout(() => void flush(), 500); return true;
  }
  function setConsent(value) {
    if (!config || typeof value !== 'boolean') return;
    if (value && consent) { retries = 0; void flush(); return; }
    consent = value; version++; identity = undefined; pending = undefined; queued.clear(); retries = 0; clearTimeout(timer);
    storage.set(key() + ':consent', value ? 'yes' : 'no');
    notify(value ? 'Anonymous activity tracking is on.' : 'Tracking is off. Feedback can still be submitted.');
    if (value) track('page_view');
  }
  function configure(value) {
    if (config) return;
    if (!value?.experiment?.id || !value.apiBase) throw new Error('Missing LaunchLab experiment configuration.');
    config = value; accepted = new Set(['page_view', ...config.experiment.events.map((e) => e.id)]);
    consent = storage.get(key() + ':consent') === 'yes';
    if (consent) track('page_view');
  }
  const sdk = { configure, track, setConsent, flush,
    state: () => ({ configured: Boolean(config), tracking: consent, consentKnown: config ? storage.get(key() + ':consent') !== null : false, actor }),
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
    async feedback(value) { if (!config) throw new Error('Feedback is still loading.'); const who = await session(); return api('/feedback', value, who.token); },
  };
  globalThis.LaunchLab = Object.freeze(sdk);
  document.addEventListener('click', (event) => { const control = event.target?.closest?.('[data-launchlab-event]'); if (control) track(control.getAttribute('data-launchlab-event')); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush(); });
  // Only record a fixed error category if the experiment explicitly declared it.
  globalThis.addEventListener?.('error', () => track('app_error'));
  globalThis.addEventListener?.('unhandledrejection', () => track('app_error'));
})();
