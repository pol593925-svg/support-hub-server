'use strict';
const express=require('express'),{Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const PART=512*1024,valid=id=>typeof id==='string'&&/^[a-f0-9]{24}$/.test(id),fail=(status,message)=>Object.assign(Error(message),{status});
function create({io,mongoose,authenticate,enqueue,get,mediaType}){
  const ns=io.of('/radio-origin'),keys=mongoose.connection.collection('cinema_keys'),tracks=mongoose.connection.collection('radio_tracks');
  let host=null,inflight=0;const cache=new Map();
  function online(){if(!host?.connected||!host.data.ready)throw fail(503,'ПК Fifflaren с музыкой не подключён. Попроси открыть обновлённый Support Hub.');return host;}
  async function rpc(op,data){const sock=online();if(inflight>=12)throw fail(429,'ПК принимает другие песни. Повтори через несколько секунд.');inflight++;
    try{const r=await sock.timeout(25000).emitWithAck(op,data);if(!r?.ok)throw fail([400,409,415,429,507].includes(r?.status)?r.status:503,r?.error||'ПК не подтвердил операцию.');return r.result;}finally{inflight--;}
  }
  const item=t=>({id:t._id,title:t.title,duration:t.duration,addedBy:t.addedBy});
  function normalize(m){
    if(!m||!valid(m.id)||typeof m.title!=='string'||!m.title.trim()||m.title.length>200||!Number.isSafeInteger(m.size)||m.size<4||!Number.isFinite(m.duration)||m.duration<=0||typeof m.addedBy!=='string'||!m.addedBy||m.addedBy.length>100||!['audio/wav','audio/flac','audio/ogg','audio/aiff','audio/mp4','audio/webm','audio/aac','audio/mpeg'].includes(m.mime))throw fail(400,'Некорректный каталог радио.');
    return {id:m.id,title:m.title,size:m.size,duration:m.duration,addedBy:m.addedBy,mime:m.mime,createdAt:Number(m.createdAt)||Date.now()};
  }
  async function save(raw){
    const m=normalize(raw),old=await tracks.findOne({_id:m.id});
    if(old&&(old.storage!=='pc'||['title','size','duration','addedBy'].some(k=>old[k]!==m[k])))throw fail(409,'Номер трека уже занят.');
    const {id,...data}=m;
    try{await tracks.updateOne({_id:id,storage:'pc',addedBy:m.addedBy},{$set:{...data,ready:true},$setOnInsert:{queuedOnce:false}},{upsert:true});}catch(e){if(e.code===11000)throw fail(409,'Номер трека уже занят.');throw e;}
    const t=await tracks.findOne({_id:id});
    if(!t.queuedOnce){await enqueue(item(t));await tracks.updateOne({_id:id,storage:'pc'},{$set:{queuedOnce:true}});}
    return t;
  }
  ns.use(async(sock,next)=>{try{
    const u=await authenticate(sock.handshake.auth?.token),id=sock.handshake.auth?.hostId;
    if(u?.username?.toLowerCase()!=='fifflaren'||typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('Библиотеку радио подключает Fifflaren.');
    await keys.updateOne({_id:'pc-library'},{$setOnInsert:{hostId:id,movies:[]}},{upsert:true});
    if((await keys.findOne({_id:'pc-library'})).hostId!==id)throw Error('Библиотека привязана к другому ПК Fifflaren.');
    if(host?.connected)throw Error('Музыкальная библиотека уже подключена.');next();
  }catch(e){next(Error(e.message?.startsWith('Библиотек')||e.message?.startsWith('Музыкаль')?e.message:'Не удалось подключить ПК к радио.'));}});
  ns.on('connection',sock=>{
    if(host?.connected){sock.disconnect(true);return;}host=sock;cache.clear();
    sock.on('catalog',async(list,ack)=>{if(typeof ack!=='function')return;try{
      if(!Array.isArray(list)||list.length>20000||new Set(list.map(t=>t?.id)).size!==list.length)throw fail(400,'Некорректный каталог радио.');
      list.forEach(normalize);for(const t of list){if(host!==sock||!sock.connected)throw fail(503,'ПК отключён.');await save(t);}
      sock.data.ready=true;ack({ok:true});
    }catch(e){ack({error:e.status?e.message:'Не удалось сохранить каталог радио.'});}});
    sock.on('disconnect',()=>{if(host===sock){host=null;cache.clear();}});
  });
  async function owned(id,user){
    if(!valid(id))throw fail(400,'Неверный номер трека.');const t=await tracks.findOne({_id:id,storage:'pc'});
    if(!t)throw fail(404,'Загрузка не найдена.');if(t.addedBy!==user)throw fail(403,'Это загрузка другого сотрудника.');return t;
  }
  function installUploads({app,guard,error,send}){
    app.put('/api/radio/uploads/:id',guard(false),async(req,res)=>{try{
      online();const id=req.params.id,title=String(req.body?.title||'').trim().slice(0,200),{size,duration}=req.body||{},addedBy=req.radioName;
      if(!valid(id)||!title||!Number.isSafeInteger(size)||size<4||!Number.isFinite(duration)||duration<=0)throw fail(400,'Проверь аудиофайл.');
      const old=await tracks.findOne({_id:id});
      if(old&&(old.storage!=='pc'||old.addedBy!==addedBy))throw fail(403,'Этот номер принадлежит другой загрузке.');
      if(old&&['title','size','duration'].some(k=>old[k]!==({title,size,duration})[k]))throw fail(409,'Содержимое файла изменилось.');
      try{await tracks.updateOne({_id:id,storage:'pc',addedBy},{$setOnInsert:{title,size,duration,ready:false,queuedOnce:false}},{upsert:true});}catch(e){if(e.code===11000)throw fail(409,'Номер загрузки уже занят.');throw e;}
      const result=await rpc('start',{id,title,size,duration,addedBy});res.json({success:true,...result});
    }catch(e){error(res,e);}});
    app.put('/api/radio/uploads/:id/parts/:index',guard(false),express.raw({type:'application/octet-stream',limit:PART}),async(req,res)=>{try{
      const t=await owned(req.params.id,req.radioName),n=Number(req.params.index),bytes=req.body;
      if(!Number.isSafeInteger(n)||n<0||n>=Math.ceil(t.size/PART)||!Buffer.isBuffer(bytes)||bytes.length!==Math.min(PART,t.size-n*PART))throw fail(400,'Некорректная часть трека.');
      if(n===0&&!mediaType(bytes))throw fail(415,'Формат аудио не распознан.');
      await rpc('part',{id:t._id,n,bytes});res.json({success:true});
    }catch(e){error(res,e);}});
    app.post('/api/radio/uploads/:id/finish',guard(false),async(req,res)=>{try{
      const t=await owned(req.params.id,req.radioName),complete=await rpc('finish',{id:t._id});await save(complete);send(res,await get(),req.radioName.toLowerCase()!=='fifflaren'||req.radioMobileMode==='upload');
    }catch(e){error(res,e);}});
  }
  async function stream(req,res,m,range){
    const sock=online(),span=range(req.headers.range,m.size);if(!span)return res.set('Content-Range','bytes */'+m.size).sendStatus(416);
    const {start,end}=span,partial=!!req.headers.range;res.status(partial?206:200).type(m.mime).set({'Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    if(partial)res.set('Content-Range','bytes '+start+'-'+end+'/'+m.size);if(req.method==='HEAD')return res.end();
    async function block(offset){if(host!==sock||!sock.connected)throw fail(503,'ПК отключился.');const key=m._id+'/'+offset;
      if(!cache.has(key)){const p=sock.timeout(25000).emitWithAck('read',{id:m._id,offset}).then(r=>{if(!r?.ok||!Buffer.isBuffer(r.result)||r.result.length!==Math.min(PART,m.size-offset))throw fail(503,'ПК не передал часть трека.');return r.result;}).catch(e=>{cache.delete(key);throw e;});cache.set(key,p);if(cache.size>64)cache.delete(cache.keys().next().value);}return cache.get(key);
    }
    async function* chunks(){for(let at=Math.floor(start/PART)*PART;at<=end;at+=PART){if(res.destroyed)return;const data=await block(at);yield data.subarray(Math.max(0,start-at),Math.min(data.length,end-at+1));}}
    await pipeline(Readable.from(chunks()),res);
  }
  return {online,installUploads,stream};
}
module.exports={create,PART};
