const $ = (id) => document.getElementById(id);
let current, poll, busy = false, modelReady = false;
const node = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
async function api(path, data) {
  const response = await fetch('/api/agent/' + path, { method: data ? 'POST' : 'GET', headers: { 'Content-Type':'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed.'); return result;
}
function row(label, value) { const el = node('div'); el.className = 'row'; el.append(node('span',label),node('strong',value)); return el; }
$('example').onclick=async()=>{
  try {
    const example=await api('example');
    for(const [key,value] of Object.entries(example)){const input=$('brief').elements.namedItem(key);if(!input)continue;if(input.type==='checkbox')input.checked=value;else input.value=value;}
    $('plan-status').textContent='PROOF / REPS example loaded at its original storefront commit. It has no existing feedback widget. Planning and deployment start only when you choose them.';
  } catch(error){$('plan-status').textContent=error.message;}
};
async function history() {
  const values = await api('experiments'); $('history').replaceChildren();
  for (const value of values) { const button = node('button',`${value.name} · ${value.status}`); button.type='button';button.onclick=()=>void load(value.id);$('history').append(button); }
  if (!values.length) $('history').textContent='No experiments yet.';
}
function render({ experiment, deployment }) {
  current = experiment; location.hash=experiment.id;
  $('plan-empty').hidden=Boolean(experiment.design);$('plan-content').hidden=!experiment.design;
  $('blockers').hidden=!(experiment.blockers?.length || deployment?.blocker);
  $('blockers').textContent=[...(experiment.blockers || []),deployment?.blocker?.message].filter(Boolean).join(' ');
  $('deploy-button').hidden=deployment?.status!=='planned';
  if (experiment.design) {
    const receipt=experiment.calls.find((call)=>call.provider==='openai' && call.status==='received');
    if(receipt)$('connection').textContent=`OpenAI response verified for this plan · ${receipt.model}`;
    $('plan-summary').textContent=experiment.design.summary;
    $('revision').textContent=`Source ${experiment.source.commitSha.slice(0,12)} · ${experiment.calls.length} model call(s) · ${experiment.previews.length} file(s) to instrument`;
    $('events').replaceChildren(...experiment.design.events.map((e)=>node('li',`${e.label} — ${e.reason}`)));
    $('questions').replaceChildren(...experiment.design.questions.map((q)=>node('li',q.label)));
    $('limitations').replaceChildren(...experiment.design.limitations.map((v)=>node('li',v)));
    $('patches').replaceChildren(...experiment.previews.map((file)=>{const section=node('section');section.append(node('h3',file.path));for(const change of file.changes)section.append(node('pre',`${change.placement}: ${change.eventId}\n${change.anchor}`));return section;}));
  }
  $('deployment-status').textContent=deployment ? `${deployment.status.replaceAll('_',' ')} — ${deployment.timeline.at(-1)?.message || ''}` : experiment.status.replaceAll('_',' ');
  $('links').replaceChildren(); $('results').hidden=deployment?.status!=='ready';
  if (deployment?.links) {
    for (const [label,url] of [['Open preview',deployment.links.website],['Private founder report',deployment.links.report]]) { const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener';$('links').append(a); }
    const p=node('p','Access credentials are in this private local file: ');p.className='fine';p.append(node('code',deployment.links.credentialsPath));$('links').append(p);
  }
  clearTimeout(poll);
  if (deployment && !['planned','ready','blocked','needs_input'].includes(deployment.status)) poll=setTimeout(()=>void load(experiment.id),5000);
}
async function load(id) {
  try { render(await api('experiments/'+id)); if(!$('results').hidden) await report(); }
  catch(error){$('deployment-status').textContent=error.message;}
}
$('brief').onsubmit=async(event)=>{
  event.preventDefault();if(busy)return;busy=true;$('plan-button').disabled=true;$('plan-status').textContent='Inspecting the pinned source and preparing tracking edits. This may take a minute…';
  const form=Object.fromEntries(new FormData(event.target));
  const input={requestKey:'exp-'+crypto.randomUUID(),repoUrl:form.repoUrl,name:form.name,hypothesis:form.hypothesis,audience:form.audience,ref:form.ref || 'HEAD',allowRepairs:form.allowRepairs==='on',refreshBuildPackages:form.refreshBuildPackages==='on',...(form.rootDirectory?{rootDirectory:form.rootDirectory}:{})};
  try{const experiment=await api('experiments',input);await load(experiment.id);$('plan-status').textContent=experiment.status==='planned'?'Plan ready. Review the changes before deploying.':'The agent returned a blocker. See the details.';await history();}
  catch(error){$('plan-status').textContent=error.message;}
  finally{busy=false;$('plan-button').disabled=!modelReady;}
};
$('deploy-button').onclick=async()=>{
  if(!current)return;$('deploy-button').disabled=true;
  try{render(await api('experiments/'+current.id+'/start',{planDigest:current.planDigest}));}
  catch(error){$('deployment-status').textContent=error.message;}
  finally{$('deploy-button').disabled=false;}
};
const filters=()=>({cohort:$('cohort').value,days:$('days').value});
async function report(){
  if(!current)return;const id=current.id,filter=filters();$('report-status').textContent='Loading saved activity and feedback…';
  try{
    const data=await api(`experiments/${id}/report?${new URLSearchParams(filter)}`);
    if(current.id!==id || JSON.stringify(filters())!==JSON.stringify(filter))return;
    $('metrics').replaceChildren(...[['Tracked sessions',data.sessions],['Primary actions',data.primaryActions],['Feedback responses',data.responses]].map(([label,value])=>{const el=node('div');el.className='metric';el.append(node('span',label),node('strong',value));return el;}));
    $('action-counts').replaceChildren(...(data.eventCounts || []).map((e)=>row(e.label,e.sessions)));
    $('funnel').replaceChildren(...(data.funnel || []).map((e)=>row(e.label,e.sessions)));
    $('answers').replaceChildren();for(const q of data.questionResults || []){$('answers').append(node('h3',q.label));for(const option of q.options || [])$('answers').append(row(option.label,option.count));for(const text of q.texts || [])$('answers').append(node('blockquote',text));}
    $('comments').replaceChildren(...data.comments.map((c)=>node('blockquote',c.comment)));
    $('report-status').textContent=`${data.verdict} · ${data.cohort} audience · updated ${new Date(data.generatedAt*1000).toLocaleString()}`;
    $('insights').replaceChildren();$('evidence').replaceChildren();$('analysis-status').textContent='';
    $('analyze').disabled=!modelReady || !(data.sessions || data.responses);
  }catch(error){$('report-status').textContent=error.message;}
}
$('refresh').onclick=report;$('cohort').onchange=report;$('days').onchange=report;
$('analyze').onclick=async()=>{
  if(!current)return;const id=current.id,filter=filters();$('analyze').disabled=true;$('analysis-status').textContent='Analyzing measured behavior and feedback with basic identifiers removed…';
  try{
    const insight=await api(`experiments/${id}/analyze`,filter);
    if(current.id!==id || JSON.stringify(filters())!==JSON.stringify(filter))return;
    $('insights').replaceChildren();$('evidence').replaceChildren();
    for(const [section,label]of [['observations','Observed'],['reported','Reported'],['suggestions','Suggested next tests']]){
      $('insights').append(node('h3',label));for(const item of insight[section] || []){$('insights').append(node('p',item.text));const refs=node('p','Evidence: '+item.evidenceIds.join(', '));refs.className='fine';$('insights').append(refs);}
    }
    for(const item of insight.evidence?.items || [])$('evidence').append(row(`${item.id} · ${item.label}`,String(item.value)));
    for(const text of insight.limitations || [])$('insights').append(node('p',text));
    $('analysis-status').textContent=insight.status==='no_evidence'?insight.message:insight.cached?'Showing saved analysis of unchanged evidence.':'Analysis saved. Suggestions are hypotheses, not proven causes.';
  }catch(error){$('analysis-status').textContent=error.message;}
  finally{$('analyze').disabled=!modelReady;}
};
try{const status=await api('status');modelReady=status.configured;$('connection').textContent=modelReady?`OpenAI configured · ${status.model}. Model access is verified on the first request.`:'One setup step remains: add OPENAI_API_KEY to the private .env file, then restart LaunchLab. The key stays on the server.';$('plan-button').disabled=!modelReady;await history();if(/^#exp_[a-f0-9]{20}$/.test(location.hash))await load(location.hash.slice(1));}
catch(error){$('connection').textContent=error.message;}
