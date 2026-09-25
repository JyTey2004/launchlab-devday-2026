const $ = (id) => document.getElementById(id);
const labels = { yes: 'Would consider using', maybe: 'Maybe', no: 'Would not use', none: 'No hesitation', price: 'Price', usefulness: 'Usefulness', ease: 'Ease of use', trust: 'Trust', other: 'Other', direct: 'Direct', community: 'Community', okx: 'OKX', incentivized: 'Incentivized people', organic: 'Unrewarded people', agent: 'Agents', test: 'Internal tests' };
const views = { overview: ['Experiment overview', 'A clear view of what happened, and what to learn next.'], activity: ['Product activity', 'See repeat actions, session reach and the journey through your product.'], feedback: ['User feedback', 'Keep what people said alongside what they actually did.'], quality: ['Data quality', 'Understand coverage, counting and the limits of this experiment.'] };
let config, key = '', latest, loading = false, view = 'overview';
const fmt = (n) => Number.isFinite(n) ? n.toLocaleString() : '—';
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function metric(label, value, note) { const el = node('div', undefined, 'metric'); el.append(node('span', label), node('strong', value), node('span', note, 'metric-note')); return el; }
function empty(target, message = 'No data in this audience yet.') { target.append(node('p', message, 'empty')); }
function rows(id, values) { $(id).replaceChildren(...Object.entries(values || {}).sort((a,b) => b[1]-a[1]).map(([name,count]) => { const el = node('div', undefined, 'row'); el.append(node('span',labels[name] || name),node('strong',fmt(count))); return el; })); if (!Object.keys(values || {}).length) empty($(id)); }
function showView(name, updateHash = false) {
  view = Object.hasOwn(views, name) ? name : 'overview';
  for (const el of document.querySelectorAll('[data-panel]')) el.hidden = el.dataset.panel !== view;
  for (const button of document.querySelectorAll('[data-view]')) { if (button.dataset.view === view) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); }
  $('view-title').textContent = views[view][0]; $('view-description').textContent = views[view][1];
  if (updateHash) { history.replaceState(null,'','#'+view); $('view-title').setAttribute('tabindex','-1'); $('view-title').focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'}); }
}
function bar(value, total) { const el = node('div', undefined, 'bar'), fill = node('span'); fill.style.width = (total ? Math.min(100, Math.max(0, value/total*100)) : 0)+'%'; el.append(fill); el.setAttribute('aria-hidden','true'); return el; }
function funnel(id, data) {
  $(id).replaceChildren();
  for (const [index,item] of (data.funnel || []).entries()) { const el = node('div', undefined, 'funnel-step'), label = node('div', undefined, 'funnel-label'); label.append(node('span',String(index+1).padStart(2,'0')+'  '+item.label),node('strong',fmt(item.sessions))); el.append(label,bar(item.sessions,data.sessions)); $(id).append(el); }
  if (!data.sessions) empty($(id),'No opted-in sessions in this audience yet.');
}
function ready(value) {
  $('access').hidden = value; $('controls').hidden = !value; $('report').hidden = !value; $('export').hidden = !value; $('lock').hidden = !value; $('lock-top').hidden = !value; $('audience-badge').hidden = !value;
  for (const button of document.querySelectorAll('[data-view]')) button.disabled = !value;
}
function render(data) {
  latest = data; ready(true); $('status').className = '';
  $('audience-badge').textContent = labels[data.cohort] || data.cohort;
  $('feedback-count').textContent = fmt(data.responses);
  const primary = (data.eventCounts || []).find(e => e.id === (config.experiment?.funnel?.at(-1) || 'primary_action'));
  const legacy = data.primaryActionLegacySessions || 0;
  const known = data.measurementVersion >= 2;
  const actionValue = !known || (legacy && !data.primaryActionOccurrences) ? '—' : fmt(data.primaryActionOccurrences)+(legacy ? '+' : '');
  $('metrics').replaceChildren(metric('Opted-in sessions',fmt(data.sessions),'Browser sessions, not unique people'),metric('Sessions completing goal',fmt(data.primaryActions),primary?.label || 'Primary action'),metric('Recorded goal actions',actionValue,legacy ? 'Earlier repeats unavailable' : known ? 'Includes repeat actions' : 'Action totals not collected'),metric('Feedback responses',fmt(data.responses),'One saved response per session'));
  $('verdict').textContent = data.verdict;
  $('verdict-note').textContent = ['test','agent'].includes(data.cohort) ? 'This audience verifies the collection flow. It cannot establish customer demand or preferences.' : data.responses === 0 ? (data.sessions ? 'Activity is arriving, but no feedback is saved for this audience. Invite intended users to share what helped or held them back.' : 'No activity or feedback is saved for this audience yet. Invite intended users to try the product and share their experience.') : 'Behavior and stated interest are early evidence. This sample does not establish paid demand.';
  $('next').replaceChildren(...(data.nextSteps || []).map(v => node('li',v)));
  funnel('overview-funnel',data); funnel('activity-funnel',data);
  const older = data.occurrenceCoverage?.legacySessions || 0;
  $('coverage-notice').textContent = !known ? 'This collector reports session reach only. Repeated actions were not stored.' : older ? 'Partial action history: '+fmt(older)+' session(s) include earlier records that stored reach only. “Recorded actions” counts the newer event IDs; it excludes those unknown earlier repeats. Sessions include both.' : 'Recorded actions include repeats. Sessions count each action once per visit. Network retries with the same event ID count once.';
  $('event-rows').replaceChildren();
  for (const item of data.eventCounts || []) {
    const row = node('tr'), name = node('td',item.label), occurrence = node('td');
    occurrence.append(node('span', item.occurrences === undefined || (item.legacySessions && !item.occurrences) ? '—' : fmt(item.occurrences)+(item.legacySessions ? '+' : '')));
    if (item.legacySessions) occurrence.append(node('small','Earlier repeats unavailable'));
    row.append(name,occurrence,node('td',fmt(item.sessions)),node('td',data.sessions ? Math.round(item.sessions/data.sessions*100)+'%' : '—')); $('event-rows').append(row);
  }
  rows('sources',data.sources); rows('intent',data.intent); rows('blockers',data.blockers); rows('cohorts',data.cohorts);
  $('feedback-summary').textContent = fmt(data.responses)+' saved response(s) · '+(labels[data.cohort] || data.cohort)+'. Resubmitting in the same session updates the response; it does not add another. '+(['test','agent'].includes(data.cohort) ? 'These are testing records, not customer validation.' : 'Feedback is voluntary and may come from visits without tracking consent.');
  $('questions').replaceChildren();
  for (const q of data.questionResults || []) {
    const section = node('div',undefined,'question'); section.append(node('h3',q.label));
    for (const option of q.options || []) { const answer = node('div',undefined,'answer-row'), line = node('div'); line.append(node('span',option.label),node('strong',fmt(option.count))); answer.append(line,bar(option.count,data.responses)); section.append(answer); }
    for (const text of q.texts || []) { const quote = node('blockquote'); quote.append(node('p',text)); section.append(quote); }
    if (q.kind === 'text' && !(q.texts || []).length) empty(section,'No written answers yet.');
    $('questions').append(section);
  }
  if (!(data.questionResults || []).length) empty($('questions'),'No custom questions for this experiment.');
  $('comments').replaceChildren(...(data.comments || []).map(value => { const el = node('blockquote'); el.append(node('p',value.comment),node('small',(labels[value.intent] || value.intent)+' · '+(labels[value.blocker] || value.blocker))); return el; }));
  if (!(data.comments || []).length) empty($('comments'),'No feedback comments yet.');
  const h = data.hosting?.metrics || {};
  $('hosting').replaceChildren(...(data.hosting?.status === 'available' ? [metric('Requests',fmt(h.Requests),'All hosting requests'),metric('Data delivered',h.BytesDownloaded == null ? '—' : (h.BytesDownloaded/1048576).toFixed(2)+' MB','All downloaded assets'),metric('4xx responses',fmt(h['4xxErrors']),'Includes failed logins'),metric('5xx responses',fmt(h['5xxErrors']),'Server errors')] : [node('p','Hosting metrics are temporarily unavailable.','empty')]));
  const coverageRows = [['Recorded action IDs',known ? data.occurrenceCoverage?.recorded : null],['Sessions with earlier records',known ? older : null]];
  $('coverage').replaceChildren(...coverageRows.map(([label,value]) => { const row = node('div',undefined,'row'); row.append(node('span',label),node('strong',fmt(value))); return row; }));
  const details = [['Experiment',data.experimentId || data.project],['Source commit',data.sourceCommit || 'Not provided'],['Goal',primary?.label || data.goalEvent],['Period starts',data.windowStart ? new Date(data.windowStart*1000).toISOString().replace('T',' ').replace('.000Z',' UTC') : 'Not provided'],['Period basis','Sessions started in the selected UTC period'],['Last refreshed',new Date(data.generatedAt*1000).toLocaleString()]];
  $('provenance').replaceChildren(...details.flatMap(([label,value]) => [node('dt',label),node('dd',value)]));
  $('limits').replaceChildren(...(data.limitations || []).map(v => node('li',v)));
  $('status').textContent = 'Updated '+new Date(data.generatedAt*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · Refreshes every minute';
}

const snapshot = await (await fetch('./snapshot.json')).json();
config=snapshot.config;
$('name').textContent=config.name; $('project-name').textContent=config.name; $('hypothesis').textContent=config.hypothesis; $('revision').textContent='Version '+snapshot.report.sourceCommit.slice(0,7);
render(snapshot.report);
for (const id of ['lock','lock-top','controls','export','access']) $(id).hidden=true;
$('status').textContent='Read-only test snapshot · '+new Date(snapshot.capturedAt).toLocaleString()+' · Written responses withheld';
for (const button of document.querySelectorAll('[data-view],[data-goto]')) button.onclick=()=>showView(button.dataset.view||button.dataset.goto,true);
window.addEventListener('hashchange',()=>showView(location.hash.slice(1))); showView(location.hash.slice(1));
