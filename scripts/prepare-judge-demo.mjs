import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Publish only a demo artifact and a redacted read-only report, never an operator credential.
const root = resolve(import.meta.dirname, '..');
const destination = resolve(process.argv[2]);
const client = JSON.parse(await readFile(join(root, '.data/hosted-operator/founder-client.json'), 'utf8'));
const response = await fetch(client.origin + '/api/agent/workflows/wf_2a278987f6a8e6d72562/report?cohort=test&days=7', {
  headers: { Authorization: 'Bearer ' + client.token }, signal: AbortSignal.timeout(20000), redirect: 'error',
});
if (!response.ok) throw new Error('Report read failed: ' + response.status);
const result = await response.json();
if (result.report?.cohort !== 'test') throw new Error('Only the internal test report may be exported.');
const allowed = ['project','generatedAt','days','cohort','experimentId','sourceCommit','eventCounts','funnel','questionResults','sessions','primaryActions','primaryActionOccurrences','primaryActionLegacySessions','responses','verdict','nextSteps','measurementVersion','occurrenceCoverage','sources','intent','blockers','cohorts','windowStart','limitations'];
const report = Object.fromEntries(allowed.filter(key => Object.hasOwn(result.report,key)).map(key => [key,result.report[key]]));
report.comments = [];
for (const question of report.questionResults || []) question.texts = [];
report.limitations = [...(report.limitations || []), 'Public snapshot: written responses are withheld. New interactions with the public store copy do not update this report.'];
const rawConfig = JSON.parse(await readFile(join(root,'.data/hosted-operator/dashboard-refresh/config.json'),'utf8'));
const config = { name: 'PROOF / REPS', project: rawConfig.project, hypothesis: rawConfig.hypothesis, experiment: rawConfig.experiment };
await mkdir(join(destination, 'store'), { recursive: true });
await mkdir(join(destination, 'results'), { recursive: true });
execFileSync('python3',['-c',`
import zipfile,pathlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 for item in z.infolist():
  p=pathlib.PurePosixPath(item.filename)
  if p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe archive path')
  if item.is_dir() or item.filename.startswith('__launchlab/'): continue
  if p.suffix not in ['.html','.js','.css','.svg','.jpg','.png','.webp']: raise ValueError('Unexpected asset type')
  out=pathlib.Path(sys.argv[2])/p
  out.parent.mkdir(parents=True,exist_ok=True)
  data=z.read(item)
  if p.suffix in ['.html','.js','.css']:
   text=data.decode()
   for prefix in ['/assets/','/products/']: text=text.replace(prefix,'.'+prefix)
   text=text.replace('href="/favicon.svg"','href="./favicon.svg"')
   data=text.encode()
  out.write_bytes(data)
`,join(root,'.data/hosted-operator/dashboard-refresh/dashboard.zip'),join(destination,'store')]);
let html = await readFile(join(destination,'store/index.html'),'utf8');
html = html.replace('<script src="/__launchlab/sdk.js"></script>','<script src="./demo-mode.js"></script>')
  .replace('<script type="module" src="/__launchlab/widget.js"></script>','')
  .replace('LAUNCHLAB EXPERIMENT <span>Demo store · no real purchases</span>','JUDGE PREVIEW <span>Simulated checkout · collection disabled in this public copy</span>')
  .replace('<footer>','<p style="padding:20px;text-align:center;color:#c8b5dd">This is an interactive copy of the deployed storefront. Feedback collection runs in the protected live experiment. <a href="../results/">View its recorded test results →</a></p><footer>');
await writeFile(join(destination,'store/index.html'),html);
await writeFile(join(destination,'store/demo-mode.js'),'globalThis.LaunchLab = Object.freeze({track() {}});\n');
const assets = join(root,'src/managed/assets');
for (const file of ['results.css','logo.svg']) await copyFile(join(assets,file),join(destination,'results',file));
let reportHtml = await readFile(join(assets,'results.html'),'utf8');
reportHtml = reportHtml.replaceAll('/__launchlab/','./').replace('src="./results.js"','src="./snapshot.js"')
  .replace('href="/" class="project-link"','href="../store/" class="project-link"')
  .replace('Private founder workspace','Public test snapshot').replace('Private results','Read-only snapshot').replace('Live experiment','Recorded experiment');
await writeFile(join(destination,'results/index.html'),reportHtml);
let reportJs = (await readFile(join(assets,'results.js'),'utf8')).split('async function refresh()')[0];
reportJs += `\nconst snapshot = await (await fetch('./snapshot.json')).json();\nconfig=snapshot.config;\n$('name').textContent=config.name; $('project-name').textContent=config.name; $('hypothesis').textContent=config.hypothesis; $('revision').textContent='Version '+snapshot.report.sourceCommit.slice(0,7);\nrender(snapshot.report);\nfor (const id of ['lock','lock-top','controls','export','access']) $(id).hidden=true;\n$('status').textContent='Read-only test snapshot · '+new Date(snapshot.capturedAt).toLocaleString()+' · Written responses withheld';\nfor (const button of document.querySelectorAll('[data-view],[data-goto]')) button.onclick=()=>showView(button.dataset.view||button.dataset.goto,true);\nwindow.addEventListener('hashchange',()=>showView(location.hash.slice(1))); showView(location.hash.slice(1));\n`;
await writeFile(join(destination,'results/snapshot.js'),reportJs);
await writeFile(join(destination,'results/snapshot.json'),JSON.stringify({capturedAt:new Date().toISOString(),config,report},null,2)+'\n');
await copyFile(join(root,'assets/brand/launchlab-okx-avatar.png'),join(destination,'logo.png'));
await writeFile(join(destination,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LaunchLab — Judge walkthrough</title><link rel="stylesheet" href="./judge.css"></head><body><header><a href="https://launchlab.stardive.xyz/"><img src="./logo.png" alt="" width="38" height="38">launchlab.</a><span>OKX DEV DAY 2026</span></header><main><p class="eyebrow">BUILD A COMPANY / TEY JIA YE</p><h1>From a repository<br>to <em>something you can learn from.</em></h1><p class="lead">LaunchLab helps founders and agents deploy a product experiment, add consent-based tracking and collect feedback tied to the version people tried.</p><div class="actions"><a class="primary" href="./store/">Try PROOF / REPS ↗</a><a href="./results/">Explore recorded results ↗</a><a href="https://github.com/JyTey2004/launchlab-devday-2026">Read the source ↗</a></div><section class="note"><strong>What you are opening</strong><p>The storefront is an interactive public copy of the deployed Vite app. Checkout is simulated; this copy sends no tracking or feedback. Results are a redacted snapshot from the real hosted experiment's internal tests, captured on ${new Date().toISOString().slice(0,10)}. They do not update as you try this copy.</p></section><h2>The working launch loop</h2><div class="steps"><article><b>01 / SOURCE</b><h3>Start with a repo and a goal</h3><p>Pin the GitHub commit, detect the framework, and clarify the experiment and audience.</p></article><article><b>02 / APPROVAL</b><h3>Review what gets measured</h3><p>GPT proposes bounded tracking edits and feedback questions. The founder approves the exact plan.</p></article><article><b>03 / DEPLOY</b><h3>Open a verified preview</h3><p>AWS CodeBuild builds an isolated copy. Amplify hosts the instrumented product.</p></article><article><b>04 / LEARN</b><h3>Bring evidence to your agent</h3><p>Read activity, feedback and data-quality limits through the dashboard or nine HTTPS/MCP tools.</p></article></div><section class="note"><strong>OKX integration status</strong><p>LaunchLab provider 13905 is registered. Its free A2A pilot was submitted for listing review. The hosted provider tools work; a complete OKX buyer-task-to-delivery round trip remains unverified. A separate readiness endpoint has a verified X Layer testnet x402 self-payment.</p><p><a href="https://github.com/JyTey2004/launchlab-devday-2026/blob/main/docs/okx-provider-interface.md">Integration contract and boundaries ↗</a></p></section><h2>What the evidence shows</h2><div class="stats"><article><strong>${report.sessions}</strong><span>Internal test sessions</span></article><article><strong>${report.primaryActionOccurrences}</strong><span>Recorded checkout actions</span></article><article><strong>${report.responses}</strong><span>Saved test feedback response</span></article></div><p class="muted">Earlier repeat actions were not recorded. Browser sessions are not verified unique people. Internal tests verify instrumentation; they do not establish customer demand.</p><footer>LaunchLab · Controlled hackathon prototype · Independent project, no OKX endorsement</footer></main></body></html>`);
await writeFile(join(destination,'judge.css'),`*{box-sizing:border-box}body{margin:0;background:#0d0c12;color:#f4f1fa;font:16px/1.6 system-ui,sans-serif}header{display:flex;justify-content:space-between;align-items:center;max-width:1160px;margin:auto;padding:28px 32px}header a{display:flex;align-items:center;gap:12px;font-size:23px;font-weight:700}header span,.eyebrow{font-size:12px;letter-spacing:.15em;color:#b9a6cb}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}main{max-width:1160px;margin:auto;padding:44px 32px}h1{font-size:clamp(38px,5vw,68px);line-height:1.12;letter-spacing:-.04em;margin:18px 0 28px;max-width:920px}em{font-style:normal;color:#baa0dd}.lead{font-size:20px;color:#b6b0c1;max-width:820px}.actions{display:flex;gap:14px;flex-wrap:wrap;margin:32px 0 42px}.actions a{padding:13px 20px;border:1px solid #40374d;border-radius:8px}.primary{background:#c4ade2;color:#17111d;border:none!important;font-weight:600}.note{padding:24px 28px;border:1px solid #352c43;background:#17121f;border-radius:12px;margin:34px 0}.note p{color:#bdb3c9;margin-bottom:0}h2{font-size:30px;letter-spacing:-.02em;margin-top:52px}.steps{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}.steps article{padding:26px;background:#15121b;border:1px solid #282232;border-radius:12px}b{color:#aa91c7;font-size:12px;letter-spacing:.1em}h3{font-size:22px;margin:12px 0}.steps p,.muted{color:#a7a0b3}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.stats article{padding:24px;border-top:1px solid #41344e}.stats strong{display:block;font-size:46px}.stats span{color:#afa1bc}footer{border-top:1px solid #282230;margin-top:64px;padding:24px 0;font-size:13px;color:#83798d}@media(max-width:650px){header{padding:20px}header span{display:none}main{padding:20px}.steps,.stats{grid-template-columns:1fr}h1{font-size:42px}.actions a{width:100%}}`);
console.log(JSON.stringify({destination,capturedAt:new Date().toISOString(),sessions:report.sessions,recordedActions:report.primaryActionOccurrences,feedbackResponses:report.responses,privateTextExported:false,collectionInPublicCopy:false}));
