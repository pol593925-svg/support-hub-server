'use strict';
function makeFlags(grid){const h=grid.length,w=grid[0].length,used=[];return [[.28,.24],[.72,.24],[.5,.5],[.28,.76],[.72,.76]].map(([fx,fz],i)=>{
 let best=null,score=Infinity;for(let z=2;z<h-2;z++)for(let x=2;x<w-2;x++){if(grid[z][x]!==0||used.some(p=>Math.hypot(p.x-x*4-2,p.z-z*4-2)<35))continue;let open=0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(grid[z+dz][x+dx]===0)open++;const d=(x-w*fx)**2+(z-h*fz)**2+(9-open)*5;if(d<score){score=d;best={id:i,label:'ABCDE'[i],x:x*4+2,z:z*4+2,owner:null,capturing:null,progress:0,contested:false};}}
 if(!best)throw Error('Cannot place conquest flag');used.push(best);return best;});}
function create({state,grid,emit,personal,spawn,finish,blast,reward=()=>{}}){
 let lastTick=0,nextIncome=0,shots=[],serial=0;
 const sid=p=>[...state.players].find(([,v])=>v===p)?.[0];
 function start(now){state.scores={t:0,ct:0};state.winner=null;state.cq={flags:makeFlags(grid()),limit:50};state.roundEnds=state.freezeEnds+600000;state.buyUntil=state.roundEnds;lastTick=state.freezeEnds;nextIncome=state.freezeEnds+10000;shots=[];
  for(const p of state.players.values()){p.cqSpawn=null;p.cqStats={captures:0,defenses:0,vehicles:0,vehicleKills:0,teamwork:0};p.cqRespawnAt=0;p.cqProtectedUntil=state.freezeEnds+1800;p.artilleryUntil=0;p.kills=0;p.deaths=0;p.money=5000;p.armor=100;p.weapon=p.team==='t'?'ak47':'m4a1';}
 }
 function winner(){return state.scores.t===state.scores.ct?'draw':state.scores.t>state.scores.ct?'t':'ct';}
 function killed(attacker,target,now=Date.now(),weapon){
  if(state.gm!=='cq'||state.phase!=='live'||target.cqRespawnAt)return;
  target.cqRespawnAt=now+4000;target.cqProtectedUntil=0;
  if(attacker&&attacker!==target&&attacker.team&&attacker.team!==target.team){state.scores[attacker.team]++;
    const stats=attacker.cqStats||(attacker.cqStats={captures:0,defenses:0,vehicles:0,vehicleKills:0,teamwork:0});
    if(['mgveh','tankgun','tank','heli'].includes(weapon))stats.vehicleKills++;
    if(state.cq.flags.some(f=>f.owner===attacker.team&&Math.hypot((target.bot?target.bx:target.lx)-f.x,(target.bot?target.bz:target.lz)-f.z)<16)){stats.defenses++;stats.teamwork+=5;reward(attacker);}
    if(state.scores[attacker.team]>=50)finish(attacker.team);}
 }
 function safeFlag(p,id){const f=state.cq?.flags.find(f=>f.id===id);if(!f||f.owner!==p.team||f.contested)return null;
  if([...state.players.values()].some(e=>e.alive&&e.team&&e.team!==p.team&&Math.abs(e.ly||0)<3&&Math.hypot((e.bot?e.bx:e.lx)-f.x,(e.bot?e.bz:e.lz)-f.z)<22))return null;return f;
 }
 function chooseSpawn(p,id){if(state.gm!=='cq'||state.phase!=='live'||!p?.team||p.alive)return 'Точка выбирается после гибели.';if(id!==null&&!safeFlag(p,id))return 'Флаг недоступен: потерян или рядом противник.';p.cqSpawn=id;personal(sid(p));return null;}
 function spawnPosition(p,index){const f=safeFlag(p,p.cqSpawn);if(f){const g=grid(),cx=Math.floor(f.x/4),cz=Math.floor(f.z/4);const candidates=[];for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++)if(g[cz+dz]?.[cx+dx]===0&&![...state.players.values()].some(e=>e.alive&&e.team&&e.team!==p.team&&Math.abs(e.ly||0)<3&&Math.hypot((e.bot?e.bx:e.lx)-((cx+dx)*4+2),(e.bot?e.bz:e.lz)-((cz+dz)*4+2))<16))candidates.push([(cx+dx)*4+2,0,(cz+dz)*4+2]);if(candidates.length)return candidates[index%candidates.length];}const pos=spawn(p.team,index,0);return [pos[0],0,pos[2]];}
 function respawn(p,now){const index=[...state.players.values()].filter(v=>v.team===p.team).indexOf(p),pos=spawnPosition(p,Math.max(0,index));
  p.alive=true;p.hp=100;p.armor=100;p.weapon=p.team==='t'?'ak47':'m4a1';p.kit=false;p.cqRespawnAt=0;p.cqProtectedUntil=now+1800;p.vehSeat=null;
  if(p.veh){emit('cs16_vehdie',{by:p.nick,kind:p.veh.kind,pos:p.veh.pos||pos});p.veh=null;}
  p.lx=p.bx=pos[0];p.ly=0;p.lz=p.bz=pos[2];personal(sid(p));emit('cs16_cq_respawn',{nick:p.nick,pos,weapon:p.weapon,protectedUntil:p.cqProtectedUntil});
 }
 function tick(now=Date.now()){
  if(state.gm!=='cq'||state.phase!=='live'||!state.cq)return;
  if(now>=state.roundEnds){finish(winner());return;}
  const dt=Math.max(0,Math.min(1.5,(now-lastTick)/1000));lastTick=now;
  for(const p of state.players.values())if(p.team&&!p.alive){if(!p.cqRespawnAt)p.cqRespawnAt=now+4000;if(now>=p.cqRespawnAt)respawn(p,now);}
  for(const f of state.cq.flags){const nearby=[...state.players.values()].filter(p=>p.alive&&p.team&&Math.abs(p.bot?0:p.ly||0)<3&&Math.hypot((p.bot?p.bx:p.lx)-f.x,(p.bot?p.bz:p.lz)-f.z)<=10);const teams=new Set(nearby.map(p=>p.team));f.contested=teams.size>1;
   if(teams.size!==1){if(!teams.size){f.progress=Math.max(0,f.progress-dt);if(!f.progress)f.capturing=null;}continue;}
   const team=[...teams][0];if(f.owner===team){f.progress=0;f.capturing=null;continue;}if(f.capturing!==team){f.capturing=team;f.progress=0;}f.progress=Math.min(8,f.progress+dt);
   if(f.progress>=8){f.owner=team;f.progress=0;f.capturing=null;for(const p of nearby){p.money=Math.min(16000,p.money+750);if(!p.cqStats)p.cqStats={captures:0,defenses:0,vehicles:0,vehicleKills:0,teamwork:0};p.cqStats.captures++;p.cqStats.teamwork+=5;reward(p);personal(sid(p));}emit('cs16_cq_flag',{label:f.label,owner:team,reward:750});}
  }
  if(now>=nextIncome){nextIncome=now+10000;for(const p of state.players.values())if(p.team){const flags=state.cq.flags.filter(f=>f.owner===p.team).length;p.money=Math.min(16000,p.money+150+flags*50);personal(sid(p));}}
  const ready=shots.filter(s=>s.at<=now);shots=shots.filter(s=>s.at>now);
  for(const shot of ready){if(state.phase!=='live')break;emit('cs16_artillery_impact',{pos:shot.pos,by:shot.by});const attacker=[...state.players.values()].find(p=>p.nick===shot.by);if(attacker)blast(attacker,shot.pos);}
 }
 function artillery(p,d,now=Date.now()){
  if(state.gm!=='cq'||state.phase!=='live'||!p?.alive||!p.team)return 'Артобстрел доступен в режиме «Захват» живому игроку.';
  const g=grid(),x=d?.x,z=d?.z;if(!Number.isFinite(x)||!Number.isFinite(z)||x<4||z<4||x>g[0].length*4-4||z>g.length*4-4)return 'Выбери сектор внутри карты.';
  if(p.money<2000)return 'Для артобстрела нужно $2000.';if(now<(p.artilleryUntil||0))return 'Артобстрел перезаряжается (30 секунд).';
  p.money-=2000;p.artilleryUntil=now+30000;personal(sid(p));const plan=[];
  for(let i=0;i<12;i++){const a=i*2.399963,r=i?Math.sqrt(i/11)*18:0,sx=Math.max(2,Math.min(g[0].length*4-2,x+Math.cos(a)*r)),sz=Math.max(2,Math.min(g.length*4-2,z+Math.sin(a)*r)),c=g[Math.floor(sz/4)][Math.floor(sx/4)],y=c===1?4:c===2?2.6:c===3?1.15:c===11?4.2:0;plan.push({pos:[sx,y+.15,sz],at:now+2500+i*350,by:p.nick});}
  shots.push(...plan);emit('cs16_artillery',{id:++serial,by:p.nick,team:p.team,x,z,radius:18,startsAt:now+2500,shots:plan});return null;
 }
 return {start,tick,killed,artillery,chooseSpawn,safeFlag};
}
module.exports={create,makeFlags};
