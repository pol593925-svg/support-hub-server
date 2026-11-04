'use strict';
const C=require('./voxel-core');
module.exports=function environment({io,ns,mongoose,world,storage,players,enqueue,live,Chunk,Player}){
 const Animal=mongoose.model('HubVoxelAnimal',new mongoose.Schema({_id:String,world:String,home:String,kind:String,pos:[Number],yaw:Number,health:Number},{versionKey:false}));Animal.schema.index({world:1,home:1});
 const animals=new Map(),homes=new Set(),base=new Map(),flow=new Map(),pendingChunks=new Set();let worldId='',busy=false,lastHomes=0,lastSave=0,recovery=[],recoveryAt=0,overflow=false;
 const publicAnimal=a=>({id:a._id,kind:a.kind,pos:a.pos,yaw:a.yaw||0,health:a.health});
 const snapshot=p=>[...animals.values()].filter(a=>a.health>0&&Math.hypot(a.pos[0]-p.pos[0],a.pos[2]-p.pos[2])<52).sort((a,b)=>Math.hypot(a.pos[0]-p.pos[0],a.pos[2]-p.pos[2])-Math.hypot(b.pos[0]-p.pos[0],b.pos[2]-p.pos[2])).slice(0,24).map(publicAnimal);
 const notify=()=>{for(const[sid,p]of players)ns.sockets.get(sid)?.volatile.emit('animals',snapshot(p));};
 const coordKey=(x,y,z)=>x+','+y+','+z;
 function addFlow(at){if(!C.validCell(at))return;if(flow.size>=20000){overflow=true;return;}flow.set(at.join(','),at);}
 function changed(at){addFlow(at);for(const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])addFlow(at.map((v,i)=>v+d[i]));pendingChunks.add(C.chunk(at[0],at[2]).join(','));}
 function clear(){animals.clear();homes.clear();flow.clear();pendingChunks.clear();recovery=[];recoveryAt=0;overflow=false;lastHomes=0;}
 async function read(w,coords,session){const list=[...new Set(coords.map(c=>c.join(',')))].map(k=>{const[cx,cz]=k.split(',').map(Number);return{cx,cz};});let q=Chunk.find({world:storage(w),$or:list}).lean();if(session)q=q.session(session);const docs=await q,map=new Map(docs.map(d=>[d.cx+','+d.cz,d]));
  const get=(x,y,z)=>{if(y<0)return 13;if(y>=C.HEIGHT)return 0;const[cx,cz]=C.chunk(x,z),k=cx+','+cz,key=C.key(x,y,z),over=map.get(k)?.blocks?.[key];if(over!==undefined)return over;const bk=w.seed+'/'+k;let data=base.get(bk);if(!data){data=C.generate(cx,cz,w.seed);base.set(bk,data);if(base.size>128)base.delete(base.keys().next().value);}return data[y*256+((z%16+16)%16)*16+(x%16+16)%16];};
  return {get,map,put(x,y,z,id){const[cx,cz]=C.chunk(x,z),k=cx+','+cz;let d=map.get(k);if(!d){d={cx,cz,blocks:{}};map.set(k,d);}d.blocks[C.key(x,y,z)]=id;}};
 }
 const around=(x,z,r=1)=>{const[cx,cz]=C.chunk(x,z),out=[];for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++)out.push([cx+dx,cz+dz]);return out;};
 async function flush(){const dirty=[...animals.values()].filter(a=>a.dirty);if(dirty.length){await Animal.bulkWrite(dirty.map(a=>({updateOne:{filter:{_id:a._id},update:{$set:{pos:a.pos,yaw:a.yaw,health:a.health}}}})));dirty.forEach(a=>a.dirty=false);}}
 async function refreshAnimals(w){const wanted=new Set();for(const p of players.values()){const tx=Math.floor(p.pos[0]/32),tz=Math.floor(p.pos[2]/32);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)wanted.add((tx+dx)+','+(tz+dz));}
  await flush();for(const h of homes)if(!wanted.has(h)){homes.delete(h);for(const[id,a]of animals)if(a.home===h)animals.delete(id);}
  let added=0;for(const home of wanted){if(homes.has(home)||animals.size>=96||added++>=12)continue;const[tx,tz]=home.split(',').map(Number),x=tx*32+8+Math.floor(C.hash(tx,tz,w.seed+17)*16),z=tz*32+8+Math.floor(C.hash(tx,tz,w.seed+29)*16),y=C.height(x,z,w.seed)+1;
   homes.add(home);if(y<=C.WATER+1||['desert','badlands'].includes(C.biome(x,z,w.seed)))continue;
   const kind=['cow','sheep','pig'][((tx+tz*2)%3+3)%3],_id=storage(w)+'/'+home;
   const doc=await Animal.findOneAndUpdate({_id},{$setOnInsert:{world:storage(w),home,kind,pos:[x+.5,y,z+.5],yaw:0,health:C.animals[kind].health}},{upsert:true,returnDocument:'after'}).lean();if(C.animals[doc.kind]&&C.validPos(doc.pos))animals.set(_id,{...doc,dirty:false});
  }
 }
 function footing(a,x,z,get){const spec=C.animals[a.kind];for(let y=Math.floor(a.pos[1])+1;y>=Math.max(1,Math.floor(a.pos[1])-2);y--){let free=true;for(const dx of [-spec.width,spec.width])for(const dz of [-spec.width,spec.width]){const xx=Math.floor(x+dx),zz=Math.floor(z+dz);if(!C.solid(get(xx,y-1,zz))||get(xx,y-1,zz)===21)free=false;for(let yy=y;yy<=Math.floor(y+spec.height);yy++)if(C.solid(get(xx,yy,zz))||C.fluid(get(xx,yy,zz)))free=false;}if(free)return y;}return null;}
 async function stepAnimals(w,now){if(now-lastHomes>3000){lastHomes=now;await refreshAnimals(w);}const active=[...animals.values()].filter(a=>a.health>0&&[...players.values()].some(p=>Math.hypot(a.pos[0]-p.pos[0],a.pos[2]-p.pos[2])<52));if(!active.length)return;const data=await read(w,active.flatMap(a=>around(a.pos[0],a.pos[2])));
  for(const a of active){const[tx,tz]=a.home.split(',').map(Number);if(!a.turnAt||now>a.turnAt){a.yaw=C.hash(tx+Math.floor(now/4500),tz,w.seed)*Math.PI*2;a.turnAt=now+2000+C.hash(tz,tx,w.seed)*4000;}
   const speed=C.animals[a.kind].speed*(a.fleeUntil>now?1.8:1),x=a.pos[0]+Math.sin(a.yaw)*speed*.25,z=a.pos[2]+Math.cos(a.yaw)*speed*.25,y=footing(a,x,z,data.get);
   if(y!==null&&Math.abs(x-(tx*32+16))<25&&Math.abs(z-(tz*32+16))<25){a.pos=[x,y,z];a.dirty=true;}else{a.yaw+=Math.PI*.75;a.turnAt=now+1500;}
  }if(now-lastSave>5000){await flush();lastSave=now;}notify();
 }
 async function stepWater(w){
  if(!flow.size&&!recovery.length){const docs=await Chunk.find({world:storage(w),fluidPending:true}).limit(8).lean();for(const d of docs){pendingChunks.add(d.cx+','+d.cz);for(const key of Object.keys(d.blocks||{})){const[x,y,z]=key.split('_').map(Number);recovery.push([d.cx*16+x,y,d.cz*16+z]);}}recoveryAt=0;}
  while(recoveryAt<recovery.length&&flow.size<16000)changed(recovery[recoveryAt++]);if(recoveryAt>=recovery.length){recovery=[];recoveryAt=0;}
  const batch=[...flow.values()].slice(0,96);if(!batch.length)return;
  const data=await read(w,batch.flatMap(([x,,z])=>around(x,z))),changes=new Map();
  for(const[x,y,z]of batch){const old=data.get(x,y,z),next=C.flowAt(x,y,z,data.get);if(next===old)continue;data.put(x,y,z,next);const[cx,cz]=C.chunk(x,z),k=cx+','+cz;if(!changes.has(k))changes.set(k,{cx,cz,blocks:{}});changes.get(k).blocks[C.key(x,y,z)]=next;}
  const saved=[];if(changes.size)await mongoose.connection.transaction(async session=>{saved.length=0;for(const c of changes.values()){const set={fluidPending:true};for(const[k,v]of Object.entries(c.blocks))set['blocks.'+k]=v;const doc=await Chunk.findOneAndUpdate({world:storage(w),cx:c.cx,cz:c.cz},{$set:set,$inc:{revision:1}},{upsert:true,returnDocument:'after',session}).lean();saved.push({...c,revision:doc.revision});}});
  batch.forEach(at=>flow.delete(at.join(',')));for(const c of saved){pendingChunks.add(c.cx+','+c.cz);ns.to('support-main-v1').emit('blocks',c);for(const key of Object.keys(c.blocks)){const[x,y,z]=key.split('_').map(Number);changed([c.cx*16+x,y,c.cz*16+z]);}}
  if(!flow.size&&!recovery.length){if(overflow){overflow=false;return;}const coords=[...pendingChunks].map(k=>{const[cx,cz]=k.split(',').map(Number);return{cx,cz};});if(coords.length)await Chunk.updateMany({world:storage(w),$or:coords},{$set:{fluidPending:false}});pendingChunks.clear();}
 }
 function attach(rpc,socket){
  rpc('attack',data=>enqueue(async()=>{const p=live(socket),now=Date.now(),tool=data.tool||0;if(tool&&(!Number.isInteger(tool)||C.items[tool]?.kind!=='sword'||!(p.inventory[tool]>0)))throw Error('Меч недоступен');if(now-(p.lastAttack||0)<600)throw Error('Подожди замах');const w=await world();let target,sid;if(data.kind==='player'){for(const[id,q]of players)if(q.nick===data.target){target=q;sid=id;break;}if(!target||target===p||target.health<=0)throw Error('Нет цели');}else if(data.kind==='animal'){target=animals.get(data.target);if(!target||target.health<=0)throw Error('Животное уже ушло');}else throw Error('Нет цели');
   if(Math.hypot(...p.pos.map((v,i)=>v-target.pos[i]))>5)throw Error('Цель слишком далеко');const terrain=await read(w,around(p.pos[0],p.pos[2]));if(C.melee([p.pos[0],p.pos[1]+C.eyeHeight(p.crouched),p.pos[2]],data.dir,target,terrain.get)===null)throw Error('Удар не достигает цели');
   p.lastAttack=now;const damage=tool?C.items[tool].damage:1,health=Math.max(0,target.health-damage),used=C.wearTool(p.inventory,p.wear,tool),bag=used.inventory;
   if(data.kind==='animal'&&!health)for(const[id,n]of Object.entries(C.animals[target.kind].drop)){bag[id]=(bag[id]||0)+n;if(bag[id]>9999)throw Error('Инвентарь заполнен');}
   await mongoose.connection.transaction(async session=>{await Player.updateOne({_id:p.id},{$set:{inventory:bag,wear:used.wear,updatedAt:new Date()}},{session});if(sid)await Player.updateOne({_id:target.id},{$set:{health,updatedAt:new Date()}},{session});else await Animal.updateOne({_id:target._id},{$set:{health,pos:target.pos,yaw:target.yaw}},{session});});
   p.inventory=bag;p.wear=used.wear;target.health=health;target.mining=null;if(sid){ns.sockets.get(sid)?.emit('vitals',{health,hunger:target.hunger,air:target.air,cause:'Удар игрока '+p.nick});ns.to('support-main-v1').emit('move',{nick:target.nick,pos:target.pos,yaw:target.yaw||0,health});}else{target.fleeUntil=now+3000;target.yaw=Math.atan2(target.pos[0]-p.pos[0],target.pos[2]-p.pos[2]);target.turnAt=now+3000;notify();}
   ns.to('support-main-v1').emit('combat',{by:p.nick,target:data.target,kind:data.kind,damage,health,tool});return {inventory:bag,wear:used.wear,broke:used.broke,damage,health};
  }));
  rpc('bucket',data=>enqueue(async()=>{const p=live(socket),w=await world(),at=data.at;if(!C.validCell(at)||!['fill','pour'].includes(data.action)||Math.hypot(...at.map((v,i)=>v+.5-p.pos[i]-(i===1?C.eyeHeight(p.crouched):0)))>6)throw Error('Подойди к воде');if(Date.now()-(p.lastBucket||0)<250)throw Error('Подожди');p.lastBucket=Date.now();const tool=data.action==='fill'?130:131;if(!(p.inventory[tool]>0))throw Error('Нет ведра');const[cx,cz]=C.chunk(at[0],at[2]),key=C.key(...at);let result;
   await mongoose.connection.transaction(async session=>{const terrain=await read(w,around(p.pos[0],p.pos[2]),session),old=terrain.get(...at),eye=[p.pos[0],p.pos[1]+C.eyeHeight(p.crouched),p.pos[2]],delta=at.map((v,i)=>v+.5-eye[i]),distance=Math.hypot(...delta);for(let t=0;t<distance-.1;t+=.08){const cell=eye.map((v,i)=>Math.floor(v+delta[i]*t/distance));if(C.solid(terrain.get(...cell)))throw Error('Воду закрывает препятствие');}if(data.action==='fill'?old!==12:old!==0&&!C.fluid(old))throw Error(data.action==='fill'?'Зачерпнуть можно только источник воды':'Место занято');const bag={...p.inventory,[tool]:p.inventory[tool]-1},out=tool===130?131:130;bag[out]=(bag[out]||0)+1;if(bag[out]>9999)throw Error('Инвентарь заполнен');const block=tool===130?0:12,doc=await Chunk.findOneAndUpdate({world:storage(w),cx,cz},{$set:{['blocks.'+key]:block,fluidPending:true},$inc:{revision:1}},{upsert:true,returnDocument:'after',session}).lean();await Player.updateOne({_id:p.id},{$set:{inventory:bag,updatedAt:new Date()}},{session});result={inventory:bag,change:{cx,cz,key,block,revision:doc.revision}};});p.inventory=result.inventory;changed(at);ns.to('support-main-v1').emit('block',result.change);return {inventory:p.inventory,saved:true};
  }));
 }
 const timer=setInterval(()=>{if(busy||!players.size)return;busy=true;enqueue(async()=>{const w=await world();if(worldId!==storage(w)){clear();worldId=storage(w);}await stepWater(w);await stepAnimals(w,Date.now());}).catch(e=>console.error('Voxel environment: '+e.message)).finally(()=>busy=false);},250);timer.unref();
 return {Animal,attach,changed,flush,clear,snapshot,stop(){clearInterval(timer);},stepWater,read};
};
