const config = await (await fetch('/__launchlab/config.json', { cache: 'no-store' })).json();
if (config.experiment) {
  const { mount } = await import('./widget-v2.js');
  mount(config);
} else {
const params = new URLSearchParams(location.search);
const actor = params.get('test') === '1' ? 'test' : params.get('actor') === 'agent' ? 'agent' : 'human';
const source = ['community', 'okx', 'incentivized'].includes(params.get('source')) ? params.get('source') : 'direct';
const storage = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* memory only */ } } };
const key = 'launchlab:' + config.project;
let tracking = storage.get(key + ':consent') === 'yes';
let session, pending, generation = 0;
const events = new Map();
let flushing = false;
const root = document.createElement('div'); root.id = '__launchlab'; document.body.append(root);
const shadow = root.attachShadow({ mode: 'open' });
shadow.innerHTML = `<link rel="stylesheet" href="/__launchlab/widget.css"><aside class="consent" aria-label="Optional experiment tracking"><p>Help improve this demo. Allow anonymous visit and button activity? No wallet or contact details. Records expire after 90 days.</p><div><button id="allow">Allow</button><button id="skip" class="quiet">No thanks</button></div></aside><button class="launcher">Share feedback</button><dialog aria-labelledby="ll-title"><button class="close quiet" aria-label="Close feedback">Close ×</button><h2 id="ll-title">Your honest take</h2><p class="hypothesis"></p><p class="note">Negative feedback is equally useful. No reward is paid by this form. Leave out personal information.</p><form><label>Would you use this product?<select name="intent" required><option value="">Choose an answer</option><option value="yes">Yes, I would consider it</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>What would hold you back?<select name="blocker" required><option value="">Choose one</option><option value="none">Nothing so far</option><option value="price">Price</option><option value="usefulness">Usefulness</option><option value="ease">Ease of use</option><option value="trust">Trust</option><option value="other">Something else</option></select></label><label>Were you offered a reward to test this?<select name="rewarded" required><option value="">Choose one</option><option value="no">No</option><option value="yes">Yes</option></select></label><label>What would make it better? (optional)<textarea name="comment" rows="3" maxlength="800"></textarea></label><button type="submit">Send feedback</button><p class="feedback-status" role="status" aria-live="polite"></p></form><button class="preferences quiet">Tracking preferences</button><p class="tracking-status note" role="status"></p></dialog>`;
const $ = (s) => shadow.querySelector(s);
$('.hypothesis').textContent = config.hypothesis;
$('.consent').hidden = storage.get(key + ':consent') !== null;
$('.launcher').onclick = () => $('dialog').showModal();
$('.close').onclick = () => $('dialog').close();
$('.preferences').onclick = () => { $('dialog').close(); $('.consent').hidden = false; };
async function api(path, body, token) {
  const response = await fetch(config.apiBase + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), keepalive: true });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save. Please try again.');
  return data;
}
async function identity() {
  if (session?.expiresAt * 1000 > Date.now()) return session;
  if (pending) return pending;
  const version = generation;
  const promise = (async () => {
    let saved;
    try { saved = JSON.parse(storage.get(`${key}:${actor}:${source}:${tracking}`)); } catch { /* fresh visit */ }
    const id = saved?.expiresAt > Date.now() ? saved.id : crypto.randomUUID();
    const value = await api('/sessions', { id, actor, source, tracking });
    if (version !== generation) return identity();
    storage.set(`${key}:${actor}:${source}:${tracking}`, JSON.stringify({ id, expiresAt: value.expiresAt * 1000 }));
    session = value; return value;
  })().finally(() => { if (pending === promise) pending = null; });
  pending = promise; return promise;
}
let timer;
async function flush() {
  if (!tracking || !events.size || flushing) return;
  flushing = true;
  const version = generation, batch = [...events].slice(0,20);
  let saved = false;
  try {
    const who = await identity();
    if (version !== generation || !tracking) return;
    await api('/events', { events: batch.map(([id,type]) => ({ id,type })) }, who.token);
    if (version !== generation) return;
    batch.forEach(([id]) => events.delete(id)); saved = true;
    $('.tracking-status').textContent = actor === 'human' ? 'Anonymous tracking is on.' : `${actor} activity is reported separately.`;
  } catch { if (version === generation) $('.tracking-status').textContent = 'Tracking could not sync. Your product still works. Allow again to retry.'; }
  finally { flushing = false; if (saved && tracking && version === generation && events.size) { clearTimeout(timer); timer=setTimeout(flush,500); } }
}
function track(type) { if (tracking && events.size < 200) { events.set(crypto.randomUUID(),type); clearTimeout(timer); timer = setTimeout(flush, 500); } }
function setTracking(value) {
  if (value && tracking) { void flush(); $('.consent').hidden = true; return; }
  tracking = value; generation++; session = undefined; pending = undefined; events.clear();
  storage.set(key + ':consent', value ? 'yes' : 'no'); $('.consent').hidden = true;
  $('.tracking-status').textContent = value ? 'Connecting anonymous tracking…' : 'Tracking is off. Feedback can still be submitted.';
  if (value) track('page_view');
}
$('#allow').onclick = () => setTracking(true); $('#skip').onclick = () => setTracking(false);
document.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('[data-launchlab-event]')?.getAttribute('data-launchlab-event') === config.goalEvent) track('primary_action'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) void flush(); });
$('form').onsubmit = async (event) => {
  event.preventDefault(); const button = $('button[type=submit]'); button.disabled = true;
  $('.feedback-status').textContent = 'Saving…';
  try { const who = await identity(); await api('/feedback', Object.fromEntries(new FormData($('form'))), who.token); $('.feedback-status').textContent = 'Saved. Thank you. Submitting again updates your answer.'; }
  catch (error) { $('.feedback-status').textContent = error.message; }
  finally { button.disabled = false; }
};
if (tracking) track('page_view');
}
