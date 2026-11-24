'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const install=require('./profile-service');
const TOKEN='a'.repeat(43),OTHER_TOKEN='b'.repeat(43);
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=';
const get=(row,key)=>key.split('.').reduce((value,part)=>value?.[part],row);
function matches(row,filter){
  return Object.entries(filter).every(([key,value])=>{
    const actual=get(row,key);
    if(value&&typeof value==='object')return Object.entries(value).every(([op,want])=>{
      if(op==='$gte')return actual>=want;if(op==='$lte')return actual<=want;if(op==='$lt')return actual<want;if(op==='$in')return want.includes(actual);if(op==='$ne')return actual!==want;
      throw Error('Unsupported match '+op);
    });
    return value===null?actual==null:actual===value;
  });
}
function evaluate(value,row){
  if(typeof value==='string'&&value.startsWith('$'))return get(row,value.slice(1));
  if(Array.isArray(value))return value.map(entry=>evaluate(entry,row));
  if(value===null||typeof value!=='object')return value;
  const [[op,input]]=Object.entries(value),args=()=>evaluate(input,row);
  if(op==='$eq'){const [a,b]=args();return a===b;}
  if(op==='$ne'){const [a,b]=args();return a!==b;}
  if(op==='$and')return args().every(Boolean);
  if(op==='$cond')return evaluate(input[evaluate(input[0],row)?1:2],row);
  if(op==='$add')return args().reduce((a,b)=>a+b,0);
  if(op==='$multiply')return args().reduce((a,b)=>a*b,1);
  if(op==='$arrayElemAt'){const [array,index]=args();return array?.[index];}
  if(op==='$convert'){
    const actual=evaluate(input.input,row);if(actual==null)return input.onNull;
    if(input.to==='string')return typeof actual==='object'?input.onError:String(actual);
    if(input.to==='int'){const result=Number(actual);return Number.isFinite(result)?Math.trunc(result):input.onError;}
  }
  if(op==='$regexFind'){const match=new RegExp(input.regex).exec(evaluate(input.input,row));return match?{match:match[0],captures:match.slice(1)}:null;}
  throw Error('Unsupported expression '+op);
}
function aggregate(rows,pipeline){
  let current=structuredClone(rows);
  for(const stage of pipeline){
    if(stage.$match)current=current.filter(row=>matches(row,stage.$match));
    else if(stage.$set)current=current.map(row=>({...row,...Object.fromEntries(Object.entries(stage.$set).map(([key,value])=>[key,evaluate(value,row)]))}));
    else if(stage.$group){
      if(!current.length)return [];
      const result={_id:null};
      for(const [key,value]of Object.entries(stage.$group))if(key!=='_id')result[key]=current.reduce((sum,row)=>sum+(Number(evaluate(value.$sum,row))||0),0);
      current=[result];
    }else throw Error('Unsupported pipeline stage');
  }
  return current;
}
function harness(){
  const users=[{username:'alice',team:'fifflaren',position:'Сотрудник',avatar:'',telegram:'',status:'available',password:'must-not-leak',callsSessions:[{hash:'secret'}]},
    {username:'bob',team:'fifflaren',avatar:PNG,telegram:'Bob_team',status:'dnd'}];
  const events=[],daily=[],writes=[],routes=new Map();let statsFail=false,dbFail=false;
  const app=Object.fromEntries(['get','patch','post'].map(method=>[method,(url,handler)=>routes.set(method+' '+url,handler)]));
  const User={async findOneAndUpdate(filter,update){if(dbFail)throw Error('database detail');const row=users.find(user=>matches(user,filter));if(!row)return null;Object.assign(row,update.$set);writes.push({filter,update});return row;}};
  const Event={async aggregate(pipeline){if(statsFail)throw Error('statistics unavailable');return aggregate(events,pipeline);},async countDocuments(filter){if(statsFail)throw Error('statistics unavailable');return events.filter(row=>matches(row,filter)).length;}};
  const DailyStat={async aggregate(pipeline){if(statsFail)throw Error('statistics unavailable');return aggregate(daily,pipeline);}};
  install({app,User,Event,DailyStat,authenticate:async token=>token===TOKEN?users[0]:token===OTHER_TOKEN?users[1]:null,now:()=>Date.parse('2026-10-31T22:30:00Z')});
  async function request(method,url,{token=TOKEN,body,headers={}}={}){
    const response={statusCode:200,headers:{},status(code){this.statusCode=code;return this;},set(key,value){this.headers[key]=value;return this;},json(data){this.body=data;return this;}};
    await routes.get(method+' '+url)({headers:{...(token?{authorization:'Bearer '+token}:{}),...headers},body},response);
    return response;
  }
  return {request,users,events,daily,writes,setStatsFail:value=>statsFail=value,setDbFail:value=>dbFail=value};
}

test('profile read and both write routes require a valid active session',async()=>{
  const h=harness();
  for(const token of ['', 'x'.repeat(43),'invalid'])for(const [method,url]of [['get','/api/profile/me'],['patch','/api/profile/me'],['post','/api/profile']]){
    const result=await h.request(method,url,{token,body:{username:'alice',avatar:''}});assert.equal(result.statusCode,401);
  }
  h.users[0].offboardedAt=new Date();assert.equal((await h.request('get','/api/profile/me')).statusCode,401);
  h.users[0].offboardedAt=null;h.users[0].isBanned=true;assert.equal((await h.request('patch','/api/profile/me',{body:{status:'break'}})).statusCode,401);
  assert.equal(h.writes.length,0);
});
test('own GET returns only profile fields, never passwords or authentication material',async()=>{
  const h=harness(),result=await h.request('get','/api/profile/me');
  assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'no-store');
  const profile=result.body.profile;assert.equal(profile.username,'alice');assert.equal(profile.month.from,'2026-11-01');assert.equal(profile.month.logs,0);
  assert(!JSON.stringify(result.body).includes('must-not-leak'));assert(!('callsSessions'in profile));assert(!('password'in profile));
  h.users[0].username='fifflaren';h.users[0].team='';delete h.users[0].status;
  assert.equal((await h.request('get','/api/profile/me')).body.profile.team,'fifflaren');assert.equal((await h.request('get','/api/profile/me')).body.profile.status,'available');
});
test('avatar, Telegram and status persist in the account and partial updates retain other fields',async()=>{
  const h=harness();
  const saved=await h.request('patch','/api/profile/me',{body:{avatar:PNG,telegram:'  @Alice_team  ',status:'break'}});
  assert.equal(saved.statusCode,200);assert.equal(saved.body.profile.telegram,'Alice_team');assert.equal(saved.body.profile.avatar,PNG);
  await h.request('patch','/api/profile/me',{body:{status:'dnd'}});
  const loaded=(await h.request('get','/api/profile/me')).body.profile;
  assert.equal(loaded.status,'dnd');assert.equal(loaded.telegram,'Alice_team');assert.equal(loaded.avatar,PNG);
  assert.equal(h.users[1].telegram,'Bob_team');assert.equal(h.users[1].avatar,PNG);
  const cleared=await h.request('patch','/api/profile/me',{body:{avatar:'',telegram:''}});assert.equal(cleared.body.profile.avatar,'');assert.equal(cleared.body.profile.telegram,'');assert.equal(cleared.body.profile.status,'dnd');
});
test('identity, privileges, invalid Telegram, arbitrary links and unsupported statuses are rejected',async()=>{
  const h=harness();
  for(const body of [{username:'bob',status:'break'},{role:'admin'},{},[],{status:'online'},{telegram:'12345'},{telegram:'abcd'},{telegram:'https://t.me/alice'},{telegram:'@abc<script>'},{telegram:'a'.repeat(33)},{telegram:null},{telegram:'@@Alice_team'}]){
    const response=await h.request('patch','/api/profile/me',{body});assert.equal(response.statusCode,400,JSON.stringify(body));
  }
  assert.equal(h.writes.length,0);assert.equal(h.users[1].status,'dnd');
});
test('legacy avatar route cannot impersonate another account, including with a valid session',async()=>{
  const h=harness();
  assert.equal((await h.request('post','/api/profile',{body:{username:'bob',avatar:''}})).statusCode,403);
  assert.equal((await h.request('post','/api/profile',{token:OTHER_TOKEN,body:{username:'alice',avatar:PNG}})).statusCode,403);
  assert.equal((await h.request('post','/api/profile',{body:{username:' ALICE ',avatar:PNG}})).statusCode,200);
  assert.equal(h.users[0].avatar,PNG);assert.equal(h.users[1].avatar,PNG);
  assert.equal(h.writes.length,1);
});
test('avatars accept raster data only, enforce the encoded size limit, and reject disguised SVG',async()=>{
  const h=harness();assert(install.validAvatar(PNG));assert(install.validAvatar(''));
  for(const avatar of ['https://example.com/avatar.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,'+Buffer.from('<svg/>').toString('base64'),PNG+'junk','data:image/png;base64,'+'A'.repeat(400000),null,1]){
    const result=await h.request('patch','/api/profile/me',{body:{avatar}});assert.equal(result.statusCode,400);
  }
  assert.equal(h.writes.length,0);
});
test('month follows Kyiv boundaries, including daylight saving changes and leap years',()=>{
  assert.equal(install.monthBounds(Date.parse('2026-10-31T22:30:00Z')).from,'2026-11-01');
  assert.equal(install.monthBounds(Date.parse('2026-07-31T21:30:00Z')).from,'2026-08-01');
  assert.equal(install.monthBounds(Date.parse('2024-02-15T12:00:00Z')).to,'2024-02-29');
  assert.equal(install.monthBounds(Date.parse('2026-02-15T12:00:00Z')).to,'2026-02-28');
});
test('monthly statistics count real owner records, avoid counting shift totals as additional logs and parse historical durations',async()=>{
  const h=harness();
  h.events.push(
    {user:'alice',date:'2026-11-01',type:'shift',data:{duration:'2 ч. 18 мин.',logs:999}},
    {user:'alice',date:'2026-11-02',type:'shift',data:{duration:'10 ч. 05 мин.',logs:0}},
    {user:'alice',date:'2026-11-02',type:'shift',data:{duration:'unknown'}},
    {user:'alice',date:'2026-11-02',type:'log',data:{}},
    {user:'alice',date:'2026-11-03',type:'log',data:{}},
    {user:'alice',date:'2026-11-03',type:'call',data:{reviewStatus:'done',reviewedAt:new Date('2026-11-03T15:00:00Z')}},
    {user:'alice',date:'2026-10-31',type:'call',data:{reviewStatus:'done',reviewedAt:new Date('2026-10-31T22:30:00Z')}},
    {user:'alice',date:'2026-11-03',type:'call',data:{reviewStatus:'done',reviewedAt:new Date('2026-11-30T22:01:00Z')}},
    {user:'alice',date:'2026-11-04',type:'call',data:{reviewStatus:'pending'}},
    {user:'alice',date:'2026-10-31',type:'shift',data:{duration:'8 ч. 0 мин.'}},
    {user:'alice',date:'2026-12-01',type:'log',data:{}},
    {user:'bob',date:'2026-11-04',type:'call',data:{reviewStatus:'done'}},
    {user:'bob',date:'2026-11-01',type:'shift',data:{duration:'8 ч. 30 мин.'}}
  );
  h.daily.push({username:'alice',date:'2026-11-01',truffles:20,approves:3},{username:'alice',date:'2026-11-02',truffles:50,approves:2},{username:'bob',date:'2026-11-01',truffles:300,approves:50},{username:'alice',date:'2026-10-31',truffles:900,approves:100});
  const result=(await h.request('get','/api/profile/me')).body.profile.month;
  assert.deepEqual({shifts:result.shifts,logs:result.logs,workedMinutes:result.workedMinutes,closedCalls:result.closedCalls,truffles:result.truffles,approves:result.approves,durationUnknownShifts:result.durationUnknownShifts},
    {shifts:3,logs:2,workedMinutes:743,closedCalls:2,truffles:70,approves:5,durationUnknownShifts:1});
  assert.equal(result.recordedShiftsOnly,true);
});
test('unavailable statistics never become zero statistics and do not prevent profile persistence',async()=>{
  const h=harness();h.setStatsFail(true);
  const read=await h.request('get','/api/profile/me');assert.equal(read.statusCode,200);assert.equal(read.body.profile.month,null);assert.equal(read.body.profile.statsUnavailable,true);
  const save=await h.request('patch','/api/profile/me',{body:{status:'break'}});assert.equal(save.statusCode,200);assert.equal(save.body.profile.status,'break');assert.equal(save.body.profile.month,null);
  h.setStatsFail(false);const fresh=await h.request('get','/api/profile/me');assert.equal(fresh.body.profile.status,'break');assert.equal(fresh.body.profile.month.logs,0);
});
test('failed persistence reports failure without modifying account data or exposing database errors',async()=>{
  const h=harness();h.setDbFail(true);
  const response=await h.request('patch','/api/profile/me',{body:{status:'break'}});
  assert.equal(response.statusCode,503);assert.equal(h.users[0].status,'available');assert(!JSON.stringify(response.body).includes('database detail'));
});
