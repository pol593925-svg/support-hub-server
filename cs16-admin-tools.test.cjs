const {test}=require('node:test'),assert=require('node:assert/strict');
const install=require('./cs16-admin-tools');
const ownerToken='a'.repeat(43),otherToken='b'.repeat(43),denied={allowed:false,wallhack:false,aimbot:false};
function fixture({token=ownerToken,actor={username:'Fifflaren',role:'admin'},authenticate}={}){
  let connect;const handlers={},events=[],calls=[],timers=new Set();
  const socket={id:'game-socket',connected:true,data:{},handshake:{auth:{token}},nick:'Fifflaren',
    on:(name,fn)=>handlers[name]=fn,emit:(name,data)=>events.push({name,data}),broadcast:{emit(){throw Error('private capability broadcast');}}};
  const f={socket,events,calls,timers,actor,authenticate};
  install({io:{on:(name,fn)=>{assert.equal(name,'connection');connect=fn;},emit(){throw Error('private capability broadcast');}},
    authenticate:async value=>{calls.push(value);return f.authenticate?f.authenticate(value):value===ownerToken?f.actor:value===otherToken?{username:'someone',role:'admin'}:null;},
    setTimer:fn=>{const timer={fn,unref(){}};timers.add(timer);return timer;},clearTimer:timer=>timers.delete(timer)});
  f.connect=()=>connect(socket);f.send=data=>handlers.cs16_admin_tools(data);
  f.disconnect=()=>{socket.connected=false;handlers.disconnect();};
  f.recheck=async()=>{const timer=[...timers][0];assert(timer);timers.delete(timer);await timer.fn();};
  return f;
}
test('only the verified Fifflaren account gets a private capability, never a supplied nickname or role',async()=>{
  const f=fixture();await f.connect();assert.deepEqual(f.events.at(-1),{name:'cs16_admin_tools_state',data:{allowed:true,wallhack:false,aimbot:false}});
  await f.send({wallhack:true,aimbot:true});assert.deepEqual(f.socket.data.cs16AdminTools,{allowed:true,wallhack:true,aimbot:true});assert.deepEqual(f.calls,[ownerToken,ownerToken]);
  for(const token of ['',undefined,'bad','x'.repeat(43),otherToken]){
    const other=fixture({token:token===undefined?'':token});other.socket.handshake.auth.username='Fifflaren';other.socket.handshake.auth.role='admin';await other.connect();
    await other.send({wallhack:true,aimbot:true,username:'Fifflaren',role:'admin',token:ownerToken});
    assert.deepEqual(other.socket.data.cs16AdminTools,denied);assert.equal(other.timers.size,0);assert(other.events.every(event=>event.data.allowed===false));other.disconnect();
  }
  f.disconnect();
});
test('both tool flags must be own boolean properties and invalid payloads cannot change selection',async()=>{
  const f=fixture();await f.connect();
  for(const data of [null,undefined,true,[],{}, {wallhack:true}, {aimbot:true}, {wallhack:'true',aimbot:true},{wallhack:true,aimbot:1},Object.create({wallhack:true,aimbot:true})]){
    await f.send(data);assert.deepEqual(f.socket.data.cs16AdminTools,{allowed:true,wallhack:false,aimbot:false});
  }
  await f.send({wallhack:true,aimbot:false});await f.send({wallhack:false,aimbot:'false'});
  assert.deepEqual(f.socket.data.cs16AdminTools,{allowed:true,wallhack:true,aimbot:false});
  await f.send({wallhack:false,aimbot:true});assert.deepEqual(f.socket.data.cs16AdminTools,{allowed:true,wallhack:false,aimbot:true});f.disconnect();
});
test('revoked, banned, offboarded and failed authentication reset enabled tools',async()=>{
  for(const actor of [null,{username:'fifflaren',isBanned:true},{username:'fifflaren',offboardedAt:new Date()},{username:'other',role:'admin'}]){
    const f=fixture();await f.connect();await f.send({wallhack:true,aimbot:true});f.actor=actor;await f.recheck();
    assert.deepEqual(f.socket.data.cs16AdminTools,denied);assert.equal(f.timers.size,0);f.disconnect();
  }
  const f=fixture();await f.connect();await f.send({wallhack:true,aimbot:true});f.authenticate=async()=>{throw Error('database unavailable');};await f.send({wallhack:true,aimbot:true});
  assert.deepEqual(f.socket.data.cs16AdminTools,denied);assert.equal(f.timers.size,0);f.disconnect();
});
test('disconnect cancels rechecks and an in-flight authentication cannot restore tools',async()=>{
  const f=fixture();await f.connect();await f.send({wallhack:true,aimbot:true});assert.equal(f.timers.size,1);
  let complete;f.authenticate=()=>new Promise(resolve=>complete=resolve);const pending=f.send({wallhack:true,aimbot:true});const before=f.events.length;f.disconnect();
  assert.deepEqual(f.socket.data.cs16AdminTools,denied);assert.equal(f.timers.size,0);complete({username:'fifflaren'});await pending;
  assert.deepEqual(f.socket.data.cs16AdminTools,denied);assert.equal(f.events.length,before);assert.equal(f.timers.size,0);
  const next=fixture();await next.connect();assert.deepEqual(next.socket.data.cs16AdminTools,{allowed:true,wallhack:false,aimbot:false});next.disconnect();
});
test('out-of-order authentication cannot overwrite a newer toggle result',async()=>{
  const f=fixture();await f.connect();const pending=[];f.authenticate=()=>new Promise(resolve=>pending.push(resolve));
  const first=f.send({wallhack:true,aimbot:true}),second=f.send({wallhack:false,aimbot:false});
  pending[1]({username:'fifflaren'});await second;pending[0]({username:'fifflaren'});await first;
  assert.deepEqual(f.socket.data.cs16AdminTools,{allowed:true,wallhack:false,aimbot:false});assert.equal(f.timers.size,1);f.disconnect();
});
test('the production calls-session authenticator rejects expired or removed owner session hashes',async()=>{
  const hash=require('node:crypto').createHash('sha256').update(ownerToken).digest('hex');
  const user={username:'fifflaren',callsSessions:[{hash,expiresAt:new Date(Date.now()+60000)}]};
  const callsService=require('./calls-service')({app:{get(){},post(){},patch(){}},io:{on(){}},Event:{},
    User:{findOne:query=>({select:async()=>user.callsSessions.some(session=>session.hash===query['callsSessions.hash'])?user:null})}});
  const f=fixture({authenticate:token=>callsService.actor(token)});await f.connect();await f.send({wallhack:true,aimbot:true});assert.equal(f.socket.data.cs16AdminTools.allowed,true);
  user.callsSessions[0].expiresAt=new Date(0);await f.recheck();assert.deepEqual(f.socket.data.cs16AdminTools,denied);
  user.callsSessions[0].expiresAt=new Date(Date.now()+60000);await f.send({wallhack:true,aimbot:true});assert.equal(f.socket.data.cs16AdminTools.allowed,true);
  user.callsSessions=[];await f.recheck();assert.deepEqual(f.socket.data.cs16AdminTools,denied);f.disconnect();
});
