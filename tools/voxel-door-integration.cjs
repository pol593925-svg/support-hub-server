const path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const deps=process.env.VOXEL_TEST_DEPS,dep=n=>require(deps?path.join(deps,n):n);
const {MongoMemoryReplSet}=dep('mongodb-memory-server'),mongoose=dep('mongoose'),{Server}=dep('socket.io'),{io:client}=dep('socket.io-client');
const C=require('../voxel-core'),install=require('../voxel-service'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  let db,io,web,models;const sockets=[];
  const oak=C.catalog.ids.get('wooden_door'),iron=C.catalog.ids.get('iron_door'),world='support-main-v1',door=[15,40,2],upper=[15,41,2],signal=[16,40,2];
  async function start(){
    await mongoose.connect(db.getUri(),{dbName:'doors'});
    web=http.createServer();io=new Server(web);
    models=install({io,mongoose,authenticate:async token=>({username:token})});
    await Promise.all(Object.values(models).map(m=>m.init()));
    await new Promise(r=>web.listen(0,'127.0.0.1',r));
  }
  function rpc(s,event,data={}){return new Promise((r,j)=>s.timeout(8000).emit(event,data,(e,v)=>e?j(e):r(v)));}
  async function ok(s,event,data){const v=await rpc(s,event,data);assert(v.ok,event+': '+v.error);return v;}
  async function connect(token){
    const s=client('http://127.0.0.1:'+web.address().port+'/voxel',{auth:{token,protocol:4},reconnection:false});
    sockets.push(s);await new Promise((r,j)=>{s.once('connect',r);s.once('connect_error',j);});await ok(s,'join');return s;
  }
  async function stop(){
    for(const s of sockets.splice(0)){if(s.connected)await ok(s,'leave');s.disconnect();}
    if(io){await new Promise(r=>io.close(r));io=null;}
    await mongoose.disconnect();mongoose.deleteModel(/HubVoxel/);
  }
  async function read(s,at){
    const [chunk]=(await ok(s,'chunks',{coords:[C.chunk(at[0],at[2])]})).chunks;
    return chunk.blocks[C.key(...at)];
  }
  async function mine(s,at){
    const digging=await ok(s,'mine',{at,tool:0});await pause(digging.duration+75);
    return ok(s,'edit',{action:'break',at});
  }
  try{
    db=await MongoMemoryReplSet.create({replSet:{count:1},instanceOpts:[{launchTimeout:60000}],binary:{version:'8.2.6'}});await start();
    for(const cx of [0,1]){
      const blocks={};
      for(let x=Math.max(12,cx*16);x<=Math.min(19,cx*16+15);x++)for(let z=0;z<=6;z++){
        blocks[C.key(x,39,z)]=1;
        for(let y=40;y<=44;y++)blocks[C.key(x,y,z)]=0;
      }
      if(cx===0)blocks[C.key(14,41,2)]=3;
      await models.Chunk.create({world,cx,cz:0,blocks});
    }
    for(const [id,x] of [['alpha',15.5],['beta',16.5]])await models.Player.create({_id:id,pos:[x,40,4.5],inventory:{[oak]:2,[iron]:1,[C.lever]:1}});
    let a=await connect('alpha'),b=await connect('beta');
    const rejected=await rpc(a,'edit',{action:'place',at:[14,40,2],block:oak});assert(!rejected.ok);assert.equal(await read(b,[14,40,2]),0);
    await pause(180);
    const update=new Promise(r=>b.once('blocks',r));
    const placed=await Promise.all([rpc(a,'edit',{action:'place',at:door,block:oak}),rpc(b,'edit',{action:'place',at:door,block:oak})]);
    assert.equal(placed.filter(v=>v.ok).length,1);assert.equal(Object.keys((await update).blocks).length,2);
    let closed=await read(a,door);assert.equal(C.doorState(closed).open,false);assert(C.doorState(await read(b,upper)).upper);
    await ok(a,'use_block',{at:door,expected:closed});assert(!(await rpc(b,'use_block',{at:door,expected:closed})).ok);
    const opened=await read(b,upper);assert(C.doorState(opened).open);
    await stop();await start();a=await connect('alpha');b=await connect('beta');
    assert.equal(await read(a,upper),opened);assert(C.doorState(await read(b,door)).open);
    await ok(b,'use_block',{at:upper,expected:opened});assert.equal(await read(a,door),closed);
    const before=(await models.Player.findById('alpha').lean()).inventory[oak];
    const removed=await mine(a,upper);assert.equal(removed.inventory[oak],before+1);assert.equal(await read(b,door),0);assert.equal(await read(b,upper),0);
    await pause(180);await ok(a,'edit',{action:'place',at:door,block:iron});
    assert(!(await rpc(b,'use_block',{at:door,expected:await read(a,door)})).ok);
    await pause(180);await ok(a,'edit',{action:'place',at:signal,block:C.lever});await ok(b,'use_block',{at:signal,expected:C.lever});
    const ids=new Map();for(const at of [door,upper,signal])ids.set(at.join(),await read(a,at));
    for(const at of [door,upper])assert(C.doorState(C.effectiveBlock((...p)=>ids.get(p.join())||0,...at)).open);
    await ok(a,'use_block',{at:signal,expected:C.leverOn});assert.equal(await read(b,signal),C.lever);
    const brokenSupport=await mine(b,[15,39,2]);assert.equal(brokenSupport.inventory[iron],2);assert.equal(await read(a,door),0);assert.equal(await read(a,upper),0);
    console.log('PASS two-client doors: placement conflicts, opening, stale actions, restart, power across chunks, single drop and support removal.');
  }finally{await stop();if(db)await db.stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
