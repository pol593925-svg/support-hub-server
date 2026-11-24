'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const install=require('./truffle-loans');

function get(row,path){return path.split('.').reduce((r,k)=>r?.[k],row);}
function matches(row,filter){return Object.entries(filter).every(([key,want])=>{
  const actual=get(row,key);
  if(want&&typeof want==='object'&&!(want instanceof Date))return Object.entries(want).every(([op,value])=>op==='$ne'?actual!==value:op==='$lt'?actual<value:op==='$in'?value.includes(actual):false);
  return want===null?actual==null:actual===want;
});}
class Query{
  constructor(get){this.get=get;this.offset=0;this.count=Infinity;}
  select(){return this;}
  sort(spec){this.order=spec;return this;}
  skip(n){this.offset=n;return this;}
  limit(n){this.count=n;return this;}
  then(resolve,reject){return Promise.resolve().then(()=>{
    let result=this.get();if(!Array.isArray(result))return result;
    if(this.order)result=result.slice().sort((a,b)=>{for(const [key,dir]of Object.entries(this.order)){if(get(a,key)<get(b,key))return -dir;if(get(a,key)>get(b,key))return dir;}return 0;});
    return result.slice(this.offset,this.offset+this.count);
  }).then(resolve,reject);}
}
function fixture(){
  const users=['fifflaren','borrower','lender','observer'].map(username=>({username,role:'user'}));
  const rows=[],routes=new Map();let connect;
  class Loan{
    constructor(data){Object.assign(this,{lender:'',status:'requested',version:0},data);}
    async save(){if(rows.some(r=>r._id===this._id))throw Object.assign(new Error('Duplicate key'),{code:11000});rows.push(this);return this;}
    static find(filter){return new Query(()=>rows.filter(row=>matches(row,filter)));}
    static findById(id){return new Query(()=>rows.find(row=>row._id===id)||null);}
    static countDocuments(filter){return Promise.resolve(rows.filter(row=>matches(row,filter)).length);}
    static findOneAndUpdate(filter,update){return new Query(()=>{
      const row=rows.find(r=>matches(r,filter));if(!row)return null;
      Object.assign(row,update.$set);for(const [key,v]of Object.entries(update.$inc||{}))row[key]=(row[key]||0)+v;
      for(const [key,v]of Object.entries(update.$push||{}))row[key]=[...(row[key]||[]),...(v.$each||[v])].slice(v.$slice||0);
      return row;
    });}
  }
  class Schema{constructor(fields){this.fields=fields;}index(){}}
  const User={find:filter=>new Query(()=>users.filter(user=>matches(user,filter))),findOne:filter=>new Query(()=>users.find(user=>matches(user,filter))||null)};
  const app={};for(const method of ['get','post','patch'])app[method]=(path,fn)=>routes.set(method+' '+path,fn);
  const authenticate=async token=>{const user=users.find(u=>u.username===token);return user?.expired?null:user;};
  install({app,io:{on:(_name,fn)=>connect=fn},mongoose:{Schema,model:()=>Loan},User,authenticate});
  async function request(method,path,who='borrower',body={},params={},query={}){
    let status=200,data,cache;await routes.get(method+' '+path)({headers:{authorization:'Bearer '+who},body,params,query},{set(_key,v){cache=v;return this;},status(n){status=n;return this;},json(v){data=v;return this;}});return {status,data,cache};
  }
  async function socket(who){const handlers={},sent=[],socket={id:who,connected:true,on:(n,fn)=>handlers[n]=fn,emit:(...a)=>sent.push(a)};connect(socket);await handlers.loan_subscribe(who);return {handlers,sent,socket};}
  const body={nickname:'Borrower',quantity:25,startDate:'2026-01-01',dueDate:'2026-12-01',terms:'Private agreement',commitment:true,requestId:'abcdef12-3456-7890-abcd-ef1234567890'};
  const submit=(fields={})=>request('post','/api/loans','borrower',{...body,...fields});
  const change=(id,who,action,version,fields={})=>request('patch','/api/loans/:id',who,{action,version,...fields},{id});
  return {users,rows,Loan,request,socket,submit,change,body};
}

test('loan creation binds identity, validates terms and dates, and is retry safe',async()=>{
  const f=fixture();assert.equal((await f.request('post','/api/loans','unknown',f.body)).status,401);
  for(const quantity of [0,-1,1.2,1000001,'20',NaN])assert.equal((await f.submit({quantity})).status,400);
  assert.equal((await f.submit({nickname:'observer'})).status,400);
  assert.equal((await f.submit({startDate:'2026-02-30'})).status,400);
  assert.equal((await f.submit({dueDate:'2025-12-31'})).status,400);
  assert.equal((await f.submit({commitment:false})).status,400);
  assert.equal((await f.submit({terms:'x'.repeat(1501)})).status,400);
  const responses=await Promise.all([f.submit({borrower:'observer',lender:'observer',status:'closed'}),f.submit()]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);assert.equal(f.rows.length,1);
  const loan=responses[0].data.loan;assert.equal(loan.borrower,'borrower');assert.equal(loan.lender,'');assert.equal(loan.status,'requested');assert.equal(loan.terms,f.body.terms);
  assert.equal((await f.submit({quantity:30})).status,409);assert.equal(f.rows[0].quantity,25);
});

test('ledger is public to authenticated employees; private terms and audit are participant-only',async()=>{
  const f=fixture(),created=await f.submit(),id=created.data.loan.id;
  assert.equal((await f.request('get','/api/loans','unknown')).status,401);
  const publicList=await f.request('get','/api/loans','observer');assert.equal(publicList.cache,'no-store');
  assert.equal(publicList.data.loans[0].quantity,25);assert(!('terms' in publicList.data.loans[0]));assert(!('history' in publicList.data.loans[0]));assert(!('requestHash' in publicList.data.loans[0]));
  const publicRow=await f.request('get','/api/loans/:id','observer',{}, {id});assert(!('terms' in publicRow.data.loan));
  const ownerRow=await f.request('get','/api/loans/:id','fifflaren',{}, {id});assert.equal(ownerRow.data.loan.terms,f.body.terms);
  assert.deepEqual(ownerRow.data.loan.actions,['assign','reject']);assert.deepEqual(publicRow.data.loan.actions,[]);
  assert.equal((await f.request('get','/api/loans/employees','observer')).status,403);
  assert.equal((await f.request('get','/api/loans/employees','fifflaren')).data.users.length,4);
});

test('complete loan lifecycle requires correct parties, preserves terms and changes no balances',async()=>{
  const f=fixture(),created=await f.submit(),id=created.data.loan.id;
  assert.equal((await f.change(id,'observer','assign',0,{lender:'lender'})).status,403);
  assert.equal((await f.change(id,'fifflaren','assign',0,{lender:'borrower'})).status,400);
  assert.equal((await f.change(id,'fifflaren','assign',0,{lender:'missing'})).status,400);
  const assigned=await f.change(id,'fifflaren','assign',0,{lender:'lender',quantity:999999,terms:'Replace',dueDate:'2099-01-01'});
  assert.equal(assigned.status,200);assert.equal(assigned.data.loan.quantity,25);assert.equal(assigned.data.loan.terms,'Private agreement');assert.equal(assigned.data.loan.dueDate,'2026-12-01');
  assert.equal((await f.change(id,'borrower','confirm_issue',1)).status,403);
  assert.equal((await f.change(id,'fifflaren','confirm_issue',1)).status,403);
  const issued=await f.change(id,'lender','confirm_issue',1);assert.equal(issued.data.loan.status,'active');assert(issued.data.loan.issuedAt);
  assert.equal((await f.change(id,'lender','request_return',2)).status,403);
  const returned=await f.change(id,'borrower','request_return',2);assert.equal(returned.data.loan.status,'return_pending');
  assert.equal((await f.change(id,'borrower','confirm_return',3)).status,403);
  const closed=await f.change(id,'lender','confirm_return',3);assert.equal(closed.data.loan.status,'closed');assert(closed.data.loan.closedAt);
  assert.deepEqual(closed.data.loan.history.map(h=>h.action),['request','assign','confirm_issue','request_return','confirm_return']);
  assert.equal(f.users.some(user=>Object.keys(user).some(key=>/balance/i.test(key))),false);
  assert.equal((await f.change(id,'lender','confirm_return',3)).status,409);
  const replay=await f.submit();assert.equal(replay.data.replayed,true);assert.equal(replay.data.loan.status,'closed');assert.equal(f.rows.length,1);
});

test('declining issue returns request to owner; denied return remains an active obligation',async()=>{
  const f=fixture(),id=(await f.submit()).data.loan.id;
  await f.change(id,'fifflaren','assign',0,{lender:'lender'});
  assert.equal((await f.change(id,'lender','decline_issue',1)).status,400);
  const declined=await f.change(id,'lender','decline_issue',1,{reason:'Не могу выдать сейчас'});
  assert.equal(declined.data.loan.status,'requested');assert.equal(declined.data.loan.lender,'');
  await f.change(id,'fifflaren','assign',2,{lender:'lender'});await f.change(id,'lender','confirm_issue',3);await f.change(id,'borrower','request_return',4);
  assert.equal((await f.change(id,'lender','deny_return',5)).status,400);
  const denied=await f.change(id,'lender','deny_return',5,{reason:'Возврат пока не получен'});assert.equal(denied.data.loan.status,'active');assert.equal(denied.data.loan.returnRequestedAt,null);
  assert.equal(denied.data.loan.history.at(-1).reason,'Возврат пока не получен');
  assert.equal((await f.change(id,'fifflaren','reject',6,{reason:'Поздно'})).status,403);
});

test('owner rejection requires reason; concurrent updates cannot overwrite each other',async()=>{
  const f=fixture(),id=(await f.submit()).data.loan.id;
  assert.equal((await f.change(id,'fifflaren','reject',0)).status,400);
  const results=await Promise.all([f.change(id,'fifflaren','assign',0,{lender:'lender'}),f.change(id,'fifflaren','reject',0,{reason:'Отказ'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.rows[0].version,1);assert.equal(f.rows[0].history.length,2);
  const id2=(await f.submit({requestId:'another-request-12345'})).data.loan.id;
  const rejected=await f.change(id2,'fifflaren','reject',0,{reason:'Не согласовано'});assert.equal(rejected.data.loan.status,'rejected');assert.deepEqual(rejected.data.loan.actions,[]);
});

test('Kyiv calendar handles winter/summer boundaries; only issued unpaid obligations become overdue',async()=>{
  assert.equal(install.kyivToday(new Date('2026-01-01T21:59:59Z')),'2026-01-01');
  assert.equal(install.kyivToday(new Date('2026-01-01T22:00:00Z')),'2026-01-02');
  assert.equal(install.kyivToday(new Date('2026-07-01T21:00:00Z')),'2026-07-02');
  const f=fixture(),id=(await f.submit({startDate:'2020-01-01',dueDate:'2020-01-02'})).data.loan.id;
  assert.equal((await f.request('get','/api/loans','observer',{}, {},{status:'overdue'})).data.total,0);
  await f.change(id,'fifflaren','assign',0,{lender:'lender'});await f.change(id,'lender','confirm_issue',1);
  const overdue=await f.request('get','/api/loans','observer',{}, {},{status:'overdue'});assert.equal(overdue.data.total,1);assert.equal(overdue.data.loans[0].overdue,true);
  await f.change(id,'borrower','request_return',2);await f.change(id,'lender','confirm_return',3);
  assert.equal((await f.request('get','/api/loans','observer',{}, {},{status:'overdue'})).data.total,0);
});

test('ledger paginates and rejects invalid filters without exposing private records',async()=>{
  const f=fixture();for(let i=0;i<43;i++)await f.submit({requestId:'request-1234567890-'+i});
  const first=await f.request('get','/api/loans','observer'),last=await f.request('get','/api/loans','observer',{}, {},{page:'1',status:'requested'});
  assert.equal(first.data.loans.length,40);assert.equal(first.data.hasMore,true);assert.equal(last.data.loans.length,3);assert.equal(last.data.hasMore,false);
  assert.equal(new Set([...first.data.loans,...last.data.loans].map(row=>row.id)).size,43);
  assert.equal((await f.request('get','/api/loans','observer',{}, {},{status:'secret'})).status,400);
  assert.equal((await f.request('get','/api/loans','observer',{}, {},{page:'-1'})).status,400);
  assert.equal((await f.request('get','/api/loans','observer',{}, {},{page:'1.5'})).status,400);
});

test('notifications contain no terms; notify only intended participants and reject expired subscriptions',async()=>{
  const f=fixture(),sockets={};for(const who of ['fifflaren','borrower','lender','observer','invalid'])sockets[who]=await f.socket(who);
  const id=(await f.submit()).data.loan.id;
  assert.deepEqual(sockets.fifflaren.sent[0],['loan_changed',{id,notify:true}]);assert.deepEqual(sockets.observer.sent[0],['loan_changed',{id,notify:false}]);assert.equal(sockets.invalid.sent.length,0);
  await f.change(id,'fifflaren','assign',0,{lender:'lender'});assert.equal(sockets.lender.sent.at(-1)[1].notify,true);assert.equal(sockets.fifflaren.sent.at(-1)[1].notify,false);
  await f.change(id,'lender','confirm_issue',1);assert.equal(sockets.borrower.sent.at(-1)[1].notify,true);assert.equal(sockets.fifflaren.sent.at(-1)[1].notify,true);
  f.users.find(u=>u.username==='observer').expired=true;const count=sockets.observer.sent.length;
  await f.change(id,'borrower','request_return',2);assert.equal(sockets.lender.sent.at(-1)[1].notify,true);assert.equal(sockets.observer.sent.length,count);
  assert.equal((await f.request('get','/api/loans','observer')).status,401);
  f.users.find(u=>u.username==='lender').offboardedAt=new Date();assert.equal((await f.change(id,'lender','confirm_return',3)).status,401);
  f.users[0].isBanned=true;assert.equal((await f.request('get','/api/loans/employees','fifflaren')).status,401);
});
