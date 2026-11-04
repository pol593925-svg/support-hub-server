'use strict';
const M=require('./cs16-magic'),Characters=require('./cs16-characters'),B=require('./cs16-buildings');
function create({state,grid,emit,personal,damage,combat}){
 const at=p=>p.bot?[p.bx,p.ly||0,p.bz]:[p.lx,p.ly,p.lz],valid=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite),enemy=(p,q)=>q!==p&&q.alive&&q.team&&(state.gm==='gg'||q.team!==p.team);
 function visible(from,to){const delta=to.map((v,i)=>v-from[i]),dist=Math.hypot(...delta);return dist<.1||B.trace(grid(),state.map,from,delta.map(v=>v/dist),dist)>=dist-.35;}
 function snapshot(p,now=Date.now()){return {heroReady:p.heroReady||0,petReady:p.petReady||0,shield:(p.shieldUntil||0)>now?p.magicShield||0:0,shieldUntil:p.shieldUntil||0,slowUntil:p.slowUntil||0,speedUntil:p.speedUntil||0,now};}
 function sync(p,extra={}){personal(p,{...snapshot(p),...extra});}
 function absorb(p,amount,now=Date.now()){if(p.shieldUntil>now&&p.magicShield>0){const used=Math.min(amount,p.magicShield);p.magicShield-=used;amount-=used;sync(p);}return amount;}
 function reset(p){Object.assign(p,{heroReady:0,petReady:0,shieldUntil:0,magicShield:0,slowUntil:0,speedUntil:0});sync(p);}
 function cast(p,slot,dir,now=Date.now()){
  if(!p?.alive||!p.team||state.phase!=='live'||p.veh?.inside||p.vehSeat)return 'Способность доступна живому бойцу вне техники';
  if(!['hero','pet'].includes(slot)||!valid(dir)||Math.abs(Math.hypot(...dir)-1)>.02||!valid(at(p)))return 'Неверное направление';
  const hero=Characters.profiles[Characters.normalize(p.characterId)],id=slot==='hero'?hero.ability:p.petId,key=slot==='hero'?'heroReady':'petReady';
  if(slot==='pet'&&!M.petValid(id))return 'Сначала выбери питомца в лобби';if(p[key]>now)return 'Способность восстанавливается';
  const origin=at(p).map((v,i)=>v+(i===1?1.3:0));let point=origin.slice();const hits=[],affected=[];
  if(id==='wind'){const length=Math.hypot(dir[0],dir[2]);if(length<.1)return 'Посмотри вперёд';const d=[dir[0]/length,0,dir[2]/length],from=at(p);let dest=from.slice();for(let t=.2;t<=9;t+=.2){const q=from.map((v,i)=>v+d[i]*t),v=B.vertical(grid(),state.map,q[0],q[2],from[1]);const cx=Math.floor(q[0]/4),cz=Math.floor(q[2]/4),cell=grid()[cz]?.[cx];if(cell===undefined||![0,8,12].includes(cell)||v.floor>from[1]+.4)break;let blocked=false;for(const y of [.2,1,1.7])for(const side of [-.36,.36]){const rayOrigin=[from[0]+d[2]*side,from[1]+y,from[2]-d[0]*side];if(B.trace(grid(),state.map,rayOrigin,d,t+.4)<t+.4){blocked=true;break;}}if(blocked)break;dest=q;}if(Math.hypot(dest[0]-from[0],dest[2]-from[2])<.4)return 'Впереди препятствие';p.lx=dest[0];p.lz=dest[2];point=dest;sync(p,{teleport:dest});}
  else if(id==='flame'||id==='dragon'){const range=id==='flame'?36:28;let distance=B.trace(grid(),state.map,origin,dir,range);for(const q of state.players.values()){if(!enemy(p,q)||!valid(at(q)))continue;const v=at(q),hit=combat.playerHit(origin,dir,{x:v[0],y:v[1],z:v[2]},distance);if(hit)distance=Math.min(distance,hit.t);}point=origin.map((v,i)=>v+dir[i]*Math.max(0,distance-.12));const radius=id==='flame'?5:3,max=id==='flame'?85:50;for(const q of state.players.values()){if(!enemy(p,q)||!valid(at(q)))continue;const center=at(q).map((v,i)=>v+(i===1?1:0)),dist=Math.hypot(...center.map((v,i)=>v-point[i]));if(dist<radius&&visible(point,center))hits.push([q,Math.round(max*(1-dist/radius*.65))]);}}
  else if(id==='frost'){for(const q of state.players.values()){if(!enemy(p,q)||!valid(at(q)))continue;const target=at(q).map((v,i)=>v+(i===1?1.1:0)),delta=target.map((v,i)=>v-origin[i]),dist=Math.hypot(...delta);if(dist<12&&dist>.01&&delta.reduce((n,v,i)=>n+v*dir[i],0)/dist>.45&&visible(origin,target)&&!(q.cqProtectedUntil>now)){q.slowUntil=now+5000;hits.push([q,30]);affected.push(q);}}}
  else if(id==='stone'||id==='golem'){p.magicShield=Math.max(p.shieldUntil>now?p.magicShield||0:0,id==='stone'?100:60);p.shieldUntil=now+(id==='stone'?7000:5000);}
  else if(id==='light'||id==='deer'){for(const q of state.players.values()){if(!q.alive||!q.team||(q!==p&&(id==='deer'||state.gm==='gg'||q.team!==p.team))||!valid(at(q)))continue;const target=at(q).map((v,i)=>v+(i===1?1:0));if(Math.hypot(...target.map((v,i)=>v-origin[i]))<7&&visible(origin,target)){q.hp=Math.min(100,q.hp+(id==='light'?60:45));affected.push(q);}}}
  else if(id==='owl')p.speedUntil=now+6000;
  else if(id==='fox')sync(p,{reload:true});
  else return 'Способность не найдена';
  p[key]=now+(slot==='hero'?M.spells[id].cooldown:M.petCooldown);for(const[q,n]of hits)damage(p,q,n);for(const q of affected)sync(q,{hp:q.hp});sync(p,{hp:p.hp});emit('cs16_magic_fx',{by:p.nick,slot,id,origin,pos:point,now});return null;
 }
 return {cast,absorb,snapshot,reset,sync};
}
module.exports={create};
