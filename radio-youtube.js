'use strict';
const path=require('node:path'),express=require('express');
const fail=(status,message)=>Object.assign(Error(message),{status});
function videoId(value){
 if(typeof value!=='string'||value.length>2048)throw fail(400,'Вставь ссылку на отдельную песню YouTube или YouTube Music.');
 let u;try{u=new URL(value.trim());}catch{throw fail(400,'Нужна полная ссылка YouTube.');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)throw fail(400,'Некорректная ссылка YouTube.');
 const host=u.hostname.toLowerCase();let id;
 if(host==='youtu.be')id=u.pathname.split('/')[1];
 else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)){
  if(u.pathname==='/watch')id=u.searchParams.get('v');
  else if(/^\/(shorts|embed)\//.test(u.pathname))id=u.pathname.split('/')[2];
 }
 if(!/^[\w-]{11}$/.test(id||''))throw fail(400,'Нужна ссылка на отдельный трек. Плейлист целиком пока не добавляется.');
 return id;
}
function install({app,guard,get,commit,send,error,fetchMetadata=fetch,now=Date.now}){
 const cache=new Map(),limits=new Map();
 async function metadata(id){
  let row=cache.get(id);if(row&&row.until>now())return row.value;
  let response;
  try{response=await fetchMetadata('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent('https://www.youtube.com/watch?v='+id),{redirect:'error',signal:AbortSignal.timeout(12000)});}
  catch{throw fail(503,'YouTube не ответил. Попробуй ещё раз.');}
  if(!response.ok)throw fail(response.status===429?429:422,'YouTube не разрешает открыть этот ролик. Проверь ссылку или выбери другой трек.');
  const data=await response.json();
  if(typeof data.title!=='string'||!data.title.trim())throw fail(422,'Не удалось прочитать название ролика.');
  const value={source:'youtube',videoId:id,title:data.title.slice(0,240),author:String(data.author_name||'').slice(0,150),url:'https://www.youtube.com/watch?v='+id,thumbnail:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'};
  if(cache.size>=200)cache.delete(cache.keys().next().value);
  cache.set(id,{value,until:now()+15*60*1000});return value;
 }
 function throttle(req){
  const key=req.radioName.toLowerCase(),time=now(),entry=limits.get(key);
  if(!entry||entry.until<time){if(limits.size>2000)for(const [k,v]of limits)if(v.until<time)limits.delete(k);limits.set(key,{count:1,until:time+60000});return;}
  if(++entry.count>20)throw fail(429,'Слишком много ссылок. Подожди минуту.');
 }
 app.post('/api/radio/youtube/preview',guard(false),async(req,res)=>{try{
  throttle(req);res.set('Cache-Control','no-store').json({success:true,track:await metadata(videoId(req.body?.url))});
 }catch(e){error(res,e);}});
 app.post('/api/radio/youtube/queue',guard(false),async(req,res)=>{try{
  throttle(req);
  const playNow=req.body?.playNow===true;
  if(playNow&&(req.radioName.toLowerCase()!=='fifflaren'||req.radioMobileMode&&req.radioMobileMode!=='dj'))throw fail(403,'Включить сейчас может только Fifflaren из приложения или DJ-пульта.');
  const duration=Number(req.body?.duration);
  if(!Number.isFinite(duration)||duration<1||duration>86400)throw fail(400,'Дождись проверки длительности в плеере. Прямые трансляции не поддерживаются.');
  const info=await metadata(videoId(req.body?.url)),track={...info,id:'yt_'+info.videoId,duration,addedBy:req.radioName};
  for(let n=0;n<8;n++){
   let s=await get();const existing=s.queue.find(t=>t.id===track.id);
   if(s.queue.length>=500&&!existing)throw fail(409,'В очереди уже 500 песен. Удали ненужные треки.');
   try{
    if(!existing)s=await commit(s,{op:'add',track});
    if(playNow)s=await commit(s,{op:'select',id:track.id});
    return send(res,s);
   }catch(e){if(e.status!==409||n===7)throw e;}
  }
 }catch(e){error(res,e);}});
 // The hosted wrapper supplies a real HTTPS referrer even when Electron's main UI is file://.
 app.use('/radio-player',(_req,res,next)=>{
  res.set({'Referrer-Policy':'strict-origin-when-cross-origin','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache',
   'Content-Security-Policy':"default-src 'none'; script-src 'self' https://www.youtube.com; style-src 'self'; frame-src https://www.youtube.com; img-src https://i.ytimg.com; connect-src 'self' https://www.youtube.com; base-uri 'none'; form-action 'none'"});
  next();
 },express.static(path.join(__dirname,'radio-player'),{index:'index.html',dotfiles:'deny'}));
}
module.exports={install,videoId};

