const test=require('node:test'),assert=require('node:assert/strict');
const install=require('./calls-service');
function fixture(){
 const owner={username:'fifflaren',team:'Alpha',callsSessions:[]},routes={},sockets=[];
 let connection,query,skip;
 const service=install({app:{get:(path,fn)=>routes[path]=fn,patch:(path,fn)=>routes[path]=fn},io:{on:(event,fn)=>connection=fn},User:{
  findOne(){const result=Promise.resolve(owner);result.select=()=>result;return result;},
  async updateOne(filter,update){owner.callsSessions.push(...update.$push.callsSessions.$each);},
  async find(){return [{username:'member'}];}
 },Event:{find(filter){query=filter;return{sort(){return this;},skip(n){skip=n;return this;},limit(){return Promise.resolve([{_id:'call1',user:'member',createdAt:new Date(),data:{serviceName:'Service',callLink:'https://example.com'}}]);}};},countDocuments:async()=>201}});
 async function request(token,date='2026-10-25',page=0){let status=200,body;await routes['/api/fifflaren/calls']({headers:{authorization:'Bearer '+token},query:{date,page}},{status(n){status=n;return this;},json(v){body=v;}});return{status,body};}
 function socket(id){const handlers={},sent=[];const s={id,connected:true,on:(event,fn)=>handlers[event]=fn,emit:(...args)=>sent.push(args)};connection(s);sockets.push(s);return{handlers,sent,s};}
 return {service,owner,request,socket,get query(){return query;},get skip(){return skip;}};
}
test('UTC+3 report boundary, midnight and invalid dates',()=>{
 assert.equal(install.calendar(Date.parse('2026-10-25T15:59:59Z')).reportDay,'2026-10-24');
 assert.equal(install.calendar(Date.parse('2026-10-25T16:00:00Z')).reportDay,'2026-10-25');
 assert.equal(install.calendar(Date.parse('2026-10-25T21:00:00Z')).day,'2026-10-26');
 assert.equal(install.dayBounds('2026-10-25').$gte.toISOString(),'2026-10-24T21:00:00.000Z');
 assert.throws(()=>install.dayBounds('2026-02-30'));
});
test('private report rejects unknown, expired and banned sessions',async()=>{
 const f=fixture();assert.equal(await f.service.issue({username:'member',isBanned:true}),undefined);
 assert.equal((await f.request('x'.repeat(43))).status,403);
 const token=await f.service.issue(f.owner);assert.equal(await f.service.valid(token),true);
 assert.notEqual(f.owner.callsSessions[0].hash,token);
 f.owner.isBanned=true;assert.equal((await f.request(token)).status,403);
 f.owner.isBanned=false;f.owner.callsSessions[0].expiresAt=new Date(0);assert.equal((await f.request(token)).status,403);
});
test('report scopes to team at submission, falls back only for legacy events and paginates',async()=>{
 const f=fixture(),token=await f.service.issue(f.owner),response=await f.request(token);
 assert.equal(response.status,200);assert.equal(response.body.team,'alpha');assert.equal(response.body.hasMore,true);
 assert.equal(f.query.type,'call');assert.deepEqual(f.query.$or,[{'data.teamAtSubmission':'alpha'},{'data.teamAtSubmission':{$exists:false},user:{$in:['member']}}]);
 assert.equal(response.body.calls[0].link,'https://example.com');
 await f.request(token,'2026-10-25',1);assert.equal(f.skip,200);
 assert.equal((await f.request(token,'2026-02-30')).status,400);
});
test('only authenticated owner socket receives own-team calls; expiry revokes subscription',async()=>{
 const f=fixture(),token=await f.service.issue(f.owner),owner=f.socket('owner'),other=f.socket('other');
 await owner.handlers.calls_subscribe(token);await other.handlers.calls_subscribe('z'.repeat(43));
 const event={_id:'1',type:'call',user:'member',data:{teamAtSubmission:'beta'}};
 await f.service.notify(event);assert.equal(owner.sent.length,0);
 event.data.teamAtSubmission='alpha';await f.service.notify(event);assert.equal(owner.sent.length,1);assert.equal(other.sent.length,0);
 f.owner.callsSessions[0].expiresAt=new Date(0);await f.service.notify(event);assert.equal(owner.sent.length,1);
});
