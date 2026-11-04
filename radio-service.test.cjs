const {test}=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),{install,live,change,empty}=require('./radio-service');
test('broadcast follows a single clock across tracks, pauses and reorders',()=>{
  let s=empty();const cmd=(op,now,extra={})=>s=change(s,{op,...extra},now);
  for(const [id,duration]of [['aa',4],['bb',6],['cc',3]])cmd('add',0,{track:{id,title:id,duration}});
  cmd('play',1000);assert.deepEqual(live(s,6000),{current:'bb',position:1,playing:true});
  cmd('pause',6000);assert.equal(live(s,12000).position,1);cmd('up',12000,{id:'bb'});cmd('play',13000);
  cmd('seek',14000,{id:'bb',position:5});assert.equal(live(s,16000).current,'aa');
  assert.throws(()=>cmd('seek',16000,{id:'bb',position:0}));cmd('remove',16000,{id:'aa'});assert.equal(s.current,'cc');
  assert.equal(live(s,116000).current,'cc');cmd('previous',116000);assert.equal(s.current,'bb');
});
test('radio routes separate employee playback from owner controls and binary uploads',async()=>{
 let record=null,id=0;const tracks=new Map();
 const radio={findOne:async()=>record,updateOne:async(f,update)=>{if(record&&record.rev!==f.rev)return {matchedCount:0};record={_id:'live',...update.$set};return {matchedCount:1};}};
 const media={insertOne:async row=>tracks.set(row._id,row),deleteOne:async({_id})=>tracks.delete(_id),findOne:async({_id})=>tracks.get(_id)};
 const app=express();app.use(express.json());install({app,mongoose:{connection:{collection:n=>n==='radio_audio'?media:radio},Types:{ObjectId:class{toString(){return (++id).toString(16).padStart(24,'0');}}}},authenticate:async t=>['fifflaren','worker'].includes(t)?{username:t}:null});
 const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));
 try{
 const url='http://127.0.0.1:'+server.address().port+'/api/radio/',wav=Buffer.from('RIFF0000WAVEtest');
 const req=(path,user,method='GET',body,type)=>fetch(url+path,{method,headers:{Authorization:'Bearer '+user,...(type?{'Content-Type':type}:{})},body});
 assert.equal((await req('state','')).status,403);assert.equal((await req('control','worker','POST','{}','application/json')).status,403);
 assert.equal((await req('tracks?title=demo&duration=90','worker','POST',wav,'application/octet-stream')).status,403);
 const st=await (await req('tracks?title=demo&duration=90','fifflaren','POST',wav,'application/octet-stream')).json();
 assert.equal(st.queue.length,1);assert.equal(st.playing,false);
 assert.deepEqual(Buffer.from(await (await req('audio/'+st.current,'worker')).arrayBuffer()),wav);
 const play=await (await req('control','fifflaren','POST',JSON.stringify({op:'play',rev:st.rev}),'application/json')).json();assert(play.playing);
 assert.equal((await req('control','fifflaren','POST',JSON.stringify({op:'pause',rev:st.rev}),'application/json')).status,409);
 assert.equal((await (await req('state','worker')).json()).current,st.current);
 }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
});
