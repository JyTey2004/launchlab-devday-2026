// LaunchLab — From code to learning. Native Higgsedit, 168 seconds.
// Product motion is an illustrated reconstruction; photographs and captures are labelled.
import fs from 'node:fs';
export default async ({project}) => {
 const base=process.env.LAUNCHLAB_FILM_DIR||'/home/user/launchlab-film';
 const p=await project({dir:base+'/project',size:'1920x1080',fps:24,background:'#0C0913'});
 const A={};for(const n of ['Geist-Regular.ttf','Geist-Medium.ttf','Geist-Semibold.ttf','founder.png','logo.png','tee.jpg','shorts.jpg','hoodie.jpg','store-desktop.png','feedback-desktop.png']) A[n]=await p.add(base+'/input/'+n);
 const C={night:'#0C0913',ink:'#211A31',paper:'#F8F7FC',card:'#FFFFFF',muted:'#746B82',line:'#E5DEED',purple:'#8052D5',lilac:'#CAADFF',pink:'#F4A4CF',green:'#418B75',soft:'#F0EAF9'};
 const ease=[.22,1,.36,1];
 const F=(x,y,w,h,n,o={})=><frame x={x} y={y} width={w} height={h} layout="none" {...o}>{n}</frame>;
 const R=(x,y,w,h,c=C.card,r=0,o={})=><rect x={x} y={y} width={w} height={h} fill={c} radius={r} {...o}/>;
 const T=(s,x,y,w,h,z=28,c=C.ink,weight=400,o={})=><text x={x} y={y} width={w} height={h} fontFamily="Geist" typography={{fontAssetId:A[weight>=600?'Geist-Semibold.ttf':weight>=500?'Geist-Medium.ttf':'Geist-Regular.ttf'].id}} fontSize={z} fontWeight={weight} color={c} lineHeight={1.17} letterSpacing={z>=45?-z*.035:0} {...o}>{s}</text>;
 const I=(n,x,y,w,h,o={})=><media file={A[n]} x={x} y={y} width={w} height={h} fit="cover" {...o}/>;
 const fade=(a,b,d=.45,at=0)=>({property:'opacity',from:a,to:b,duration:d,at,easing:'ease-out'});
 const enter=(delay=0,dx=0,dy=24)=>({at:delay,motion:{enter:{from:{x:dx,y:dy,opacity:0,scale:.985},duration:.7,easing:ease}}});
 const line=(x,y,w,c=C.line)=>R(x,y,w,1,c);
 const panel=(x,y,w,h,c=C.card)=>R(x,y,w,h,c,24,{strokeColor:C.line,strokeWidth:1,shadow:{x:0,y:18,blur:45,color:'#25144010'}});
 const label=(s,x,y,w=1200,c=C.purple)=>T(s.toUpperCase(),x,y,w,30,18,c,500,{letterSpacing:2.2});
 const pill=(s,x,y,w,c=C.purple,bg=C.soft)=>F(x,y,w,40,[R(0,0,w,40,bg,20),T(s,10,10,w-20,27,17,c,500,{align:'center'})]);
 const arrow=(x,y,w,at=0,c=C.purple)=>F(x,y,w,22,<path width={w} height={22} d={`M0 11 H${w-3} M${w-14} 2 L${w-3} 11 L${w-14} 20`} stroke={{color:c,width:2,cap:'round'}}/>,{at,reveal:{from:'left',duration:.6}});
 const cursor=(x,y,at=0)=>F(x,y,38,44,<path width={38} height={44} d="M2 2 L33 25 L21 28 L14 41 Z" fill="#FFFFFF" stroke={{color:C.ink,width:2}}/>,{at,animate:[{property:'offsetX',from:-170,to:0,duration:.8,easing:ease},{property:'offsetY',from:110,to:0,duration:.8,easing:ease},{property:'scale',keyframes:[{at:0,value:1},{at:1,value:1},{at:1.12,value:.78},{at:1.32,value:1}]}]});
 const lightBg=[R(0,0,1920,1080,C.paper),<path width={1920} height={1080} d="M1280 -200 L2100 70 V1080 L1550 980 L1110 270 Z" fill={{kind:'linear',angle:90,stops:[{offset:0,color:'#D9C7FF',opacity:.48},{offset:.6,color:'#F5CEE6',opacity:.32},{offset:1,color:'#FFFFFF',opacity:0}]}}/>];
 const darkBg=[R(0,0,1920,1080,C.night),R(400,-260,1750,1600,{kind:'radial',stops:[{offset:0,color:'#58308D',opacity:.46},{offset:.5,color:'#3A1F5C',opacity:.18},{offset:1,color:C.night,opacity:0}]})];
 const brand=(dark=false)=>[I('logo.png',76,45,43,43,{fit:'contain'}),T('launchlab.',133,47,400,46,32,dark?'#F8F3FF':C.ink,500)];
 const chrome=(index,kind='Illustrated workflow',dark=false)=>[...brand(dark),T(kind,1010,56,825,30,18,dark?'#BBAACD':C.muted,400,{align:'right'}),line(80,118,1760,dark?'#34233F':C.line),T('LAUNCHLAB  /  OKX DEV DAY 2026',80,1027,1220,28,16,dark?'#A591B9':C.muted,500,{letterSpacing:1.6}),T(index,1700,1027,140,28,18,dark?'#A591B9':C.muted,400,{align:'right'})];
 const scene=(at,dur,name,nodes,{dark=false,kind='Illustrated workflow',header=true}={})=>p.compose(F(0,0,1920,1080,[...(dark?darkBg:lightBg),...(header?chrome(String(at).padStart(3,'0'),kind,dark):[]),...nodes]),{at,dur,name});
 const head=(eyebrow,title,sub='')=>[label(eyebrow,80,165),T(title,80,214,1750,100,61,C.ink,500),...(sub?[T(sub,80,315,1750,55,27,C.muted)]:[])];
 const hero=(s,x,y,w,h,z=92,c='#FAF6FF',at=0)=>T(s,x,y,w,h,z,c,500,{motion:{by:'word',from:{opacity:0,y:22},at,duration:.6,overlap:.65,easing:'house'}});
 const assets=[['tee.jpg','Proof Training Tee','32 USDT'],['shorts.jpg','Rep Training Shorts','38 USDT'],['hoodie.jpg','Off-Duty Hoodie','64 USDT']];
 // ACT I — the difference between writing code and learning from use.
 scene(0,6,'A founder, a repository, a question',[
   F(0,0,1920,1080,I('founder.png',0,0,1920,1080),{origin:'center',animate:[{property:'scale',from:1,to:1.045,duration:6}]}),
   R(0,0,1920,1080,{kind:'linear',angle:90,stops:[{offset:0,color:C.night,opacity:.67},{offset:.65,color:C.night,opacity:.10},{offset:1,color:C.night,opacity:0}]}),
   ...brand(true),label('FOR THE NEXT WEB3 FOUNDER',90,289,1000,C.lilac),hero("A repo isn't\na launch.",85,370,1070,340,112),T('AI-generated founder illustration',80,1020,900,28,17,'#B7AFC0')
 ],{dark:true,header:false});
 scene(6,5,'The opening match cut',[
   label('AND THE WORK DOES NOT END AT DEPLOY',90,288,1600,C.lilac),hero("A launch isn't\nvalidation.",85,373,1730,320,119),F(90,737,1680,100,T('Someone has to try it. You have to learn why they stay—or leave.',0,0,1680,90,35,'#C7BAD5'),enter(1.5))
 ],{dark:true,header:false});
 scene(11,8,'Code activity becomes an unanswered product question',[
   ...head('The founder problem','Your code can work. Your idea still needs a test.'),
   ...[['Repository','Code committed'],['Deployment','Build succeeds'],['Validation','Would someone use it?']].map((v,i)=>F(80+i*600,425,560,362,[panel(0,0,560,362),label('0'+(i+1),30,33,490),T(v[0],30,116,498,73,45,C.ink,500),T(v[1],30,243,498,78,30,i===2?C.purple:C.muted)],enter(i*.6))),arrow(650,606,38,.8),arrow(1250,606,38,1.5),
   F(80,858,1760,85,T('The missing connection: deployment → behavior → feedback.',0,0,1760,75,36,C.ink,500,{align:'center'}),enter(3))
 ]);
 scene(19,6,'LaunchLab brand reveal',[
   I('logo.png',860,208,200,200,{fit:'contain'}),T('LaunchLab.',130,449,1660,155,124,'#FAF6FF',500,{align:'center',motion:{by:'word',from:{opacity:0,y:22},at:.3,duration:.6,overlap:.65,easing:'house'}}),T('From code to a testable product.',130,638,1660,85,44,C.lilac,400,{align:'center'}),F(420,811,1080,60,T('DEPLOY  /  OBSERVE  /  LEARN',0,0,1080,60,23,'#B4A3C6',500,{align:'center',letterSpacing:5}),enter(1.9))
 ],{dark:true,header:false});
 // ACT II — one concrete founder story, not a catalogue of features.
 scene(25,9,'Meet the use case: PROOF REPS',[
   ...head('01 / A founder with an idea','PROOF / REPS','A Web3 gymwear concept. One small storefront. One testable question.'),
   ...assets.map((a,i)=>F(80+i*600,403,560,538,[panel(0,0,560,538),F(14,14,532,386,I(a[0],0,0,532,386),{clip:true,radius:14}),T(a[1],27,430,505,47,30,C.ink,500),T(a[2]+' · demo pricing',27,487,505,30,20,C.muted)],enter(i*.45,0,60)))
 ],{kind:'Real demo assets · fictional products and prices'});
 scene(34,8,'Turn an idea into a hypothesis',[
   label('THE FIRST EXPERIMENT',88,209,1500,C.lilac),hero('Will people try\na crypto gymwear store?',82,302,1750,290,97),
   F(90,681,1740,153,[line(0,0,1740,'#42304E'),T('Observe',0,43,320,45,25,C.lilac,500),T('Complete a simulated checkout',380,43,1280,60,38,'#FAF6FF')],enter(1.7)),F(90,846,1740,78,[T('Ask',0,0,320,45,25,C.lilac,500),T('What would stop you from buying?',380,0,1280,70,38,'#FAF6FF')],enter(3))
 ],{dark:true,header:false});
 scene(42,12,'A repository and a goal start the workflow',[
   ...head('02 / Brief the agent','Start with your repository. Add the question.'),
   F(90,393,610,507,[label('FOUNDER → LAUNCHLAB',0,0,600),T('“Deploy my store.\nHelp me test the\ncheckout journey.”',0,72,610,253,48,C.ink,500),pill('Example founder request',0,396,305)],enter()),
   F(770,378,1060,569,[panel(0,0,1060,569),label('NEW EXPERIMENT',34,34,970),T('GitHub repository',34,103,970,38,23,C.muted),R(34,158,992,104,C.paper,12,{strokeColor:C.line,strokeWidth:1}),T('JyTey2004 /',57,180,940,36,26),T('launchlab-proof-reps-public-demo',57,219,940,37,26,C.purple,500),
     T('Validation goal',34,313,970,35,23,C.muted),F(34,369,988,90,T('Measure simulated checkout actions\nand collect voluntary feedback.',0,0,988,88,32),{at:1.6,reveal:{from:'left',duration:1.4}}),R(734,473,292,61,C.ink,12),T('Inspect repository',744,491,272,38,23,'#FFFFFF',500,{align:'center'}),cursor(960,500,4.2),
     F(0,0,1060,569,[panel(0,0,1060,569),pill('Repository inspected',333,84,393,C.green,'#E9F4EF'),T('A reproducible starting point.',65,199,930,137,51,C.ink,500,{align:'center'}),T('Public source  ·  Vite  ·  commit 23eeae7',65,374,930,68,29,C.muted,400,{align:'center'})],{at:6.3,animate:[fade(0,1,.4)]})
   ],enter(.5,100,0))
 ]);
 scene(54,9,'Detect the framework and preserve the tested version',[
   ...head('03 / Know what is being shipped','One version. One measurement plan.'),
   F(80,389,775,535,[panel(0,0,775,535),label('INSPECTED SOURCE',32,32,710),T('PROOF / REPS',32,102,710,70,48,C.ink,500),...['Framework     Vite','Build output   dist/','Source pinned  23eeae7','Scope          Static frontend'].map((s,i)=>F(32,227+i*70,708,55,T(s,0,0,708,51,28,i===2?C.purple:C.muted),enter(.3+i*.35)))],enter()),
   arrow(884,640,110,1.4),F(1030,389,810,535,[panel(0,0,810,535),label('BOUNDED GPT PLAN',32,32,740),T('Add what the\nexperiment needs.',32,105,744,154,48,C.ink,500),T('Consent-based activity tracking\nA checkout completion event\nA short feedback form',32,309,744,158,30,C.muted)],enter(1.2,100,0))
 ]);
 scene(63,12,'Human approval precedes changes and deployment',[
   ...head('04 / Approve before the agent edits','You control the experiment.'),
   F(80,390,1760,565,[panel(0,0,1760,565),label('PROPOSED CHANGES',32,30),pill('Awaiting approval',1440,24,280),
   ...[['Measure','Checkout completion, with consent'],['Ask','What would stop you from buying?'],['Protect','Keep the original GitHub repository unchanged']].map((r,i)=>F(32,130+i*99,1694,86,[T(r[0],0,3,310,45,26,C.muted),T(r[1],341,0,1330,75,33,C.ink,500),line(0,78,1694)],enter(.4+i*.5))),
   T('Changes are applied to an isolated source copy.',33,473,1140,60,26,C.muted),R(1290,459,430,70,C.purple,12),T('Approve this plan',1305,482,400,42,29,'#FFFFFF',500,{align:'center'}),cursor(1640,492,4.3),
   F(0,0,1760,565,[panel(0,0,1760,565),pill('Plan approved',672,84,416,C.green,'#E9F4EF'),T('Instrument the approved version.',80,200,1600,127,69,C.ink,500,{align:'center'}),T('Tracking hooks + feedback form → ready to build',80,377,1600,73,32,C.muted,400,{align:'center'})],{at:6.3,animate:[fade(0,1,.4)]})
   ],enter())
 ]);
 scene(75,8,'Build and publish pipeline advances',[
   ...head('05 / Give the experiment a home','From approved source to a live URL.'),
   ...[['01','Source copy','Approved instrumentation'],['02','CodeBuild','Isolated build'],['03','Amplify','Hosted preview']].map((v,i)=>F(80+i*600,429,560,365,[panel(0,0,560,365),pill(v[0],29,29,72),T(v[1],30,122,500,76,45,C.ink,500),T(v[2],30,249,500,60,27,C.muted),F(29,328,500,4,R(0,0,500,4,C.purple,2),{at:.6+i*1.4,reveal:{from:'left',duration:1.1}})],enter(i*.65))),arrow(650,612,38,.8),arrow(1250,612,38,2),F(160,867,1600,70,T('The founder gets a link that people can actually try.',0,0,1600,66,34,C.ink,500,{align:'center'}),enter(4))
 ]);
 // ACT III — real product screens, then honest internal evidence.
 scene(83,10,'Reveal the real deployed storefront',[
   ...head('06 / The product is online','A real store. Ready for a test.'),
   F(80,379,1212,578,[panel(0,0,1212,578,C.night),F(12,12,1188,554,I('store-desktop.png',0,0,1188,1092),{clip:true,radius:14,animate:[]})],enter()),
   F(80,379,1212,578,F(12,12,1188,554,I('store-desktop.png',0,0,1188,1092,{animate:[{property:'offsetY',from:0,to:-493,at:2,duration:6,easing:'ease-in-out'}]}),{clip:true,radius:14}),{}),
   F(1350,420,490,480,[pill('AWS Amplify',0,0,238),T('Browse.\nChoose a size.\nTry checkout.',0,90,490,235,47,C.ink,500),T('Simulated checkout.\nNo funds move.\nNo order is placed.',0,358,490,119,27,C.muted)],enter(.8))
 ],{kind:'Actual deployed store capture · internal demonstration'});
 scene(93,10,'A close view of the visitor journey',[
   ...head('THE VISITOR JOURNEY','A small action becomes useful evidence.'),
   F(80,390,572,547,[panel(0,0,572,547),I('tee.jpg',16,16,540,366),T('Proof Training Tee',30,406,512,47,31,C.ink,500),T('32 USDT · demo product',30,475,512,35,21,C.muted)],enter()),
   F(716,411,1118,504,[label('INSTRUMENTED FLOW',0,0,1110),...['Opt in to usage measurement','Add an item and try demo checkout','Record the completed action'].map((s,i)=>F(0,89+i*124,1118,99,[R(0,0,1118,99,i===2?C.soft:'#FFFFFF',15),pill(String(i+1),19,28,56),T(s,103,32,985,64,31,C.ink,500)],enter(.5+i*1.15))),T('Repeat actions are counted separately from browser sessions.',0,474,1118,70,24,C.muted)],{})
 ],{kind:'Illustrated visitor journey · simulated checkout'});
 scene(103,11,'Ask what the clicks cannot explain',[
   ...head('07 / Listen to the person behind the visit','Clicks tell you what. Feedback helps explain why.'),
   F(80,390,945,540,[label('QUESTIONS IN THE ACTUAL FORM',0,0,900),T('Would you consider using this?\n\nWhat was your main hesitation?\n\nWhich checkout method\nwould you prefer?',0,69,910,328,35,C.ink,500),T('Feedback is voluntary and tied to the tested version.',0,443,902,72,26,C.muted)],enter()),
   F(1090,373,620,587,[panel(0,0,620,587,C.night),F(12,12,596,563,I('feedback-desktop.png',-596,-44,1788,1644,{animate:[{property:'offsetY',from:0,to:-465,at:2,duration:6,easing:'ease-in-out'}]}),{clip:true,radius:16})],enter(.6,90,0))
 ],{kind:'Actual feedback-form capture · internal QA response'});
 scene(114,13,'Recorded results with the data quality boundary visible',[
   ...head('08 / Read the evidence','What happened—and what it can tell you.','Recorded internal-test snapshot · 25 September 2026'),
   ...[['2','Browser sessions','Not verified unique people'],['2+','Checkout actions','Earlier repeats unavailable'],['1','Saved response','Internal QA feedback']].map((v,i)=>F(80+i*600,423,560,321,[panel(0,0,560,321),T(v[0],30,23,500,139,103,C.purple,500),T(v[1],30,179,500,52,33,C.ink,500),T(v[2],30,260,500,37,22,C.muted)],enter(i*.5))),
   F(80,795,1760,157,[R(0,0,1760,157,C.ink,20),T('Collection verified.',34,28,1690,57,40,'#FAF6FF',500),T('Customer demand is still unproven. The next step is testing with intended users.',34,95,1690,48,27,'#D1C3DF')],enter(2.6))
 ],{kind:'Verified internal-test data · editorial visualization'});
 scene(127,10,'Return the evidence to the founder or their agent',[
   ...head('09 / Close the loop','Results for you. Results your agent can retrieve.'),
   F(80,391,640,558,[label('FOUNDER OR CALLING AGENT',0,0,630),T('“What did we\nlearn from\nPROOF / REPS?”',0,74,635,278,51,C.ink,500),pill('Authenticated HTTP / MCP',0,450,372)],enter()),arrow(744,642,76,1.6),
   F(857,384,983,568,[panel(0,0,983,568),label('EXPERIMENT RESULT',31,32,920),T('Deployment ready',31,101,920,61,43,C.ink,500),line(31,186,921),...['Preview link + pinned source version','Activity totals + voluntary feedback','Data-quality notes + dashboard link'].map((s,i)=>F(31,231+i*84,921,66,T(s,0,0,921,64,30,C.muted),enter(1+i*.6))),pill('9 authenticated service tools',31,493,408)],enter(.7,100,0))
 ],{kind:'Illustrated service response · HTTP / MCP implemented'});
 scene(137,8,'The repeatable experiment pattern',[
   ...head('ONE LOOP. DIFFERENT QUESTIONS.','Give more Web3 ideas a useful first test.'),
   ...[['Community merch','Will people try the checkout?'],['Wallet onboarding','Where do first-time users hesitate?'],['Membership landing page','What makes someone want to join?']].map((v,i)=>F(80+i*600,420,560,389,[panel(0,0,560,389),label('EXPERIMENT 0'+(i+1),29,32,505),T(v[0],29,124,500,111,41,C.ink,500),T(v[1],29,259,500,105,30,C.muted)],enter(i*.45))),T('Additional use cases illustrate the same testing model; only PROOF / REPS is demonstrated here.',80,884,1760,68,25,C.muted,400,{align:'center'})
 ],{kind:'Example use cases · not additional customer deployments'});
 scene(145,13,'Why OKX AI and X Layer, with implementation scope',[
   ...head('WHY OKX AI + X LAYER','A service agents can discover, request and pay for.'),
   F(80,390,855,563,[panel(0,0,855,563),label('OKX AI / DISTRIBUTION',32,33,790),T('Agent marketplace\nentry point',32,106,790,143,48,C.ink,500),T('Registered LaunchLab provider.\nHosted service is running.',32,292,790,95,30,C.muted),R(32,420,791,110,'#F7EEF3',12),T('Listing review rejected. Marketplace\nrequest → returned result remains unverified.',51,443,750,76,25,'#8F476B')],enter()),
   F(975,390,865,563,[panel(0,0,865,563),label('X LAYER / PAYMENT RAIL',32,33,801),T('Pay-per-use\nservice access',32,106,801,143,48,C.ink,500),T('0.01 test USDT0 payment verified\non X Layer testnet via x402.',32,292,801,95,30,C.muted),R(32,420,801,110,'#EDF4F1',12),T('Separate readiness-endpoint self-test.\nNot deployment billing or user rewards.',51,443,760,76,25,C.green)],enter(.7))
 ],{kind:'Integration status · 25 September 2026'});
 scene(158,10,'LaunchLab: ship, observe, learn',[
   I('logo.png',94,100,78,78,{fit:'contain'}),T('launchlab.',195,113,1350,74,53,'#FAF6FF',500),hero('Ship something\npeople can try.',89,283,1730,266,108),F(90,612,1700,92,T('Learn what to build next.',0,0,1700,82,51,C.lilac),enter(1.4)),T('Explore the working demo + source',94,796,1700,48,29,'#D2C3E0'),T('jytey2004.github.io/launchlab-devday-2026',94,861,1700,47,30,'#FAF6FF',500),T('Tey Jia Ye  /  Build a Company  /  OKX Dev Day 2026',94,944,1700,32,20,'#AB96BE'),T('Music: “Tears In Rain” — Scott Buckley · CC BY 4.0 · Edited excerpt\nscottbuckley.com.au · creativecommons.org/licenses/by/4.0',94,991,1700,65,17,'#AB96BE')
 ],{dark:true,header:false});
 const times=[3,8.8,16.5,22,29.5,39,49.2,59,68,71,80,87,91,99,108,112,120,133,141,152,163];
 fs.mkdirSync(base+'/frames',{recursive:true});
 for(let i=0;i<times.length;i++) await p.frame(times[i],base+'/frames/'+String(i).padStart(2,'0')+'.png');
 fs.writeFileSync(base+'/frame-times.json',JSON.stringify(times));
 if(process.env.LAUNCHLAB_RENDER==='1') await p.render(base+'/silent.mp4',{depth:8,bitrate:6500000,shards:8,concurrency:2});
 console.log(JSON.stringify({duration:168,frames:times.length,project:base+'/project',render:process.env.LAUNCHLAB_RENDER==='1'}));
};
