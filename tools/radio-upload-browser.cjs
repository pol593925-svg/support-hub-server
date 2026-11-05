const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {chromium}=require('playwright'),express=require('express'),mongoose=require('mongoose'),{Server}=require('socket.io'),{MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'../../fifflaren-app'),radio=require('../radio-service'),{PART}=require('../radio-origin');
function wav(seconds=30){const n=16000*seconds,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(1500*Math.sin(i*2*Math.PI*440/16000)),44+i*2);return b;}
(async()=>{
 let db,io,browser,stopPC;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radio-upload-browser-')),handlers=new Map(),events=new Map(),sender={isDestroyed:()=>false},event={sender};
 try{
  db=await MongoMemoryServer.create({instance:{launchTimeout:60000},binary:{version:'8.2.6'}});await mongoose.connect(db.getUri());
  const app=express(),server=http.createServer(app);app.use(express.json());io=new Server(server);
  radio.install({app,io,mongoose,authenticate:async t=>['fifflaren','mira','leo'].includes(t)?{username:t}:null});
  const legacy='000000000000000000000001',bytes=wav(30);await mongoose.connection.collection('radio_audio').insertOne({_id:legacy,mime:'audio/wav',data:bytes});
  await mongoose.connection.collection('radio_station').insertOne({_id:'live',...radio.empty(),current:legacy,queue:[{id:legacy,title:'Already playing',duration:30}],playing:true,anchor:Date.now()});
  const tab=fs.readFileSync(path.join(root,'index.html'),'utf8').split('<div id="tab-radio"')[1].split('<div id="tab-admin"')[0];
  app.get('/',(req,res)=>res.send('<meta charset="utf-8"><link rel="stylesheet" href="/app-theme.css"><link rel="stylesheet" href="/radio.css"><link rel="stylesheet" href="/cinema.css"><header style="display:flex"><div class="hub-tools"></div></header><button id="radioTabButton"></button><div id="tab-radio"'+tab+'<script src="/socket.io/socket.io.js"></script><script>window.HubCinema={start(){},stop(){},open(){}};</script><script src="/radio.js"></script><script>const nick=location.hash.slice(1);window.ready=false;HubRadio.start({username:nick,token:nick,server:location.origin,io,radioPC:{connect:async token=>{const r=await qaConnect(token);ready=true;return r;},stop:()=>{}}});</script>'));
  for(const f of ['app-theme.css','radio.css','cinema.css','radio.js'])app.get('/'+f,(req,res)=>res.sendFile(path.join(root,f)));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  stopPC=require(path.join(root,'radio-host-main')).install({serverUrl:url,app:{getPath:()=>dir,on(){}},getWindow:()=>({isDestroyed:()=>false,webContents:sender}),ipcMain:{on:(n,f)=>events.set(n,f),handle:(n,f)=>handlers.set(n,f)}});
  const req=(route,user='mira',method='GET',body,headers={})=>fetch(url+'/api/radio/'+route,{method,headers:{Authorization:'Bearer '+user,...(body?{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'}:{}),...headers},body:Buffer.isBuffer(body)?body:body?JSON.stringify(body):undefined});
  const json=async(...a)=>{const r=await req(...a),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const errors=[];
  const owner=await browser.newPage({viewport:{width:1200,height:800}}),worker=await browser.newPage({viewport:{width:1000,height:700}});
  for(const p of [owner,worker]){p.on('pageerror',e=>errors.push(e.message));await p.exposeFunction('qaConnect',token=>handlers.get('radio-pc-connect')(event,token));}
  await owner.goto(url+'/#fifflaren');await owner.waitForFunction(()=>ready);
  await worker.goto(url+'/#mira');assert(await worker.locator('#radioAddSong').isVisible());assert(await worker.locator('#radioTabButton').isHidden());
  await worker.click('#radioAddSong');assert(await worker.locator('#radioUploadDialog').isVisible());
  const file=path.join(dir,'Employee song.wav');fs.writeFileSync(file,bytes);await worker.locator('#radioGuestFiles').setInputFiles(file);
  await worker.waitForFunction(()=>document.querySelector('#radioGuestStatus').textContent.startsWith('В очередь добавлено 1 из 1'),null,{timeout:45000});
  const st=await json('state','fifflaren');assert.equal(st.queue.length,2);assert.equal(st.current,legacy);assert(st.playing);assert.equal(st.queue[1].addedBy,'mira');const song=st.queue[1];
  assert.equal(await mongoose.connection.collection('radio_parts').countDocuments({}),0);
  assert.deepEqual(fs.readFileSync(path.join(dir,'radio-library',song.id+'.audio')),bytes);
  await worker.locator('#radioGuestFiles').setInputFiles([{name:'Employee song.wav',mimeType:'audio/wav',buffer:bytes},{name:'Second.wav',mimeType:'audio/wav',buffer:bytes}]);
  await worker.waitForFunction(()=>document.querySelector('#radioGuestStatus').textContent.startsWith('В очередь добавлено 2 из 2'),null,{timeout:45000});
  assert.equal((await json('state','fifflaren')).queue.length,4);
  assert.equal((await req('control','mira','POST',{rev:st.rev,op:'next'})).status,403);
  assert.equal((await req('library/'+song.id+'/queue','mira','POST')).status,403);
  assert.equal((await req('uploads/'+song.id+'/finish','leo','POST')).status,403);
  assert.equal((await req('uploads/'+'f'.repeat(24),'nobody','PUT',{title:'No',size:bytes.length,duration:30})).status,403);
  const pending='d'.repeat(24),meta={title:'Resume',size:bytes.length,duration:30};
  await json('uploads/'+pending,'mira','PUT',meta);await json('uploads/'+pending+'/parts/0','mira','PUT',bytes.subarray(0,PART));
  assert.equal((await req('uploads/'+pending,'leo','PUT',meta)).status,403);
  assert.equal((await req('uploads/'+pending+'/parts/0','leo','PUT',bytes.subarray(0,PART))).status,403);
  stopPC();assert.equal((await req('uploads/'+'e'.repeat(24),'mira','PUT',meta)).status,503);
  await handlers.get('radio-pc-connect')(event,'fifflaren');
  assert.equal((await json('uploads/'+pending,'mira','PUT',meta)).next,1);
  for(let n=1;n<Math.ceil(bytes.length/PART);n++)await json('uploads/'+pending+'/parts/'+n,'mira','PUT',bytes.subarray(n*PART,(n+1)*PART));
  await json('uploads/'+pending+'/finish','mira','POST');await json('uploads/'+pending+'/finish','mira','POST');
  assert.equal((await json('state','fifflaren')).queue.filter(t=>t.id===pending).length,1);
  const {ticket}=await json('audio/'+song.id+'/ticket','mira','POST'),stream='audio/'+song.id+'?ticket='+ticket;
  const piece=await req(stream,'nobody','GET',null,{Range:'bytes=524280-524300'});assert.equal(piece.status,206);assert.deepEqual(Buffer.from(await piece.arrayBuffer()),bytes.subarray(524280,524301));
  assert.deepEqual(Buffer.from(await (await req(stream,'nobody')).arrayBuffer()),bytes);
  const current=await json('state','fifflaren');await json('control','fifflaren','POST',{rev:current.rev,op:'select',id:song.id});
  await worker.click('#radioUploadClose');await worker.click('#radioToggle');await worker.waitForFunction(()=>document.querySelector('#radioCount').textContent==='1',null,{timeout:16000});
  if(process.env.RADIO_QA_SCREEN)await worker.screenshot({path:process.env.RADIO_QA_SCREEN});
  stopPC();await handlers.get('radio-pc-connect')(event,'fifflaren');assert.equal((await json('state','fifflaren')).queue.filter(t=>t.id===song.id).length,1);
  assert.equal(await mongoose.connection.collection('radio_parts').countDocuments({}),0);assert.deepEqual(errors,[]);
  console.log('PASS worker widget upload, multi-file queue append without interrupting current track, uploader isolation, owner-only controls, PC persistence/resume, no audio in Mongo, exact range/full bytes, audible employee stream and reconnect deduplication');
 }finally{await browser?.close();stopPC?.();if(io)await new Promise(r=>io.close(r));await mongoose.disconnect();await db?.stop();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
