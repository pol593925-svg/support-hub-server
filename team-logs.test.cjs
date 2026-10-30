const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto'),install=require('./calls-service');
test('log feed authenticates sender and isolates teams for history and realtime',async()=>{
 const tokens=['a'.repeat(43),'b'.repeat(43),'c'.repeat(43)],users=tokens.map((t,i)=>({username:'u'+i,team:i===2?'beta':'alpha',callsSessions:[{hash:crypto.createHash('sha256').update(t).digest('hex'),expiresAt:new Date(Date.now()+100000)}]})),routes={},events=[],sent=[[],[],[]];let connect,filter;
 const User={findOne:f=>({select:async()=>users.find(u=>u.callsSessions[0].hash===f['callsSessions.hash'])})};class Event{constructor(d){Object.assign(this,d);this._id='log1';this.createdAt=new Date();}async save(){events.push(this);}static find(f){filter=f;return{sort(){return this;},limit:async()=>events.filter(e=>e.data.teamAtSubmission===f['data.teamAtSubmission'])};}}
 install({app:{get:(p,h)=>routes['GET'+p]=h,post:(p,h)=>routes['POST'+p]=h,patch(){}},io:{on:(_,f)=>connect=f},User,Event});
 for(let i=0;i<3;i++){const handlers={};connect({id:String(i),on:(n,h)=>handlers[n]=h,emit:(n,d)=>sent[i].push({n,d})});await handlers.calls_subscribe(tokens[i]);}
 async function call(method,token,body={}){let status=200,result;await routes[method]({headers:{authorization:'Bearer '+token},body},{status(n){status=n;return this;},json(d){result=d;}});return{status,result};}
 assert.equal((await call('POST/api/logs','bad',{link:'https://example.com',comment:'x'})).status,403);
 assert.equal((await call('POST/api/logs',tokens[0],{user:'fake',team:'beta',link:'https://example.com',comment:'Info'})).status,200);assert.equal(events[0].user,'u0');assert.equal(events[0].data.teamAtSubmission,'alpha');assert.equal(sent[0].length,1);assert.equal(sent[1].length,1);assert.equal(sent[2].length,0);
 assert.equal((await call('GET/api/logs/team',tokens[2])).result.logs.length,0);assert.equal(filter['data.teamAtSubmission'],'beta');assert.equal((await call('GET/api/logs/team',tokens[1])).result.logs.length,1);
 users[1].team='beta';await call('POST/api/logs',tokens[0],{link:'https://example.com',comment:'second'});assert.equal(sent[1].length,1);
});
