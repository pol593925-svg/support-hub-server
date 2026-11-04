'use strict';
const F=require('./cs16-front'),B=require('./cs16-buildings'),T=require('./cs16-terrain'),Combat=require('./cs16-combat');
const type=i=>i%50<46?'foot':i%50<48?'tank':i%50===48?'heli':'jet';
const maxHP={foot:100,tank:550,heli:340,jet:280},speed={foot:5,tank:8,heli:19,jet:65};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),validPos=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
function create({state,grid,emit,frame,hitHuman,respawn,finish,credit,wipe,radial,guided}){
 let epoch=0,g=null,units=[],sites=[],stage=0,capture=0,tickets=0,lastTick=0,nextStatus=0,flows=new Map(),shots=[],charges=[],chips=new Map();
 let routes=[],bombUsed=false,falling=null,gold=null,flowBudget=0;
 const attacking=()=>state.gm==='assault';
 const humans=()=>[...state.players.values()].filter(p=>p.team);
 const xyz=p=>[p.army?p.x:p.bot?p.bx:p.lx,p.army?p.y:p.ly,p.army?p.z:p.bot?p.bz:p.lz];
 const alive=team=>state.army?units.filter(u=>u.team===team&&u.alive).length:0;
 const seatUnit=p=>p?.frontSeat!=null?units.find(u=>u.id===p.frontSeat):null;
 function objective(){const s=sites[Math.min(stage,sites.length-1)];if(!s)return null;
   return {...s,y:F.ruined(g,s.x,s.z)?T.height(g,s.x,s.z):s.y};
 }
 function status(){return {epoch,map:state.map,stage,tickets,capture,bombUsed,gold,objective:attacking()?objective():null,army:!!state.army,counts:[alive('t'),alive('ct')]};}
 function pack(){const rows=[];for(const u of units)rows[u.id]=[Math.round(u.x*10),Math.round(u.y*10),Math.round(u.z*10),Math.round(u.yaw*100),u.hp];return rows;}
 function snapshot(){return {...status(),rows:pack(),crater:g?F.damage(g).crater:null,ids:g?[...F.damage(g).original.keys()]:[],pilots:units.filter(u=>u.rider).map(u=>[u.rider.nick,u.id])};}
 function spawn(team,index=0){
   const s=objective(),side=team==='t'?1:-1;
   const [x,z]=F.openCell(g,s.x+(index%9-4)*3.5,s.z+side*(35+Math.floor(index%50/9)*3),index)||[s.x,s.z];
   return [x,T.walkHeight(g,x,z),z];
 }
 function routePoints(){
   const out=[];
   for (const rz of [.18,.49,.81]) for (const rx of [.18,.48,.81]) {
     const point=F.openCell(g,rx*g[0].length*4,rz*g.length*4,out.length);
     if(point)out.push({x:point[0],z:point[1],y:0,r:12});
   }
   return out;
 }
 function fieldSpawn(u){
   const n=u.id%50, row=(u.team==='t'?2:0), col=(n*7+Math.floor(n/5))%3;
   const sector=routes[(n%4===0?1:row)*3+col];
   if(!sector)return spawn(u.team,n);
   for(let i=0;i<16;i++){
     const a=(n*17+i*23+(u.deployments||0)*11)*2.4,r=5+(n*7+i*5)%33;
     const point=F.openCell(g,sector.x+Math.cos(a)*r,sector.z+Math.sin(a)*r,n+i);
     if(!point||B.contains(g,state.map,...point,1)||units.some(v=>v!==u&&v.alive&&Math.hypot(v.x-point[0],v.z-point[1])<3))continue;
     return [point[0],T.walkHeight(g,...point),point[1]];
   }
   return spawn(u.team,n);
 }
 function deploy(u,now){
   const p=fieldSpawn(u);u.deployments=(u.deployments||0)+1;u.prev=null;u.patrol=(u.id*7+u.deployments)%Math.max(1,routes.length);u.planUntil=0;u.x=p[0];u.y=p[1];u.z=p[2];
   if(u.kind==='heli'||u.kind==='jet')u.y+=u.kind==='jet'?28:15;
   u.hp=maxHP[u.kind];u.alive=true;u.cqRespawnAt=0;u.roofStep=0;u.protectedUntil=now+1500;u.nextShot=now+800+(u.id*379)%2200;u.yaw=u.team==='t'?0:Math.PI;u.rider=null;u.input=null;
 }
 function reset(){
   if(g)F.reset(g);epoch++;g=grid();F.reset(g);flows.clear();chips.clear();charges=[];shots=[];stage=0;capture=0;tickets=100;
   if(!(state.round>1))bombUsed=false;falling=null;gold=null;
   sites=F.sectors(g,B.layout(g,state.map).buildings);routes=state.army?routePoints():[];units=[];lastTick=0;nextStatus=0;
   if(state.army)for(let id=0;id<100;id++){
     const u={id,kind:type(id),team:id<50?'t':'ct',nick:'🤖 Армия-'+(id+1),army:true,kills:0,money:0};
     deploy(u,state.freezeEnds||Date.now());units.push(u);
   }
   if(attacking()){state.roundEnds=state.freezeEnds+720000;state.buyUntil=state.roundEnds;}
   emit('cs16_front_reset',snapshot());
 }
 function clear(){if(g)F.reset(g);g=null;epoch++;units=[];routes=[];falling=gold=null;bombUsed=false;sites=[];flows.clear();chips.clear();charges=[];shots=[];
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
   if(state.army&&!by.army)credit(by,u);
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
   const range=Math.min(d.weapon==='knife'?2.4:200,Number.isFinite(d.distance)?Math.max(0,d.distance)+3:200);
   let hit=rayUnit(d.origin,d.dir,range,p.team);
   // Rendering interpolates from the previous server frame. Accept its visible pose within this one tick.
   for(const u of units){if(!u.prev||!u.alive||u.team===p.team||Math.hypot(u.x-u.prev[0],u.z-u.prev[2])>8)continue;
     const [x,y,z]=u.prev,r=u.kind==='foot'?.46:u.kind==='tank'?2.1:2.6;
     const t=B.rayBox(d.origin,d.dir,{min:[x-r,y,z-r],max:[x+r,y+(u.kind==='foot'?1.8:2.4),z+r]},hit?.t??range);
     if(t!==null&&t<(hit?.t??range))hit={u,t};
   }
   const wall=B.trace(g,state.map,d.origin,d.dir,range);
   if(hit&&wall>=hit.t-.25){damageArmy(hit.u,w.dmg*(hit.u.kind==='foot'?1:.55)*(p.goldWeapon===d.weapon?1.35:1),p,now);emit('cs16_army_hit',{by:p.nick,id:hit.u.id,hp:Math.ceil(hit.u.hp)});return;}
   if(wall>=range-.05||d.weapon==='knife')return;
   const pos=d.origin.map((v,i)=>v+d.dir[i]*(wall+.12)),id=F.key(g,pos[0],pos[2]);
   if(F.damage(g).original.has(id))return;
   const dmg=(chips.get(id)||0)+w.dmg;chips.set(id,dmg);
   if(dmg>=280){chips.delete(id);demolish(pos,0,[id]);}
 }
 function flow(x,z){
   const aim=F.openCell(g,x,z);if(!aim)return null;const w=g[0].length,start=F.key(g,...aim);
   if(flows.has(start))return flows.get(start);
   if(flowBudget<=0)return null;flowBudget--;
   const dist=new Int16Array(g.length*w);dist.fill(-1);const q=new Int32Array(dist.length);let head=0,end=1;q[0]=start;dist[start]=0;
   while(head<end){const k=q[head++];for(const n of [k-1,k+1,k-w,k+w]){
     if(n<0||n>=dist.length||dist[n]!==-1||g[Math.floor(n/w)][n%w]!==0)continue;dist[n]=dist[k]+1;q[end++]=n;
   }}
   if(flows.size>=24)flows.delete(flows.keys().next().value);flows.set(start,dist);return dist;
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
     const order=[k-w,k+1,k+w,k-1];let n=k;
     for(let i=0;i<4;i++){const v=order[(i+u.id)%4];if(d&&d[v]>=0&&(d[n]<0||d[v]<d[n]))n=v;}
     dest=n===k?[goal.x,goal.z]:[(n%w)*4+2,Math.floor(n/w)*4+2];
     const radius=(goal.r||9)*.72;if(Math.hypot(u.x-goal.x,u.z-goal.z)<radius+2){
       const angle=u.id*2.39996,r=radius*(.35+.6*(u.id%11)/10);
       const x=goal.x+Math.cos(angle)*r,z=goal.z+Math.sin(angle)*r;
       if(g[Math.floor(z/4)]?.[Math.floor(x/4)]===0)dest=[x,z];
     }
   }
   const dx=dest[0]-u.x,dz=dest[1]-u.z,l=Math.hypot(dx,dz);if(l<.55)return;
   const m=Math.min(l,speed[u.kind]*(.85+(u.id%9)*.038)*dt)/l,[x,z]=B.collide(g,state.map,u.x+dx*m,u.z+dz*m,u.y,u.kind==='tank'?2:1.75,u.kind==='tank'?1:.35);
   if(g[Math.floor(z/4)]?.[Math.floor(x/4)]!==0||Math.hypot(x-u.x,z-u.z)<.16){if(now>(u.nextBreach||0)){u.nextBreach=now+24000;demolish([u.x+dx/l*2,u.y+1,u.z+dz/l*2],2.6);}return;}
   u.x=x;u.z=z;u.yaw=Math.atan2(-dx,-dz);const floor=B.vertical(g,state.map,x,z,u.y+.02).floor;u.y=Math.max(T.walkHeight(g,x,z),Number.isFinite(floor)?floor:-100);
 }
 function impact(by,pos,r){blast(by,pos,r);emit('cs16_front_fx',{kind:'impact',pos});radial(by,pos);}
 function aiFire(u,enemies,now){
   if(now<u.nextShot)return;u.nextShot=now+(u.kind==='foot'?2200:u.kind==='tank'?5400:4200)+(u.id*71)%850;
   const o=[u.x,u.y+(u.kind==='tank'?2:1.45),u.z],range=u.kind==='foot'?75:140;
   const candidates=[];
   for(const e of enemies){if(!e.alive||e.frontSeat!=null||e.team===u.team)continue;
     const [x,y,z]=xyz(e),dist=Math.hypot(x-o[0],y+.9-o[1],z-o[2]);
     if(dist>1&&dist<range)candidates.push({e,x,y,z,dist,priority:dist*(e.army||e.bot?1:.42)});
   }
   candidates.sort((a,b)=>a.priority-b.priority);
   let target,dir,len,wall;
   for(const t of candidates.slice(0,3)){
     len=t.dist;dir=[(t.x-o[0])/len,(t.y+.9-o[1])/len,(t.z-o[2])/len];wall=B.trace(g,state.map,o,dir,len);
     if(wall>=len-.7){target=t.e;break;}
   }
   if(!target)return;u.yaw=Math.atan2(-dir[0],-dir[2]);
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
   const u=seatUnit(p);if(!u||u.rider!==p){p.frontSeat=p.strikeJet=null;return;}
   u.rider=null;u.input=null;p.frontSeat=null;p.strikeJet=null;
   if(!state.army){units=units.filter(v=>v!==u);emit('cs16_front_frame',{epoch,rows:pack(),shots:[]});}
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
 function board(p,kind,purchase=false){
   if(!p)return 'Сначала вступи в команду.';if(p.frontSeat!=null){leave(p,true);return;}
   if(!g||!p.alive||!['t','ct'].includes(p.team)||p.veh?.inside||p.vehSeat||!['live','freeze'].includes(state.phase)||!['jet','heli'].includes(kind))return 'Авиация доступна живому бойцу своей команды.';
   if(!state.army&&(!purchase||kind!=='jet'||state.gm==='gg'))return 'Самолёт можно купить в магазине техники.';
   let u=units.find(v=>v.kind===kind&&v.team===p.team);
   if(!u&&!state.army){
     if(!validPos([p.lx,p.ly,p.lz]))return 'Дождись появления на карте.';
     const id=p.team==='t'?49:99;
     u={id,kind,team:p.team,army:true,nick:'Самолёт · '+p.nick,hp:maxHP.jet,alive:true,x:p.lx,z:p.lz,
       y:Math.max(p.ly,T.walkHeight(g,p.lx,p.lz))+28,yaw:p.team==='t'?0:Math.PI,nextShot:0,protectedUntil:0};
     units.push(u);
   }
   if(!u||u.rider)return 'Борт уже занят союзником.';
   if(!u.alive){
     const now=Date.now();if(now<(u.scrambleUntil||0))return 'Борт восстанавливается · '+Math.max(1,Math.ceil((u.respawn-now)/1000))+' с';
     deploy(u,now);u.scrambleUntil=now+45000;
   }
   u.rider=p;p.frontSeat=u.id;u.y=Math.max(u.y,16);p.lx=u.x;p.ly=u.y;p.lz=u.z;emit('cs16_front_seat',{nick:p.nick,id:u.id,kind,yaw:u.yaw,pos:[u.x,u.y,u.z]});
   if(!state.army)emit('cs16_front_frame',{epoch,rows:pack(),shots:[]});
 }
 function buyJet(p){
   if(!p||p.frontSeat!=null)return 'Сначала покинь текущий борт.';
   const error=board(p,'jet',true);if(error)return error;
   p.strikeJet=seatUnit(p);return null;
 }
 function dropBomb(p,now=Date.now()){
   const u=seatUnit(p);
   if(!g||state.phase!=='live'||!p?.alive||!u||u!==p.strikeJet||u.rider!==p||u.kind!=='jet')return 'Нужен купленный ударный самолёт.';
   if(bombUsed)return 'Ядерный заряд этого матча уже использован.';
   const x=clamp(u.x,30,g[0].length*4-30),z=clamp(u.z,30,g.length*4-30);
   bombUsed=true;falling={p,x,z,at:now+3000};emit('cs16_army_drop',{epoch,x,z,at:falling.at});return null;
 }
 function detonate(drop,now){
   const {p,x,z}=drop,c={x,z,r:28,depth:8};
   const y=T.height(g,x,z);F.setCrater(g,c);demolish([x,y,z],c.r);
   const pos=[x,T.height(g,x,z),z];gold={x,y:pos[1],z};
   emit('cs16_army_impact',{epoch,crater:c,gold,pos});
   for(const u of units){const d=Math.hypot(u.x-x,u.y-y,u.z-z);if(d<40&&u.alive)damageArmy(u,Math.ceil(920*(1-d/40)),p,now);}
   for(const other of humans()){const [px,py,pz]=xyz(other),d=Math.hypot(px-x,py-y,pz-z);if(other.alive&&other.frontSeat==null&&d<40)hitHuman(p,other,Math.ceil(250*(1-d/40)));}
 }
 function claim(p){
   if(!g||!gold||state.phase!=='live'||!p?.alive||!p.team||p.frontSeat!=null||p.veh?.inside||!validPos([p.lx,p.ly,p.lz])||Math.hypot(p.lx-gold.x,p.ly-gold.y,p.lz-gold.z)>4)return 'Подойди к золотому ящику в воронке.';
   gold=null;p.goldWeapon=p.weapon=p.team==='t'?'ak47':'m4a1';emit('cs16_army_loot',{epoch,nick:p.nick,weapon:p.weapon});return null;
 }
 function control(p,input,now=Date.now()){
   const u=seatUnit(p);if(!u||u.rider!==p||!p.alive||!input||now<(u.nextInput||0)||![input.yaw,input.pitch,input.forward,input.side,input.lift].every(Number.isFinite))return;
   u.nextInput=now+50;u.input={yaw:input.yaw,pitch:clamp(input.pitch,-1.4,1.4),forward:clamp(input.forward,-1,1),side:clamp(input.side,-1,1),lift:clamp(input.lift,-1,1),fire:input.fire===true,rocket:input.rocket===true,at:now};
 }
 function pilot(u,dt,now){
   const p=u.rider;if(!p.alive||state.players.size===0){leave(p);return;}
   const cmd=u.input&&now-u.input.at<550?u.input:{yaw:u.yaw,forward:0,side:0,lift:0,pitch:0};
   u.yaw=cmd.yaw;const f=u.kind==='jet'?76+30*cmd.forward:16*cmd.forward;
   u.x=clamp(u.x+(-Math.sin(u.yaw)*f+Math.cos(u.yaw)*cmd.side*8)*dt,5,g[0].length*4-5);
   u.z=clamp(u.z+(-Math.cos(u.yaw)*f-Math.sin(u.yaw)*cmd.side*8)*dt,5,g.length*4-5);
   u.y=clamp(u.y+cmd.lift*(u.kind==='jet'?24:12)*dt,12,90);p.lx=u.x;p.ly=u.y;p.lz=u.z;
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
   const all=[...members,...units];flowBudget=2;
   if(falling&&now>=falling.at){const drop=falling;falling=null;detonate(drop,now);if(state.phase!=='live')return;}
   for(const u of units){
     if(!u.alive){if(state.gm!=='classic'&&now>=u.respawn)deploy(u,now);continue;}
     if(u.rider){pilot(u,dt,now);continue;}
     const flags=state.gm==='cq'?state.cq?.flags:null;
     u.prev=[u.x,u.y,u.z];
     let dest=flags?.length?flags[u.id%flags.length]:goal;
     if(routes.length&&(!attacking()||u.id%3!==0)&&(!flags||u.id%3!==0)){
       if(!u.planUntil||now>=u.planUntil||Math.hypot(u.x-routes[u.patrol].x,u.z-routes[u.patrol].z)<7){
         u.patrol=(u.patrol+1+(u.id%5))%routes.length;u.planUntil=now+14000+(u.id*911)%17000;
       }
       dest=routes[u.patrol];
     }
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
   if(units.length)frame('cs16_front_frame',{epoch,rows:pack(),shots});
   if(now>=nextStatus){nextStatus=now+800;emit('cs16_front_status',status());}
 }
 return {reset,clear,spawn,snapshot,status,tick,alive,shoot,blast,demolish,board,control,leave,lost,requestCharge,rayUnit,buyJet,dropBomb,claim,units:()=>units};
}
module.exports={create,type,maxHP};
