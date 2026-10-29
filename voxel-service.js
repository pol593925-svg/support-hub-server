'use strict';
const C=require('./voxel-core');
const WORLD='support-main-v1';
module.exports=function install({io,mongoose,authenticate}){
 const worldSchema=new mongoose.Schema({_id:String,seed:Number,name:String,createdAt:Date,storage:String,generation:Number},{versionKey:false});
 const chunkSchema=new mongoose.Schema({world:String,cx:Number,cz:Number,blocks:{type:Map,of:Number,default:{}},revision:{type:Number,default:0}},{versionKey:false});
 chunkSchema.index({world:1,cx:1,cz:1},{unique:true});
 const playerSchema=new mongoose.Schema({_id:String,inventory:{type:Map,of:Number,default:{}},pos:[Number],health:{type:Number,default:20},hunger:{type:Number,default:20},air:{type:Number,default:10},exhaustion:{type:Number,default:0},wear:{type:Map,of:Number,default:{}},updatedAt:Date},{versionKey:false});
 const furnaceSchema=new mongoose.Schema({_id:String,world:String,at:[Number],jobs:[{recipe:String,readyAt:Number,out:{type:Map,of:Number},_id:false}]},{versionKey:false});
 const Furnace=mongoose.model('HubVoxelFurnace',furnaceSchema);
 const World=mongoose.model('HubVoxelWorld',worldSchema),Chunk=mongoose.model('HubVoxelChunk',chunkSchema),Player=mongoose.model('HubVoxelPlayer',playerSchema);
 const ns=io.of('/voxel'),players=new Map();let queue=Promise.resolve(),worldPromise,queued=0;
 const storage=w=>w.storage||WORLD;
 const initialInventory=()=>({6:16,104:1,118:3});
 const world=()=>worldPromise||(worldPromise=World.findOneAndUpdate({_id:WORLD},{$setOnInsert:{seed:758321,name:'Общий мир Support Hub',createdAt:new Date()}},{upsert:true,returnDocument:'after'}).lean().catch(e=>{worldPromise=null;throw e;}));
 const inventory=p=>Object.fromEntries(Object.entries(p.inventory||{}).filter(([,n])=>n>0));
 const enqueue=fn=>{queued++;const next=queue.then(fn).finally(()=>queued--);queue=next.catch(()=>{});return next;};
 async function cell(x,y,z,seed,session){const w=await world();const [cx,cz]=C.chunk(x,z);let query=Chunk.findOne({world:storage(w),cx,cz}).lean();if(session)query=query.session(session);const doc=await query;return doc?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,seed);}
 const vitals=p=>({health:p.health,hunger:p.hunger,air:p.air});
 const savedVitals=p=>({...vitals(p),exhaustion:p.exhaustion});
 const live=socket=>{const p=players.get(socket.id);if(!p)throw Error('Сначала присоединись');if(p.health<=0)throw Error('Сначала возродись');return p;};
 async function safeSpawn(w){const pos=[.5,C.height(0,0,w.seed)+2,.5];while(pos[1]<C.HEIGHT&&(C.solid(await cell(0,pos[1],0,w.seed))||C.solid(await cell(0,pos[1]+1,0,w.seed))))pos[1]++;return pos;}
 async function furnaceAt(p,at,session){if(!C.validCell(at)||Math.hypot(at[0]+.5-p.pos[0],at[1]+.5-p.pos[1]-1,at[2]+.5-p.pos[2])>5)throw Error('Подойди к печи');const w=await world();if(await cell(...at,w.seed,session)!==15)throw Error('Здесь нет печи');return {w,id:storage(w)+'/'+at.join(',')};}
 const publicPlayer=p=>({nick:p.nick,pos:p.pos,yaw:p.yaw||0});
 const roster=()=>[...players.values()].filter(p=>p.joined).map(publicPlayer);
 async function leave(socket){const p=players.get(socket.id);if(!p)return;players.delete(socket.id);socket.leave(WORLD);if(p.joined){await Player.updateOne({_id:p.id},{$set:{pos:p.pos,...savedVitals(p),updatedAt:new Date()}});ns.to(WORLD).emit('players',roster());}}
 ns.use(async(socket,next)=>{try{const user=await authenticate(socket.handshake.auth?.token);if(!user)return next(Error('Войди заново в Support Hub для игры.'));socket.data.nick=user.username.toLowerCase();next();}catch{next(Error('Не удалось проверить вход. Попробуй позже.'));}});
 ns.on('connection',socket=>{
  let requests=0,windowAt=Date.now();
  function rpc(name,fn){socket.on(name,async(data,ack)=>{if(typeof ack!=='function')return;try{if(Date.now()-windowAt>1000){windowAt=Date.now();requests=0;}if(++requests>25)throw Error('Слишком много запросов');if(['edit','craft','mine','smelt','furnace','collect_furnace','eat','respawn'].includes(name)&&queued>=128)throw Error('Мир занят, повтори через секунду');ack({ok:true,...await fn(data||{})});}catch(error){if(error.name==='MongoServerError')console.error('Voxel '+name+': '+error.message);ack({ok:false,error:error.message.includes('транзак')?error.message: error.name==='MongoServerError'?'Сохранение недоступно. Изменение не применено.':error.message});}});}
  rpc('info',async()=>({world:await world(),online:roster().length,canReset:socket.data.nick==='fifflaren'}));
  rpc('join',()=>enqueue(async()=>{
   if(players.get(socket.id)?.joined){const p=players.get(socket.id);return {world:await world(),pos:p.pos,inventory:p.inventory,wear:p.wear,vitals:vitals(p),players:roster()};}
   const nick=socket.data.nick;
   for(const [id,p]of players)if(p.nick===nick&&id!==socket.id){const old=ns.sockets.get(id);if(old){await leave(old);old.emit('replaced');old.disconnect(true);}}
   const w=await world(),spawn=[.5,C.height(0,0,w.seed)+2,.5];
   const playerId=storage(w)===WORLD?nick:storage(w)+'/'+nick;
   const stored=await Player.findOneAndUpdate({_id:playerId},{$setOnInsert:{inventory:initialInventory(),pos:spawn,updatedAt:new Date()}},{upsert:true,returnDocument:'after'}).lean();
   let pos=C.validPos(stored.pos)?stored.pos:spawn;
   pos=[Math.floor(pos[0])+.5,Math.max(1,Math.ceil(pos[1])),Math.floor(pos[2])+.5];
   while(pos[1]<C.HEIGHT&&(C.solid(await cell(Math.floor(pos[0]),pos[1],Math.floor(pos[2]),w.seed))||C.solid(await cell(Math.floor(pos[0]),pos[1]+1,Math.floor(pos[2]),w.seed))))pos[1]++;
   const p={nick,id:playerId,pos,inventory:inventory(stored),wear:{...(stored.wear||{})},health:stored.health??20,hunger:stored.hunger??20,air:stored.air??10,exhaustion:stored.exhaustion||0,fallPeak:pos[1],regenAt:Date.now(),joined:true,lastMove:Date.now(),lastEdit:0};players.set(socket.id,p);await socket.join(WORLD);ns.to(WORLD).emit('players',roster());return {world:w,pos,inventory:p.inventory,wear:p.wear,vitals:vitals(p),players:roster()};
  }));
  rpc('chunks',async data=>{const w=await world();const p=players.get(socket.id);if(!p)throw Error('Сначала присоединись');const center=C.chunk(p.pos[0],p.pos[2]);if(!Array.isArray(data.coords)||data.coords.length>25)throw Error('Неверный запрос территории');const coords=data.coords.filter(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isInteger)&&Math.abs(v[0]-center[0])<=4&&Math.abs(v[1]-center[1])<=4);const docs=coords.length?await Chunk.find({world:storage(w),$or:coords.map(([cx,cz])=>({cx,cz}))}).lean():[];return {chunks:coords.map(([cx,cz])=>docs.find(d=>d.cx===cx&&d.cz===cz)||{cx,cz,blocks:{},revision:0})};});
  rpc('mine',data=>enqueue(async()=>{
   const p=live(socket);if(!C.validCell(data.at))throw Error('Неверный блок');
   const [x,y,z]=data.at;if(Math.hypot(x+.5-p.pos[0],y+.5-p.pos[1]-1.6,z+.5-p.pos[2])>6)throw Error('Блок слишком далеко');
   const tool=Number.isInteger(data.tool)&&p.inventory[data.tool]>0?data.tool:0,w=await world(),id=await cell(x,y,z,w.seed),rule=C.mining(id,tool);if(!rule)throw Error('Этот блок нельзя добыть');
   p.mining={at:data.at.join(','),id,tool,start:Date.now(),ms:rule.ms,harvest:rule.harvest};return {duration:rule.ms,harvest:rule.harvest};
  }));
  rpc('mine_cancel',()=>enqueue(()=>{const p=players.get(socket.id);if(p)p.mining=null;return {};}));
  rpc('edit',data=>enqueue(async()=>{
   const p=live(socket),w=await world();if(!C.validCell(data.at)||!['break','place'].includes(data.action))throw Error('Неверное действие');
   const [x,y,z]=data.at;if(Math.hypot(x+.5-p.pos[0],y+.5-(p.pos[1]+1.6),z+.5-p.pos[2])>6)throw Error('Блок слишком далеко');if(Date.now()-p.lastEdit<140)throw Error('Подожди перед следующим действием');p.lastEdit=Date.now();
   const [cx,cz]=C.chunk(x,z),blockKey=C.key(x,y,z);let result;
   await mongoose.connection.transaction(async session=>{
    const doc=await Chunk.findOne({world:storage(w),cx,cz}).session(session).lean(),old=doc?.blocks?.[blockKey]??C.terrain(x,y,z,w.seed),bag={...p.inventory};let id,wear={...p.wear},broke=false;
    if(data.action==='break'){
     const mine=p.mining;if(!mine||mine.at!==data.at.join(',')||mine.id!==old)throw Error('Удерживай ЛКМ на блоке для добычи');
     if(Date.now()-mine.start<mine.ms)throw Error('Блок ещё не разрушен');
     if(mine.tool&&!(bag[mine.tool]>0))throw Error('Инструмент недоступен');
     if(old===15){const furnace=await Furnace.findById(storage(w)+'/'+data.at.join(',')).session(session).lean();if(furnace?.jobs?.length)throw Error('Сначала забери содержимое печи');await Furnace.deleteOne({_id:storage(w)+'/'+data.at.join(',')},{session});}
     const worn=C.wearTool(bag,wear,mine.tool);Object.assign(bag,worn.inventory);wear=worn.wear;broke=worn.broke;
     if((old===5||old===23)&&C.hash(x+y*13,z,w.seed+82)>.75)bag[118]=(bag[118]||0)+1;
     if(old===21)bag[119]=(bag[119]||0)+1;
     id=0;if(mine.harvest&&old!==8){const item=C.blocks[old].drop||(old===1?2:old);bag[item]=(bag[item]||0)+1;if(bag[item]>9999)throw Error('Инвентарь заполнен');}
    }else{
     id=data.block;const b=C.blocks[id];if(!Number.isInteger(id)||!b||id===0||b.unbreakable||b.fluid||!(bag[id]>0))throw Error('Нет такого блока в инвентаре');if(C.solid(old))throw Error('Место уже занято');if([...players.values()].some(q=>C.intersects(q.pos,x,y,z)))throw Error('Здесь стоит игрок');bag[id]--;
    }
    if(Object.values(bag).some(n=>n>9999))throw Error('Инвентарь заполнен');
    const changed=await Chunk.findOneAndUpdate({world:storage(w),cx,cz},{$set:{['blocks.'+blockKey]:id},$inc:{revision:1}},{upsert:true,returnDocument:'after',session}).lean();
    await Player.updateOne({_id:p.id},{$set:{inventory:bag,wear,pos:p.pos,updatedAt:new Date()}},{session});result={cx,cz,key:blockKey,block:id,revision:changed.revision,inventory:bag,wear,broke};
   });
   p.exhaustion+=data.action==='break'?.025:0;p.mining=null;p.inventory=result.inventory;p.wear=result.wear;const {inventory:bag,wear,broke,...change}=result;ns.to(WORLD).emit('block',change);return {inventory:bag,wear,broke,saved:true};
  }));
  rpc('craft',data=>enqueue(async()=>{const p=live(socket);const r=data.grid?C.matchRecipe(data.grid):C.recipes.find(r=>r.id===data.id);if(!r)throw Error('Неизвестный рецепт');if(data.grid&&data.grid.length===2&&r.station)throw Error('Нужен верстак');
   if(r.station===15)throw Error('Открой печь и запусти плавку');
   if(r.station){const w=await world(),[px,py,pz]=p.pos.map(Math.floor);let found=false;const coords=new Set();for(let x=px-3;x<=px+3;x++)for(let z=pz-3;z<=pz+3;z++)coords.add(C.chunk(x,z).join(','));const docs=await Chunk.find({world:storage(w),$or:[...coords].map(k=>{const[cx,cz]=k.split(',').map(Number);return{cx,cz};})}).lean();for(let x=px-3;x<=px+3;x++)for(let z=pz-3;z<=pz+3;z++)for(let y=Math.max(1,py-2);y<=py+2;y++){const[cx,cz]=C.chunk(x,z),d=docs.find(d=>d.cx===cx&&d.cz===cz);if((d?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,w.seed))===r.station)found=true;}if(!found)throw Error('Рядом нужен '+C.blocks[r.station].name.toLowerCase());}
   const bag=C.craft(p.inventory,r.id);await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}});p.inventory=bag;return {inventory:bag,saved:true};
  }));
  rpc('eat',data=>enqueue(async()=>{const p=live(socket);const result=C.consume(p.inventory,vitals(p),data.item);await Player.updateOne({_id:p.id},{$set:{inventory:result.inventory,...result.vitals,updatedAt:new Date()}});p.inventory=result.inventory;p.hunger=result.vitals.hunger;return {...result,wear:p.wear};}));
  rpc('respawn',()=>enqueue(async()=>{const p=players.get(socket.id);if(!p||p.health>0)throw Error('Возрождение недоступно');const pos=await safeSpawn(await world());await Player.updateOne({_id:p.id},{$set:{pos,health:20,hunger:20,air:10,exhaustion:0,updatedAt:new Date()}});Object.assign(p,{pos,health:20,hunger:20,air:10,exhaustion:0,fallPeak:pos[1],lastMove:Date.now(),mining:null});socket.to(WORLD).emit('move',publicPlayer(p));return {pos,vitals:vitals(p)};}));
  rpc('furnace',data=>enqueue(async()=>{const p=live(socket),{id}=await furnaceAt(p,data.at);const doc=await Furnace.findById(id).lean();return {jobs:doc?.jobs||[],now:Date.now()};}));
  rpc('smelt',data=>enqueue(async()=>{const p=live(socket),r=C.recipes.find(r=>r.id===data.id&&r.station===15);if(!r)throw Error('Неизвестный рецепт печи');let result;
   await mongoose.connection.transaction(async session=>{const {w,id}=await furnaceAt(p,data.at,session),doc=await Furnace.findById(id).session(session).lean(),jobs=(doc?.jobs||[]).map(j=>({recipe:j.recipe,readyAt:j.readyAt,out:j.out}));if(jobs.length>=8)throw Error('Очередь печи заполнена');const bag={...p.inventory};for(const [item,count]of Object.entries(r.in)){if((bag[item]||0)<count)throw Error('Не хватает ресурсов или топлива');bag[item]-=count;}jobs.push({recipe:r.id,out:{...r.out},readyAt:Math.max(Date.now(),...jobs.map(j=>j.readyAt))+r.smeltMs});await Furnace.updateOne({_id:id},{$set:{world:storage(w),at:data.at,jobs}},{upsert:true,session});await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}},{session});result={inventory:bag,jobs,now:Date.now()};});p.inventory=result.inventory;return result;
  }));
  rpc('collect_furnace',data=>enqueue(async()=>{const p=live(socket);let result;
   await mongoose.connection.transaction(async session=>{const {id}=await furnaceAt(p,data.at,session),doc=await Furnace.findById(id).session(session).lean(),bag={...p.inventory},now=Date.now(),ready=(doc?.jobs||[]).filter(j=>j.readyAt<=now);if(!ready.length)throw Error('Плавка ещё идёт');for(const job of ready)for(const [item,count]of Object.entries(job.out||C.recipes.find(r=>r.id===job.recipe).out)){bag[item]=(bag[item]||0)+count;if(bag[item]>9999)throw Error('Инвентарь заполнен');}const jobs=doc.jobs.filter(j=>j.readyAt>now).map(j=>({recipe:j.recipe,readyAt:j.readyAt,out:j.out}));await Furnace.updateOne({_id:id},{$set:{jobs}},{session});await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}},{session});result={inventory:bag,jobs,now};});p.inventory=result.inventory;return result;
  }));
  rpc('reset_world',data=>enqueue(async()=>{
   if(socket.data.nick!=='fifflaren')throw Error('Новый мир может создать только Fifflaren');
   if(data.confirm!=='НОВЫЙ МИР')throw Error('Введи НОВЫЙ МИР для подтверждения');
   const previous=await world();if(Date.now()-new Date(previous.createdAt).getTime()<30000&&previous.generation===2)throw Error('Подожди 30 секунд перед новым сбросом');
   const nextStorage='world-'+require('crypto').randomUUID(),nextSeed=-require('crypto').randomInt(1,2000000000);
   // Archive current players under their existing generation before switching the head.
   for(const p of players.values())await Player.updateOne({_id:p.id},{$set:{pos:p.pos,...savedVitals(p),updatedAt:new Date()}});
   await World.updateOne({_id:'archive/'+storage(previous)},{$setOnInsert:{seed:previous.seed,name:previous.name,storage:storage(previous),generation:previous.generation||1,createdAt:previous.createdAt}},{upsert:true});
   const next=await World.findOneAndUpdate({_id:WORLD},{$set:{storage:nextStorage,seed:nextSeed,generation:2,createdAt:new Date()}},{returnDocument:'after'}).lean();worldPromise=Promise.resolve(next);
   for(const id of players.keys())ns.sockets.get(id)?.leave(WORLD);players.clear();ns.emit('world_reset',{name:next.name});return {world:next};
  }));
  rpc('leave',()=>enqueue(async()=>{await leave(socket);return {};}));
  socket.on('move',data=>{const p=players.get(socket.id);if(!p||p.health<=0||!C.validPos(data?.pos))return;const now=Date.now(),dt=Math.min(2,(now-p.lastMove)/1000);if(dt<.075)return;if(Math.hypot(data.pos[0]-p.pos[0],data.pos[2]-p.pos[2])>dt*12+1){socket.emit('correct',p.pos);return;}p.exhaustion+=Math.hypot(data.pos[0]-p.pos[0],data.pos[2]-p.pos[2])*.02;p.fallPeak=Math.max(p.fallPeak,data.pos[1]);p.pos=data.pos;p.yaw=Number.isFinite(data.yaw)?data.yaw:0;p.lastMove=now;socket.to(WORLD).volatile.emit('move',publicPlayer(p));});
  socket.on('disconnect',()=>{enqueue(()=>leave(socket)).catch(e=>console.error('Voxel leave: '+e.message));});
 });
 let ticking=false;
 const survivalTimer=setInterval(()=>{if(ticking||!players.size||queued>=128)return;ticking=true;enqueue(async()=>{
  if(!players.size)return;const w=await world(),coords=new Set();for(const p of players.values())for(const dx of [-1,0,1])for(const dz of [-1,0,1])coords.add(C.chunk(Math.floor(p.pos[0])+dx,Math.floor(p.pos[2])+dz).join(','));
  const docs=await Chunk.find({world:storage(w),$or:[...coords].map(k=>{const[cx,cz]=k.split(',').map(Number);return {cx,cz};})}).lean(),byChunk=new Map(docs.map(d=>[d.cx+','+d.cz,d]));const get=(x,y,z)=>byChunk.get(C.chunk(x,z).join(','))?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,w.seed);
  for(const [sid,p]of players){if(p.health<=0)continue;const next={...p},[x,y,z]=p.pos.map(Math.floor),wet=get(x,Math.floor(p.pos[1]+1.6),z)===12,feet=get(x,Math.floor(p.pos[1]-.08),z),ground=C.solid(feet);let cause='';
   if(wet){next.air=Math.max(0,p.air-1);next.fallPeak=p.pos[1];if(!next.air){next.health-=2;cause='Закончился воздух';}}else next.air=10;
   if(ground){const fall=p.fallPeak-p.pos[1];if(fall>3){next.health-=Math.floor(fall-3);cause='Падение';}next.fallPeak=p.pos[1];}else if(get(x,y,z)===12)next.fallPeak=p.pos[1];
   const touchingCactus=[[x,y,z],[Math.floor(p.pos[0]-.3),y,z],[Math.floor(p.pos[0]+.3),y,z],[x,y,Math.floor(p.pos[2]-.3)],[x,y,Math.floor(p.pos[2]+.3)],[x,Math.floor(p.pos[1]-.08),z]].some(at=>get(...at)===21);if(touchingCactus){next.health--;cause='Кактус';}
   if(p.exhaustion>=4){next.hunger=Math.max(0,p.hunger-Math.floor(p.exhaustion/4));next.exhaustion=p.exhaustion%4;}
   if(Date.now()-p.regenAt>=4000){next.regenAt=Date.now();if(next.hunger>=18&&next.health>0&&next.health<20&&!wet&&!touchingCactus){next.health++;next.exhaustion+=4;}else if(next.hunger===0&&next.health>1){next.health--;cause='Голод';}}
   next.health=Math.max(0,next.health);const changed=next.health!==p.health||next.hunger!==p.hunger||next.air!==p.air||next.exhaustion!==p.exhaustion;
   if(changed)await Player.updateOne({_id:p.id},{$set:{...savedVitals(next),updatedAt:new Date()}});Object.assign(p,{...savedVitals(next),fallPeak:next.fallPeak,regenAt:next.regenAt});if(!p.health)p.mining=null;if(changed)ns.sockets.get(sid)?.emit('vitals',{...vitals(p),cause});
  }
 }).catch(e=>console.error('Voxel survival: '+e.message)).finally(()=>ticking=false);},1000);survivalTimer.unref();
 const saveTimer=setInterval(()=>{enqueue(async()=>{for(const p of players.values())await Player.updateOne({_id:p.id},{$set:{pos:p.pos,...savedVitals(p),updatedAt:new Date()}});}).catch(e=>console.error('Voxel position save: '+e.message));},30000);saveTimer.unref();
 io.httpServer?.once('close',()=>{clearInterval(saveTimer);clearInterval(survivalTimer);});
 return {World,Chunk,Player,Furnace};
};
