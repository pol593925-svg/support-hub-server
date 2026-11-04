const test=require('node:test'),assert=require('node:assert/strict');
const workflow=require('./call-workflow'),installAccess=require('./team-access');
function response(){return {code:200,status(n){this.code=n;return this;},sendStatus(n){this.code=n;},json(body){this.body=body;}};}
test('offboarding requires Fifflaren, preserves the owner, messages only the target',async()=>{
 const routes={},sent=[],writes=[];const User={findOneAndUpdate:async(...args)=>{writes.push(args);return {username:'worker'};}};
 const app={get(){},post:(p,h)=>routes[p]=h},io={on(){},to:room=>({emit:(...a)=>sent.push([room,...a])}),sockets:{sockets:new Map()}};
 installAccess({app,io,User,onlineUsers:()=>new Map(),authenticate:async t=>t?{username:t}:null});
 async function run(t,username){const res=response();await routes['/api/owner/offboard']({headers:{authorization:'Bearer '+t},body:{username}},res);return res;}
 assert.equal((await run('other-admin','worker')).code,403);assert.equal((await run('fifflaren','fifflaren')).code,400);assert.equal(writes.length,0);
 assert.equal((await run('fifflaren','worker')).body.success,true);
 assert.deepEqual(writes[0][0],{username:'worker',offboardedAt:null});assert.equal(writes[0][1].$set.isBanned,true);assert.deepEqual(sent,[['access:worker','account_offboarded']]);
});
test('returned calls keep their identity and history; a stale edit cannot overwrite them',async()=>{
 const routes={},id='a'.repeat(24);let version=1,edit;
 const before={_id:id,user:'worker',data:{callType:'Колл на биржу',callLink:'https://old.test',reviewStatus:'returned'}};
 const match=f=>f._id===id&&f.user==='worker'&&f['data.reviewStatus']==='returned'&&f['data.reviewVersion']===version&&version===1;
 const Event={findOne:async f=>match(f)?before:null,findOneAndUpdate:async(f,u)=>{if(!match(f))return null;version++;edit=u;return before;}};
 workflow.install({app:{get(){},patch:(p,h)=>routes[p]=h},Event,actor:async t=>t?{username:t}:null,bearer:r=>r.user,notify:async()=>{},callRow:e=>({id:e._id})});
 const run=async user=>{const res=response();await routes['/api/calls/mine/:id']({user,params:{id},body:{version:1,serviceName:'Example',callLink:'https://example.test',callType:'Колл на биржу'}},res);return res;};
 assert.equal((await run('other')).code,409);assert.equal((await run('worker')).body.call.id,id);
 assert.equal(edit.$set['data.reviewStatus'],'pending');assert.deepEqual(edit.$push['data.reviewHistory'].$each.map(h=>h.action),['previous','resubmitted']);assert.equal((await run('worker')).code,409);
});
