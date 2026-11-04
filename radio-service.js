'use strict';
const express = require('express');
const media=require('./radio-media');
const empty = () => ({queue:[], current:null, position:0, playing:false, anchor:0, rev:0});
function live(station, now = Date.now()) {
  const {queue,playing} = station;
  if (!queue.length) return {current:null, position:0, playing:false};
  let i = Math.max(0, queue.findIndex(t => t.id === station.current));
  let p = station.position + (playing ? Math.max(0, now - station.anchor) / 1000 : 0);
  p %= queue.reduce((n,t) => n+t.duration,0);
  while (p >= queue[i].duration) {p -= queue[i].duration; i = (i+1) % queue.length;}
  return {current:queue[i].id, position:p, playing};
}
function change(station, command, now) {
  const s = {...station, ...live(station, now), anchor:now, queue:station.queue.slice()};
  const index = s.queue.findIndex(t => t.id === s.current);
  if(command.op === 'add') {
    s.queue.push(command.track); if(!s.current)s.current=command.track.id;
  } else {
    if(index<0) throw Error('Очередь пуста.');
    const idx = s.queue.findIndex(t=>t.id===command.id);
    switch(command.op){
      case 'play': s.playing=true;break;
      case 'pause': s.playing=false;break;
      case 'seek':
        if(command.id!==s.current||!Number.isFinite(command.position))throw Error('Трек изменился. Обнови эфир.');
        s.position=Math.max(0,Math.min(s.queue[index].duration-.01,command.position));break;
      case 'next': case 'previous':
        s.current=s.queue[(index+s.queue.length+(command.op==='next'?1:-1))%s.queue.length].id;s.position=0;break;
      case 'select': if(idx<0)throw Error('Трека нет в очереди.');s.current=command.id;s.position=0;s.playing=true;break;
      case 'up': case 'down':{
        const to=idx+(command.op==='up'?-1:1);if(idx<0||to<0||to>=s.queue.length)throw Error('Трек уже на краю очереди.');
        [s.queue[to],s.queue[idx]]=[s.queue[idx],s.queue[to]];break;
      }
      case 'remove':
        if(idx<0)throw Error('Трека нет в очереди.');
        s.queue.splice(idx,1);if(idx===index){s.current=s.queue[idx%s.queue.length]?.id||null;s.position=0;if(!s.current)s.playing=false;}break;
      default: throw Error('Неизвестная команда.');
    }
  }
  s.rev++;return s;
}
function installAudience(io,authenticate){
  const ns=io.of('/radio'),listeners=new Map();
  const roster=()=>Array.from(listeners.values(),entry=>entry.name).sort((a,b)=>a.localeCompare(b,'ru'));
  let changed;
  function broadcast(){
    if(changed)return;
    changed=setTimeout(()=>{changed=null;ns.emit('audience',roster());},80);
  }
  ns.use(async(socket,next)=>{
    try{
      const user=await authenticate(socket.handshake.auth?.token);
      if(!user?.username)return next(Error('Войди в Support Hub, чтобы видеть слушателей.'));
      socket.data.radioName=user.username;next();
    }catch{next(Error('Радио временно недоступно.'));}
  });
  ns.on('connection',socket=>{
    const name=socket.data.radioName,key=name.toLowerCase();let active=false;
    socket.emit('audience',roster());
    function listening(on){
      if(typeof on!=='boolean'||active===on)return;
      active=on;
      const count=(listeners.get(key)?.count||0)+(on?1:-1);
      if(count>0)listeners.set(key,{name,count});else listeners.delete(key);
      if(on?count===1:count===0)broadcast();
    }
    socket.on('listening',listening);
    socket.on('disconnect',()=>listening(false));
  });
}
function install({app,io,mongoose,authenticate}){
  if(io)installAudience(io,authenticate);
  const station=mongoose.connection.collection('radio_station'), audio=mongoose.connection.collection('radio_audio');
  const get=async()=>await station.findOne({_id:'live'})||{_id:'live',...empty()};
  const send=(res,s,compact=false)=>{
    const now=Date.now(),at=live(s,now);
    const payload=compact?{track:s.queue.find(t=>t.id===at.current)||null}:{queue:s.queue};
    res.set('Cache-Control','no-store').json({success:true,...payload,...at,rev:s.rev,now});
  };
  function guard(owner){return async(req,res,next)=>{try{
    const u=await authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));
    if(!u||(owner&&u.username.toLowerCase()!=='fifflaren'))return res.status(403).json({success:false,message:'Нет доступа к эфиру.'});
    next();
  }catch{res.status(503).json({success:false,message:'Сервис эфира недоступен.'});}};}
  async function commit(s,cmd){
    let next;try{next=change(s,cmd,Date.now());}catch(e){e.status=400;throw e;}
    const {_id,...fields}=next;
    try{const r=await station.updateOne({_id:'live',rev:s.rev},{$set:fields},{upsert:s.rev===0});if(r.matchedCount||r.upsertedCount)return next;}
    catch(e){if(e.code!==11000)throw e;}
    throw Object.assign(Error('Очередь уже изменилась. Повтори действие.'),{status:409});
  }
  async function enqueue(track){
    for(let i=0;i<8;i++){
      const state=await get();if(state.queue.some(t=>t.id===track.id))return state;
      try{return await commit(state,{op:'add',track});}catch(e){if(e.status!==409||i===7)throw e;}
    }
  }
  const error=(res,e)=>res.status(e.status||503).json({success:false,message:e.status?e.message:/quota|space limit|out of.*space/i.test(e.message)?'Хранилище сервера заполнено.':'Сервис радио временно недоступен.'});
  const storage=media.create({app,mongoose,guard,get,enqueue,send,error});
  app.get('/api/radio/state',guard(false),async(req,res)=>{try{
    const s=await get();send(res,s,req.query.compact==='1'||req.query.since===String(s.rev));
  }catch(e){error(res,e);}});
  // Compatibility upload for 3.50.0/1, which send one BSON-sized payload.
  app.post('/api/radio/tracks',guard(true),express.raw({type:'application/octet-stream',limit:'12mb'}),async(req,res)=>{try{
    const mime=media.mediaType(req.body), title=String(req.query.title||'').trim().slice(0,140),duration=Number(req.query.duration);
    if(!mime||!title||!Number.isFinite(duration)||duration<=0)return res.status(400).json({success:false,message:'Нужен читаемый аудиофайл.'});
    const id=new mongoose.Types.ObjectId().toString(),track={id,title,duration};
    await audio.insertOne({_id:id,mime,data:req.body});
    await storage.remember([track]);send(res,await enqueue(track));
  }catch(e){error(res,e);}});
  app.post('/api/radio/control',guard(true),async(req,res)=>{try{
    const s=await get(),cmd=req.body||{};
    if(s.rev!==cmd.rev)return res.status(409).json({success:false,message:'Эфир уже изменился. Повтори действие.'});
    if(cmd.op==='add')return res.sendStatus(400);
    if(cmd.op==='remove'){const item=s.queue.find(t=>t.id===cmd.id);if(item)await storage.retain(item);}
    send(res,await commit(s,cmd));
  }catch(e){error(res,e);}});
}
module.exports={install,live,change,empty,mediaType:media.mediaType};
