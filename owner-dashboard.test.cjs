'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const install=require('./owner-dashboard'),{dayBounds}=require('./calls-service');

const get=(row,path)=>path.split('.').reduce((value,key)=>value?.[key],row);
function matches(row,filter){
  return Object.entries(filter).every(([key,want])=>{
    if(key==='$or')return want.some(part=>matches(row,part));
    const actual=get(row,key);
    if(want&&typeof want==='object'&&!(want instanceof Date))return Object.entries(want).every(([op,value])=>{
      if(op==='$exists')return (actual!==undefined)===value;
      if(op==='$in')return value.includes(actual);
      if(op==='$nin')return !value.includes(actual);
      throw Error('Unsupported query operator '+op);
    });
    return actual===want;
  });
}
function project(row,fields){
  if(!fields)return row;
  const result={_id:row._id};
  for(const path of fields.split(/\s+/).map(field=>field.replace(/^\+/,''))){
    const value=get(row,path);if(value===undefined)continue;
    const keys=path.split('.'),last=keys.pop();let target=result;
    for(const key of keys)target=target[key]??={};target[last]=value;
  }
  return result;
}
function expression(value,row){
  if(typeof value==='string'&&value.startsWith('$'))return get(row,value.slice(1));
  if(value&&typeof value==='object'){
    if(value.$eq)return expression(value.$eq[0],row)===expression(value.$eq[1],row);
    if(value.$cond)return expression(value.$cond[expression(value.$cond[0],row)?1:2],row);
    throw Error('Unsupported aggregate expression');
  }
  return value;
}
function aggregate(rows,pipeline){
  let result=rows.slice();
  for(const stage of pipeline){
    if(stage.$match){result=result.filter(row=>matches(row,stage.$match));continue;}
    if(stage.$group){
      const groups=new Map();
      for(const row of result){
        const id=expression(stage.$group._id,row),group=groups.get(id)||{_id:id};
        for(const [key,spec] of Object.entries(stage.$group))if(key!=='_id'){
          assert('$sum' in spec);const value=expression(spec.$sum,row);
          group[key]=(group[key]||0)+(typeof value==='number'?value:0);
        }
        groups.set(id,group);
      }
      result=[...groups.values()];continue;
    }
    throw Error('Unsupported aggregate stage');
  }
  return result;
}
function fixture(){
  const users=[{username:'fifflaren',team:'alpha',role:'user'},{username:'member',team:'alpha'},
    {username:'helper',team:'alpha',role:'admin',callsReviewAccess:{by:'fifflaren',team:'alpha'}},
    {username:'other',team:'beta',role:'admin'}];
  const events=[],loans=[],online=new Map(),reads=[],selections=[],sessions=new Map();
  for(const user of users)sessions.set(user.username+'-token',user);
  let handler,failAt='';
  const check=operation=>{reads.push(operation);if(failAt===operation)throw Error('Database failure with private details');};
  class Query{
    constructor(rows,filter,kind){this.rows=rows;this.filter=filter;this.kind=kind;this.count=Infinity;}
    select(fields){this.fields=fields;selections.push({kind:this.kind,fields});return this;}
    sort(order){this.order=order;return this;}
    limit(count){this.count=count;return this;}
    async lean(){
      check(this.kind+'.find');let result=this.rows.filter(row=>matches(row,this.filter));
      if(this.order)result=result.slice().sort((a,b)=>{
        for(const [key,direction]of Object.entries(this.order)){if(get(a,key)<get(b,key))return -direction;if(get(a,key)>get(b,key))return direction;}return 0;
      });
      return result.slice(0,this.count).map(row=>project(row,this.fields));
    }
  }
  const model=(rows,kind)=>({find:filter=>new Query(rows,filter,kind),async aggregate(pipeline){check(kind+'.aggregate');return aggregate(rows,pipeline);}});
  install({app:{get(path,fn){assert.equal(path,'/api/owner/dashboard');handler=fn;}},
    User:model(users,'User'),Event:model(events,'Event'),Loan:model(loans,'Loan'),onlineUsers:()=>online,
    authenticate:async token=>{if(failAt==='authenticate')throw Error('Private auth failure');return sessions.get(token)||null;}});
  let nextId=1;
  const id=()=>String(nextId++).padStart(24,'0');
  function call(data={},fields={}){const row={_id:id(),user:'member',type:'call',createdAt:new Date('2024-01-02T12:00:00Z'),data:{teamAtSubmission:'alpha',...data},...fields};events.push(row);return row;}
  function loan(fields={}){const row={_id:id(),borrower:'member',quantity:25,status:'requested',createdAt:new Date('2024-01-02T12:00:00Z'),...fields};loans.push(row);return row;}
  async function request(token='fifflaren-token',extra={}){
    let status=200,data;const headers={};
    await handler({headers:{authorization:token?'Bearer '+token:''},...extra},{
      set(key,value){headers[key]=value;return this;},status(value){status=value;return this;},json(value){data=value;return this;}
    });return {status,data,headers};
  }
  return {users,events,loans,online,reads,selections,sessions,call,loan,request,fail(operation){failAt=operation;}};
}

test('dashboard requires an active owner session, never an admin role or delegated review permission',async()=>{
  const f=fixture();f.call();
  for(const [token,status]of [['',401],['expired-token',401],['member-token',403],['helper-token',403],['other-token',403]]){
    const r=await f.request(token,{query:{username:'fifflaren',role:'admin'},body:{username:'fifflaren'}});
    assert.equal(r.status,status);assert.equal(r.data.success,false);assert.equal(r.headers['Cache-Control'],'no-store');
    assert(!('stats' in r.data));assert(!('employees' in r.data));
  }
  const owner=f.users[0];owner.isBanned=true;assert.equal((await f.request()).status,401);
  owner.isBanned=false;owner.offboardedAt=new Date();assert.equal((await f.request()).status,401);
  owner.offboardedAt=null;assert.deepEqual(f.reads,[],'denied requests cannot read business data');
  owner.username='Fifflaren';const allowed=await f.request();assert.equal(allowed.status,200);
  assert.equal(allowed.data.isOwner,true);assert.equal(allowed.data.stats.pendingCalls,1);
});

test('pending calls respect submission team, legacy membership and terminal statuses',async()=>{
  const f=fixture();f.users[0].team=' Alpha ';f.users[1].team='ALPHA';
  const own=f.call({reviewStatus:'pending'}),network=f.call({requestType:'network'},{user:'other'});
  const legacy=f.call({}, {data:{serviceName:'Legacy'}}),inProgress=f.call({reviewStatus:'in_work'});
  for(const reviewStatus of ['done','rejected','returned'])f.call({reviewStatus});
  f.call({teamAtSubmission:'beta'});f.call({}, {user:'other',data:{serviceName:'Other legacy'}});
  f.call({teamAtSubmission:null});f.call({}, {type:'shift'});
  const r=await f.request();assert.equal(r.status,200);
  assert.equal(r.data.stats.pendingCalls,3);assert.equal(r.data.stats.pendingNetwork,1);
  assert.deepEqual(new Set(r.data.requests.map(row=>row.id)),new Set([own,network,legacy,inProgress].map(row=>row._id)));
  assert.equal(r.data.requests.find(row=>row.id===network._id).kind,'network');
  assert.equal(r.data.requests.find(row=>row.id===network._id).title,'Скачать пасы');
});

test('Fifflaren with an empty team retains access to the Fifflaren team and legacy calls',async()=>{
  const f=fixture();f.users[0].username='Fifflaren';f.users[0].team='';f.users[1].team='FiFfLaReN';
  f.call({teamAtSubmission:'fifflaren'});f.call({}, {data:{serviceName:'Legacy'}});
  const r=await f.request();assert.equal(r.status,200);assert.equal(r.data.stats.totalEmployees,2);
  assert.equal(r.data.stats.pendingCalls,2);
  assert.equal(r.data.employees.find(user=>user.username==='Fifflaren').team,'fifflaren');
});

test('totals cover the complete backlog while the combined preview contains only the newest eight',async()=>{
  const f=fixture(),base=Date.parse('2024-04-01T12:00:00Z');
  for(let i=0;i<17;i++)f.call({serviceName:'Call '+i},{createdAt:new Date(base+i*60000)});
  for(let i=0;i<6;i++)f.call({requestType:'network'},{createdAt:new Date(base+(i+20)*60000)});
  for(let i=0;i<13;i++)f.loan({quantity:i+1,createdAt:new Date(base+(i+10)*60000)});
  for(const status of ['assigned','active','return_pending','closed','rejected'])f.loan({status,quantity:9999,createdAt:new Date(base+90000000)});
  const r=await f.request();assert.equal(r.status,200);
  assert.deepEqual([r.data.stats.pendingCalls,r.data.stats.pendingNetwork,r.data.stats.pendingLoans,r.data.stats.requestedPoints],[17,6,13,91]);
  const newest=[...f.events,...f.loans.filter(row=>row.status==='requested')]
    .sort((a,b)=>+b.createdAt-+a.createdAt||b._id.localeCompare(a._id)).slice(0,8).map(row=>row._id);
  assert.equal(r.data.requests.length,8);assert.deepEqual(r.data.requests.map(row=>row.id),newest);
  assert(r.data.requests.some(row=>row.kind==='loan'));assert(r.data.requests.some(row=>row.kind==='network'));
});

test('employee counts deduplicate online sessions, normalize names and exclude banned, offboarded and foreign users',async()=>{
  const f=fixture();f.users.push({username:'banned',team:'alpha',isBanned:true},{username:'departed',team:'alpha',offboardedAt:new Date()});
  for(let i=0;i<14;i++)f.users.push({username:'worker'+i,team:'alpha'});
  for(const [index,nick]of ['FIFFLAREN','fifflaren',' Member ','MEMBER','helper','banned','departed','other','unknown',...Array.from({length:14},(_,i)=>'WORKER'+i)].entries())f.online.set('socket-'+index,nick);
  const r=await f.request();assert.equal(r.status,200);
  assert.equal(r.data.stats.totalEmployees,17);assert.equal(r.data.stats.onlineEmployees,17);assert.equal(r.data.employees.length,12);
  assert(r.data.employees.every(user=>user.online));assert(!r.data.employees.some(user=>['banned','departed','other','unknown'].includes(user.username)));
  assert.equal(r.data.employees.find(user=>user.username==='fifflaren').canReview,true);
  assert.equal(r.data.employees.find(user=>user.username==='helper').canReview,true);
  assert.equal(r.data.employees.find(user=>user.username==='member').canReview,false);
  f.users[2].callsReviewAccess.team='beta';assert.equal((await f.request()).data.employees.find(user=>user.username==='helper').canReview,false);
});

test('dashboard reads only summary fields and never returns credentials or private call and loan data',async()=>{
  const f=fixture(),secret='SECRET_MUST_NOT_LEAK';
  for(const user of f.users)Object.assign(user,{password:secret,email:secret,callsSessions:[{hash:secret}],authToken:secret});
  f.call({serviceName:'Exchange',callLink:secret,callNote:secret,reviewReason:secret});
  f.loan({terms:secret,history:[secret],requestHash:secret});
  const r=await f.request();assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'no-store');
  assert(!JSON.stringify(r.data).includes(secret));
  const allowed={User:new Set(['username','team','isBanned','offboardedAt','callsReviewAccess']),
    Event:new Set(['user','createdAt','data.serviceName','data.callType','data.requestType']),Loan:new Set(['borrower','quantity','createdAt'])};
  assert.deepEqual(f.selections.map(selection=>selection.kind).sort(),['Event','Loan','User'],'all three data sources must use explicit field projections');
  for(const selection of f.selections)for(const field of selection.fields.split(/\s+/))assert(allowed[selection.kind].has(field.replace(/^\+/,'')),'unexpected database field: '+field);
  for(const row of r.data.employees)assert.deepEqual(Object.keys(row).sort(),['canReview','online','team','username']);
  assert.equal(r.data.requests.find(row=>row.kind==='call').title,'Exchange');
});

test('old call links use the existing inbox calendar at the fixed +03:00 midnight boundary',async()=>{
  const f=fixture();
  for(const stamp of ['2020-12-31T20:59:59.999Z','2020-12-31T21:00:00.000Z','2021-06-30T20:59:59.999Z','2021-06-30T21:00:00.000Z'])f.call({}, {createdAt:new Date(stamp)});
  const r=await f.request();assert.equal(r.data.requests.length,4);
  const expected=['2020-12-31','2021-01-01','2021-06-30','2021-07-01'];
  for(const [index,event]of f.events.entries()){
    const link=r.data.requests.find(row=>row.id===event._id);assert.equal(link.date,expected[index]);
    const bounds=dayBounds(link.date);assert(event.createdAt>=bounds.$gte&&event.createdAt<bounds.$lt,'deep link must open the day containing the actual request');
  }
});

test('empty queues return zero counts; backend failures are 503 without partial data or database details',async()=>{
  const empty=await fixture().request();assert.deepEqual(empty.data.requests,[]);
  for(const key of ['pendingCalls','pendingNetwork','pendingLoans','requestedPoints'])assert.equal(empty.data.stats[key],0);
  for(const operation of ['authenticate','User.find','Event.aggregate','Event.find','Loan.aggregate','Loan.find']){
    const f=fixture();f.call();f.loan();f.fail(operation);const r=await f.request();
    assert.equal(r.status,503,operation);assert.equal(r.data.success,false);assert.equal(r.headers['Cache-Control'],'no-store');
    assert(!('stats' in r.data));assert(!('requests' in r.data));assert(!JSON.stringify(r.data).includes('Private'));assert(!JSON.stringify(r.data).includes('Database'));
  }
});
