'use strict';

const TYPES=Object.freeze({
 ap:Object.freeze({item:'mine_ap',pack:5,max:25,armMs:900,trigger:1.35}),
});
const MAX_ACTIVE=96;
const kindOf=item=>item==='mine_ap'?'ap':null;
const positionOf=p=>[p.bot?p.bx:p.lx,Number.isFinite(p.ly)?p.ly:0,p.bot?p.bz:p.lz];
const enemy=(state,mine,target)=>target!==mine.owner&&target.team&&(state.gm==='gg'||target.team!==mine.team);

function create({state,emit,visible=emit,personal,onDetonate,walkHeight}){
 const active=new Map();let serial=0;
 function inventory(p){
  if(!p.mines||typeof p.mines!=='object')p.mines={ap:0};
  p.mines.ap=Math.max(0,p.mines.ap|0);delete p.mines.at;
  return p.mines;
 }
 function row(mine){return {id:mine.id,kind:mine.kind,pos:mine.pos.slice(),team:mine.team,by:mine.owner.nick,armedAt:mine.armedAt};}
 function snapshot(owner){return {map:state.map,rows:[...active.values()].filter(m=>!owner||m.owner===owner).map(row)};}
 function buy(p,item){
  const kind=kindOf(item);if(!kind)return null;
  const bag=inventory(p),spec=TYPES[kind];
  if(bag[kind]>=spec.max)return {error:'У тебя уже максимум мин этого типа'};
  bag[kind]=Math.min(spec.max,bag[kind]+spec.pack);
  return {kind,count:bag[kind]};
 }
 function place(p,data,now=Date.now()){
  const kind=data?.kind==='ap'?'ap':kindOf(data?.kind),spec=TYPES[kind];
  if(!spec)return {error:'Неизвестный тип мины'};
  if(state.phase!=='live'||!p?.alive||!p.team||p.frontSeat!=null||p.veh?.inside||p.vehSeat)return {error:'Сейчас установить мину нельзя'};
  const bag=inventory(p);if(!(bag[kind]>0))return {error:'Сначала купи комплект мин в магазине'};
  if(now-(p.minePlacedAt||0)<450)return {error:'Подожди перед следующей установкой'};
  if(active.size>=MAX_ACTIVE)return {error:'На карте слишком много мин — дождись срабатывания'};
  const pos=positionOf(p);if(!pos.every(Number.isFinite))return {error:'Позиция ещё не синхронизирована'};
  pos[1]=(walkHeight?walkHeight(pos[0],pos[2]):pos[1])+.035;
  for(const mine of active.values())if(Math.hypot(mine.pos[0]-pos[0],mine.pos[2]-pos[2])<.42)return {error:'Здесь уже установлена мина'};
  bag[kind]--;p.minePlacedAt=now;
  const mine={id:++serial,kind,owner:p,team:p.team,pos,armedAt:now+spec.armMs};
  active.set(mine.id,mine);visible('cs16_mine_add',row(mine),p);personal?.(p);
  return {mine:row(mine),count:bag[kind]};
 }
 function detonate(mine){
  if(!active.delete(mine.id))return false;
  emit('cs16_mine_remove',{id:mine.id});
  emit('cs16_mine_boom',{id:mine.id,kind:mine.kind,pos:mine.pos.slice(),by:mine.owner.nick});
  onDetonate(mine,mine.owner);return true;
 }
 function tick(now=Date.now()){
  if(state.phase!=='live')return 0;
  let exploded=0;
  for(const mine of [...active.values()]){
   if(now<mine.armedAt)continue;const spec=TYPES[mine.kind];let triggered=false;
   for(const target of state.players.values()){
    if(!target.alive||!enemy(state,mine,target)||target.frontSeat!=null||target.vehSeat||target.veh?.inside)continue;
    const pos=positionOf(target);if(!pos.every(Number.isFinite))continue;
    if(Math.abs(pos[1]-mine.pos[1])<2.15&&Math.hypot(pos[0]-mine.pos[0],pos[2]-mine.pos[2])<=spec.trigger){triggered=true;break;}
   }
   if(triggered&&detonate(mine))exploded++;
  }
  return exploded;
 }
 // Round transitions keep deployed mines and unspent inventory. Refresh the
 // private owner view and follow side swaps without exposing coordinates.
 function sync(){
  for(const mine of active.values())if(['t','ct'].includes(mine.owner?.team))mine.team=mine.owner.team;
  for(const p of state.players.values()){
   visible('cs16_mines',snapshot(p),p);
   personal?.(p);
  }
 }
 // A new match is the only ordinary lifecycle event that clears every mine.
 function reset(){active.clear();serial=0;for(const p of state.players.values())p.mines={ap:0};emit('cs16_mines',{map:state.map,rows:[]});}
 return {buy,place,tick,sync,reset,snapshot,count:()=>active.size};
}
module.exports={TYPES,MAX_ACTIVE,create,kindOf};
