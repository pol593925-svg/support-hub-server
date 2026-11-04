'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const install = require('./team-office');
test('a workstation is registered once; only its team can see and mark the row', {skip:!process.env.HUB_TEST_MONGO}, async () => {
  const conn=await mongoose.createConnection(process.env.HUB_TEST_MONGO, {dbName:'hub_qa_'+randomUUID().replace(/-/g,'')}).asPromise();
  const app=express(), people={alex:{username:'Alex',team:'Blue'},mira:{username:'Mira',team:'Blue'},zoe:{username:'Zoe',team:'Red'}};
  app.use(express.json());
  install({app,mongoose:{Schema:mongoose.Schema,model:(...args)=>conn.model(...args)},authenticate:async key=>people[key]});
  const server=await new Promise(resolve=>{const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));});
  async function request(user,path='',method='GET',body) {
    const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/office/devices'+path,{
      method,headers:{Authorization:'Bearer '+user,'Content-Type':'application/json'},body:body&&JSON.stringify(body)
    });
    return {status:r.status,...await r.json()};
  }
  try {
    await conn.model('OfficeDevice').init();
    const body={installation:'a'.repeat(24),name:'Место 1'};
    const [one,two]=await Promise.all([request('alex','','POST',body),request('alex','','POST',body)]);
    assert.equal(one.status,200);assert.equal(two.device._id,one.device._id);
    const second=await request('alex','','POST',{installation:'b'.repeat(24),name:'Место 2'});
    const path='/'+one.device._id;
    assert.equal((await request('anonymous')).status,401);
    assert.equal((await request('alex')).devices.length,2);
    assert.deepEqual((await request('zoe')).devices,[]);
    assert.equal((await request('zoe',path,'PATCH',{inWork:true})).status,404);
    assert.equal((await request('alex',path,'PATCH',{inWork:'on'})).status,400);
    assert.equal((await request('alex',path,'PATCH',{inWork:true})).device.markedBy,'alex');
    assert.equal((await request('mira',path,'PATCH',{inWork:true})).device.markedBy,'alex');
    const rows=(await request('mira')).devices;
    assert(rows.find(d=>d._id===one.device._id).inWork);
    assert(!rows.find(d=>d._id===second.device._id).inWork);
    assert(rows.every(d=>!('installation' in d)));
    await request('mira',path,'PATCH',{inWork:false});
    assert.equal((await request('alex')).devices.filter(d=>d.inWork).length,0);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await conn.dropDatabase();await conn.close();
  }
});
