'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),install=require('./hunts-service');
test('hunts are private, validated, limited to 20 and visible to team reviewers',async()=>{
 const users=[{username:'fifflaren',team:'alpha',hunts:[]},{username:'member',team:'alpha',hunts:[]},{username:'other',team:'beta',hunts:[]}],routes={};
 const resultQuery=doc=>({select:async()=>doc||null});
 const matches=(user,filter)=>user.username===filter.username&&(filter['hunts.19']?user.hunts.length<20:true)&&(filter['hunts._id']?user.hunts.some(h=>h._id===filter['hunts._id']):true);
 const User={
  findOne:filter=>resultQuery(users.find(user=>matches(user,filter))),
  findOneAndUpdate:(filter,update)=>{const user=users.find(user=>matches(user,filter));if(user){if(update.$push)user.hunts.push(update.$push.hunts);if(update.$pull)user.hunts=user.hunts.filter(h=>h._id!==update.$pull.hunts._id);}return resultQuery(user);}
 };
 const actor=async token=>users.find(user=>user.username===token)||null;
 const reviewActor=async token=>token==='fifflaren'?{user:users[0],team:'alpha'}:null;
 install({app:{get:(path,handler)=>routes['GET '+path]=handler,post:(path,handler)=>routes['POST '+path]=handler,delete:(path,handler)=>routes['DELETE '+path]=handler},User,actor,reviewActor});
 async function call(method,route,token,body={},params={}){let status=200,result,headers={};const req={headers:{authorization:'Bearer '+token},body,params};const res={set:(key,value)=>headers[key]=value,status(code){status=code;return this;},json(value){result=value;}};await routes[method+' '+route](req,res);return{status,result,headers};}
 let response=await call('POST','/api/hunts/mine','member',{url:'javascript:alert(1)',note:'bad'});assert.equal(response.status,400);
 response=await call('POST','/api/hunts/mine','member',{url:'https://example.com/hunt',note:'Рабочая ссылка · проверить доступ'});assert.equal(response.status,201);assert.equal(response.result.hunts.length,1);assert.equal(response.result.limit,20);assert.equal(response.headers['Cache-Control'],'no-store');
 const id=response.result.hunts[0].id;assert.match(id,/^[a-f0-9]{24}$/);
 response=await call('GET','/api/hunts/mine','member');assert.equal(response.result.hunts[0].note,'Рабочая ссылка · проверить доступ');
 assert.equal((await call('GET','/api/fifflaren/hunts/:username','member',{}, {username:'member'})).status,403);
 response=await call('GET','/api/fifflaren/hunts/:username','fifflaren',{}, {username:'member'});assert.equal(response.status,200);assert.equal(response.result.hunts[0].url,'https://example.com/hunt');
 assert.equal((await call('GET','/api/fifflaren/hunts/:username','fifflaren',{}, {username:'other'})).status,404);
 users[1].hunts=Array.from({length:20},(_,i)=>({_id:String(i).padStart(24,'0'),url:'https://example.com/'+i,note:'note',createdAt:new Date()}));
 response=await call('POST','/api/hunts/mine','member',{url:'https://example.com/overflow',note:'overflow'});assert.equal(response.status,409);assert.equal(users[1].hunts.length,20);
 response=await call('DELETE','/api/hunts/mine/:id','member',{}, {id:'0'.repeat(24)});assert.equal(response.status,200);assert.equal(response.result.hunts.length,19);
 assert.equal((await call('DELETE','/api/hunts/mine/:id','member',{}, {id:'bad'})).status,400);
 assert.equal((await call('GET','/api/hunts/mine','missing')).status,401);
});
