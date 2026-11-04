'use strict';
const {Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const LIMIT=4_000_000_000,PART=512*1024;
const fail=(status,message)=>Object.assign(Error(message),{status});
function create({io,mongoose,authenticate}){
  const ns=io.of('/cinema-origin'),keys=mongoose.connection.collection('cinema_keys'),legacy=mongoose.connection.collection('cinema_tracks');
  const registry=()=>keys.findOne({_id:'pc-library'}),cache=new Map();let host=null,serial=Promise.resolve();
  function run(fn){const job=serial.then(fn);serial=job.catch(()=>{});return job;}
  async function legacyBytes(){return (await legacy.aggregate([{$group:{_id:null,total:{$sum:'$size'}}}]).next())?.total||0;}
  ns.use(async(sock,next)=>{try{
    const u=await authenticate(sock.handshake.auth?.token),key=sock.handshake.auth?.hostId;
    if(u?.username?.toLowerCase()!=='fifflaren'||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error('Библиотеку подключает Fifflaren.');
    await keys.updateOne({_id:'pc-library'},{$setOnInsert:{hostId:key,movies:[]}},{upsert:true});const reg=await registry();
    if(reg.hostId!==key)throw Error('Библиотека уже привязана к другому ПК Fifflaren.');
    if(host?.connected)throw Error('Библиотека уже подключена.');sock.data.hostId=key;next();
  }catch(e){next(Error(e.message?.startsWith('Библиотек')?e.message:'Не удалось подключить библиотеку.'));}});
  ns.on('connection',sock=>{
    if(host?.connected){sock.disconnect(true);return;}host=sock;cache.clear();
    sock.on('catalog',async(items,ack)=>{
      if(typeof ack!=='function')return;
      try{
        if(!Array.isArray(items)||items.length>20000)throw fail(400,'Некорректный каталог.');
        const seen=new Set(),movies=items.map(m=>{
          if(!m||typeof m.id!=='string'||!/^[a-f0-9]{24}$/.test(m.id)||seen.has(m.id)||typeof m.title!=='string'||!m.title.trim()||m.title.length>200||
            !['video/mp4','video/webm'].includes(m.mime)||!Number.isSafeInteger(m.size)||m.size<12||!Number.isFinite(m.duration)||m.duration<=0||
            ![m.width,m.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=65535))throw fail(400,'Некорректный файл в каталоге.');
          seen.add(m.id);return {id:m.id,title:m.title,size:m.size,duration:m.duration,width:m.width,height:m.height,mime:m.mime,createdAt:Number(m.createdAt)||0,storage:'pc'};
        });
        const previous=await registry(),before=new Set(previous?.movies?.map(m=>m.id)),oldBytes=await legacyBytes();
        if(movies.reduce((n,m)=>n+m.size,oldBytes)>LIMIT&&movies.some(m=>!before.has(m.id)))throw fail(409,'Лимит библиотеки — 4 ГБ.');
        if(host!==sock||!sock.connected)throw fail(503,'ПК отключён.');
        await keys.updateOne({_id:'pc-library',hostId:sock.data.hostId},{$set:{movies}});sock.data.ready=true;cache.clear();ack({ok:true,legacyBytes:oldBytes});
      }catch(e){ack({error:e.status?e.message:'Не удалось сохранить каталог ПК.'});}
    });
    sock.on('disconnect',()=>{if(host===sock){host=null;cache.clear();}});
  });
  async function catalog(){
    const [reg,oldBytes]=await Promise.all([registry(),legacyBytes()]),movies=reg?.movies||[],local=movies.reduce((n,m)=>n+m.size,0);
    return {movies,space:{limit:LIMIT,used:local+oldBytes,local,legacy:oldBytes,online:!!(host?.connected&&host.data.ready),bound:!!reg}};
  }
  async function find(id){return (await registry())?.movies?.find(m=>m.id===id);}
  function online(){if(!host?.connected||!host.data.ready)throw fail(503,'ПК Fifflaren с библиотекой не подключён к кинозалу.');return host;}
  async function remove(id){
    const sock=online(),r=await sock.timeout(15000).emitWithAck('remove',id);
    if(!r?.ok)throw fail(409,r?.error||'ПК не подтвердил удаление.');
    await keys.updateOne({_id:'pc-library',hostId:sock.data.hostId},{$pull:{movies:{id}}});cache.clear();
  }
  function block(sock,m,offset){
    if(sock!==host||!sock.connected)throw fail(503,'Источник фильма отключился.');
    const key=m.id+'/'+offset;if(cache.has(key))return cache.get(key);
    const load=sock.timeout(15000).emitWithAck('read',{id:m.id,offset}).then(bytes=>{
      if(!Buffer.isBuffer(bytes)||bytes.length!==Math.min(PART,m.size-offset))throw fail(503,'ПК не передал запрошенную часть фильма.');return bytes;
    }).catch(e=>{cache.delete(key);throw e;});
    cache.set(key,load);if(cache.size>64)cache.delete(cache.keys().next().value);return load;
  }
  async function stream(req,res,m,range){
    const sock=online(),span=range(req.headers.range,m.size);if(!span)return res.set('Content-Range','bytes */'+m.size).sendStatus(416);
    const {start,end}=span,partial=!!req.headers.range;
    res.status(partial?206:200).type(m.mime).set({'Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    if(partial)res.set('Content-Range','bytes '+start+'-'+end+'/'+m.size);if(req.method==='HEAD')return res.end();
    async function* chunks(){for(let at=Math.floor(start/PART)*PART;at<=end;at+=PART){
      if(res.destroyed)return;const data=await block(sock,m,at);yield data.subarray(Math.max(0,start-at),Math.min(data.length,end-at+1));
    }}
    await pipeline(Readable.from(chunks()),res);
  }
  return {catalog,find,stream,remove,run,online};
}
module.exports={create,LIMIT,PART};
