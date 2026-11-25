'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const install=require('./calls-service');

function value(row,path){
  const [key,...rest]=path.split('.');
  if(Array.isArray(row))return row.map(item=>value(item,path));
  const current=row?.[key];return rest.length?value(current,rest.join('.')):current;
}
function compare(actual,expected){
  if(expected instanceof RegExp)return expected.test(actual||'');
  if(expected&&typeof expected==='object'&&!(expected instanceof Date))return Object.entries(expected).every(([op,want])=>{
    if(op==='$exists')return (actual!==undefined)===want;
    if(op==='$ne')return !compare(actual,want);
    if(op==='$in')return want.some(item=>compare(actual,item));
    if(op==='$gte')return actual>=want;
    if(op==='$lt')return actual<want;
    return compare(actual?.[op],want);
  });
  if(Array.isArray(actual))return actual.some(item=>compare(item,expected));
  return expected===null?actual==null:actual===expected;
}
function matches(row,filter){return Object.entries(filter).every(([key,want])=>key==='$or'?want.some(f=>matches(row,f)):key==='$and'?want.every(f=>matches(row,f)):compare(value(row,key),want));}
function set(row,key,v){const parts=key.split('.'),last=parts.pop();let target=row;for(const part of parts)target=target[part]??={};target[last]=v;}
function update(row,changes){
  for(const [key,v]of Object.entries(changes.$set||{}))set(row,key,v);
  for(const [key,v]of Object.entries(changes.$inc||{}))set(row,key,(value(row,key)||0)+v);
  for(const [key,v]of Object.entries(changes.$push||{})){
    const next=[...(value(row,key)||[]),...(v.$each||[v])];set(row,key,v.$slice?next.slice(v.$slice):next);
  }
  return row;
}
class Query{
  constructor(get){this.get=get;this.sortBy=null;this.offset=0;this.count=Infinity;}
  select(){return this;}
  sort(v){this.sortBy=v;return this;}
  skip(v){this.offset=v;return this;}
  limit(v){this.count=v;return this;}
  then(resolve,reject){return Promise.resolve().then(()=>{
    let result=this.get();if(!Array.isArray(result))return result;
    if(this.sortBy)result=result.slice().sort((a,b)=>{for(const [key,dir]of Object.entries(this.sortBy)){if(value(a,key)<value(b,key))return -dir;if(value(a,key)>value(b,key))return dir;}return 0;});
    return result.slice(this.offset,this.offset+this.count);
  }).then(resolve,reject);}
}
async function fixture(){
  const users=[['fifflaren','alpha'],['member','alpha'],['helper','beta'],['outsider','gamma']].map(([username,team])=>({username,team,role:'user',callsSessions:[],callsReviewAudit:[]}));
  const events=[],routes=new Map();let connect;
  const User={
    findOne:filter=>new Query(()=>users.find(user=>matches(user,filter))||null),
    find:filter=>new Query(()=>users.filter(user=>matches(user,filter))),
    updateOne:async(filter,changes)=>update(users.find(user=>matches(user,filter)),changes),
    findOneAndUpdate:(filter,changes)=>new Query(()=>{const user=users.find(user=>matches(user,filter));return user?update(user,changes):null;})
  };
  class Event{
    constructor(data){Object.assign(this,data);this._id||=(events.length+1).toString(16).padStart(24,'0');this.createdAt||=new Date();}
    async save(){if(events.some(row=>row._id===this._id)){const error=new Error('Duplicate _id');error.code=11000;throw error;}events.push(this);return this;}
    static find(filter){return new Query(()=>events.filter(row=>matches(row,filter)));}
    static findOne(filter){return new Query(()=>events.find(row=>matches(row,filter))||null);}
    static countDocuments(filter){return Promise.resolve(events.filter(row=>matches(row,filter)).length);}
    static async findOneAndUpdate(filter,changes){const row=events.find(row=>matches(row,filter));return row?update(row,changes):null;}
  }
  const app={};for(const method of ['get','post','patch'])app[method]=(path,handler)=>routes.set(method+' '+path,handler);
  const service=install({app,io:{on:(_event,handler)=>connect=handler},User,Event});
  const tokens={};for(const user of users)tokens[user.username]=await service.issue(user);
  async function request(method,path,name='member',body={},params={},query={}){
    let status=200,result;const handler=routes.get(method+' '+path);assert(handler,'Route exists: '+path);
    await handler({headers:{authorization:'Bearer '+(tokens[name]||name)},body,params,query},{status(n){status=n;return this;},json(data){result=data;return this;}});
    return {status,data:result};
  }
  async function socket(name){
    const handlers={},sent=[];connect({id:name,connected:true,on:(n,fn)=>handlers[n]=fn,emit:(...args)=>sent.push(args)});await handlers.calls_subscribe(tokens[name]);return {handlers,sent};
  }
  const grant=(enabled=true,name='helper')=>request('patch','/api/owner/calls-access/:username','fifflaren',{enabled},{username:name});
  return {users,events,Event,service,tokens,request,socket,grant};
}

test('only owner grants narrowly scoped call review; permission is persistent and audited',async()=>{
  const f=await fixture();
  assert.equal((await f.request('get','/api/calls/access','invalid')).status,401);
  assert.equal((await f.request('get','/api/calls/access')).data.canReview,false);
  assert.equal((await f.request('get','/api/owner/calls-access','helper')).status,403);
  assert.equal((await f.request('patch','/api/owner/calls-access/:username','helper',{enabled:true,role:'admin'},{username:'helper'})).status,403);
  const socket=await f.socket('helper'),granted=await f.grant();assert.equal(granted.status,200);
  assert.equal(granted.data.canReview,true);assert.equal(granted.data.isOwner,false);
  assert.equal(f.users[2].role,'user');assert.deepEqual(f.users[2].callsReviewAudit.map(a=>[a.by,a.enabled,a.team]),[['fifflaren',true,'alpha']]);
  assert.equal(socket.sent[0][0],'calls_access_changed');assert.equal(socket.sent[0][1].canReview,true);
  assert.equal(await f.service.valid(f.tokens.helper),false,'Reviewer never receives owner privileges');
  const list=await f.request('get','/api/owner/calls-access','fifflaren');assert.equal(list.data.users.find(u=>u.username==='helper').canReview,true);
  assert.equal((await f.request('patch','/api/owner/calls-access/:username','fifflaren',{enabled:'true'},{username:'helper'})).status,400);
  assert.equal((await f.request('patch','/api/owner/calls-access/:username','fifflaren',{enabled:false},{username:'fifflaren'})).status,400);
  assert.equal((await f.request('patch','/api/owner/calls-access/:username','fifflaren',{enabled:true},{username:'missing'})).status,404);
});

test('reviewer reads only granted team; revocation, owner team change and expiry close access',async()=>{
  const f=await fixture();await f.grant();
  await new f.Event({type:'call',user:'member',data:{teamAtSubmission:'alpha'}}).save();
  await new f.Event({type:'call',user:'outsider',data:{teamAtSubmission:'gamma'}}).save();
  const list=await f.request('get','/api/fifflaren/calls','helper');assert.equal(list.status,200);assert.equal(list.data.calls.length,1);assert.equal(list.data.calls[0].user,'member');
  const own=await f.request('get','/api/calls/mine','outsider');assert.equal(own.data.calls.length,1);assert.equal(own.data.calls[0].user,'outsider');
  assert.equal((await f.request('get','/api/fifflaren/calls','outsider',{}, {},{team:'alpha'})).status,403);
  f.users[0].team='new-team';assert.equal((await f.request('get','/api/fifflaren/calls','helper')).status,403);
  f.users[0].team='alpha';const sock=await f.socket('helper');await f.grant(false);
  assert.equal(sock.sent[0][0],'calls_access_changed');assert.equal(sock.sent[0][1].canReview,false);
  await f.service.notify(f.events[0]);assert.equal(sock.sent.length,1,'Revoked socket receives no team call content');
  assert.equal((await f.request('get','/api/fifflaren/calls','helper')).status,403);
  await f.grant();f.users[2].callsSessions[0].expiresAt=new Date(0);assert.equal((await f.request('get','/api/calls/access','helper')).status,401);
});

test('network request is authenticated, canonical, retry-safe and delivered to owner queue across teams',async()=>{
  const f=await fixture(),owner=await f.socket('fifflaren'),outsider=await f.socket('outsider');
  const body={link:'https://example.com/network/ticket-1',requestId:'01234567-89ab-cdef-0123-456789abcdef'};
  assert.equal((await f.request('post','/api/calls/network-requests','invalid',body)).status,401);
  for(const link of ['javascript:alert(1)','file:///C:/secret','https://name:secret@example.com', 'https://example.com/'+ 'x'.repeat(2048)])assert.equal((await f.request('post','/api/calls/network-requests','member',{...body,link})).status,400);
  assert.equal((await f.request('post','/api/calls/network-requests','member',{...body,requestId:'short'})).status,400);
  const replies=await Promise.all([f.request('post','/api/calls/network-requests','outsider',{...body,user:'fifflaren',status:'done',teamAtSubmission:'gamma'}),f.request('post','/api/calls/network-requests','outsider',body)]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,201]);assert.equal(f.events.length,1);assert.equal(owner.sent.length,1);assert.equal(outsider.sent.length,1);
  const row=replies[0].data.call;assert.equal(row.user,'outsider');assert.equal(row.status,'pending');assert.equal(row.requestType,'network');assert.equal(row.kind,'Скачать пасы');
  assert.equal(f.events[0].data.teamAtSubmission,'alpha');assert.equal(f.events[0].data.submittedByTeam,'gamma');
  assert.equal((await f.request('get','/api/fifflaren/calls','fifflaren')).data.calls[0].id,row.id);
  assert.equal((await f.request('get','/api/calls/mine','outsider')).data.calls[0].id,row.id);
  assert.equal((await f.request('post','/api/calls/network-requests','outsider',{...body,link:'https://example.com/changed'})).status,409);
  assert.equal(f.events.length,1);assert.equal(f.events[0].data.callLink,body.link);
});

test('review stores actual reviewer and rejects stale concurrent status or wrong-team writes',async()=>{
  const f=await fixture();await f.grant();
  const r=await f.request('post','/api/calls/network-requests','member',{link:'https://example.com/a',requestId:'request-1234567890'}),id=r.data.call.id;
  const another=new f.Event({type:'call',user:'outsider',data:{teamAtSubmission:'gamma',reviewVersion:0}});await another.save();
  assert.equal((await f.request('patch','/api/fifflaren/calls/:id','helper',{status:'done'},{id})).status,400);
  assert.equal((await f.request('patch','/api/fifflaren/calls/:id','helper',{status:'done',version:0},{id:another._id})).status,409);
  const replies=await Promise.all(['helper','fifflaren'].map(name=>f.request('patch','/api/fifflaren/calls/:id',name,{status:'done',version:0},{id})));
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  const done=replies.find(r=>r.status===200).data.call;assert.equal(done.version,1);assert.equal(done.reviewedBy,'helper');assert.equal(done.history.at(-1).by,'helper');
  await f.grant(false);assert.equal((await f.request('patch','/api/fifflaren/calls/:id','helper',{status:'pending',version:1},{id})).status,403);
});

test('returned network link can be corrected without changing category or losing identity',async()=>{
  const f=await fixture();const r=await f.request('post','/api/calls/network-requests','member',{link:'https://example.com/a',requestId:'request-1234567890'}),id=r.data.call.id;
  await f.request('patch','/api/fifflaren/calls/:id','fifflaren',{status:'returned',reason:'Исправь ссылку',version:0},{id});
  const body={version:1,callLink:'https://example.com/b',callType:'Колл на биржу',serviceName:'Changed',callNote:'Not copied'};
  assert.equal((await f.request('patch','/api/calls/mine/:id','outsider',body,{id})).status,409);
  const edited=await f.request('patch','/api/calls/mine/:id','member',body,{id});assert.equal(edited.status,200);
  assert.equal(edited.data.call.id,id);assert.equal(edited.data.call.kind,'Скачать пасы');assert.equal(edited.data.call.service,'Пасы · сеть');
  assert.equal(edited.data.call.link,body.callLink);assert.equal(edited.data.call.status,'pending');assert.equal(edited.data.call.reviewedBy,'');assert.equal(edited.data.call.history.at(-1).action,'resubmitted');
  assert.equal((await f.request('patch','/api/calls/mine/:id','member',body,{id})).status,409);
  const retry=await f.request('post','/api/calls/network-requests','member',{link:'https://example.com/a',requestId:'request-1234567890'});
  assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);assert.equal(retry.data.call.link,'https://example.com/b');assert.equal(f.events.length,1);
});

test('offboarded or banned identities cannot create requests, review, receive calls or retain owner authority',async()=>{
  const f=await fixture();await f.grant();const sock=await f.socket('helper');
  f.users[2].offboardedAt=new Date();
  assert.equal((await f.request('get','/api/calls/access','helper')).status,401);
  assert.equal((await f.request('get','/api/fifflaren/calls','helper')).status,403);
  assert.equal((await f.request('post','/api/calls/network-requests','helper',{link:'https://example.com/a',requestId:'request-1234567890'})).status,401);
  await f.service.notify({type:'call',user:'member',data:{teamAtSubmission:'alpha'}});assert.equal(sock.sent.length,0);
  assert.equal((await f.grant(true,'helper')).status,404);
  f.users[0].offboardedAt=new Date();assert.equal(await f.service.valid(f.tokens.fifflaren),false);
  assert.equal((await f.grant(true,'member')).status,403);
  f.users[0].offboardedAt=null;f.users[0].isBanned=true;assert.equal((await f.grant(true,'member')).status,403);
});

test('quantity requests validate authenticated team membership and persist exactly once under retries',async()=>{
  const f=await fixture(),owner=await f.socket('fifflaren'),member=await f.socket('member');
  const body={quantity:15,requestId:'quantity-request-12345678'};
  assert.equal((await f.request('post','/api/calls/log-requests','invalid',body)).status,401);
  assert.equal((await f.request('post','/api/calls/log-requests','outsider',body)).status,403);
  for(const quantity of [0,-1,0.5,100001,'12',null,true,{},[1]])
    assert.equal((await f.request('post','/api/calls/log-requests','member',{...body,quantity})).status,400);
  assert.equal((await f.request('post','/api/calls/log-requests','member',{...body,requestId:'short'})).status,400);
  const replies=await Promise.all([1,2].map(()=>f.request('post','/api/calls/log-requests','member',{
    ...body,user:'outsider',teamAtSubmission:'gamma',status:'done',callLink:'https://example.com/not-used'})));
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,201]);assert.equal(f.events.length,1);
  const row=replies[0].data.call;
  assert.equal(row.user,'member');assert.equal(row.requestType,'logs');assert.equal(row.quantity,15);
  assert.equal(row.kind,'Запросить логов');assert.equal(row.service,'Запрос логов · 15');assert.equal(row.link,'');assert.equal(row.status,'pending');
  assert.equal(f.events[0].data.teamAtSubmission,'alpha');assert.equal(f.events[0].data.reviewHistory[0].quantity,15);
  assert.equal(owner.sent.length,1);assert.equal(member.sent.length,1);
  assert.equal((await f.request('get','/api/fifflaren/calls','fifflaren')).data.calls[0].quantity,15);
  assert.equal((await f.request('get','/api/calls/mine','member')).data.calls[0].quantity,15);
  assert.equal((await f.request('post','/api/calls/log-requests','member',{...body,quantity:16})).status,409);
  for(const quantity of [1,100000])assert.equal((await f.request('post','/api/calls/log-requests','member',{quantity,requestId:'quantity-boundary-'+quantity})).status,201);
  f.users[1].isBanned=true;assert.equal((await f.request('post','/api/calls/log-requests','member',body)).status,401);
});

test('returned quantity is corrected with revision checks and retains original retry identity',async()=>{
  const f=await fixture(),body={quantity:7,requestId:'quantity-request-12345678'};
  const first=await f.request('post','/api/calls/log-requests','member',body),id=first.data.call.id;
  assert.equal((await f.request('patch','/api/fifflaren/calls/:id','fifflaren',{status:'returned',reason:'Уточни количество',version:0},{id})).status,200);
  assert.equal((await f.request('patch','/api/calls/mine/:id','outsider',{quantity:9,version:1},{id})).status,409);
  assert.equal((await f.request('patch','/api/calls/mine/:id','member',{quantity:0,version:1},{id})).status,400);
  f.users[1].team='beta';assert.equal((await f.request('patch','/api/calls/mine/:id','member',{quantity:9,version:1},{id})).status,403);f.users[1].team='alpha';
  const fixed=await f.request('patch','/api/calls/mine/:id','member',{quantity:9,version:1,callType:'Колл на биржу',callLink:'https://example.com',serviceName:'ignored'},{id});
  assert.equal(fixed.status,200);assert.equal(fixed.data.call.quantity,9);assert.equal(fixed.data.call.status,'pending');assert.equal(fixed.data.call.version,2);
  assert.equal(fixed.data.call.kind,'Запросить логов');assert.equal(fixed.data.call.link,'');assert.equal(fixed.data.call.history.at(-1).quantity,9);
  assert.equal((await f.request('patch','/api/calls/mine/:id','member',{quantity:9,version:1},{id})).status,409);
  const replay=await f.request('post','/api/calls/log-requests','member',body);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.call.quantity,9);
  const done=await f.request('patch','/api/fifflaren/calls/:id','fifflaren',{status:'done',version:2},{id});assert.equal(done.status,200);assert.equal(done.data.call.quantity,9);assert.equal(done.data.call.status,'done');assert.equal(done.data.call.reviewedBy,'fifflaren');assert.equal(f.events.length,1);
});

test('authorized feed and call lists return current author photos once and preserve deleted history',async()=>{
  const f=await fixture(),photo='data:image/png;base64,aGVsbG8=';
  Object.assign(f.users[1],{avatar:photo,telegram:'private_contact',password:'private_password'});
  const socket=await f.socket('fifflaren');
  await f.request('post','/api/calls/log-requests','member',{quantity:5,requestId:'quantity-request-12345678'});
  assert.equal(socket.sent[0][1].avatar,photo);
  await new f.Event({type:'call',user:'member',data:{teamAtSubmission:'alpha'}}).save();
  await new f.Event({type:'call',user:'deleted',data:{teamAtSubmission:'alpha'}}).save();
  await new f.Event({type:'call',user:'outsider',data:{teamAtSubmission:'gamma'}}).save();
  const list=(await f.request('get','/api/fifflaren/calls','fifflaren')).data;
  assert.deepEqual(list.authors,{member:{avatar:photo},deleted:{avatar:''}});
  assert(!JSON.stringify(list.authors).includes('private_'));
  assert.equal(list.calls.filter(row=>row.user==='member').length,2);
  const log=await f.request('post','/api/logs','member',{link:'https://example.com/work',comment:'Обновление'});
  assert.equal(log.data.log.avatar,photo);assert.equal(socket.sent.at(-1)[0],'team_log');assert.equal(socket.sent.at(-1)[1].avatar,photo);
  assert.deepEqual((await f.request('get','/api/logs/team','fifflaren')).data.authors,{member:{avatar:photo}});
  f.users[1].avatar='';assert.deepEqual((await f.request('get','/api/logs/team','fifflaren')).data.authors,{member:{avatar:''}});
  assert.deepEqual((await f.request('get','/api/calls/mine','outsider')).data.authors,{outsider:{avatar:''}});
});
