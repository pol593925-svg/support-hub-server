'use strict';
const C=require('./voxel-core');
const WORLD='support-main-v1';
module.exports=function install({io,mongoose,authenticate}){
 const worldSchema=new mongoose.Schema({_id:String,seed:Number,name:String,createdAt:Date,storage:String,generation:Number},{versionKey:false});
 const chunkSchema=new mongoose.Schema({world:String,cx:Number,cz:Number,blocks:{type:Map,of:Number,default:{}},revision:{type:Number,default:0},fluidPending:{type:Boolean,default:false}},{versionKey:false});
 chunkSchema.index({world:1,cx:1,cz:1},{unique:true});
 chunkSchema.index({world:1,fluidPending:1});
 const playerSchema=new mongoose.Schema({_id:String,inventory:{type:Map,of:Number,default:{}},pos:[Number],health:{type:Number,default:20},hunger:{type:Number,default:20},air:{type:Number,default:10},exhaustion:{type:Number,default:0},wear:{type:Map,of:Number,default:{}},lastFlowerVisit:String,updatedAt:Date},{versionKey:false});
 const furnaceSchema=new mongoose.Schema({_id:String,world:String,at:[Number],jobs:[{recipe:String,readyAt:Number,out:{type:Map,of:Number},_id:false}]},{versionKey:false});
 const Chest=mongoose.model('HubVoxelChest',new mongoose.Schema({_id:String,world:String,at:[Number],contents:{type:Map,of:Number,default:{}}},{versionKey:false}));
 const Crop=mongoose.model('HubVoxelCrop',new mongoose.Schema({_id:String,world:String,at:[Number],readyAt:Number},{versionKey:false}));
 const Furnace=mongoose.model('HubVoxelFurnace',furnaceSchema);
 const World=mongoose.model('HubVoxelWorld',worldSchema),Chunk=mongoose.model('HubVoxelChunk',chunkSchema),Player=mongoose.model('HubVoxelPlayer',playerSchema);
 const ns=io.of('/voxel'),players=new Map();let queue=Promise.resolve(),worldPromise,queued=0;
 const storage=w=>w.storage||WORLD;
 const initialInventory=()=>({6:16,104:1,118:3,121:3});
 const world=()=>worldPromise||(worldPromise=World.findOneAndUpdate({_id:WORLD},{$setOnInsert:{seed:758321,name:'Общий мир Support Hub',createdAt:new Date()}},{upsert:true,returnDocument:'after'}).lean().catch(e=>{worldPromise=null;throw e;}));
 const inventory=p=>Object.fromEntries(Object.entries(p.inventory||{}).filter(([,n])=>n>0));
 const enqueue=fn=>{queued++;const next=queue.then(fn).finally(()=>queued--);queue=next.catch(()=>{});return next;};
 async function cell(x,y,z,seed,session){const w=await world();const [cx,cz]=C.chunk(x,z);let query=Chunk.findOne({world:storage(w),cx,cz}).lean();if(session)query=query.session(session);const doc=await query;return doc?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,seed);}
 const vitals=p=>({health:p.health,hunger:p.hunger,air:p.air});
 const savedVitals=p=>({...vitals(p),exhaustion:p.exhaustion});
 const live=socket=>{const p=players.get(socket.id);if(!p)throw Error('Сначала присоединись');if(p.health<=0)throw Error('Сначала возродись');return p;};
 async function safeSpawn(w){const pos=[.5,C.height(0,0,w.seed)+2,.5];while(pos[1]<C.HEIGHT&&(C.solid(await cell(0,pos[1],0,w.seed))||C.solid(await cell(0,pos[1]+1,0,w.seed))))pos[1]++;return pos;}
 async function containerAt(p,at,type,session){if(!C.validCell(at)||Math.hypot(at[0]+.5-p.pos[0],at[1]+.5-p.pos[1]-1,at[2]+.5-p.pos[2])>5)throw Error('Подойди ближе');const w=await world();if(await cell(...at,w.seed,session)!==type)throw Error('Объект уже убрали');return {w,id:storage(w)+'/'+at.join(',')};}
 async function furnaceAt(p,at,session){if(!C.validCell(at)||Math.hypot(at[0]+.5-p.pos[0],at[1]+.5-p.pos[1]-1,at[2]+.5-p.pos[2])>5)throw Error('Подойди к печи');const w=await world();const station=await cell(...at,w.seed,session);if(!C.catalog.heaters.has(station))throw Error('Здесь нет печи');return {w,id:storage(w)+'/'+at.join(','),station};}
 const FLOWER_MS=10000;
 async function floristSpot(w){
   const x=2,z=2,[cx,cz]=C.chunk(x,z),doc=await Chunk.findOne({world:storage(w),cx,cz}).lean();
   const get=y=>doc?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,w.seed);
   for(let y=C.HEIGHT-2;y>0;y--)if(!C.solid(get(y))&&C.solid(get(y-1)))return [x+.5,y,z+.5];
   return [x+.5,C.height(x,z,w.seed)+1,z+.5];
 }
 function endVisit(p){if(p?.flowerVisit){clearTimeout(p.flowerVisit.timer);p.flowerVisit=null;}}
 const publicPlayer=p=>({nick:p.nick,pos:p.pos,yaw:p.yaw||0,crouched:!!p.crouched,health:p.health});
 const roster=()=>[...players.values()].filter(p=>p.joined).map(publicPlayer);
 const environment=require('./voxel-environment')({io,ns,mongoose,world,storage,players,enqueue,live,Chunk,Player});
 async function leave(socket){const p=players.get(socket.id);if(!p)return;endVisit(p);await environment.flush();players.delete(socket.id);socket.leave(WORLD);if(p.joined){await Player.updateOne({_id:p.id},{$set:{pos:p.pos,...savedVitals(p),updatedAt:new Date()}});ns.to(WORLD).emit('players',roster());}}
 ns.use(async(socket,next)=>{try{if(socket.handshake.auth?.protocol!==3)return next(Error('Обнови Support Hub до 4.0.2 для входа в блочный мир Bedrock.'));const user=await authenticate(socket.handshake.auth?.token);if(!user)return next(Error('Войди заново в Support Hub для игры.'));socket.data.nick=user.username.toLowerCase();next();}catch{next(Error('Не удалось проверить вход. Попробуй позже.'));}});
 ns.on('connection',socket=>{
  let requests=0,windowAt=Date.now();
  function rpc(name,fn){socket.on(name,async(data,ack)=>{if(typeof ack!=='function')return;try{if(Date.now()-windowAt>1000){windowAt=Date.now();requests=0;}if(++requests>25)throw Error('Слишком много запросов');if(['edit','craft','mine','smelt','furnace','collect_furnace','eat','respawn','chest','chest_transfer','farm','attack','bucket','palette','florist_begin'].includes(name)&&queued>=128)throw Error('Мир занят, повтори через секунду');ack({ok:true,...await fn(data||{})});}catch(error){if(error.name==='MongoServerError')console.error('Voxel '+name+': '+error.message);ack({ok:false,error:error.message.includes('транзак')?error.message: error.name==='MongoServerError'?'Сохранение недоступно. Изменение не применено.':error.message});}});}
  environment.attach(rpc,socket);
  rpc('info',async()=>({world:await world(),online:roster().length,pvp:true,canReset:socket.data.nick==='fifflaren'}));
  rpc('join',()=>enqueue(async()=>{
   if(players.get(socket.id)?.joined){const p=players.get(socket.id);return {world:await world(),florist:await floristSpot(await world()),pos:p.pos,inventory:p.inventory,wear:p.wear,vitals:vitals(p),players:roster(),pvp:true,animals:environment.snapshot(p)};}
   const nick=socket.data.nick;
   for(const [id,p]of players)if(p.nick===nick&&id!==socket.id){const old=ns.sockets.get(id);if(old){await leave(old);old.emit('replaced');old.disconnect(true);}}
   const w=await world(),spawn=[.5,C.height(0,0,w.seed)+2,.5];
   const playerId=storage(w)===WORLD?nick:storage(w)+'/'+nick;
   const stored=await Player.findOneAndUpdate({_id:playerId},{$setOnInsert:{inventory:initialInventory(),pos:spawn,updatedAt:new Date()}},{upsert:true,returnDocument:'after'}).lean();
   let pos=C.validPos(stored.pos)?stored.pos:spawn;
   pos=[Math.floor(pos[0])+.5,Math.max(1,Math.ceil(pos[1])),Math.floor(pos[2])+.5];
   while(pos[1]<C.HEIGHT&&(C.solid(await cell(Math.floor(pos[0]),pos[1],Math.floor(pos[2]),w.seed))||C.solid(await cell(Math.floor(pos[0]),pos[1]+1,Math.floor(pos[2]),w.seed))))pos[1]++;
   const p={nick,id:playerId,pos,inventory:inventory(stored),wear:{...(stored.wear||{})},health:stored.health??20,hunger:stored.hunger??20,air:stored.air??10,exhaustion:stored.exhaustion||0,fallPeak:pos[1],regenAt:Date.now(),joined:true,lastMove:Date.now(),lastEdit:0};players.set(socket.id,p);await socket.join(WORLD);ns.to(WORLD).emit('players',roster());return {world:w,florist:await floristSpot(w),pos,inventory:p.inventory,wear:p.wear,vitals:vitals(p),players:roster(),pvp:true,animals:environment.snapshot(p)};
  }));
  rpc('chunks',async data=>{const w=await world();const p=players.get(socket.id);if(!p)throw Error('Сначала присоединись');const center=C.chunk(p.pos[0],p.pos[2]);if(!Array.isArray(data.coords)||data.coords.length>25)throw Error('Неверный запрос территории');const coords=data.coords.filter(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isInteger)&&Math.abs(v[0]-center[0])<=4&&Math.abs(v[1]-center[1])<=4);const docs=coords.length?await Chunk.find({world:storage(w),$or:coords.map(([cx,cz])=>({cx,cz}))}).lean():[];return {chunks:coords.map(([cx,cz])=>docs.find(d=>d.cx===cx&&d.cz===cz)||{cx,cz,blocks:{},revision:0})};});
  rpc('mine',data=>enqueue(async()=>{
   const p=live(socket);if(!C.validCell(data.at))throw Error('Неверный блок');
   const [x,y,z]=data.at;if(Math.hypot(x+.5-p.pos[0],y+.5-p.pos[1]-C.eyeHeight(p.crouched),z+.5-p.pos[2])>6)throw Error('Блок слишком далеко');
   const tool=Number.isInteger(data.tool)&&p.inventory[data.tool]>0?data.tool:0,w=await world(),id=await cell(x,y,z,w.seed),rule=C.mining(id,tool);if(!rule)throw Error('Этот блок нельзя добыть');
   p.mining={at:data.at.join(','),id,tool,start:Date.now(),ms:rule.ms,harvest:rule.harvest};return {duration:rule.ms,harvest:rule.harvest};
  }));
  rpc('mine_cancel',()=>enqueue(()=>{const p=players.get(socket.id);if(p)p.mining=null;return {};}));
  rpc('edit',data=>enqueue(async()=>{
   const p=live(socket),w=await world();if(!C.validCell(data.at)||!['break','place'].includes(data.action))throw Error('Неверное действие');
   const [x,y,z]=data.at;if(Math.hypot(x+.5-p.pos[0],y+.5-(p.pos[1]+C.eyeHeight(p.crouched)),z+.5-p.pos[2])>6)throw Error('Блок слишком далеко');if(Date.now()-p.lastEdit<140)throw Error('Подожди перед следующим действием');p.lastEdit=Date.now();
   const [cx,cz]=C.chunk(x,z),blockKey=C.key(x,y,z);let result;
   await mongoose.connection.transaction(async session=>{
    const doc=await Chunk.findOne({world:storage(w),cx,cz}).session(session).lean(),old=doc?.blocks?.[blockKey]??C.terrain(x,y,z,w.seed),bag={...p.inventory};let id,wear={...p.wear},broke=false;
    if(data.action==='break'){
     const mine=p.mining;if(!mine||mine.at!==data.at.join(',')||mine.id!==old)throw Error('Удерживай ЛКМ на блоке для добычи');
     if(Date.now()-mine.start<mine.ms)throw Error('Блок ещё не разрушен');
     if(mine.tool&&!(bag[mine.tool]>0))throw Error('Инструмент недоступен');
     if(old===25){const chest=await Chest.findById(storage(w)+'/'+data.at.join(',')).session(session).lean();if(Object.values(chest?.contents||{}).some(n=>n>0))throw Error('Сначала опустоши сундук');await Chest.deleteOne({_id:storage(w)+'/'+data.at.join(',')},{session});}
     if(old===26&&[27,28].includes(await cell(x,y+1,z,w.seed,session)))throw Error('Сначала собери пшеницу');
     if(old===27||old===28){await Crop.deleteOne({_id:storage(w)+'/'+data.at.join(',')},{session});bag[121]=(bag[121]||0)+(old===28?2:1);if(old===28)bag[122]=(bag[122]||0)+1;}
     if(old===1&&C.hash(x,y+z,w.seed+339)>.75)bag[121]=(bag[121]||0)+1;
     if(C.catalog.heaters.has(old)){const furnace=await Furnace.findById(storage(w)+'/'+data.at.join(',')).session(session).lean();if(furnace?.jobs?.length)throw Error('Сначала забери содержимое печи');await Furnace.deleteOne({_id:storage(w)+'/'+data.at.join(',')},{session});}
     const worn=C.wearTool(bag,wear,mine.tool);Object.assign(bag,worn.inventory);wear=worn.wear;broke=worn.broke;
     if((old===5||old===23)&&C.hash(x+y*13,z,w.seed+82)>.75)bag[118]=(bag[118]||0)+1;
     if(old===21)bag[119]=(bag[119]||0)+1;
     id=0;if(mine.harvest&&![8,27,28].includes(old)){const item=C.blocks[old].drop||(old===1||old===26?2:old);bag[item]=(bag[item]||0)+1;if(bag[item]>9999)throw Error('Инвентарь заполнен');}
    }else{
     id=data.block;const b=C.blocks[id];if(!Number.isInteger(id)||!b||id===0||b.unbreakable||b.fluid||[26,27,28].includes(id)||!(bag[id]>0))throw Error('Нет такого блока в инвентаре');if(C.solid(old))throw Error('Место уже занято');if([...players.values()].some(q=>C.intersects(q.pos,x,y,z,q.crouched)))throw Error('Здесь стоит игрок');bag[id]--;
    }
    if(Object.values(bag).some(n=>n>9999))throw Error('Инвентарь заполнен');
    const changed=await Chunk.findOneAndUpdate({world:storage(w),cx,cz},{$set:{['blocks.'+blockKey]:id,fluidPending:true},$inc:{revision:1}},{upsert:true,returnDocument:'after',session}).lean();
    await Player.updateOne({_id:p.id},{$set:{inventory:bag,wear,pos:p.pos,updatedAt:new Date()}},{session});result={cx,cz,key:blockKey,block:id,revision:changed.revision,inventory:bag,wear,broke};
   });
   p.exhaustion+=data.action==='break'?.025:0;p.mining=null;p.inventory=result.inventory;p.wear=result.wear;environment.changed(data.at);const {inventory:bag,wear,broke,...change}=result;ns.to(WORLD).emit('block',change);return {inventory:bag,wear,broke,saved:true};
  }));
  rpc('craft',data=>enqueue(async()=>{const p=live(socket);const r=data.grid?C.matchRecipe(data.grid,data.id):C.recipes.find(r=>r.id===data.id);if(!r||r.reference)throw Error('Неизвестный рецепт');if(data.grid&&data.grid.length===2&&r.station)throw Error('Нужен верстак');
   if(r.type==='furnace'||r.station===15)throw Error('Открой печь и запусти плавку');
   if(r.station){const w=await world(),[px,py,pz]=p.pos.map(Math.floor);let found=false;const coords=new Set();for(let x=px-3;x<=px+3;x++)for(let z=pz-3;z<=pz+3;z++)coords.add(C.chunk(x,z).join(','));const docs=await Chunk.find({world:storage(w),$or:[...coords].map(k=>{const[cx,cz]=k.split(',').map(Number);return{cx,cz};})}).lean();for(let x=px-3;x<=px+3;x++)for(let z=pz-3;z<=pz+3;z++)for(let y=Math.max(1,py-2);y<=py+2;y++){const[cx,cz]=C.chunk(x,z),d=docs.find(d=>d.cx===cx&&d.cz===cz);if((d?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,w.seed))===r.station)found=true;}if(!found)throw Error('Рядом нужен '+C.blocks[r.station].name.toLowerCase());}
   const used=r.transform?{}:C.costs(r,p.inventory,data.grid);if(Object.keys(used).some(id=>p.wear[id]!=null&&p.wear[id]<C.items[id]?.durability))throw Error('Сначала убери изношенный инструмент из рецепта.');const bag=C.craft(p.inventory,r.id,data.grid,data.selections);await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}});p.inventory=bag;return {inventory:bag,saved:true};
  }));
  rpc('florist_begin',()=>enqueue(async()=>{
   const p=live(socket);if(p.flowerVisit)throw Error('Встреча уже идёт.');
   const w=await world(),spot=await floristSpot(w);ns.to(WORLD).emit('florist_spot',spot);
   const dx=spot[0]-p.pos[0],dy=spot[1]+1.45-p.pos[1]-C.eyeHeight(p.crouched),dz=spot[2]-p.pos[2],dist=Math.hypot(dx,dy,dz);
   if(dist>3.3)throw Error('Подойди к садовнице.');
   // Only the few cells between the eye and NPC need checking.
   const checked=new Set();for(let t=.18;t<dist-.15;t+=.24){const q=[p.pos[0]+dx*t/dist,p.pos[1]+C.eyeHeight(p.crouched)+dy*t/dist,p.pos[2]+dz*t/dist].map(Math.floor),k=q.join(',');if(checked.has(k))continue;checked.add(k);if(C.solid(await cell(...q,w.seed)))throw Error('Садовницу закрывает препятствие.');}
   const flower=C.catalog.ids.get('red_tulip');if(!flower||(p.inventory[flower]||0)>=9999)throw Error('В рюкзаке нет места для тюльпана.');
   const id=require('crypto').randomUUID(),visit={id};p.flowerVisit=visit;
   visit.timer=setTimeout(()=>enqueue(async()=>{
     if(players.get(socket.id)!==p||p.flowerVisit!==visit)return;if(!socket.connected||p.health<=0){endVisit(p);return;}
     try{const saved=await Player.findOneAndUpdate({_id:p.id,lastFlowerVisit:{$ne:id},$or:[{['inventory.'+flower]:{$exists:false}},{['inventory.'+flower]:{$lt:9999}}]},
       {$inc:{['inventory.'+flower]:1},$set:{lastFlowerVisit:id,updatedAt:new Date()}},{returnDocument:'after'}).lean();
       if(!saved)throw Error('Не удалось положить цветок в рюкзак.');p.inventory=inventory(saved);socket.emit('florist_gift',{id,inventory:p.inventory});
     }catch{socket.emit('florist_end',{id});}finally{endVisit(p);}
   }).catch(()=>endVisit(p)),FLOWER_MS);visit.timer.unref();return {id,spot,ms:FLOWER_MS};
  }));
  rpc('florist_cancel',data=>enqueue(()=>{const p=players.get(socket.id);if(!data.id||p?.flowerVisit?.id===data.id)endVisit(p);return {};}));
  rpc('palette',data=>enqueue(async()=>{
   const p=live(socket),id=data.id,b=C.blocks[id];if(socket.data.nick!=='fifflaren')throw Error('Палитра доступна Fifflaren.');
   if(!Number.isInteger(id)||!b||!b.color||b.unbreakable||C.fluid(id)||[26,27,28].includes(id))throw Error('Недоступный строительный блок.');
   const bag={...p.inventory},count=bag[id]||0;if(count>=9999)throw Error('Инвентарь заполнен');bag[id]=Math.min(9999,count+64);
   await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}});p.inventory=bag;return {inventory:bag};
  }));
  rpc('chest',data=>enqueue(async()=>{const p=live(socket),{w,id}=await containerAt(p,data.at,25);const doc=await Chest.findById(id).lean();return {contents:doc?.contents||{}};}));
  rpc('chest_transfer',data=>enqueue(async()=>{const p=live(socket);let result;await mongoose.connection.transaction(async session=>{const {w,id}=await containerAt(p,data.at,25,session),doc=await Chest.findById(id).session(session).lean();result=C.transfer(p.inventory,doc?.contents||{},p.wear,data.item,data.count,data.direction);await Chest.updateOne({_id:id},{$set:{world:storage(w),at:data.at,contents:result.contents}},{upsert:true,session});await Player.updateOne({_id:p.id},{$set:{inventory:result.inventory,updatedAt:new Date()}},{session});});p.inventory=result.inventory;return result;}));
  rpc('farm',data=>enqueue(async()=>{const p=live(socket),w=await world();if(!C.validCell(data.at)||!['till','plant'].includes(data.action))throw Error('Неверное действие');const [x,y,z]=data.at;if(Math.hypot(x+.5-p.pos[0],y+.5-p.pos[1]-1,z+.5-p.pos[2])>5)throw Error('Подойди к грядке');let result;
   await mongoose.connection.transaction(async session=>{const old=await cell(x,y,z,w.seed,session),bag={...p.inventory};let wear={...p.wear},at=[x,y,z],id,broke=false;if(data.action==='till'){if(![1,2].includes(old)||await cell(x,y+1,z,w.seed,session)!==0)throw Error('Нужна открытая земля или дёрн');if(!(bag[124]>0))throw Error('Нужна мотыга');const used=C.wearTool(bag,wear,124);Object.assign(bag,used.inventory);wear=used.wear;broke=used.broke;id=26;}else{if(old!==26||!(bag[121]>0)||await cell(x,y+1,z,w.seed,session)!==0||y+1>=C.HEIGHT)throw Error('Нужны семена и свободная грядка');bag[121]--;id=27;at=[x,y+1,z];const coords=new Set();for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)coords.add(C.chunk(x+dx,z+dz).join(','));const docs=await Chunk.find({world:storage(w),$or:[...coords].map(k=>{const[cx,cz]=k.split(',').map(Number);return {cx,cz};})}).session(session).lean();const map=new Map(docs.map(d=>[d.cx+','+d.cz,d]));let water=false;for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)if(C.fluid(map.get(C.chunk(x+dx,z+dz).join(','))?.blocks?.[C.key(x+dx,y,z+dz)]??C.terrain(x+dx,y,z+dz,w.seed)))water=true;await Crop.updateOne({_id:storage(w)+'/'+at.join(',')},{$set:{world:storage(w),at,readyAt:Date.now()+(water?60000:180000)}},{upsert:true,session});}
    const[cx,cz]=C.chunk(at[0],at[2]),key=C.key(...at),doc=await Chunk.findOneAndUpdate({world:storage(w),cx,cz},{$set:{['blocks.'+key]:id},$inc:{revision:1}},{upsert:true,returnDocument:'after',session}).lean();await Player.updateOne({_id:p.id},{$set:{inventory:bag,wear,updatedAt:new Date()}},{session});result={inventory:bag,wear,broke,change:{cx,cz,key,block:id,revision:doc.revision}};
   });p.inventory=result.inventory;p.wear=result.wear;ns.to(WORLD).emit('block',result.change);return {inventory:result.inventory,wear:result.wear,broke:result.broke};
  }));
  rpc('eat',data=>enqueue(async()=>{const p=live(socket);const result=C.consume(p.inventory,vitals(p),data.item);await Player.updateOne({_id:p.id},{$set:{inventory:result.inventory,...result.vitals,updatedAt:new Date()}});p.inventory=result.inventory;p.hunger=result.vitals.hunger;return {...result,wear:p.wear};}));
  rpc('respawn',()=>enqueue(async()=>{const p=players.get(socket.id);if(!p||p.health>0)throw Error('Возрождение недоступно');endVisit(p);const pos=await safeSpawn(await world());await Player.updateOne({_id:p.id},{$set:{pos,health:20,hunger:20,air:10,exhaustion:0,updatedAt:new Date()}});Object.assign(p,{pos,health:20,hunger:20,air:10,exhaustion:0,fallPeak:pos[1],lastMove:Date.now(),mining:null});socket.to(WORLD).emit('move',publicPlayer(p));return {pos,vitals:vitals(p)};}));
  rpc('furnace',data=>enqueue(async()=>{const p=live(socket),{id}=await furnaceAt(p,data.at);const doc=await Furnace.findById(id).lean();return {jobs:doc?.jobs||[],now:Date.now()};}));
  rpc('smelt',data=>enqueue(async()=>{const p=live(socket),r=C.recipes.find(r=>r.id===data.id&&!r.reference&&(r.type==='furnace'||r.station===15));if(!r)throw Error('Неизвестный рецепт печи');let result;
   await mongoose.connection.transaction(async session=>{const {w,id,station}=await furnaceAt(p,data.at,session);if(!(r.stations||[r.station]).includes(station))throw Error('Рецепт для другой печи');const doc=await Furnace.findById(id).session(session).lean(),jobs=(doc?.jobs||[]).map(j=>({recipe:j.recipe,readyAt:j.readyAt,out:j.out}));if(jobs.length>=8)throw Error('Очередь печи заполнена');const bag={...p.inventory};for(const [item,count]of Object.entries(C.costs(r,bag))){if((bag[item]||0)<count)throw Error('Не хватает ресурсов или топлива');bag[item]-=count;}jobs.push({recipe:r.id,out:{...r.out},readyAt:Math.max(Date.now(),...jobs.map(j=>j.readyAt))+r.smeltMs});await Furnace.updateOne({_id:id},{$set:{world:storage(w),at:data.at,jobs}},{upsert:true,session});await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}},{session});result={inventory:bag,jobs,now:Date.now()};});p.inventory=result.inventory;return result;
  }));
  rpc('collect_furnace',data=>enqueue(async()=>{const p=live(socket);let result;
   await mongoose.connection.transaction(async session=>{const {id}=await furnaceAt(p,data.at,session),doc=await Furnace.findById(id).session(session).lean(),bag={...p.inventory},now=Date.now(),ready=(doc?.jobs||[]).filter(j=>j.readyAt<=now);if(!ready.length)throw Error('Плавка ещё идёт');for(const job of ready)for(const [item,count]of Object.entries(job.out||C.recipes.find(r=>r.id===job.recipe).out)){bag[item]=(bag[item]||0)+count;if(bag[item]>9999)throw Error('Инвентарь заполнен');}const jobs=doc.jobs.filter(j=>j.readyAt>now).map(j=>({recipe:j.recipe,readyAt:j.readyAt,out:j.out}));await Furnace.updateOne({_id:id},{$set:{jobs}},{session});await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}},{session});result={inventory:bag,jobs,now};});p.inventory=result.inventory;return result;
  }));
  rpc('reset_world',data=>enqueue(async()=>{
   if(socket.data.nick!=='fifflaren')throw Error('Новый мир может создать только Fifflaren');
   if(data.confirm!=='НОВЫЙ МИР')throw Error('Введи НОВЫЙ МИР для подтверждения');
   await environment.flush();const previous=await world();if(Date.now()-new Date(previous.createdAt).getTime()<30000&&previous.generation===2)throw Error('Подожди 30 секунд перед новым сбросом');
   const nextStorage='world-'+require('crypto').randomUUID(),nextSeed=-require('crypto').randomInt(1,2000000000);
   // Archive current players under their existing generation before switching the head.
   for(const p of players.values())await Player.updateOne({_id:p.id},{$set:{pos:p.pos,...savedVitals(p),updatedAt:new Date()}});
   await World.updateOne({_id:'archive/'+storage(previous)},{$setOnInsert:{seed:previous.seed,name:previous.name,storage:storage(previous),generation:previous.generation||1,createdAt:previous.createdAt}},{upsert:true});
   const next=await World.findOneAndUpdate({_id:WORLD},{$set:{storage:nextStorage,seed:nextSeed,generation:2,createdAt:new Date()}},{returnDocument:'after'}).lean();worldPromise=Promise.resolve(next);
   for(const id of players.keys())ns.sockets.get(id)?.leave(WORLD);players.clear();environment.clear();ns.emit('world_reset',{name:next.name});return {world:next};
  }));
  rpc('leave',()=>enqueue(async()=>{await leave(socket);return {};}));
  socket.on('move',data=>{const p=players.get(socket.id);if(!p||p.flowerVisit||p.health<=0||!C.validPos(data?.pos))return;const now=Date.now(),dt=Math.min(2,(now-p.lastMove)/1000);if(dt<.075)return;if(Math.hypot(data.pos[0]-p.pos[0],data.pos[2]-p.pos[2])>dt*12+1){socket.emit('correct',p.pos);return;}p.exhaustion+=Math.hypot(data.pos[0]-p.pos[0],data.pos[2]-p.pos[2])*.02;p.fallPeak=Math.max(p.fallPeak,data.pos[1]);p.pos=data.pos;p.crouched=data.crouched===true;p.yaw=Number.isFinite(data.yaw)?data.yaw:0;p.lastMove=now;socket.to(WORLD).volatile.emit('move',publicPlayer(p));});
  socket.on('disconnect',()=>{enqueue(()=>leave(socket)).catch(e=>console.error('Voxel leave: '+e.message));});
 });
 let growing=false;const growthTimer=setInterval(()=>{if(growing||queued>=128)return;growing=true;enqueue(async()=>{const w=await world(),due=await Crop.find({world:storage(w),readyAt:{$lte:Date.now()}}).limit(64).lean();for(const crop of due){let change=null;await mongoose.connection.transaction(async session=>{const[x,y,z]=crop.at;if(await cell(x,y,z,w.seed,session)===27){const[cx,cz]=C.chunk(x,z),key=C.key(x,y,z),doc=await Chunk.findOneAndUpdate({world:storage(w),cx,cz},{$set:{['blocks.'+key]:28},$inc:{revision:1}},{upsert:true,returnDocument:'after',session}).lean();change={cx,cz,key,block:28,revision:doc.revision};}await Crop.deleteOne({_id:crop._id},{session});});if(change)ns.to(WORLD).emit('block',change);}}).catch(e=>console.error('Voxel crops: '+e.message)).finally(()=>growing=false);},5000);growthTimer.unref();
 let ticking=false;
 const survivalTimer=setInterval(()=>{if(ticking||!players.size||queued>=128)return;ticking=true;enqueue(async()=>{
  if(!players.size)return;const w=await world(),coords=new Set();for(const p of players.values())for(const dx of [-1,0,1])for(const dz of [-1,0,1])coords.add(C.chunk(Math.floor(p.pos[0])+dx,Math.floor(p.pos[2])+dz).join(','));
  const docs=await Chunk.find({world:storage(w),$or:[...coords].map(k=>{const[cx,cz]=k.split(',').map(Number);return {cx,cz};})}).lean(),byChunk=new Map(docs.map(d=>[d.cx+','+d.cz,d]));const get=(x,y,z)=>byChunk.get(C.chunk(x,z).join(','))?.blocks?.[C.key(x,y,z)]??C.terrain(x,y,z,w.seed);
  for(const [sid,p]of players){if(p.health<=0)continue;const next={...p},[x,y,z]=p.pos.map(Math.floor),wet=C.fluid(get(x,Math.floor(p.pos[1]+C.eyeHeight(p.crouched)),z)),feet=get(x,Math.floor(p.pos[1]-.08),z),ground=C.solid(feet);let cause='';
   if(wet){next.air=Math.max(0,p.air-1);next.fallPeak=p.pos[1];if(!next.air){next.health-=2;cause='Закончился воздух';}}else next.air=10;
   if(ground){const fall=p.fallPeak-p.pos[1];if(fall>3){next.health-=Math.floor(fall-3);cause='Падение';}next.fallPeak=p.pos[1];}else if(C.fluid(get(x,y,z)))next.fallPeak=p.pos[1];
   const touchingCactus=[[x,y,z],[Math.floor(p.pos[0]-.3),y,z],[Math.floor(p.pos[0]+.3),y,z],[x,y,Math.floor(p.pos[2]-.3)],[x,y,Math.floor(p.pos[2]+.3)],[x,Math.floor(p.pos[1]-.08),z]].some(at=>get(...at)===21);if(touchingCactus){next.health--;cause='Кактус';}
   if(p.exhaustion>=4){next.hunger=Math.max(0,p.hunger-Math.floor(p.exhaustion/4));next.exhaustion=p.exhaustion%4;}
   if(Date.now()-p.regenAt>=4000){next.regenAt=Date.now();if(next.hunger>=18&&next.health>0&&next.health<20&&!wet&&!touchingCactus){next.health++;next.exhaustion+=4;}else if(next.hunger===0&&next.health>1){next.health--;cause='Голод';}}
   next.health=Math.max(0,next.health);const changed=next.health!==p.health||next.hunger!==p.hunger||next.air!==p.air||next.exhaustion!==p.exhaustion;
   if(changed)await Player.updateOne({_id:p.id},{$set:{...savedVitals(next),updatedAt:new Date()}});Object.assign(p,{...savedVitals(next),fallPeak:next.fallPeak,regenAt:next.regenAt});if(!p.health)p.mining=null;if(changed){ns.sockets.get(sid)?.emit('vitals',{...vitals(p),cause});ns.to(WORLD).emit('move',publicPlayer(p));}
  }
 }).catch(e=>console.error('Voxel survival: '+e.message)).finally(()=>ticking=false);},1000);survivalTimer.unref();
 const saveTimer=setInterval(()=>{enqueue(async()=>{for(const p of players.values())await Player.updateOne({_id:p.id},{$set:{pos:p.pos,...savedVitals(p),updatedAt:new Date()}});}).catch(e=>console.error('Voxel position save: '+e.message));},30000);saveTimer.unref();
 io.httpServer?.once('close',()=>{clearInterval(saveTimer);clearInterval(survivalTimer);clearInterval(growthTimer);environment.stop();});
 return {World,Chunk,Player,Furnace,Chest,Crop,Animal:environment.Animal};
};
