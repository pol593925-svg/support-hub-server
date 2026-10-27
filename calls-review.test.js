const test=require('node:test'),assert=require('node:assert/strict'),install=require('./calls-service');
test('personal history is private; only owner can review own team; rejection requires reason',async()=>{
 const users=[{username:'fifflaren',team:'alpha',callsSessions:[]},{username:'member',team:'alpha',callsSessions:[]}],routes={};let query,update;
 const event={_id:'a'.repeat(24),type:'call',user:'member',createdAt:new Date(),data:{teamAtSubmission:'alpha'}};
 const User={findOne(filter){const u=filter.username?users.find(u=>u.username===filter.username):users.find(u=>u.callsSessions.some(s=>s.hash===filter['callsSessions.hash']));return{then:f=>Promise.resolve(u).then(f),select:()=>Promise.resolve(u)};},async updateOne(f,u){users.find(x=>x.username===f.username).callsSessions.push(...u.$push.callsSessions.$each);},find:async()=>[{username:'member'}]};
 const Event={find(f){query=f;return {sort(){return this;},skip(){return this;},limit:async()=>[event]};},countDocuments:async()=>1,findOneAndUpdate:async(f,u)=>{query=f;update=u;for(const [key,value] of Object.entries(u.$set))event.data[key.slice(5)]=value;return event;}};
 const service=install({app:{get:(p,h)=>routes[p]=h,patch:(p,h)=>routes[p]=h},io:{on(){}},User,Event});
 const owner=await service.issue(users[0]),member=await service.issue(users[1]);
 async function call(route,token,body={}){let status=200,result;await routes[route]({headers:{authorization:'Bearer '+token},query:{},params:{id:event._id},body},{status(n){status=n;return this;},json(v){result=v;}});return{status,result};}
 assert.equal((await call('/api/calls/mine',member)).status,200);assert.equal(query.user,'member');
 assert.equal((await call('/api/calls/mine','invalid')).status,403);
 assert.equal((await call('/api/fifflaren/calls/:id',member,{status:'done'})).status,403);
 assert.equal((await call('/api/fifflaren/calls/:id',owner,{status:'rejected'})).status,400);
 const rejected=await call('/api/fifflaren/calls/:id',owner,{status:'rejected',reason:'Неверная ссылка'});assert.equal(rejected.status,200);assert.equal(rejected.result.call.reason,'Неверная ссылка');assert.equal(query.$or[0]['data.teamAtSubmission'],'alpha');
 assert.equal((await call('/api/calls/mine',member)).result.calls[0].status,'rejected');
 await call('/api/fifflaren/calls/:id',owner,{status:'done'});assert.equal(update.$set['data.reviewReason'],'');
});
