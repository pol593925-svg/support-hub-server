'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const install = require('./team-office');

function fixture() {
  const routes = new Map(), updates = [], matchId = 'aa'.repeat(12);
  const users = {owner:{username:'Fifflaren',team:'Blue'}, member:{username:'Alex',team:'Blue'}, other:{username:'Bob',team:'Red'}};
  const app = Object.fromEntries(['get','post','patch','delete'].map(verb => [verb,(p,f) => routes.set(verb+' '+p,f)]));
  const articles = [], matches = [];
  const query = docs => ({sort(){return this;},limit(){return this;},async lean(){return docs;}});
  const decisions = {
    find(filter) {updates.push(filter);return query(articles.filter(d=>d.team===filter.team));},
    async updateOne(filter, update) {const d=articles.find(a=>a.team===filter.team&&a.callId===filter.callId);if(d)Object.assign(d,update.$set);else articles.push({...filter,...update.$set});}
  };
  const games = {
    async create(m) {if(matches.some(x=>x._id===m._id))throw Object.assign(Error('duplicate'),{code:11000});matches.push(m);},
    async exists(f) {return matches.some(m=>m._id===f._id&&m.team===f.team&&m.host===f.host&&m.map===f.map&&+m.start===+f.start);},
    async updateOne(f, u) {const m=matches.find(m=>m.team===f.team&&m._id===f._id&&m.expires>f.expires.$gt);if(!m)return{matchedCount:0};if(u.$addToSet&&!m.members.includes(u.$addToSet.members))m.members.push(u.$addToSet.members);if(u.$pull)m.members=m.members.filter(v=>v!==u.$pull.members);return{matchedCount:1};},
    async deleteOne(f) {const n=matches.findIndex(m=>m._id===f._id&&m.team===f.team&&(!f.host||m.host===f.host));if(n<0)return{deletedCount:0};matches.splice(n,1);return{deletedCount:1};},
    find(f){return query(matches.filter(m=>m.team===f.team&&m.expires>f.expires.$gt));}
  };
  const mongoose = {Schema:class{index(){}},model:name=>name==='OfficeDecision'?decisions:games};
  const Event = {findOne(f){assert.equal(f['data.reviewStatus'],'done');return query(f._id===matchId?{data:{teamAtSubmission:'blue'}}:null);}};
  install({app,mongoose,authenticate:async token=>users[token],Event,User:{}});
  async function run(verb,path,token,body={},params={},q={}) {
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};
    await routes.get(verb+' /api/office/'+path)({headers:{authorization:'Bearer '+token},query:q,params,body},res);
    return res;
  }
  return {run,articles,matches,matchId,updates,users};
}
test('decisions are owner-published, team scoped, searchable and keyed by resolved call',async()=>{
  const {run,articles,matchId,updates}=fixture();
  const body={callId:matchId,title:'Доступ',situation:'Нет ответа',solution:'Проверить статус запроса'};
  assert.equal((await run('get','decisions','bad')).statusCode,401);
  assert.equal((await run('post','decisions','member',body)).statusCode,403);
  assert.equal((await run('post','decisions','owner',{...body,callId:'bb'.repeat(12)})).statusCode,404);
  assert.equal((await run('post','decisions','owner',body)).statusCode,200);
  await run('post','decisions','owner',{...body,title:'Обновлено'});
  assert.equal(articles.length,1);assert.equal(articles[0].title,'Обновлено');
  assert.equal((await run('get','decisions','other')).data.items.length,0);
  await run('get','decisions','member',{}, {},{q:'a+b'});
  assert.equal(updates.at(-1).$or[0].title.$regex,'a\\+b');
});
test('owner uses the existing Fifflaren team when unassigned; other users require membership',async()=>{
  const {run,users,updates}=fixture();users.owner.team='';users.member.team=' ';
  assert.equal((await run('get','decisions','owner')).statusCode,200);
  assert.equal(updates.at(-1).team,'fifflaren');
  const noTeam=await run('get','decisions','member');assert.equal(noTeam.statusCode,403);assert.match(noTeam.data.message,/не назначена команда/);
  const anonymous=await run('get','decisions','unknown');assert.equal(anonymous.statusCode,401);assert.match(anonymous.data.message,/Сессия/);
});
test('match retries, team roster, time window and organizer cancellation',async()=>{
  const {run,matches,matchId}=fixture(),params={id:matchId},body={id:matchId,map:'inferno',start:Date.now()+60000};
  assert.equal((await run('post','matches','owner',{...body,start:1})).statusCode,400);
  await run('post','matches','owner',body);await run('post','matches','owner',body);assert.equal(matches.length,1);
  assert.equal((await run('get','matches','other')).data.matches.length,0);
  assert.equal((await run('patch','matches/:id','other',{join:true},params)).statusCode,404);
  await run('patch','matches/:id','member',{join:true},params);await run('patch','matches/:id','member',{join:true},params);
  assert.deepEqual(matches[0].members,['fifflaren','alex']);
  await run('patch','matches/:id','member',{join:false},params);assert.deepEqual(matches[0].members,['fifflaren']);
  assert.equal((await run('delete','matches/:id','member',{},params)).statusCode,404);
  assert.equal((await run('delete','matches/:id','owner',{},params)).statusCode,200);
});
