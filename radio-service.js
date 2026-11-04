'use strict';
const express = require('express');
const LIMIT = 12 * 1024 * 1024, MAX_TRACKS = 40;
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
    if(s.queue.length >= MAX_TRACKS) throw Error('Очередь заполнена. Удали трек перед загрузкой.');
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
function mediaType(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>LIMIT)return null;
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')return 'audio/wav';
  if(bytes.toString('ascii',0,4)==='OggS')return 'audio/ogg';
  if(bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224))return 'audio/mpeg';
  return null;
}
function install({app,mongoose,authenticate}){
  const station=mongoose.connection.collection('radio_station'), audio=mongoose.connection.collection('radio_audio');
  const get=async()=>await station.findOne({_id:'live'})||{_id:'live',...empty()};
  const send=(res,s)=>{const now=Date.now();res.set('Cache-Control','no-store').json({success:true,queue:s.queue,...live(s,now),rev:s.rev,now});};
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
  const error=(res,e)=>res.status(e.status||503).json({success:false,message:e.status?e.message:'Не удалось обновить эфир.'});
  app.get('/api/radio/state',guard(false),async(req,res)=>{try{send(res,await get());}catch(e){error(res,e);}});
  app.get('/api/radio/audio/:id',guard(false),async(req,res)=>{try{
    if(!/^[a-f0-9]{24}$/.test(req.params.id))return res.sendStatus(404);
    const track=await audio.findOne({_id:req.params.id});if(!track)return res.sendStatus(404);
    res.type(track.mime).set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(Buffer.isBuffer(track.data)?track.data:Buffer.from(track.data.buffer));
  }catch(e){error(res,e);}});
  app.post('/api/radio/tracks',guard(true),express.raw({type:'application/octet-stream',limit:LIMIT}),async(req,res)=>{try{
    const mime=mediaType(req.body), title=String(req.query.title||'').trim().slice(0,140),duration=Number(req.query.duration);
    if(!mime||!title||!Number.isFinite(duration)||duration<1||duration>3600)return res.status(400).json({success:false,message:'Нужен трек MP3, OGG или WAV до 12 МБ, от секунды до часа.'});
    const s=await get(), id=new mongoose.Types.ObjectId().toString();
    await audio.insertOne({_id:id,mime,data:req.body});
    try{send(res,await commit(s,{op:'add',track:{id,title,duration}}));}catch(e){if(e.status===400||e.status===409)await audio.deleteOne({_id:id});throw e;}
  }catch(e){error(res,e);}});
  app.post('/api/radio/control',guard(true),async(req,res)=>{try{
    const s=await get(),cmd=req.body||{};
    if(s.rev!==cmd.rev)return res.status(409).json({success:false,message:'Эфир уже изменился. Повтори действие.'});
    if(cmd.op==='add')return res.sendStatus(400);
    const next=await commit(s,cmd);if(cmd.op==='remove')await audio.deleteOne({_id:cmd.id});send(res,next);
  }catch(e){error(res,e);}});
}
module.exports={install,live,change,empty,mediaType};
