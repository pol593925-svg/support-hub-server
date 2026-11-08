const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const install=require('./auth-session');
const token='t'.repeat(43),hash=crypto.createHash('sha256').update(token).digest('hex');
function fixture(){
 const routes={},user={username:'fifflaren',role:'admin',team:'alpha',callsSessions:[{hash,expiresAt:new Date(Date.now()+60000)}]};let record,error=false;
 install({app:{get:(p,f)=>routes[p]=f,post:(p,f)=>routes[p]=f},User:{updateOne:async(...args)=>record=args},authenticate:async t=>{if(error)throw Error('db');return t===token?user:null;}});
 return {user,get record(){return record;},fail(){error=true;},async request(route,t=token,body={}){let status=200,data,cache;await routes[route]({headers:{authorization:t?'Bearer '+t:''},body},{set(k,v){cache=v;},status(n){status=n;return this;},json(v){data=v;}});return {status,data,cache};}};
}
test('resuming uses current server role and expiry, never a supplied identity',async()=>{
 const f=fixture();f.user.role='user';const r=await f.request('/api/auth/session',token,{username:'someone',role:'admin'});
 assert.equal(r.status,200);assert.equal(r.data.username,'fifflaren');assert.equal(r.data.role,'user');assert.equal(r.data.callsToken,token);assert.equal(r.cache,'no-store');assert(!('callsSessions' in r.data));
});
test('missing, unknown and expired passes cannot authenticate',async()=>{
 const f=fixture();for(const t of ['', 'x'.repeat(43),'bad'])assert.equal((await f.request('/api/auth/session',t)).status,401);
 f.user.callsSessions[0].expiresAt=new Date(0);assert.equal((await f.request('/api/auth/session')).status,401);
});
test('ban and offboarding immediately reject a saved pass',async()=>{
 const f=fixture();f.user.isBanned=true;assert.equal((await f.request('/api/auth/session')).status,401);
 f.user.isBanned=false;f.user.offboardedAt=new Date();assert.equal((await f.request('/api/auth/session')).status,401);
});
test('temporary backend failure is distinct from invalidation',async()=>{const f=fixture();f.fail();assert.equal((await f.request('/api/auth/session')).status,503);});
test('logout revokes only the presented session hash, malformed token cannot broaden update',async()=>{
 const f=fixture();await f.request('/api/auth/logout','bad');assert.equal(f.record,undefined);
 await f.request('/api/auth/logout');assert.deepEqual(f.record,[{'callsSessions.hash':hash},{$pull:{callsSessions:{hash}}}]);
});
