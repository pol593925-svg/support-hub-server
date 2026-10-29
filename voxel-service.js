'use strict';
const C=require('./voxel-core');
const WORLD='support-main-v1';
module.exports=function install({io,mongoose,authenticate}){
 const worldSchema=new mongoose.Schema({_id:String,seed:Number,name:String,createdAt:Date,storage:String,generation:Number},{versionKey:false});
 const chunkSchema=new mongoose.Schema({world:String,cx:Number,cz:Number,blocks:{type:Map,of:Number,default:{}},revision:{type:Number,default:0}},{versionKey:false});
 chunkSchema.index({world:1,cx:1,cz:1},{unique:true});
 const playerSchema=new mongoose.Schema({_id:String,inventory:{type:Map,of:Number,default:{}},pos:[Number],updatedAt:Date},{versionKey:false});
 const World=mongoose.model('HubVoxelWorld',worldSchema),Chunk=mongoose.model('HubVoxelChunk',chunkSchema),Player=mongoose.model('HubVoxelPlayer',playerSchema);
 const ns=io.of('/voxel'),players=new Map();let queue=Promise.resolve(),worldPromise,queued=0;
 const storage=w=>w.storage||WORLD;
 const initialInventory=()=>({6:16,104:1});
 const world=()=>worldPromise||(worldPromise=World.findOneAndUpdate({_id:WORLD},{$setOnInsert:{seed:758321,name:'Общий мир Support Hub',createdAt:new Date()}},{upsert:true,returnDocument:'after'}).lean().catch(e=>{worldPromise=null;throw e;}));
 const inventory=p=>Object.fromEntries(Object.entries(p.inventory||{}).filter(([,n])=>n>0));
 const enqueue=fn=>{queued++;const next=queue.then(fn).finally(()=>queued--);queue=next.catch(()=>{});return next;};
 async function cell(x,y,z,seed,session){const w=await world();const [cx,cz]=C.chunk(x,z);let query=Chunk.findOne({world:storage(w),cx,cz}).lean();if(session)query=query.session(session);const doc=await query;return doc?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,seed);}
 const publicPlayer=p=>({nick:p.nick,pos:p.pos,yaw:p.yaw||0});
 const roster=()=>[...players.values()].filter(p=>p.joined).map(publicPlayer);
 async function leave(socket){const p=players.get(socket.id);if(!p)return;players.delete(socket.id);socket.leave(WORLD);if(p.joined){await Player.updateOne({_id:p.id},{$set:{pos:p.pos,updatedAt:new Date()}});ns.to(WORLD).emit('players',roster());}}
 ns.use(async(socket,next)=>{try{const user=await authenticate(socket.handshake.auth?.token);if(!user)return next(Error('Войди заново в Support Hub для игры.'));socket.data.nick=user.username.toLowerCase();next();}catch{next(Error('Не удалось проверить вход. Попробуй позже.'));}});
 ns.on('connection',socket=>{
  let requests=0,windowAt=Date.now();
  function rpc(name,fn){socket.on(name,async(data,ack)=>{if(typeof ack!=='function')return;try{if(Date.now()-windowAt>1000){windowAt=Date.now();requests=0;}if(++requests>25)throw Error('Слишком много запросов');if(['edit','craft','mine'].includes(name)&&queued>=128)throw Error('Мир занят, повтори через секунду');ack({ok:true,...await fn(data||{})});}catch(error){if(error.name==='MongoServerError')console.error('Voxel '+name+': '+error.message);ack({ok:false,error:error.message.includes('транзак')?error.message: error.name==='MongoServerError'?'Сохранение недоступно. Изменение не применено.':error.message});}});}
  rpc('info',async()=>({world:await world(),online:roster().length,canReset:socket.data.nick==='fifflaren'}));
  rpc('join',()=>enqueue(async()=>{
   if(players.get(socket.id)?.joined){const p=players.get(socket.id);return {world:await world(),pos:p.pos,inventory:p.inventory,players:roster()};}
   const nick=socket.data.nick;
   for(const [id,p]of players)if(p.nick===nick&&id!==socket.id){const old=ns.sockets.get(id);if(old){await leave(old);old.emit('replaced');old.disconnect(true);}}
   const w=await world(),spawn=[.5,C.height(0,0,w.seed)+2,.5];
   const playerId=storage(w)===WORLD?nick:storage(w)+'/'+nick;
   const stored=await Player.findOneAndUpdate({_id:playerId},{$setOnInsert:{inventory:initialInventory(),pos:spawn,updatedAt:new Date()}},{upsert:true,returnDocument:'after'}).lean();
   let pos=C.validPos(stored.pos)?stored.pos:spawn;
   pos=[Math.floor(pos[0])+.5,Math.max(1,Math.ceil(pos[1])),Math.floor(pos[2])+.5];
   while(pos[1]<C.HEIGHT&&(C.solid(await cell(Math.floor(pos[0]),pos[1],Math.floor(pos[2]),w.seed))||C.solid(await cell(Math.floor(pos[0]),pos[1]+1,Math.floor(pos[2]),w.seed))))pos[1]++;
   const p={nick,id:playerId,pos,inventory:inventory(stored),joined:true,lastMove:Date.now(),lastEdit:0};players.set(socket.id,p);await socket.join(WORLD);ns.to(WORLD).emit('players',roster());return {world:w,pos,inventory:p.inventory,players:roster()};
  }));
  rpc('chunks',async data=>{const w=await world();const p=players.get(socket.id);if(!p)throw Error('Сначала присоединись');const center=C.chunk(p.pos[0],p.pos[2]);if(!Array.isArray(data.coords)||data.coords.length>25)throw Error('Неверный запрос территории');const coords=data.coords.filter(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isInteger)&&Math.abs(v[0]-center[0])<=4&&Math.abs(v[1]-center[1])<=4);const docs=coords.length?await Chunk.find({world:storage(w),$or:coords.map(([cx,cz])=>({cx,cz}))}).lean():[];return {chunks:coords.map(([cx,cz])=>docs.find(d=>d.cx===cx&&d.cz===cz)||{cx,cz,blocks:{},revision:0})};});
  rpc('mine',data=>enqueue(async()=>{
   const p=players.get(socket.id);if(!p||!C.validCell(data.at))throw Error('Неверный блок');
   const [x,y,z]=data.at;if(Math.hypot(x+.5-p.pos[0],y+.5-p.pos[1]-1.6,z+.5-p.pos[2])>6)throw Error('Блок слишком далеко');
   const tool=Number.isInteger(data.tool)&&p.inventory[data.tool]>0?data.tool:0,w=await world(),id=await cell(x,y,z,w.seed),rule=C.mining(id,tool);if(!rule)throw Error('Этот блок нельзя добыть');
   p.mining={at:data.at.join(','),id,tool,start:Date.now(),ms:rule.ms,harvest:rule.harvest};return {duration:rule.ms,harvest:rule.harvest};
  }));
  rpc('mine_cancel',()=>enqueue(()=>{const p=players.get(socket.id);if(p)p.mining=null;return {};}));
  rpc('edit',data=>enqueue(async()=>{
   const p=players.get(socket.id),w=await world();if(!p||!C.validCell(data.at)||!['break','place'].includes(data.action))throw Error('Неверное действие');
   const [x,y,z]=data.at;if(Math.hypot(x+.5-p.pos[0],y+.5-(p.pos[1]+1.6),z+.5-p.pos[2])>6)throw Error('Блок слишком далеко');if(Date.now()-p.lastEdit<140)throw Error('Подожди перед следующим действием');p.lastEdit=Date.now();
   const [cx,cz]=C.chunk(x,z),blockKey=C.key(x,y,z);let result;
   await mongoose.connection.transaction(async session=>{
    const doc=await Chunk.findOne({world:storage(w),cx,cz}).session(session).lean(),old=doc?.blocks?.[blockKey]??C.terrain(x,y,z,w.seed),bag={...p.inventory};let id;
    if(data.action==='break'){
     const mine=p.mining;if(!mine||mine.at!==data.at.join(',')||mine.id!==old)throw Error('Удерживай ЛКМ на блоке для добычи');
     if(Date.now()-mine.start<mine.ms)throw Error('Блок ещё не разрушен');
     if(mine.tool&&!(bag[mine.tool]>0))throw Error('Инструмент недоступен');
     id=0;if(mine.harvest&&old!==8){const item=C.blocks[old].drop||(old===1?2:old);bag[item]=(bag[item]||0)+1;if(bag[item]>9999)throw Error('Инвентарь заполнен');}
    }else{
     id=data.block;const b=C.blocks[id];if(!Number.isInteger(id)||!b||id===0||b.unbreakable||b.fluid||!(bag[id]>0))throw Error('Нет такого блока в инвентаре');if(C.solid(old))throw Error('Место уже занято');if([...players.values()].some(q=>C.intersects(q.pos,x,y,z)))throw Error('Здесь стоит игрок');bag[id]--;
    }
    const changed=await Chunk.findOneAndUpdate({world:storage(w),cx,cz},{$set:{['blocks.'+blockKey]:id},$inc:{revision:1}},{upsert:true,returnDocument:'after',session}).lean();
    await Player.updateOne({_id:p.id},{$set:{inventory:bag,pos:p.pos,updatedAt:new Date()}},{session});result={cx,cz,key:blockKey,block:id,revision:changed.revision,inventory:bag};
   });
   p.mining=null;p.inventory=result.inventory;const {inventory:bag,...change}=result;ns.to(WORLD).emit('block',change);return {inventory:bag,saved:true};
  }));
  rpc('craft',data=>enqueue(async()=>{const p=players.get(socket.id);if(!p)throw Error('Сначала присоединись');const r=data.grid?C.matchRecipe(data.grid):C.recipes.find(r=>r.id===data.id);if(!r)throw Error('Неизвестный рецепт');if(data.grid&&data.grid.length===2&&r.station)throw Error('Нужен верстак');
   if(r.station){const w=await world(),[px,py,pz]=p.pos.map(Math.floor);let found=false;const coords=new Set();for(let x=px-3;x<=px+3;x++)for(let z=pz-3;z<=pz+3;z++)coords.add(C.chunk(x,z).join(','));const docs=await Chunk.find({world:storage(w),$or:[...coords].map(k=>{const[cx,cz]=k.split(',').map(Number);return{cx,cz};})}).lean();for(let x=px-3;x<=px+3;x++)for(let z=pz-3;z<=pz+3;z++)for(let y=Math.max(1,py-2);y<=py+2;y++){const[cx,cz]=C.chunk(x,z),d=docs.find(d=>d.cx===cx&&d.cz===cz);if((d?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,w.seed))===r.station)found=true;}if(!found)throw Error('Рядом нужен '+C.blocks[r.station].name.toLowerCase());}
   const bag=C.craft(p.inventory,r.id);await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}});p.inventory=bag;return {inventory:bag,saved:true};
  }));
  rpc('reset_world',data=>enqueue(async()=>{
   if(socket.data.nick!=='fifflaren')throw Error('Новый мир может создать только Fifflaren');
   if(data.confirm!=='НОВЫЙ МИР')throw Error('Введи НОВЫЙ МИР для подтверждения');
   const previous=await world();if(Date.now()-new Date(previous.createdAt).getTime()<30000&&previous.generation===2)throw Error('Подожди 30 секунд перед новым сбросом');
   const nextStorage='world-'+require('crypto').randomUUID(),nextSeed=-require('crypto').randomInt(1,2000000000);
   // Archive current players under their existing generation before switching the head.
   for(const p of players.values())await Player.updateOne({_id:p.id},{$set:{pos:p.pos,updatedAt:new Date()}});
   await World.updateOne({_id:'archive/'+storage(previous)},{$setOnInsert:{seed:previous.seed,name:previous.name,storage:storage(previous),generation:previous.generation||1,createdAt:previous.createdAt}},{upsert:true});
   const next=await World.findOneAndUpdate({_id:WORLD},{$set:{storage:nextStorage,seed:nextSeed,generation:2,createdAt:new Date()}},{returnDocument:'after'}).lean();worldPromise=Promise.resolve(next);
   for(const id of players.keys())ns.sockets.get(id)?.leave(WORLD);players.clear();ns.emit('world_reset',{name:next.name});return {world:next};
  }));
  rpc('leave',()=>enqueue(async()=>{await leave(socket);return {};}));
  socket.on('move',data=>{const p=players.get(socket.id);if(!p||!C.validPos(data?.pos))return;const now=Date.now(),dt=Math.min(2,(now-p.lastMove)/1000);if(dt<.075)return;if(Math.hypot(data.pos[0]-p.pos[0],data.pos[2]-p.pos[2])>dt*12+1){socket.emit('correct',p.pos);return;}p.pos=data.pos;p.yaw=Number.isFinite(data.yaw)?data.yaw:0;p.lastMove=now;socket.to(WORLD).volatile.emit('move',publicPlayer(p));});
  socket.on('disconnect',()=>{enqueue(()=>leave(socket)).catch(e=>console.error('Voxel leave: '+e.message));});
 });
 const saveTimer=setInterval(()=>{enqueue(async()=>{for(const p of players.values())await Player.updateOne({_id:p.id},{$set:{pos:p.pos,updatedAt:new Date()}});}).catch(e=>console.error('Voxel position save: '+e.message));},30000);saveTimer.unref();
 return {World,Chunk,Player};
};
