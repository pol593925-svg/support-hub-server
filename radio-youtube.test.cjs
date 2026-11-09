'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {videoId}=require('./radio-youtube'),{install,empty,live}=require('./radio-service');
test('YouTube link parser accepts music/watch/short links and rejects foreign hosts, credentials and playlists',()=>{
 for(const u of ['https://www.youtube.com/watch?v=M7lc1UVf-VE&t=20','https://music.youtube.com/watch?v=M7lc1UVf-VE&list=abc','https://youtu.be/M7lc1UVf-VE?si=123','https://m.youtube.com/shorts/M7lc1UVf-VE'])assert.equal(videoId(u),'M7lc1UVf-VE');
 for(const u of ['javascript:alert(1)','https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','https://user:pass@youtube.com/watch?v=M7lc1UVf-VE','https://youtube.com:8888/watch?v=M7lc1UVf-VE','http://127.0.0.1','https://youtube.com/playlist?list=123','https://youtu.be/short'])assert.throws(()=>videoId(u));
});
test('mixed queue: append, duplicates, owner takeover, QR scope, legacy clients, persistence and metadata errors',async()=>{
 let record={_id:'live',...empty(),queue:[{id:'a'.repeat(24),title:'Local file',duration:120}],current:'a'.repeat(24),position:12,playing:false,rev:1,anchor:Date.now()},requests=0;
 const radio={findOne:async()=>record,updateOne:async(f,update)=>{if(record&&record.rev!==f.rev)return {matchedCount:0};record={_id:'live',...update.$set};return {matchedCount:1};}};
 const catalog={bulkWrite:async ops=>{assert(ops.every(o=>!o.updateOne.filter._id.startsWith('yt_')));},updateOne:async()=>{},findOne:async()=>null};
 const app=express();app.use(express.json());
 install({app,mongoose:{connection:{collection:n=>n==='radio_tracks'?catalog:radio}},authenticate:async t=>['fifflaren','mira'].includes(t)?{username:t}:null,youtubeOptions:{fetchMetadata:async u=>{
  requests++;assert(u.startsWith('https://www.youtube.com/oembed?'));const video=new URL(new URL(u).searchParams.get('url')).searchParams.get('v');
  return video==='XXXXXXXXXXX'?{ok:false,status:404}:{ok:true,json:async()=>({title:'Тест <script>alert(1)</script>',author_name:'Artist',html:'<unsafe>'})};
 }}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=async(route,token='mira',body,modern=true)=>{const r=await fetch(base+'/api/radio/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(modern?{'X-SupportHub-Radio':'youtube-v1'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const link={url:'https://music.youtube.com/watch?v=M7lc1UVf-VE',duration:60};
 try{
  assert.equal((await request('youtube/preview','',link)).status,403);
  assert.equal((await request('youtube/preview','mira',{url:'https://localhost/'})).status,400);assert.equal(requests,0);
  const preview=await request('youtube/preview','mira',link);assert.equal(preview.status,200);assert(!('html'in preview.data.track));
  assert.equal((await request('youtube/queue','mira',{...link,duration:NaN})).status,400);
  assert.equal((await request('youtube/queue','mira',{...link,playNow:true})).status,403);
  const added=await request('youtube/queue','mira',link);assert.equal(added.status,200);assert.equal(added.data.queue.length,2);assert.equal(added.data.current,'a'.repeat(24));assert.equal(added.data.position,12);assert(!added.data.playing);
  assert.equal((await request('youtube/queue','mira',link)).data.queue.length,2);assert.equal(requests,1);
  assert.equal(record.queue[1].addedBy,'mira');assert.equal(record.queue[1].source,'youtube');
  const pair=(await request('mobile/pairs','fifflaren',{mode:'upload'})).data,parts=new URLSearchParams(new URL(pair.url).hash.slice(1));
  const grant=(await request('mobile/connect','',{id:pair.id,code:parts.get('code')})).data;
  assert.equal((await request('youtube/preview',grant.token,link)).status,200);
  assert.equal((await request('youtube/queue',grant.token,{...link,playNow:true})).status,403);
  assert.equal((await request('youtube/queue',grant.token,link)).status,200);
  const chosen=await request('youtube/queue','fifflaren',{...link,playNow:true});assert(chosen.data.playing);assert.equal(chosen.data.current,'yt_M7lc1UVf-VE');
  const legacy=(await request('state','mira',undefined,false)).data;assert.equal(legacy.current,null);assert.equal(legacy.playing,false);assert(legacy.queue.every(t=>t.source!=='youtube'));
  assert.equal((await request('state','mira')).data.current,'yt_M7lc1UVf-VE');
  assert.equal(live(record,record.anchor+61000).current,'a'.repeat(24));
  assert.equal((await request('youtube/preview','mira',{url:'https://youtu.be/XXXXXXXXXXX'})).status,422);
  assert.equal((await request('control','fifflaren',{op:'remove',id:'yt_M7lc1UVf-VE',rev:record.rev})).status,200);
  assert.equal(record.queue.length,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

