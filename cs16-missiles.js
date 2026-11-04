'use strict';
const Buildings=require('./cs16-buildings'),Vehicles=require('./cs16-vehicles');
const LOCK_MS=800,cosCone=Math.cos(9*Math.PI/180);
const valid=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const norm=v=>{const n=Math.hypot(...v);return n>1e-6?v.map(x=>x/n):null;};
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
function create({state,grid,army,emit,frame,impact}){
 let missiles=[],pending=[],serial=0,last=0,nextFrame=0,locks=new WeakMap();
 function targets(by){
   const list=[],add=(id,name,pos,r,h)=>{if(valid(pos))list.push({id,name,pos,r,h});};
   for(const [id,p] of state.players){
     if(p===by||!p.team||p.team===by.team)continue;
     if(p.veh?.pos&&p.veh.hp>0)add('v'+id,'Техника · '+p.nick,p.veh.pos,2.0,2.5);
     if(p.alive&&p.frontSeat==null&&!p.veh?.inside&&!p.vehSeat)add('p'+id,p.nick,[p.bot?p.bx:p.lx,p.ly,p.bot?p.bz:p.lz],.42,1.8);
   }
   for(const u of army())if(u.alive&&u.team!==by.team)add('a'+u.id,{foot:'Боец',tank:'Танк',heli:'Вертолёт',jet:'Самолёт'}[u.kind],[u.x,u.y,u.z],u.kind==='foot'?.46:u.kind==='tank'?2:2.6,u.kind==='foot'?1.8:2.2);
   return list;
 }
 const center=t=>[t.pos[0],t.pos[1]+t.h*.55,t.pos[2]];
 function source(p,kind){
   if(!p?.alive||!p.team||state.phase!=='live')return null;
   let v;if(kind==='rpg'&&p.rpgAmmo>0&&!p.veh?.inside&&!p.vehSeat&&p.frontSeat==null)v=[p.lx,p.ly+1.5,p.lz];
   if(kind==='vehicle'&&Vehicles.active(state.players,p)){const owner=p.vehSeat?[...state.players.values()].find(u=>u.nick===p.vehSeat):p;if(owner?.veh?.pos)v=owner.veh.pos.map((n,i)=>n+(i===1?1.8:0));}
   if(kind==='front'){const u=army().find(v=>v.id===p.frontSeat);if(u&&u.rider===p&&u.alive)v=[u.x,u.y+1.5,u.z];}
   if(kind==='ai'&&p.army&&p.kind!=='foot')v=[p.x,p.y+1.45,p.z];
   return valid(v)?v:null;
 }
 function visible(origin,t){
   const v=center(t).map((n,i)=>n-origin[i]),l=Math.hypot(...v);return l>.01&&Buildings.trace(grid(),state.map,origin,v.map(n=>n/l),l)>=l-.25;
 }
 function best(p,origin,dir){
   let result=null,score=-Infinity;
   for(const t of targets(p)){
     const v=center(t).map((n,i)=>n-origin[i]),l=Math.hypot(...v);if(l<2||l>235)continue;
     const angle=dot(v,dir)/l,rank=angle-l*.000035;if(angle<cosCone||rank<=score||!visible(origin,t))continue;score=rank;result=t;
   }return result;
 }
 function seek(p,kind,dir,now=Date.now()){
   const o=source(p,kind);if(!o||!valid(dir)||Math.abs(Math.hypot(...dir)-1)>.04){if(p)locks.delete(p);return {progress:0};}
   const old=locks.get(p);if(old&&now-old.last<80)return old.message;
   const t=best(p,o,dir);if(!t){locks.delete(p);return {progress:0};}
   const since=old?.id===t.id&&old.kind===kind&&now-old.last<=550?old.since:now;
   const message={name:t.name,progress:Math.min(1,(now-since)/LOCK_MS)};
   locks.set(p,{id:t.id,since,last:now,kind,message});return message;
 }
 function fire(p,kind,origin,dir,now=Date.now()){
   if(!valid(origin)||!valid(dir)||Math.abs(Math.hypot(...dir)-1)>.04||missiles.length>=64)return false;
   const lock=locks.get(p),t=lock?.kind===kind&&lock.message.progress===1&&now-lock.last<=550?best(p,origin,dir):null;
   const target=t?.id===lock?.id?t?.id:null;
   const m={id:++serial,by:p,kind,pos:origin.slice(),dir:norm(dir),target,traveled:0,speed:kind==='rpg'?55:70};
   missiles.push(m);emit('cs16_missile_start',{id:m.id,kind,pos:m.pos,dir:m.dir,speed:m.speed,locked:!!target});return true;
 }
 function vehicle(p,d,now=Date.now()){
   const o=source(p,'vehicle');if(!o||now<(p.guidedSalvo||0)||!valid(d?.dir)||Math.abs(Math.hypot(...d.dir)-1)>.04)return false;
   if(!fire(p,'vehicle',o,d.dir,now))return false;
   p.guidedSalvo=now+2500;pending.push({p,dir:d.dir.slice(),at:now+300});return true;
 }
 function steer(from,to,angle){
   const c=Math.max(-1,Math.min(1,dot(from,to))),arc=Math.acos(c);if(arc<=angle)return to;
   const ortho=norm(to.map((v,i)=>v-c*from[i]));return ortho?from.map((v,i)=>v*Math.cos(angle)+ortho[i]*Math.sin(angle)):from;
 }
 function step(m,dt,now){
   if(state.phase!=='live')return false;
   const all=targets(m.by),target=m.target&&all.find(t=>t.id===m.target);
   if(m.target){if(!target||!visible(m.pos,target))m.target=null;else{
     const want=norm(center(target).map((v,i)=>v-m.pos[i]));if(want)m.dir=steer(m.dir,want,dt*2.6);
   }}
   const maxRange=m.kind==='rpg'?195:245,step=Math.min(m.speed*dt,maxRange-m.traveled);
   let stop=Buildings.trace(grid(),state.map,m.pos,m.dir,step);
   for(const t of all){const p=t.pos,r=t.r;
     const hit=Buildings.rayBox(m.pos,m.dir,{min:[p[0]-r,p[1],p[2]-r],max:[p[0]+r,p[1]+t.h,p[2]+r]},stop);
     if(hit!==null)stop=Math.min(stop,hit);
   }
   m.pos=m.pos.map((v,i)=>v+m.dir[i]*stop);m.traveled+=stop;
   if(stop<step-1e-4||m.traveled>=maxRange-.001){
     emit('cs16_missile_end',{id:m.id,pos:m.pos});impact(m.by,m.pos,m.kind);return false;
   }return true;
 }
 function clear(){missiles=[];pending=[];locks=new WeakMap();last=0;}
 function tick(now=Date.now()){
   if(state.phase!=='live'){if(last||missiles.length||pending.length)clear();return;}
   const dt=Math.min(.16,Math.max(0,(now-(last||now-50))/1000));last=now;
   for(const shot of pending.filter(s=>s.at<=now)){const o=source(shot.p,'vehicle');if(o)fire(shot.p,'vehicle',o,shot.dir,now);}
   pending=pending.filter(s=>s.at>now);
   if(!missiles.length)return;
   missiles=missiles.filter(m=>step(m,dt,now));
   if(missiles.length&&now>=nextFrame){nextFrame=now+95;frame('cs16_missile_frame',missiles.map(m=>[m.id,...m.pos.map(v=>Math.round(v*10)),...m.dir.map(v=>Math.round(v*100))]));}
 }
 return {seek,fire,vehicle,clear,tick,source,hasRoom:()=>missiles.length<64};
}
module.exports={create,LOCK_MS};
