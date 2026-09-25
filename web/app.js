const $ = (s) => document.querySelector(s);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
let state = {
  projects: [],
  releases: [],
  campaigns: [],
  reservations: [],
  feedback: [],
  ledger: [],
  events: [],
};
let page = 'overview';
let busy = false;
const short = (value) => esc(value?.slice(0, 10) || '—');
const when = (value) =>
  new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const icon = (name) =>
  ({ overview: '◫', projects: '⌘', experiments: '◎', feedback: '☷', agents: '✳' })[name];
async function api(path, data) {
  const response = await fetch(`/api${path}`, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function toast(text, error = false) {
  $('#toast').textContent = text;
  $('#toast').className = `show ${error ? 'error' : ''}`;
  setTimeout(() => ($('#toast').className = ''), 6000);
}
async function refresh() {
  state = await api('/overview');
  render();
}
const projectFor = (id) => state.projects.find((p) => p.id === id);
const releaseFor = (id) => state.releases.find((r) => r.id === id);
function nav() {
  return `<aside><a class="brand" href="/" aria-label="LaunchLab home"><span class="brandmark">✳</span>LaunchLab<span class="beta">α</span></a><div class="workspace"><span class="workspace-icon">L</span><div>Builder workspace<small>Local prototype</small></div><span>⌄</span></div><div class="navlabel">WORKSPACE</div><nav>${[
    ['overview', 'Overview'],
    ['projects', 'Projects'],
    ['experiments', 'Experiments'],
    ['feedback', 'Feedback'],
    ['agents', 'Agent access'],
  ]
    .map(
      ([key, label]) =>
        `<button data-page="${key}" class="navitem ${page === key ? 'active' : ''}"><span>${icon(key)}</span>${label}${key === 'feedback' && state.feedback.filter((f) => f.status === 'pending').length ? `<b>${state.feedback.filter((f) => f.status === 'pending').length}</b>` : ''}</button>`,
    )
    .join(
      '',
    )}</nav><div class="sidebar-bottom"><div class="network-dot"></div><div>Built for X Layer<small>Testnet · chain 1952</small></div></div><div class="operator"><div class="avatar">B</div><div>Local builder<small>Operator access</small></div></div></aside>`;
}
function render() {
  const campaignId = new URLSearchParams(location.hash.slice(1)).get('experiment');
  if (campaignId) return renderParticipant(campaignId);
  $('#app').innerHTML =
    `${nav()}<div class="shell"><header class="topbar"><div><span class="breadcrumb">Workspace</span><span class="slash">/</span>${{ overview: 'Overview', projects: 'Projects', experiments: 'Experiments', feedback: 'Feedback', agents: 'Agent access' }[page]}</div><div class="top-actions"><span class="mode"><i></i> Demo credits</span><button class="iconbutton" data-action="refresh" aria-label="Refresh dashboard">↻</button><span class="avatar small">B</span></div></header><main>${{ overview: overview, projects: projects, experiments: experiments, feedback: feedback, agents: agents }[page]()}</main><footer class="footnote">LOCAL WORKSPACE <span>Persistent previews · Versioned evidence · Capped reward pools</span><span>v0.1</span></footer></div>`;
}
function heading(kicker, title, description, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
const newButton = '<button class="button primary" data-action="import">＋ New project</button>';
function overview() {
  const pool = state.campaigns.reduce((n, c) => n + c.pool.available, 0);
  return `${heading('BUILD. TEST. LEARN.', 'A shorter path to your first users.', 'Give agents a place to launch ideas. Give people a reason to try them.', newButton)}
  <section class="hero"><div class="hero-copy"><span class="tag light">THE EXPERIMENT WORKSPACE</span><h2>Code is a beginning.<br>Learning is the launch.</h2><p>Turn a repository into a live preview, invite testers and collect feedback you can trace to the code.</p><button class="button cream" data-action="sample">Try the example project <span>↗</span></button><small>Starts locally. No wallet or funds required.</small></div><div class="hero-diagram" aria-label="Repository to preview to human feedback"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="diagram-card code"><span>⌘</span><div>YOUR REPOSITORY<strong>One pinned version</strong></div><i>✓</i></div><div class="connector">↓</div><div class="diagram-card preview"><span>◈</span><div>LIVE PREVIEW<strong>Ready to experience</strong></div><i>↗</i></div><div class="connector">↓</div><div class="diagram-card people"><span>◎</span><div>HUMAN FEEDBACK<strong>A reason to build again</strong></div><i>＋</i></div><div class="diagram-note">ONE LOOP. MORE LEARNING.</div></div></section>
  <div class="stats">${[
    ['Projects', state.projects.length, 'Repositories in this workspace'],
    [
      'Ready previews',
      state.releases.filter((r) => r.status === 'ready').length,
      'Passed the local HTTP check',
    ],
    ['Feedback received', state.feedback.length, 'Submissions from test sessions'],
    ['Available rewards', pool, 'Demo credits · no cash value'],
  ]
    .map(
      ([label, value, note]) =>
        `<div class="stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`,
    )
    .join('')}</div>
  <div class="section-heading"><h2>Your launch loop</h2><span class="muted">Start small. Learn from one complete experiment.</span></div><div class="steps">${[
    ['01', 'Import a project', 'Pin the source you want to test.', state.projects.length > 0],
    [
      '02',
      'Prepare a preview',
      'Verify the exact version is reachable.',
      state.releases.some((r) => r.status === 'ready'),
    ],
    ['03', 'Open an experiment', 'Choose a task, audience and reward.', state.campaigns.length > 0],
    [
      '04',
      'Learn & improve',
      'Review evidence. Reward honest feedback.',
      state.feedback.some((f) => f.status === 'accepted'),
    ],
  ]
    .map(
      ([n, title, desc, done]) =>
        `<div class="step ${done ? 'done' : ''}"><span>${done ? '✓' : n}</span><h3>${title}</h3><p>${desc}</p></div>`,
    )
    .join('')}</div>
  <div class="two-col"><section class="panel"><div class="section-heading"><h2>Recent projects</h2><button class="textbutton" data-page="projects">View all ↗</button></div>${state.projects.length ? state.projects.slice(0, 3).map(projectRow).join('') : empty('⌘', 'A fresh workspace', 'Start with Hello X Layer, a tiny agent service directory.', 'Try example', 'sample')}</section><section class="panel"><div class="section-heading"><h2>Activity</h2><span class="eyebrow">RECORDED EVENTS</span></div>${
    state.events.length
      ? `<div class="timeline">${state.events
          .slice(0, 5)
          .map(
            (e) =>
              `<div><i></i><section><strong>${esc(e.type.replaceAll('.', ' · ').replaceAll('_', ' '))}</strong><p>${esc(e.detail)}</p><small>${when(e.at)}</small></section></div>`,
          )
          .join('')}</div>`
      : empty(
          '↗',
          'Your first move starts the loop',
          'Imports, checks and reward decisions appear here.',
        )
  }</section></div>`;
}
function empty(symbol, title, description, cta, action) {
  return `<div class="empty"><div class="empty-icon">${symbol}</div><h3>${title}</h3><p>${description}</p>${cta ? `<button class="button secondary" data-action="${action}">${cta} ↗</button>` : ''}</div>`;
}
function projectRow(p) {
  const r = state.releases.find((r) => r.projectId === p.id);
  return `<div class="project-row"><div class="project-icon">⌘</div><div class="grow"><strong>${esc(p.name)}</strong><small>${p.sourceKind === 'bundled' ? 'Bundled example' : esc(p.repoUrl?.replace('https://github.com/', ''))} · ${short(p.commitSha || p.sourceDigest)}</small></div><span class="badge ${r?.status === 'ready' ? 'green' : ''}">${r?.status === 'ready' ? 'Preview ready' : 'Imported'}</span></div>`;
}
function projects() {
  return `${heading('YOUR STARTING POINT', 'Projects', 'Each import pins a source version. New versions become separate experiments.', newButton)}${
    state.projects.length
      ? `<div class="project-grid">${state.projects
          .map((p) => {
            const releases = state.releases.filter((r) => r.projectId === p.id);
            const latest = releases[0];
            return `<article class="panel project-card"><div class="section-heading"><div class="project-icon large">⌘</div><span class="badge">${p.sourceKind === 'bundled' ? 'Example' : 'GitHub'}</span></div><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><div class="metadata"><span>${p.commitSha ? 'COMMIT' : 'SOURCE SHA-256'}</span><code>${short(p.commitSha || p.sourceDigest)}</code><span>ENVIRONMENT</span><strong>X Layer Testnet · Static</strong></div>${latest ? `<div class="readiness"><div class="section-heading"><strong>Preview checks</strong><span class="badge ${latest.status === 'ready' ? 'green' : 'amber'}">${esc(latest.status)}</span></div>${latest.checks.map((c) => `<div class="check"><b class="${c.status}">${c.status === 'pass' ? '✓' : '!'}</b><div>${esc(c.name)}<small>${esc(c.detail)}</small></div></div>`).join('')}</div>` : ''}<div class="card-actions">${latest?.status === 'ready' ? `<a class="button secondary" href="${esc(latest.previewUrl)}" target="_blank" rel="noopener noreferrer">Open preview ↗</a><button class="button primary" data-action="campaign" data-id="${latest.id}">Create experiment</button>` : `<button class="button primary" data-action="deploy" data-id="${p.id}">Prepare preview ↗</button>`}</div><small class="card-note">${latest?.status === 'ready' ? 'Local trial ready. Contract security and production readiness are not assessed.' : 'The static adapter copies versioned files; it does not run repository scripts.'}</small></article>`;
          })
          .join('')}</div>`
      : `<section class="panel">${empty('⌘', 'Bring an idea to life', 'Import a supported public repository or use the included example.', 'Import a project', 'import')}</section>`
  }`;
}
function experiments() {
  return `${heading('LEARN IN PUBLIC, START LOCALLY', 'Experiments', 'A specific task. A clear audience. A reward reserved before someone starts.')}<div class="notice"><span>◉</span> This prototype uses demo credits. Tester recruitment and blockchain payouts are not connected.</div>${state.campaigns.length ? `<div class="project-grid">${state.campaigns.map((c) => `<article class="panel campaign-card"><div class="section-heading"><span class="eyebrow">${esc(projectFor(c.projectId)?.name)}</span><span class="badge ${c.status === 'open' ? 'green' : ''}">${esc(c.status)}</span></div><h2>${esc(c.title)}</h2><p>${esc(c.task)}</p><div class="audience"><span>FOR</span> ${esc(c.audience)}</div><div class="pool"><div class="section-heading"><strong>Reward pool</strong><span><b>${c.pool.available}</b> / ${c.budget} available</span></div><progress value="${c.pool.reserved + c.pool.awarded}" max="${c.budget}"></progress><div class="pool-key"><span>● ${c.pool.reserved} reserved</span><span>● ${c.pool.awarded} awarded</span><span>${c.reward} / session</span></div></div><div class="card-actions"><a class="button primary" href="#experiment=${c.id}">Try experiment ↗</a><button class="button secondary" data-action="report" data-id="${c.id}">Export report</button>${c.status === 'open' ? `<button class="textbutton" data-action="close" data-id="${c.id}">Close</button>` : ''}</div><small class="card-note">${esc(c.reviewPolicy)}</small></article>`).join('')}</div>` : `<section class="panel">${empty('◎', 'Make room for your first testers', 'Prepare a preview, then turn a product question into a testable task.', 'Go to projects', 'go-projects')}</section>`}`;
}
function feedback() {
  return `${heading('OBSERVATIONS, NOT VANITY METRICS', 'Feedback', 'Review the evidence. A useful failure deserves the same reward as a successful session.')}<div class="notice"><span>↗</span> These are self-reported observations. A review does not prove a unique human or organic demand.</div>${state.feedback.length ? state.feedback.map((f) => `<article class="panel feedback-card"><div class="section-heading"><span class="badge ${f.outcome === 'blocked' ? 'amber' : 'green'}">${f.outcome === 'blocked' ? 'Encountered a blocker' : 'Completed task'}</span><span class="muted">${when(f.createdAt)} · ${f.rating}/5 experience</span><span class="badge">${esc(f.status)}</span></div><h2>${esc(f.observation)}</h2><div class="two-col"><div><span class="eyebrow">WHAT THEY DID</span><p>${esc(f.steps)}</p></div><div><span class="eyebrow">SUGGESTED CHANGE</span><p>${esc(f.suggestion || 'No suggestion supplied.')}</p></div></div><div class="provenance"><span>⌘ ${short(f.commitSha || f.sourceDigest)}</span><span>◈ ${short(f.releaseId)}</span><a href="${esc(f.previewUrl)}" target="_blank" rel="noopener noreferrer">Exact preview ↗</a></div>${f.status === 'pending' ? `<div class="card-actions"><button class="button primary" data-action="review" data-id="${f.id}" data-decision="accept">Accept & award demo credits</button><button class="button secondary" data-action="review" data-id="${f.id}" data-decision="reject">Reject with reason</button></div>` : `<div class="review-result">${f.status === 'accepted' ? '✓ Demo credits awarded. No on-chain payment.' : 'Submission rejected; reservation released.'}<p>${esc(f.review.reason)}</p></div>`}</article>`).join('') : `<section class="panel">${empty('☷', 'The best feedback comes from trying', 'Open an experiment and complete a tester session to see the review flow.', 'View experiments', 'go-experiments')}</section>`}`;
}
function agents() {
  return `${heading('A USEFUL TOOL FOR THE NEXT AGENT', 'Let an agent run the loop.', 'Connect the MCP server to give a calling agent repository, preview and feedback tools.')}<div class="two-col"><section class="panel"><span class="tag">MCP · STDIO</span><h2>One connection. Seven tools.</h2><p>The calling agent makes decisions. LaunchLab performs bounded actions and returns the evidence.</p><pre><code>{
  "mcpServers": {
    "launchlab": {
      "command": "node",
      "args": ["/absolute/path/okx-launch-lab/src/mcp.mjs"]
    }
  }
}</code></pre><small>Start the app first with npm start. Replace the path with your checkout.</small><div class="tool-list">${['overview', 'import', 'deploy', 'open_campaign', 'report', 'review', 'network'].map((t) => `<div><code>launchlab_${t}</code><span>↗</span></div>`).join('')}</div></section><section><div class="panel"><div class="section-heading"><h2>Integration status</h2><span class="badge">HONEST BY DEFAULT</span></div>${[
    ['Local MCP', 'Implemented', 'green'],
    ['GitHub static import', 'Implemented', 'green'],
    ['X Layer RPC check', 'Read-only', 'green'],
    ['OKX AI listing', 'Not registered', 'amber'],
    ['x402 seller adapter', 'Implemented · unconfigured', 'amber'],
    ['Real incentive settlement', 'Not connected', 'amber'],
    ['External tester network', 'Not connected', 'amber'],
  ]
    .map(
      ([a, b, c]) =>
        `<div class="integration"><strong>${a}</strong><span class="badge ${c}">${b}</span></div>`,
    )
    .join(
      '',
    )}<button class="button secondary full" data-action="network">Check X Layer Testnet ↗</button><p id="network-result" class="muted" role="status"></p></div><div class="callout"><span>THE NEXT MILESTONE</span><h3>One public service, end to end.</h3><p>Host the service over HTTPS, add account access, connect payment settlement and register the bounded readiness service through OKX AI.</p><a href="https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp" target="_blank" rel="noopener noreferrer">OKX A2MCP documentation ↗</a></div></section></div>`;
}
function modal(title, contents) {
  $('#dialog').innerHTML =
    `<div class="modal-head"><h2>${title}</h2><button class="iconbutton" data-action="dismiss" aria-label="Close dialog">×</button></div>${contents}`;
  $('#dialog').showModal();
}
function importDialog() {
  modal(
    'Start with a project',
    `<p class="muted">Use the bundled example, or import a public static repository containing a launchlab.json manifest.</p><button class="sample-option" data-action="sample"><span>✳</span><div><strong>Hello X Layer</strong><small>A tiny agent service directory · Included example</small></div><b>↗</b></button><div class="divider">OR BRING YOUR REPOSITORY</div><form id="import-form"><label>GitHub repository URL<input type="url" name="repoUrl" placeholder="https://github.com/you/your-project" required></label><label>Branch, tag or commit<input name="ref" value="HEAD" required></label><p class="form-note">Supports static HTML, CSS and JavaScript. Backend builds and arbitrary scripts are not run.</p><button class="button primary full">Import pinned version →</button></form>`,
  );
}
function campaignDialog(releaseId) {
  modal(
    'Design a small experiment',
    `<form id="campaign-form"><input type="hidden" name="releaseId" value="${esc(releaseId)}"><label>Experiment title<input name="title" value="Can new users find the right agent service?" minlength="3" maxlength="100" required></label><label>Who should try it?<input name="audience" value="Builders exploring agents and X Layer for the first time" maxlength="250" required></label><label>Task for participants<textarea name="task" rows="3" minlength="10" maxlength="1500" required>Open the preview, choose a service and try preparing a request. Explain what you expected, what happened and where you got stuck.</textarea></label><div class="two-col"><label>Pool (demo credits)<input type="number" name="budget" min="1" max="100000" value="100" required></label><label>Reward per session<input type="number" name="reward" min="1" max="10000" value="10" required></label></div><div class="notice">Honest negative feedback and documented blockers remain eligible for the reward.</div><button class="button primary full">Open experiment →</button></form>`,
  );
}
function renderParticipant(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c) {
    $('#app').innerHTML =
      `<main>${empty('◎', 'Experiment not found', 'Return to the builder workspace.')}<a href="#">Back to workspace</a></main>`;
    return;
  }
  const release = releaseFor(c.releaseId);
  let session = JSON.parse(sessionStorage.getItem(`launchlab-${id}`) || 'null');
  if (session && state.reservations.find((r) => r.id === session.id)?.status === 'expired') {
    sessionStorage.removeItem(`launchlab-${id}`);
    session = null;
  }
  const submitted = session && state.feedback.find((f) => f.reservationId === session.id);
  $('#app').innerHTML =
    `<div class="participant"><header><a class="brand" href="#"><span class="brandmark">✳</span>LaunchLab</a><a href="#" class="textbutton">← Builder workspace</a></header><main><span class="tag">PRODUCT EXPERIMENT · LOCAL PREVIEW</span><h1>${esc(c.title)}</h1><p class="lead">${esc(c.task)}</p><div class="participant-meta"><span>◎ ${esc(c.audience)}</span><span>✳ ${c.reward} demo credits</span><span>◈ Version ${short(release.sourceDigest)}</span></div><div class="two-col participant-columns"><section class="panel"><span class="eyebrow">YOUR MISSION</span><h2>Try it. Tell us what happened.</h2><ol class="mission"><li><strong>Reserve a spot</strong><p>Your reward is held for 30 minutes.</p></li><li><strong>Explore the exact preview</strong><p>Try the task. Getting stuck is useful evidence too.</p></li><li><strong>Share honest feedback</strong><p>Describe your steps and what you observed. Rewards do not depend on a positive rating.</p></li></ol><div class="notice">Demo credits have no cash value. This is a local test of the participation flow.</div><a class="button secondary full" href="${esc(release.previewUrl)}" target="_blank" rel="noopener noreferrer">Open project preview ↗</a></section><section class="panel">${submitted ? `<span class="badge green">FEEDBACK RECEIVED</span><h2>Thanks for trying something new.</h2><p>Your feedback is attached to this version and is ${esc(submitted.status)}.</p><p>${submitted.status === 'accepted' ? 'Your demo credits have been awarded. No blockchain transaction was made.' : 'An operator or calling agent reviews the evidence before awarding demo credits.'}</p><a class="button primary" href="#">Return to workspace →</a>` : session ? `<span class="badge green">${session.reward} CREDITS RESERVED</span><h2>What did you discover?</h2><small>Submit by ${when(session.expiresAt)}. Keep this tab open to retain your session token.</small><form id="feedback-form"><input type="hidden" name="campaignId" value="${c.id}"><label>Task outcome<select name="outcome"><option value="completed">I completed the task</option><option value="blocked">I encountered a blocker</option></select></label><label>Steps you took<textarea name="steps" rows="3" minlength="20" maxlength="3000" placeholder="I opened…, selected…, then…" required></textarea></label><label>What happened?<textarea name="observation" rows="3" minlength="20" maxlength="3000" placeholder="What worked, what failed, or what surprised you?" required></textarea></label><label>What would you change?<textarea name="suggestion" rows="2" maxlength="1500"></textarea></label><label>How was the experience?<select name="rating"><option value="3">3 — Okay</option><option value="1">1 — Very difficult</option><option value="2">2 — Difficult</option><option value="4">4 — Good</option><option value="5">5 — Great</option></select></label><button class="button primary full">Submit honest feedback →</button></form>` : `<span class="eyebrow">${c.pool.available} CREDITS AVAILABLE</span><h2>Be an early pair of eyes.</h2><p>Use a tester alias for this local session. Aliases do not verify that participants are unique people.</p><form id="reserve-form"><input type="hidden" name="campaignId" value="${c.id}"><label>Tester alias<input name="participantId" minlength="3" maxlength="100" placeholder="e.g. curious-builder" required></label><button class="button primary full" ${c.status !== 'open' || c.pool.available < c.reward ? 'disabled' : ''}>Reserve ${c.reward} demo credits →</button></form>`}</section></div></main></div>`;
}
async function execute(fn) {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  try {
    await fn();
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action],[data-page]');
  if (!target) return;
  if (target.dataset.page) {
    page = target.dataset.page;
    location.hash = '';
    render();
    return;
  }
  const { action, id, decision } = target.dataset;
  if (action === 'dismiss') return $('#dialog').close();
  if (action === 'import') return importDialog();
  if (action === 'campaign') return campaignDialog(id);
  if (action === 'go-projects' || action === 'go-experiments') {
    page = action.replace('go-', '');
    render();
    return;
  }
  if (action === 'review')
    return modal(
      decision === 'accept' ? 'Accept the evidence' : 'Explain the rejection',
      `<form id="review-form"><input type="hidden" name="feedbackId" value="${id}"><input type="hidden" name="decision" value="${decision}"><p>Assess the specific steps and observations. A low rating or a failed task is not a reason to withhold the reward.</p><label>Review rationale<textarea name="reason" rows="4" minlength="10" maxlength="1000" required placeholder="What evidence supports this decision?"></textarea></label><button class="button primary full">${decision === 'accept' ? 'Accept & award demo credits' : 'Record rejection'}</button></form>`,
    );
  execute(async () => {
    if (action === 'refresh') await refresh();
    if (action === 'sample') {
      const p = await api('/projects', {});
      if ($('#dialog').open) $('#dialog').close();
      page = 'projects';
      await refresh();
      toast('Source imported. Preparing the preview…');
      await api('/releases', { projectId: p.id });
      await refresh();
      toast('Example preview is ready to try.');
    }
    if (action === 'deploy') {
      toast('Preparing a versioned preview…');
      await api('/releases', { projectId: id });
      await refresh();
      toast('Preview passed its HTTP check.');
    }
    if (action === 'close') {
      await api(`/campaigns/${id}/close`, {});
      await refresh();
      toast('New reservations closed. Existing sessions remain valid.');
    }
    if (action === 'report') {
      const report = await api(`/campaigns/${id}/report`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `launchlab-${id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (action === 'network') {
      const n = await api('/network');
      $('#network-result').textContent =
        n.status === 'reachable'
          ? `Connected to chain ${n.chainId}. Checked ${when(n.checkedAt)}. No transaction sent.`
          : `RPC unavailable: ${n.error}`;
    }
  });
});
document.addEventListener('submit', (event) => {
  if (!event.target.matches('form')) return;
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  execute(async () => {
    if (form.id === 'import-form') {
      await api('/projects', values);
      $('#dialog').close();
      page = 'projects';
      await refresh();
      toast('Pinned source imported.');
    }
    if (form.id === 'campaign-form') {
      await api('/campaigns', {
        ...values,
        budget: Number(values.budget),
        reward: Number(values.reward),
      });
      $('#dialog').close();
      page = 'experiments';
      await refresh();
      toast('Experiment opened with a capped demo-credit pool.');
    }
    if (form.id === 'reserve-form') {
      const session = await api(`/campaigns/${values.campaignId}/reserve`, {
        participantId: values.participantId,
      });
      sessionStorage.setItem(`launchlab-${values.campaignId}`, JSON.stringify(session));
      await refresh();
    }
    if (form.id === 'feedback-form') {
      const session = JSON.parse(sessionStorage.getItem(`launchlab-${values.campaignId}`));
      const { campaignId, ...feedback } = values;
      await api(`/sessions/${session.id}/feedback`, {
        token: session.token,
        feedback: { ...feedback, rating: Number(feedback.rating) },
      });
      await refresh();
      toast('Feedback submitted for review.');
    }
    if (form.id === 'review-form') {
      await api(`/feedback/${values.feedbackId}/review`, {
        decision: values.decision,
        reason: values.reason,
      });
      $('#dialog').close();
      await refresh();
      toast(
        values.decision === 'accept'
          ? 'Evidence accepted; demo credits awarded once.'
          : 'Review recorded; reserved credits released.',
      );
    }
  });
});
window.addEventListener('hashchange', () => execute(refresh));
refresh().catch((error) => {
  $('#app').innerHTML =
    '<main><h1>Cannot reach LaunchLab</h1><p>Start the server with npm start, then reload.</p></main>';
  toast(error.message, true);
});
