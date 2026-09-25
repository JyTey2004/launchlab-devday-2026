import fs from 'node:fs';
export default async ({project}) => {
 const p=await project({dir:'/home/user/launchlab-edit',size:'1280x720',fps:24,background:'#0a0910'});
 const scenes=JSON.parse(fs.readFileSync('/home/user/input/narration.json','utf8'));
 const logo=await p.add('/home/user/input/logo.png');
 const notes=[
 ['Repository → experiment → evidence','A working prototype. Clear limits.','Built by Tey Jia Ye'],
 ['Public GitHub source','Vite • pinned commit 23eeae7','Goal: simulated checkout + feedback'],
 ['1   Pin the source and clarify the goal','2   Review proposed hooks and questions','3   Approve the exact plan before deployment'],
 ['Real AWS Amplify deployment','Consent-based measurement in the original app','Simulated checkout • no funds moved'],
 ['Feedback linked to the tested version','Real internal QA capture','Internal testing is not customer demand'],
 ['2   opted-in browser sessions','2   recorded checkout actions','1   saved test feedback response'],
 ['Nine authenticated HTTP / MCP tools','Deployment • activity • feedback • results','Public walkthrough: redacted snapshot'],
 ['OKX AI: registered; listing review rejected','Free task blocked by zero-fee funding error','X Layer: separate testnet x402 self-payment'],
 ['Repository → approval → deployment → evidence','Next: marketplace handoff and founder pilots','launchlab.stardive.xyz']
 ];
 let at=0;
 for(let i=0;i<scenes.length;i++){
  const s=scenes[i],dur=s.voiceSeconds+1.5;
  const voice=await p.add('/home/user/input/voice-'+i+'.aiff');p.cut(voice,{at:at+0.5,from:0,dur:s.voiceSeconds});
  const shot=s.screen?await p.add('/home/user/input/'+s.screen):null;
  p.compose(<frame width={1280} height={720} layout="none" background="#0a0910">
   <rect x={0} y={0} width={1280} height={6} fill="#bb80ff" />
   <media file={logo} x={50} y={33} width={38} height={38} fit="contain" />
   <text x={104} y={34} width={500} height={42} fontFamily="Montserrat" fontSize={24} fontWeight={600} color="#f7f3ff">launchlab.</text>
   <text x={50} y={101} width={1180} height={35} fontFamily="Montserrat" fontSize={16} letterSpacing={2} color="#be91ed">{s.kicker}</text>
   <text x={50} y={143} width={1180} height={105} fontFamily="Montserrat" fontSize={42} fontWeight={600} color="#f7f3ff">{s.title}</text>
   {shot ? <frame x={48} y={258} width={740} height={380} layout="none" background="#18131f" radius={16}>
      <media file={shot} x={10} y={10} width={720} height={360} fit="contain" />
    </frame> : <rect x={50} y={256} width={1180} height={360} fill="#171120" radius={18}/>}
   {notes[i].map((n,j)=><text x={shot?830:80} y={shot?280+j*112:287+j*105} width={shot?395:1100} height={90} fontFamily="Montserrat" fontSize={shot?24:33} lineHeight={1.2} color={j===0?'#f2b4db':'#ddd3e8'}>{n}</text>)}
   <text x={50} y={674} width={1050} height={24} fontFamily="Montserrat" fontSize={13} color="#91849d">{shot?'Real product capture • internal demonstration':'Verified scope and evidence • controlled prototype'} · OKX Dev Day 2026</text>
   <text x={1150} y={674} width={90} height={24} fontFamily="Montserrat" fontSize={13} color="#91849d">{String(i+1).padStart(2,'0')} / 09</text>
  </frame>,{at,dur,name:'Scene '+(i+1)});
  at+=dur;
 }
 await p.render('/home/user/launchlab-demo.mp4',{depth:8,bitrate:3000000,shards:4,concurrency:2});
 console.log(JSON.stringify({duration:at,output:'/home/user/launchlab-demo.mp4'}));
};
