'use strict';
const F=require('./cs16-front'),B=require('./cs16-buildings'),T=require('./cs16-terrain'),Combat=require('./cs16-combat');
const type=i=>i%50<46?'foot':i%50<48?'tank':i%50===48?'heli':'jet';
const maxHP={foot:100,tank:550,heli:340,jet:280},speed={foot:5,tank:8,heli:16,jet:30};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),validPos=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
function create({state,grid,emit,frame,hitHuman,respawn,finish,credit,wipe,radial,guided}){
 let epoch=0,g=null,units=[],sites=[],stage=0,capture=0,tickets=0,lastTick=0,nextStatus=0,flows=new Map(),shots=[],charges=[],chips=new Map();
 const attacking=()=>state.gm==='assault';
 const humans=()=>[...state.players.values()].filter(p=>p.team);
 const xyz=p=>[p.army?p.x:p.bot?p.bx:p.lx,p.army?p.y:p.ly,p.army?p.z:p.bot?p.bz:p.lz];
 const alive=(team)=>units.filter(u=>u.team===team&&u.alive).length;
 function objective(){const s=sites[Math.min(stage,sites.length-1)];if(!s)return null;
   return {...s,y:F.ruined(g,s.x,s.z)?T.height(g,s.x,s.z):s.y};
 }
 function status(){return {epoch,map:state.map,stage,tickets,capture,objective:attacking()?objective():null,army:!!state.army,counts:[alive('t'),alive('ct')]};}
 function snapshot(){return {...status(),ids:g?[...F.damage(g).original.keys()]:[],pilots:units.filter(u=>u.rider).map(u=>[u.rider.nick,u.id])};}
 function spawn(team,index=0){
   const s=objective(),side=team==='t'?1:-1;
   const [x,z]=F.openCell(g,s.x+(index%9-4)*3.5,s.z+side*(35+Math.floor(index%50/9)*3),index)||[s.x,s.z];
   return [x,T.walkHeight(g,x,z),z];
 }
 function deploy(u,now){
   const p=spawn(u.team,u.id%50);u.x=p[0];u.y=p[1];u.z=p[2];
   if(u.kind==='heli'||u.kind==='jet')u.y+=u.kind==='jet'?28:15;
   u.hp=maxHP[u.kind];u.alive=true;u.cqRespawnAt=0;u.roofStep=0;u.protectedUntil=now+1500;u.nextShot=now+800+(u.id*379)%2200;u.yaw=u.team==='t'?0:Math.PI;u.rider=null;u.input=null;
 }
 function reset(){
   if(g)F.reset(g);epoch++;g=grid();F.reset(g);flows.clear();chips.clear();charges=[];shots=[];stage=0;capture=0;tickets=100;
   sites=F.sectors(g,B.layout(g,state.map).buildings);units=[];lastTick=0;nextStatus=0;
   if(state.army)for(let id=0;id<100;id++){
     const u={id,kind:type(id),team:id<50?'t':'ct',nick:'🤖 Армия-'+(id+1),army:true,kills:0,money:0};
     deploy(u,state.freezeEnds||Date.now());units.push(u);
   }
   if(attacking()){state.roundEnds=state.freezeEnds+720000;state.buyUntil=state.roundEnds;}
   emit('cs16_front_reset',snapshot());
 }
 function clear(){if(g)F.reset(g);g=null;epoch++;units=[];sites=[];flows.clear();chips.clear();charges=[];shots=[];
   for(const p of state.players.values())p.frontSeat=null;emit('cs16_front_reset',snapshot());
 }
 function demolish(pos,r,exact=null){
   if(!g||state.phase!=='live'||!validPos(pos)||pos[1]>T.height(g,pos[0],pos[2])+13)return [];
   const ids=F.apply(g,exact||F.footprint(g,pos[0],pos[2],r)),w=g[0].length;
   for(const b of B.layout(g,state.map).buildings){
     if(!ids.length||Math.abs(b.x+6-pos[0])>r+12||Math.abs(b.z+6-pos[2])>r+12)continue;
     const x=Math.floor(b.x/4),z=Math.floor(b.z/4),floor=[];let supports=0;
     for(let j=0;j<3;j++)for(let i=0;i<3;i++){const id=(z+j)*w+x+i;floor.push(id);if((i!==1||j!==1)&&F.damage(g).original.has(id))supports++;}
     if(supports>=6)ids.push(...F.apply(g,floor));
   }
   if(ids.length){flows.clear();emit('cs16_front_break',{epoch,map:state.map,ids,pos});}return ids;
 }
 function damageArmy(u,n,by,now){
   if(!u.alive||now<u.protectedUntil||!by||by.team===u.team)return;
   u.hp=Math.max(0,u.hp-n);if(u.hp)return;
   u.alive=false;u.respawn=now+(u.kind==='foot'?6500:18000);
   if(u.rider){const rider=u.rider;leave(rider);if(rider.alive)hitHuman(by,rider,90);}
   if(attacking()&&u.team==='t')tickets=Math.max(0,tickets-1);
   if(!by.army)credit(by,u);
   if(u.kind!=='foot'){const pos=[u.x,u.y,u.z];demolish(pos,5);emit('cs16_front_fx',{pos,kind:'wreck'});}
   if(state.gm==='classic')wipe();
 }
 function blast(by,pos,r,now=Date.now()){
   if(!g||state.phase!=='live'||!validPos(pos)||!by?.team)return;
   demolish(pos,r);
   for(const u of units){const d=Math.hypot(u.x-pos[0],u.y+1-pos[1],u.z-pos[2]);if(d<r*1.8)damageArmy(u,Math.ceil((u.kind==='foot'?170:115)*(1-d/(r*1.8))),by,now);}
 }
 function requestCharge(p,dir,now=Date.now()){
   if(!g||state.phase!=='live'||!p?.team||!p.alive||p.frontSeat!=null||!validPos(dir)||Math.abs(Math.hypot(...dir)-1)>.03)return 'Нужен живой боец у стены.';
   if(now<(p.frontChargeAt||0))return 'Заряд перезаряжается.';
   const o=[p.lx,p.ly+1.5,p.lz],t=B.trace(g,state.map,o,dir,6);
   if(t>=5.9)return 'Подойди к двери или стене и наведи прицел.';
   const pos=o.map((v,i)=>v+dir[i]*t);p.frontChargeAt=now+20000;charges.push({p,pos,at:now+1600});emit('cs16_front_fx',{pos,kind:'charge'});return null;
 }
 function rayUnit(o,d,max,team){
   let best=null;for(const u of units){if(!u.alive||u.team===team)continue;
     const r=u.kind==='foot'?.46:u.kind==='tank'?2.1:2.6,h=u.kind==='foot'?1.8:u.kind==='tank'?2.4:2;
     const t=B.rayBox(o,d,{min:[u.x-r,u.y,u.z-r],max:[u.x+r,u.y+h,u.z+r]},max);
     if(t!==null&&t<max){best={u,t};max=t;}
   }return best;
 }
 function shoot(p,d,now=Date.now()){
   if(!g||!p.alive||!p.team||!validPos(d.origin)||!validPos(d.dir)||p.frontSeat!=null)return;
   const vehicle=['mgveh','tankgun'].includes(d.weapon)&&p.veh?.inside;
   if(!vehicle&&Math.hypot(d.origin[0]-p.lx,d.origin[1]-p.ly-1.5,d.origin[2]-p.lz)>2.6)return;
   if(vehicle&&(!validPos(p.veh.pos)||Math.hypot(...d.origin.map((v,i)=>v-p.veh.pos[i]))>9))return;
   if(!vehicle&&d.weapon!==p.weapon&&!['usp','glock','deagle','tec9','elite','fiveseven'].includes(d.weapon))return;
   const w=Combat.weapons[d.weapon];if(!w||Math.abs(Math.hypot(...d.dir)-1)>.04||now<(p.armyShotAt||0))return;
   p.armyShotAt=now+Math.max(35,60000/w.rpm*.82);
   const range=Math.min(200,Number.isFinite(d.distance)?d.distance+1:200),hit=rayUnit(d.origin,d.dir,range,p.team);
   const wall=B.trace(g,state.map,d.origin,d.dir,range);
   if(hit&&wall>=hit.t-.25){damageArmy(hit.u,w.dmg*(hit.u.kind==='foot'?1:.55),p,now);return;}
   if(wall>=range-.05||d.weapon==='knife')return;
   const pos=d.origin.map((v,i)=>v+d.dir[i]*(wall+.12)),id=F.key(g,pos[0],pos[2]);
   if(F.damage(g).original.has(id))return;
   const dmg=(chips.get(id)||0)+w.dmg;chips.set(id,dmg);
   if(dmg>=280){chips.delete(id);demolish(pos,0,[id]);}
 }
 function flow(x,z){
   const aim=F.openCell(g,x,z);if(!aim)return null;const w=g[0].length,start=F.key(g,...aim);
   if(flows.has(start))return flows.get(start);
   const dist=new Int16Array(g.length*w);dist.fill(-1);const q=new Int32Array(dist.length);let head=0,end=1;q[0]=start;dist[start]=0;
   while(head<end){const k=q[head++];for(const n of [k-1,k+1,k-w,k+w]){
     if(n<0||n>=dist.length||dist[n]!==-1||g[Math.floor(n/w)][n%w]!==0)continue;dist[n]=dist[k]+1;q[end++]=n;
   }}
   if(flows.size>=12)flows.clear();flows.set(start,dist);return dist;
 }
 function drive(u,goal,dt,now){
   const air=u.kind==='jet'||u.kind==='heli';
   if(air){
     const a=now*(u.kind==='jet'?.00024:.00014)+(u.team==='ct'?Math.PI:0),r=u.kind==='jet'?77:43;
     const x=clamp(goal.x+Math.cos(a)*r,9,g[0].length*4-9),z=clamp(goal.z+Math.sin(a)*r,9,g.length*4-9),dx=x-u.x,dz=z-u.z,l=Math.hypot(dx,dz)||1,k=Math.min(l,speed[u.kind]*dt)/l;
     u.x+=dx*k;u.z+=dz*k;u.y=Math.max(T.height(g,u.x,u.z)+12,(u.kind==='jet'?28:16)+Math.sin(a)*3);u.yaw=Math.atan2(-dx,-dz);return;
   }
   let dest;
   if(goal.y>5&&u.kind==='foot'&&Math.hypot(u.x-goal.x,u.z-goal.z)<20){
     const route=[[6,-2],[6,1],[9.7,1],[9.7,10.6],[11,10.3],[11,.7],[7,7]];
     const at=route[Math.min(u.roofStep,route.length-1)];dest=[goal.x-7+at[0],goal.z-7+at[1]];
     if(Math.hypot(u.x-dest[0],u.z-dest[1])<.65&&u.roofStep<route.length-1)u.roofStep++;
   }else{
     const d=flow(goal.x,goal.z),w=g[0].length,k=F.key(g,u.x,u.z);
     let n=k;for(const v of [k-w,k+1,k+w,k-1])if(d&&d[v]>=0&&(d[n]<0||d[v]<d[n]))n=v;
     dest=n===k?[goal.x,goal.z]:[(n%w)*4+2,Math.floor(n/w)*4+2];
     const radius=(goal.r||9)*.72;if(Math.hypot(u.x-goal.x,u.z-goal.z)<radius+2){
       const angle=u.id*2.39996,r=radius*(.35+.6*(u.id%11)/10);
       const x=goal.x+Math.cos(angle)*r,z=goal.z+Math.sin(angle)*r;
       if(g[Math.floor(z/4)]?.[Math.floor(x/4)]===0)dest=[x,z];
     }
   }
   const dx=dest[0]-u.x,dz=dest[1]-u.z,l=Math.hypot(dx,dz);if(l<.55)return;
   const m=Math.min(l,speed[u.kind]*dt)/l,[x,z]=B.collide(g,state.map,u.x+dx*m,u.z+dz*m,u.y,u.kind==='tank'?2:1.75,u.kind==='tank'?1:.35);
   if(g[Math.floor(z/4)]?.[Math.floor(x/4)]!==0||Math.hypot(x-u.x,z-u.z)<.16){if(now>(u.nextBreach||0)){u.nextBreach=now+24000;demolish([u.x+dx/l*2,u.y+1,u.z+dz/l*2],2.6);}return;}
   u.x=x;u.z=z;u.yaw=Math.atan2(-dx,-dz);const floor=B.vertical(g,state.map,x,z,u.y+.02).floor;u.y=Math.max(T.walkHeight(g,x,z),Number.isFinite(floor)?floor:-100);
 }
 function impact(by,pos,r){blast(by,pos,r);emit('cs16_front_fx',{kind:'impact',pos});radial(by,pos);}
 function aiFire(u,enemies,now){
   if(now<u.nextShot)return;u.nextShot=now+(u.kind==='foot'?2200:u.kind==='tank'?5400:4200)+(u.id*71)%850;
   let target,dist=u.kind==='foot'?47:110;
   for(const e of enemies){if(!e.alive||e.frontSeat!=null||e.team===u.team)continue;const [x,y,z]=xyz(e),l=Math.hypot(x-u.x,y-u.y,z-u.z);if(l<dist){dist=l;target=e;}}
   if(!target||dist<1)return;const o=[u.x,u.y+(u.kind==='tank'?2:1.45),u.z],v=xyz(target);v[1]+=.9;
   const dir=v.map((x,i)=>x-o[i]),len=Math.hypot(...dir);dir.forEach((x,i)=>dir[i]=x/len);
   const wall=B.trace(g,state.map,o,dir,len);
   if(guided&&(u.kind==='jet'||u.kind==='heli')){
     if(!guided(u,'ai',o,dir,now))u.nextShot=now+200;return;
   }
   if(u.kind==='foot'&&wall<len-.7)return;
   const end=o.map((x,i)=>x+dir[i]*wall);
   if(shots.length<28)shots.push([u.id,...end.map(Math.round)]);
   if(u.kind!=='foot'){impact(u,end,u.kind==='jet'?4:3);return;}
   if(target.army)damageArmy(target,15,u,now);else hitHuman(u,target,10);
 }
 function leave(p,bailout=false){
   const u=units[p.frontSeat];if(!u||u.rider!==p){p.frontSeat=null;return;}
   u.rider=null;u.input=null;p.frontSeat=null;
   let pos=F.openCell(g,u.x,u.z)||[u.x,u.z];
   if(bailout){
     const enemies=[...units,...humans()].filter(e=>e.alive&&e.team!==p.team);
     for(const r of [0,8,16,24]){
       let safe=false;for(let n=0;n<8;n++){
         const a=Math.PI*n/4,v=F.openCell(g,u.x+r*Math.cos(a),u.z+r*Math.sin(a));if(!v||B.contains(g,state.map,...v,1))continue;
         if(enemies.some(e=>{const [x,y,z]=xyz(e);return Math.abs(y)<6&&Math.hypot(x-v[0],z-v[1])<12;}))continue;
         pos=v;safe=true;break;
       }if(safe)break;
     }
     const now=Date.now();if(now>=(p.nextBailProtection||0)){p.cqProtectedUntil=now+1800;p.nextBailProtection=now+20000;}
   }
   p.lx=pos[0];p.lz=pos[1];p.ly=T.walkHeight(g,...pos);emit('cs16_front_seat',{nick:p.nick,id:null,pos:[p.lx,p.ly,p.lz]});
 }
 function board(p,kind){
   if(!p)return 'Сначала вступи в команду.';if(p.frontSeat!=null){leave(p,true);return;}
   if(!state.army||!p.alive||!p.team||p.veh?.inside||p.vehSeat||!['live','freeze'].includes(state.phase)||!['jet','heli'].includes(kind))return 'Авиация доступна живому бойцу при включённой армии.';
   const u=units.find(v=>v.kind===kind&&v.team===p.team&&!v.rider);if(!u)return 'Борт уже занят союзником.';
   if(!u.alive){
     const now=Date.now();if(now<(u.scrambleUntil||0))return 'Борт восстанавливается · '+Math.max(1,Math.ceil((u.respawn-now)/1000))+' с';
     deploy(u,now);u.scrambleUntil=now+45000;
   }
   u.rider=p;p.frontSeat=u.id;u.y=Math.max(u.y,16);p.lx=u.x;p.ly=u.y;p.lz=u.z;emit('cs16_front_seat',{nick:p.nick,id:u.id,kind,yaw:u.yaw,pos:[u.x,u.y,u.z]});
 }
 function control(p,input,now=Date.now()){
   const u=units[p?.frontSeat];if(!u||u.rider!==p||!p.alive||!input||now<(u.nextInput||0)||![input.yaw,input.pitch,input.forward,input.side,input.lift].every(Number.isFinite))return;
   u.nextInput=now+50;u.input={yaw:input.yaw,pitch:clamp(input.pitch,-1.4,1.4),forward:clamp(input.forward,-1,1),side:clamp(input.side,-1,1),lift:clamp(input.lift,-1,1),fire:input.fire===true,rocket:input.rocket===true,at:now};
 }
 function pilot(u,dt,now){
   const p=u.rider;if(!p.alive||state.players.size===0){leave(p);return;}
   const cmd=u.input&&now-u.input.at<550?u.input:{yaw:u.yaw,forward:0,side:0,lift:0,pitch:0};
   u.yaw=cmd.yaw;const f=u.kind==='jet'?20+11*cmd.forward:16*cmd.forward;
   u.x=clamp(u.x+(-Math.sin(u.yaw)*f+Math.cos(u.yaw)*cmd.side*8)*dt,5,g[0].length*4-5);
   u.z=clamp(u.z+(-Math.cos(u.yaw)*f-Math.sin(u.yaw)*cmd.side*8)*dt,5,g.length*4-5);
   u.y=clamp(u.y+cmd.lift*9*dt,12,68);p.lx=u.x;p.ly=u.y;p.lz=u.z;
   if(!cmd.fire||now<u.nextShot)return;u.nextShot=now+(cmd.rocket?2600:180);
   const cp=Math.cos(cmd.pitch),dir=[-Math.sin(u.yaw)*cp,Math.sin(cmd.pitch),-Math.cos(u.yaw)*cp],o=[u.x,u.y+1.5,u.z];
   if(cmd.rocket&&guided){guided(p,'front',o,dir,now);return;}
   let distance=B.trace(g,state.map,o,dir,180),victim=null;
   for(const e of [...units,...humans()]){if(!e.alive||e.frontSeat!=null||e.team===p.team)continue;const [x,y,z]=xyz(e),r=e.army&&e.kind!=='foot'?2:.55;
     const t=B.rayBox(o,dir,{min:[x-r,y,z-r],max:[x+r,y+2,z+r]},distance);if(t!==null&&t<distance){distance=t;victim=e;}}
   const end=o.map((v,i)=>v+dir[i]*distance);shots.push([u.id,...end.map(Math.round)]);
   if(cmd.rocket)impact(p,end,5);else if(victim?.army)damageArmy(victim,27,p,now);else if(victim)hitHuman(p,victim,27);
 }
 function lost(p,now=Date.now()){if(p.frontSeat!=null)leave(p);if(!attacking())return;
   if(!p.cqRespawnAt){p.cqRespawnAt=now+4500;if(p.team==='t')tickets=Math.max(0,tickets-1);}
 }
 function tick(now=Date.now()){
   if(!g||state.phase!=='live')return;
   const dt=clamp((now-lastTick)/1000,0,.35);lastTick=now;shots=[];
   const members=humans(),goal=objective();if(!goal)return;
   for(const c of charges.filter(c=>c.at<=now))impact(c.p,c.pos,4.5);charges=charges.filter(c=>c.at>now);
   const all=[...members,...units];
   for(const u of units){
     if(!u.alive){if(state.gm!=='classic'&&now>=u.respawn)deploy(u,now);continue;}
     if(u.rider){pilot(u,dt,now);continue;}
     const flags=state.gm==='cq'?state.cq?.flags:null;
     const dest=flags?.length?flags[u.id%flags.length]:goal;
     drive(u,dest,dt,now);aiFire(u,all,now);if(state.phase!=='live')return;
   }
   if(attacking()){
     for(const p of members)if(!p.alive){if(!p.cqRespawnAt)p.cqRespawnAt=now+4500;if(now>=p.cqRespawnAt)respawn(p,spawn(p.team,p.deaths||0),now);}
     const nearby=all.filter(p=>{if(!p.alive||p.army&&p.kind!=='foot'||p.frontSeat!=null)return false;const [x,y,z]=xyz(p);return Math.hypot(x-goal.x,z-goal.z)<=goal.r&&Math.abs(y-goal.y)<2.5;});
     if(nearby.some(p=>p.team==='t')){if(!nearby.some(p=>p.team==='ct'))capture+=dt;}
     else capture=Math.max(0,capture-dt*.3);
     if(capture>=8){stage++;capture=0;tickets=Math.min(100,tickets+25);flows.clear();if(stage===sites.length){finish('t');return;}emit('cs16_front_sector',{epoch,stage});}
     if(!tickets||now>=state.roundEnds){finish('ct');return;}
   }
   if(units.length)frame('cs16_front_frame',{epoch,rows:units.map(u=>[Math.round(u.x*10),Math.round(u.y*10),Math.round(u.z*10),Math.round(u.yaw*100),u.hp]),shots});
   if(now>=nextStatus){nextStatus=now+800;emit('cs16_front_status',status());}
 }
 return {reset,clear,spawn,snapshot,status,tick,alive,shoot,blast,demolish,board,control,leave,lost,requestCharge,rayUnit,units:()=>units};
}
module.exports={create,type,maxHP};
