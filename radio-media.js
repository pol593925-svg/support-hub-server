'use strict';
const express=require('express'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const PART=2*1024*1024, validId=id=>/^[a-f0-9]{24}$/.test(id);
const fail=(status,message)=>Object.assign(Error(message),{status});
function mediaType(data){
  if(!Buffer.isBuffer(data)||data.length<4)return null;
  const head=data.toString('latin1',0,4);
  if(['RIFF','RF64','BW64'].includes(head)&&data.toString('ascii',8,12)==='WAVE')return 'audio/wav';
  if(head==='fLaC')return 'audio/flac';
  if(head==='OggS')return 'audio/ogg';
  if(head==='FORM'&&['AIFF','AIFC'].includes(data.toString('ascii',8,12)))return 'audio/aiff';
  if(data.toString('ascii',4,8)==='ftyp')return 'audio/mp4';
  if(data.readUInt32BE(0)===0x1a45dfa3)return 'audio/webm';
  if(data[0]===0xff&&(data[1]&0xf6)===0xf0)return 'audio/aac';
  if(head.startsWith('ID3')||data[0]===255&&(data[1]&224)===224)return 'audio/mpeg';
  return null;
}
function range(value,size){
  if(!value)return {start:0,end:size-1};
  const m=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!m||!m[1]&&!m[2])return null;
  const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  const end=m[1]&&m[2]?Math.min(size-1,Number(m[2])):size-1;
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=end&&start<size?{start,end}:null;
}
const binary=v=>Buffer.isBuffer(v)?v:Buffer.from(v.value(true));
const partKey=(id,n)=>id+':'+String(n).padStart(12,'0');
const publicTrack=t=>({id:t._id,title:t.title,duration:t.duration});
function create({mongoose,app,guard,get,enqueue,send,error,kind='radio',origin,mayWatch}){
  const film=kind==='cinema',prefix='/api/'+kind,streamPath=prefix+(film?'/video':'/audio');
  function detect(data){
    if(!film)return mediaType(data);
    if(data.length>=12&&data.toString('ascii',4,8)==='ftyp')return 'video/mp4';
    if(data.length>=8&&data.readUInt32BE(0)===0x1a45dfa3&&data.subarray(0,4096).includes(Buffer.from('webm')))return 'video/webm';
    return null;
  }
  const col=name=>mongoose.connection.collection(name);
  const tracks=col(kind+'_tracks'),parts=col(kind+'_parts'),old=col(kind+'_audio'),keys=col(kind+'_keys');
  let lastCleanup=0;
  async function discardAbandoned(){
    if(Date.now()-lastCleanup<86400000)return;lastCleanup=Date.now();
    const cutoff=new Date(Date.now()-30*86400000);
    for(let i=0;i<12;i++){
      const t=await tracks.findOneAndUpdate({ready:false,$or:[{pruning:true},{touched:{$lt:cutoff}}]},{$set:{pruning:true}},{returnDocument:'after'});
      if(!t)return;
      await parts.deleteMany({_id:{$gte:partKey(t.series,0),$lt:t.series+';'}});
      await tracks.deleteOne({_id:t._id,series:t.series,ready:false,pruning:true});
    }
  }
  let signingKey;
  async function sharedKey(){
    if(!signingKey)signingKey=(async()=>{
      try{await keys.updateOne({_id:'media'},{$setOnInsert:{key:crypto.randomBytes(32).toString('hex')}},{upsert:true});}catch(e){if(e.code!==11000)throw e;}
      return (await keys.findOne({_id:'media'})).key;
    })().catch(e=>{signingKey=null;throw e;});
    return signingKey;
  }
  const sign=async(id,exp)=>crypto.createHmac('sha256',await sharedKey()).update(id+'/'+exp).digest('hex');
  async function ticketOK(id,token){
    if(typeof token!=='string'||!/^\d{10,15}\.[a-f0-9]{64}$/.test(token))return false;
    const [exp,mac]=token.split('.');
    return Number(exp)>Date.now()&&crypto.timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(await sign(id,exp),'hex'));
  }
  // Older releases stored their audio as one BSON value, and their titles in the station queue.
  async function remember(items){
    if(!items.length)return;
    await tracks.bulkWrite(items.map(t=>({updateOne:{filter:{_id:t.id},update:{$setOnInsert:{title:t.title,duration:t.duration,legacy:true,ready:true,queuedOnce:true}},upsert:true}})),{ordered:false});
  }
  let migrated;
  async function migrate(){
    if(!migrated)migrated=(async()=>remember((await get()).queue))().catch(e=>{migrated=null;throw e;});
    return migrated;
  }
  app.get(prefix+'/library',guard(true),async(req,res)=>{try{
    if(!film)await migrate();const before=req.query.before;if(before&&!validId(before))throw fail(400,'Некорректная страница.');
    const rows=await tracks.find({ready:true,...(before?{_id:{$lt:before}}:{})}).sort({_id:-1}).limit(51).toArray();
    if(film&&origin){
      const host=await origin.catalog(),all=rows.map(t=>({...publicTrack(t),size:t.size,storage:'legacy'})).concat(host.movies.filter(m=>!before||m.id<before)).sort((a,b)=>b.id.localeCompare(a.id));
      const list=all.slice(0,50);return res.json({success:true,tracks:list,before:all.length>50?list.at(-1).id:null,space:host.space});
    }
    const list=rows.slice(0,50);res.json({success:true,tracks:list.map(publicTrack),before:rows.length>50?list.at(-1)._id:null});
  }catch(e){error(res,e);}});
  if(!film)app.post(prefix+'/library/:id/queue',guard(true),async(req,res)=>{try{
    const t=await tracks.findOne({_id:req.params.id,ready:true});if(!t)throw fail(404,'Трек не найден.');
    send(res,await enqueue(publicTrack(t)));
  }catch(e){error(res,e);}});
  if(film)app.use(prefix+'/uploads',guard(true),(_req,res)=>res.status(409).json({success:false,message:'Загрузка фильмов в рабочую базу отключена. Используй библиотеку на ПК Fifflaren.'}));
  app.put(prefix+'/uploads/:id',guard(true),async(req,res)=>{try{
    const id=req.params.id,{size,duration}=req.body,title=String(req.body.title||'').trim().slice(0,200);
    if(!validId(id)||!title||!Number.isSafeInteger(size)||size<1||!Number.isFinite(duration)||duration<=0)throw fail(400,'Проверь файл и длительность трека.');
    try{await tracks.updateOne({_id:id,pruning:{$ne:true}},{$set:{touched:new Date()},$setOnInsert:{title,size,duration,next:0,series:crypto.randomBytes(16).toString('hex'),ready:false,queuedOnce:false}}, {upsert:true});}
    catch(e){if(e.code===11000)throw fail(503,'Загрузка возобновляется. Повтори попытку.');throw e;}
    await discardAbandoned();
    const t=await tracks.findOne({_id:id});
    if(t.size!==size||t.title!==title||Math.abs(t.duration-duration)>.25)throw fail(409,'Идентификатор уже занят другим треком.');
    res.json({success:true,next:t.next,partSize:PART});
  }catch(e){error(res,e);}});
  app.put(prefix+'/uploads/:id/parts/:index',guard(true),express.raw({type:'application/octet-stream',limit:PART}),async(req,res)=>{try{
    const id=req.params.id,n=Number(req.params.index),body=req.body,t=await tracks.findOne({_id:id});
    if(!validId(id)||!t||t.pruning||!Number.isSafeInteger(n)||n<0||n>=Math.ceil(t.size/PART)||!Buffer.isBuffer(body)||body.length!==Math.min(PART,t.size-n*PART))throw fail(400,'Некорректная часть трека.');
    if(n>t.next)throw fail(409,'Пропущена предыдущая часть.');
    const mime=n===0?detect(body):null;if(n===0&&!mime)throw fail(415,film?'Нужен видеофайл MP4 или WebM.':'Формат аудио не распознан.');
    const hash=crypto.createHash('sha256').update(body).digest('hex'),_id=partKey(t.series,n);
    try{await parts.updateOne({_id,hash},{$setOnInsert:{data:body}},{upsert:true});}
    catch(e){if(e.code!==11000)throw e;const same=await parts.findOne({_id,hash},{projection:{_id:1}});if(!same)throw fail(409,'Содержимое файла изменилось.');}
    if(n===t.next)await tracks.updateOne({_id:id,series:t.series,next:n,ready:false,pruning:{$ne:true}},{$inc:{next:1},$set:{touched:new Date(),...(mime?{mime}:{})}});
    res.json({success:true});
  }catch(e){error(res,e);}});
  app.post(prefix+'/uploads/:id/finish',guard(true),async(req,res)=>{try{
    const t=await tracks.findOne({_id:req.params.id});if(!t||t.pruning||t.legacy||!t.mime||t.next!==Math.ceil(t.size/PART))throw fail(409,'Загружены не все части.');
    if(!t.ready){const r=await tracks.updateOne({_id:t._id,series:t.series,pruning:{$ne:true}},{$set:{ready:true}});if(!r.matchedCount)throw fail(409,'Выбери файл заново.');}
    if(film)return res.json({success:true,film:publicTrack(t)});
    const state=t.queuedOnce?await get():await enqueue(publicTrack(t));
    if(!t.queuedOnce)await tracks.updateOne({_id:t._id},{$set:{queuedOnce:true}});
    send(res,state);
  }catch(e){error(res,e);}});
  app.post(streamPath+'/:id/ticket',guard(false),async(req,res)=>{try{
    const id=req.params.id;if(!validId(id))throw fail(404,'Трек не найден.');
    if(mayWatch&&!await mayWatch(req,id))throw fail(403,'Этот фильм ещё не объявлен для просмотра.');
    if(film&&origin&&await origin.find(id))origin.online();
    const expires=Date.now()+(film?24:4)*3600*1000,mac=await sign(id,expires);
    res.set('Cache-Control','no-store').json({success:true,ticket:expires+'.'+mac});
  }catch(e){error(res,e);}});
  // The audio element can seek using native HTTP ranges. A ticket authorizes this track alone.
  const authorize=async(req,res,next)=>{try{if(await ticketOK(req.params.id,req.query.ticket))return next();return guard(false)(req,res,async()=>{try{if(mayWatch&&!await mayWatch(req,req.params.id))throw fail(403,'Этот фильм ещё не объявлен для просмотра.');next();}catch(e){error(res,e);}});}catch(e){error(res,e);}};
  app.get(streamPath+'/:id',authorize,async(req,res)=>{try{
    const id=req.params.id;if(!validId(id))return res.sendStatus(404);
    if(film&&origin){const item=await origin.find(id);if(item)return await origin.stream(req,res,item,range);}
    const t=await tracks.findOne({_id:id,ready:true});
    const legacy=!film&&(!t||t.legacy)?await old.findOne({_id:id}):null;
    if(!legacy&&(!t||t.legacy))return res.sendStatus(404);
    const buf=legacy?binary(legacy.data):null,size=buf?buf.length:t.size,span=range(req.headers.range,size);
    if(!span)return res.set('Content-Range','bytes */'+size).sendStatus(416);
    const {start,end}=span,partial=Boolean(req.headers.range);
    res.status(partial?206:200).type(legacy?legacy.mime:t.mime).set({'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    if(partial)res.set('Content-Range','bytes '+start+'-'+end+'/'+size);
    if(req.method==='HEAD')return res.end();
    if(buf)return res.end(buf.subarray(start,end+1));
    async function* read(){
      const first=Math.floor(start/PART),last=Math.floor(end/PART);
      const cur=parts.find({_id:{$gte:partKey(t.series,first),$lte:partKey(t.series,last)}}).sort({_id:1}).batchSize(1);
      let n=first;try{for await(const row of cur){
        if(row._id!==partKey(t.series,n))throw Error('Audio part missing');
        const data=binary(row.data);yield data.subarray(n===first?start%PART:0,n===last?end%PART+1:data.length);n++;
      }if(n!==last+1)throw Error('Audio truncated');}finally{await cur.close();}
    }
    await pipeline(Readable.from(read()),res);
  }catch(e){if(!res.headersSent&&!res.destroyed)error(res,e);else if(!res.destroyed)res.destroy();}});
  async function retain(item){
    await remember([item]);
    await tracks.updateOne({_id:item.id,ready:true},{$set:{queuedOnce:true}});
  }
  return {remember,retain};
}
module.exports={create,mediaType,PART};
