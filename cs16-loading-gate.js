'use strict';
const {randomUUID}=require('node:crypto');
const STAGES=new Set(['connecting','map','models','shaders','ready','error']);
// A match barrier, independent of simulation timers. No round clock runs here.
function create({state,publish,start,abort,fill=()=>{},now=Date.now,schedule=setTimeout,unschedule=clearTimeout,timeout=120000,countdown=3000}){
 let gate=null,timer=null,signature='';
 function cancel(){if(timer!==null)unschedule(timer);timer=null;gate=null;signature='';}
 function roster(){return [...state.players].filter(([,p])=>p.team==='t'||p.team==='ct');}
 function reconcile(){
  const members=roster(),ids=new Set(members.map(([id])=>id));let changed=false;
  for(const id of gate.progress.keys())if(!ids.has(id)){gate.progress.delete(id);changed=true;}
  for(const [id,p] of members)if(!gate.progress.has(id)){gate.progress.set(id,{percent:p.bot?100:0,stage:p.bot?'ready':'connecting',ready:!!p.bot});changed=true;}
  if(changed)gate.startAt=0;
  return members;
 }
 function snapshot(){
  if(!gate||state.phase!=='loading')return null;
  return {id:gate.id,map:gate.map,now:now(),deadline:gate.deadline,startAt:gate.startAt,
   players:roster().map(([id,p])=>({id,nick:p.nick,team:p.team,bot:!!p.bot,characterId:p.characterId||'classic',
    ...(gate.progress.get(id)||{percent:0,stage:'connecting',ready:false})}))};
 }
 function tick(){
  timer=null;if(!gate)return;if(state.phase!=='loading'||state.map!==gate.map){cancel();return;}
  if(roster().some(([,p])=>!p.bot))fill();
  const members=reconcile(),humans=members.filter(([,p])=>!p.bot);
  if(!humans.length){cancel();abort('Подготовка отменена: в командах не осталось игроков.');return;}
  const ready=humans.every(([id])=>gate.progress.get(id).ready);
  if(ready&&!gate.startAt)gate.startAt=now()+countdown;
  if(!ready)gate.startAt=0;
  if(ready&&now()>=gate.startAt){cancel();start();return;}
  if(!ready&&now()>=gate.deadline){cancel();abort('Матч не начался: не все загрузили карту за 2 минуты. Повторите загрузку и запустите матч снова.');return;}
  const data=snapshot(),key=JSON.stringify({...data,now:0,count:gate.startAt?Math.ceil((gate.startAt-now())/1000):0});
  if(key!==signature){signature=key;publish(data);}
  timer=schedule(tick,250);timer?.unref?.();
 }
 function begin(){
  cancel();state.phase='loading';state.freezeEnds=state.roundEnds=state.buyUntil=0;
  gate={id:randomUUID(),map:state.map,deadline:now()+timeout,startAt:0,progress:new Map()};
  tick();return snapshot();
 }
 function report(id,data){
  if(!gate||state.phase!=='loading'||!data||data.id!==gate.id||data.map!==gate.map)return false;
  const p=state.players.get(id),entry=gate.progress.get(id);
  if(!p||p.bot||!['t','ct'].includes(p.team)||!entry)return false;
  if(!Number.isFinite(data.percent)||data.percent<0||data.percent>100||!STAGES.has(data.stage))return false;
  if(data.reset===true){entry.percent=0;entry.ready=false;entry.stage='map';gate.startAt=0;}
  if(data.stage==='error'){entry.ready=false;entry.stage='error';gate.startAt=0;return true;}
  if(entry.ready&&!data.reset)return true;
  entry.ready=data.ready===true&&data.percent===100&&data.stage==='ready';
  entry.percent=entry.ready?100:Math.max(entry.percent,Math.min(99,Math.floor(data.percent)));
  entry.stage=entry.ready?'ready':data.stage;
  return true;
 }
 return {begin,cancel,report,snapshot};
}
module.exports={create};
