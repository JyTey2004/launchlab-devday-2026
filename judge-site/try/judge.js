import { EVENT_LABELS, emptySummary, readSummary, reportText } from './model.mjs';

const $ = selector => document.querySelector(selector);
const panels = [...document.querySelectorAll('[data-panel]')];
const tabs = [...document.querySelectorAll('[data-step]')];
let approved = false;
let iframe = null;
let connected = false;
let summary = emptySummary();
let loadTimer;

function requestSummary() {
  iframe?.contentWindow?.postMessage({ source: 'launchlab-judge-parent', version: 1, type: 'request-summary' }, location.origin);
}
function showStep(step, { focus = true } = {}) {
  if (step > 1 && !approved) return;
  panels.forEach((panel, index) => { panel.hidden = index !== step; });
  tabs.forEach((tab, index) => {
    if (index === step) tab.setAttribute('aria-current', 'step');
    else tab.removeAttribute('aria-current');
    tab.disabled = index > 1 && !approved;
  });
  if (step === 2) openSample();
  if (step === 3) { requestSummary(); renderResults(); }
  if (focus) panels[step].querySelector('h3').focus({ preventScroll: true });
}
function openSample() {
  if (iframe) { requestSummary(); return; }
  iframe = document.createElement('iframe');
  iframe.title = 'Dev Day Pulse interactive sample — local browser data only';
  iframe.referrerPolicy = 'no-referrer';
  iframe.setAttribute('allow', 'clipboard-write');
  // Same-origin sample is our reviewed static bundle, with no hosted tracker.
  iframe.src = './sample/?test=1&judge=1';
  iframe.addEventListener('load', requestSummary);
  $('#sample-holder').replaceChildren(iframe);
  $('#sample-status').textContent = 'The sample is loading. Your data stays in this browser.';
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (!connected) $('#sample-status').textContent = 'We have not received observations from the sample yet. Try opening it in its own tab below.';
  }, 10000);
}
function renderResults() {
  $('#visit-count').textContent = String(summary.recordedSessions);
  $('#brief-count').textContent = String(summary.briefsCreated);
  $('#feedback-count').textContent = String(summary.feedbackResponses);
  $('#save-summary').disabled = !connected;
  let status = 'Waiting for the sample. No observations have been received yet.';
  if (connected && summary.consent) status = 'Local activity recording is on. These counts update as you try the sample.';
  if (connected && !summary.consent && !summary.recordedSessions) status = 'Activity recording is off, so zero actions is expected. You can still submit feedback.';
  if (connected && !summary.consent && summary.recordedSessions) status = 'Activity recording is now off. Actions recorded earlier in this visit remain in the summary.';
  $('#results-status').textContent = status;
  const rows = Object.entries(EVENT_LABELS).map(([id, label]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.scope = 'row'; th.textContent = label;
    const td = document.createElement('td'); td.textContent = String(summary.eventCounts.find(row => row.id === id)?.occurrences || 0);
    tr.append(th, td); return tr;
  });
  $('#event-rows').replaceChildren(...rows);
}
window.addEventListener('message', event => {
  const next = readSummary(event, { origin: location.origin, source: iframe?.contentWindow });
  if (!next) return;
  summary = next; connected = true; clearTimeout(loadTimer);
  $('#sample-status').textContent = next.consent
    ? 'Connected. Local recording is on; your actions will appear in the evidence step.'
    : 'Connected. Activity recording is off. Feedback is still available.';
  renderResults();
});
tabs.forEach(tab => tab.addEventListener('click', () => showStep(Number(tab.dataset.step))));
$('#review-plan').addEventListener('click', () => showStep(1));
$('#decline-demo').addEventListener('click', () => showStep(0));
$('#approve-demo').addEventListener('click', () => { approved = true; showStep(2); });
$('#see-results').addEventListener('click', () => showStep(3));
$('#back-sample').addEventListener('click', () => showStep(2));
$('#start-demo').addEventListener('click', () => showStep(0, { focus: false }));
$('#restart-demo').addEventListener('click', () => {
  iframe?.remove(); iframe = null; approved = false; connected = false; summary = emptySummary();
  clearTimeout(loadTimer); $('#download-status').textContent = '';
  renderResults(); showStep(0);
  // No deletion of the judge's browser data. A newly opened sample starts a new
  // visit; its own Clear local data control is the explicit deletion action.
});
$('#save-summary').addEventListener('click', () => {
  if (!connected) return;
  const url = URL.createObjectURL(new Blob([reportText(summary)], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'launchlab-browser-demo-summary.txt';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('#download-status').textContent = 'Summary download requested. It contains counts only, with no feedback text or personal details.';
});
$('#copy-prompt').addEventListener('click', async () => {
  const prompt = $('#buyer-prompt');
  let timeout;
  $('#copy-prompt').disabled = true;
  $('#copy-status').textContent = 'Copying the prompt…';
  try {
    if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
    await Promise.race([
      navigator.clipboard.writeText(prompt.value.trim()),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Clipboard did not respond')), 2500); }),
    ]);
    $('#copy-status').textContent = 'Copied. Paste into your agent to start with service discovery.';
  } catch {
    prompt.focus(); prompt.select();
    $('#copy-status').textContent = 'Automatic copy is unavailable. The prompt is selected: press Ctrl+C or ⌘C, or use Download the prompt.';
  } finally {
    clearTimeout(timeout); $('#copy-prompt').disabled = false;
  }
});
renderResults();
