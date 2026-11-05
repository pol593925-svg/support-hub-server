// Separate public/VIP films with a real local media source, browser UI and authorization checks.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright'),express=require('express'),mongoose=require('mongoose'),{Server}=require('socket.io'),{io:connect}=require('socket.io-client'),{MongoMemoryServer}=require('mongodb-memory-server');
const root=path.resolve(__dirname,'../../fifflaren-app'),password='local-fixture-invitation';
process.env.CINEMA_VIP_PASSWORD=password;
const tab=fs.readFileSync(path.join(root,'index.html'),'utf8').split('<div id="tab-radio"')[1].split('<div id="tab-admin"')[0];
(async()=>{
 let db,io,browser,stopPC;const sockets=[],dir=fs.mkdtempSync(path.join(require('os').tmpdir(),'cinema-vip-qa-'));
 const handlers=new Map(),sender={isDestroyed:()=>false,send(){}},evt={sender};
 try{
  const clip=process.env.CINEMA_QA_FILM;assert(clip&&fs.existsSync(clip),'CINEMA_QA_FILM required');
  for(const f of ['Public.mp4','Private.mp4'])fs.copyFileSync(clip,path.join(dir,f));
  db=await MongoMemoryServer.create({instance:{launchTimeout:60000},binary:{version:'8.2.6'}});await mongoose.connect(db.getUri());
  const app=express(),server=http.createServer(app);app.use(express.json());io=new Server(server);
  const cfg={app,io,mongoose,authenticate:async t=>['fifflaren','mira','leo','guest','rate'].includes(t)?{username:t}:null};
  require('../cinema-service').install(cfg);require('../radio-service').install(cfg);
  app.get('/',(_req,res)=>res.send('<meta charset="utf-8"><link rel="stylesheet" href="/radio.css"><link rel="stylesheet" href="/cinema.css"><link rel="stylesheet" href="/cinema-snacks.css"><link rel="stylesheet" href="/media-volume.css"><link rel="stylesheet" href="/cinema-vip.css"><header><div class="hub-tools"></div></header><button id="radioTabButton"></button><div id="tab-radio"'+tab+'<script src="/socket.io/socket.io.js"></script><script src="/media-volume.js"></script><script src="/cinema-voice.js"></script><script src="/cinema-snacks.js"></script><script src="/cinema.js"></script><script src="/radio.js"></script><script>const nick=location.hash.slice(1);window.posters=[];HubRadio.start({username:nick,token:nick,io,server:location.origin,notify:p=>posters.push(p),cinemaPC:{connect:(t,b)=>qaConnect(t,b),stop(){},add:(file,meta)=>qaAdd(file.name,meta)}});</script>'));
  for(const f of ['radio.css','radio.js','cinema.js','cinema.css','cinema-snacks.js','cinema-snacks.css','cinema-voice.js','media-volume.js','media-volume.css','cinema-vip.css'])app.get('/'+f,(_req,res)=>res.sendFile(path.join(root,f)));
  app.use('/assets/cinema',express.static(path.join(root,'assets/cinema')));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  const api=(route,user='mira',method='GET',body,vip)=>fetch(url+'/api/cinema/'+route,{method,headers:{Authorization:'Bearer '+user,'Content-Type':'application/json',...(vip?{'X-Cinema-Vip':vip}:{})},body:body?JSON.stringify(body):undefined});
  const login=async nick=>{const res=await api('vip/enter',nick,'POST',{password});assert.equal(res.status,200);return res.json();};
  assert.equal((await api('vip/state','bad')).status,401);
  assert.equal((await api('vip/state')).status,403);
  assert.equal((await api('vip/enter','mira','POST',{password:'wrong'})).status,403);
  const permit=await login('mira');
  assert.equal((await api('vip/state','mira','GET',null,permit.ticket)).status,200);
  assert.equal((await api('vip/state','leo','GET',null,permit.ticket)).status,403,'ticket bound to account');
  const [payload,signature]=permit.ticket.split('.'),data=JSON.parse(Buffer.from(payload,'base64url'));
  const expiredBody=Buffer.from(JSON.stringify({...data,expires:Date.now()-1})).toString('base64url');
  const key=(await mongoose.connection.collection('cinema_keys').findOne({_id:'vip-access'})).secret;
  const expired=expiredBody+'.'+crypto.createHmac('sha256',key).update(expiredBody).digest('hex');
  assert.equal((await api('vip/state','mira','GET',null,expired)).status,403);
  assert.equal((await api('vip/state','mira','GET',null,expiredBody+'.'+signature)).status,403,'tampered ticket');
  for(let n=0;n<5;n++)assert.equal((await api('vip/enter','rate','POST',{password:'wrong'})).status,403);
  assert.equal((await api('vip/enter','rate','POST',{password})).status,429,'failed attempts limited');
  async function socket(user,namespace,vip,denied=false){
    const sock=connect(url+namespace,{auth:{token:user,vip},forceNew:true,reconnection:false});sockets.push(sock);
    await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('socket timeout')),6000);
      sock.once('connect',()=>{clearTimeout(timer);denied?no(Error('unauthorized socket connected')):ok();});
      sock.once('connect_error',e=>{clearTimeout(timer);denied?ok():no(e);});
    });return sock;
  }
  await socket('leo','/cinema-vip',null,true);await socket('leo','/cinema-vip-posters',null,true);
  await socket('leo','/cinema-vip',permit.ticket,true);
  stopPC=require(path.join(root,'cinema-host-main')).install({serverUrl:url,app:{getPath:()=>dir,on(){}},getWindow:()=>({isDestroyed:()=>false,webContents:sender}),ipcMain:{on(){},handle:(name,fn)=>handlers.set(name,fn)}});
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const errors=[];
  async function page(nick){
    const p=await browser.newPage({viewport:{width:1440,height:980}});p.on('pageerror',e=>errors.push(e.message));
    await p.exposeFunction('qaConnect',(token,bind)=>handlers.get('cinema-pc-connect')(evt,{token,bind}));
    await p.exposeFunction('qaAdd',(name,meta)=>{assert(['Public.mp4','Private.mp4'].includes(name));return handlers.get('cinema-pc-add')(evt,{source:path.join(dir,name),meta});});
    await p.goto(url+'/#'+nick);await p.click('#cinemaButton');await p.waitForFunction(()=>document.getElementById('cinPhase').textContent!=='Подключаемся…');return p;
  }
  const host=await page('fifflaren'),publicViewer=await page('leo'),viewer=await page('mira');
  await host.click('#cinHost summary');
  await host.locator('#cinFiles').setInputFiles([path.join(dir,'Public.mp4'),path.join(dir,'Private.mp4')]);
  await host.waitForFunction(()=>document.querySelector('#cinFilms').options.length===3,null,{timeout:30000});
  const lib=await (await api('library','fifflaren')).json(),publicId=lib.tracks.find(x=>x.title==='Public').id,privateId=lib.tracks.find(x=>x.title==='Private').id;
  await host.selectOption('#cinFilms',publicId);await host.fill('#cinName','Общий показ');await host.fill('#cinDelay','0');await host.click('#cinSchedule');
  await publicViewer.waitForFunction(()=>document.querySelector('#cinTitle').textContent==='Общий показ');
  await host.click('#cinVipEnter');await host.waitForFunction(()=>document.querySelector('#hubCinema').classList.contains('cin-vip')&&document.querySelector('#cinPhase').textContent==='Ожидаем показ');
  await host.click('#cinHost summary');await host.selectOption('#cinFilms',privateId);await host.fill('#cinName','Золотая премьера');await host.fill('#cinDelay','0');await host.click('#cinSchedule');
  await host.waitForFunction(()=>document.querySelector('#cinTitle').textContent==='Золотая премьера');
  assert.equal((await api('video/'+privateId+'/ticket','leo','POST',{})).status,403);
  assert.equal((await api('video/'+privateId,'leo')).status,403);
  assert.equal((await api('vip/control','mira','POST',{op:'clear',rev:1},permit.ticket)).status,403);
  assert.equal((await api('library/'+privateId,'fifflaren','DELETE')).status,409,'active VIP film cannot be removed');
  assert.equal((await api('library/'+publicId,'fifflaren','DELETE')).status,409,'active public film cannot be removed');
  const mediaResponse=await api('video/'+privateId+'/ticket','mira','POST',{},permit.ticket);assert.equal(mediaResponse.status,200);
  const mediaTicket=(await mediaResponse.json()).ticket;assert(Number(mediaTicket.split('.')[0])<=permit.expires,'film access does not outlive VIP admission');
  const streamed=await fetch(url+'/api/cinema/video/'+privateId+'?ticket='+encodeURIComponent(mediaTicket),{headers:{Range:'bytes=100-199'}});
  assert.equal(streamed.status,206);assert.deepEqual(Buffer.from(await streamed.arrayBuffer()),fs.readFileSync(clip).subarray(100,200));
  await viewer.click('#cinVipEnter');await viewer.locator('#cinVipGate[open]').waitFor();
  if(process.env.VIP_QA_GATE)await viewer.locator('#cinVipGate').screenshot({path:process.env.VIP_QA_GATE});
  await viewer.fill('#cinVipPassword','wrong');await viewer.click('#cinVipSubmit');await viewer.getByText('Неверный пароль.',{exact:true}).waitFor();
  assert.equal(await viewer.locator('#hubCinema').evaluate(x=>x.classList.contains('cin-vip')),false);
  await viewer.fill('#cinVipPassword',password);await viewer.click('#cinVipSubmit');await viewer.waitForFunction(()=>document.querySelector('#hubCinema').classList.contains('cin-vip')&&document.querySelector('#cinTitle').textContent==='Золотая премьера');
  for(const p of [viewer,publicViewer]){
    await p.waitForFunction(()=>document.querySelector('#cinVideo').currentTime>.1||!document.querySelector('#cinUnmute').hidden);
    if(await p.locator('#cinUnmute').isVisible())await p.click('#cinUnmute');
    await p.waitForFunction(()=>{const v=document.querySelector('#cinVideo');return v.videoWidth===1920&&!v.paused&&v.webkitAudioDecodedByteCount>0;});
  }
  assert.equal(await publicViewer.locator('#cinTitle').textContent(),'Общий показ');
  assert.equal(await publicViewer.evaluate(()=>posters.length),1,'private posters do not leak into global notifications');
  await viewer.waitForFunction(()=>document.querySelectorAll('#cinSeats .cin-seat').length===2);
  assert(!(await viewer.locator('#cinSeats').textContent()).includes('leo'));
  await viewer.fill('#cinText','Сообщение в VIP');await viewer.locator('#cinChat button').click();await host.getByText('Сообщение в VIP',{exact:true}).waitFor();
  await publicViewer.fill('#cinText','Сообщение в общем');await publicViewer.locator('#cinChat button').click();
  assert.equal(await publicViewer.getByText('Сообщение в VIP',{exact:true}).count(),0);
  assert.equal(await viewer.getByText('Сообщение в общем',{exact:true}).count(),0);
  await host.click('#cinPause');await viewer.waitForFunction(()=>document.querySelector('#cinVideo').paused&&document.querySelector('#cinPhase').textContent==='Пауза');
  assert.equal(await publicViewer.locator('#cinVideo').evaluate(v=>v.paused),false,'VIP pause does not pause the public movie');
  if(process.env.VIP_QA_SCREEN)await viewer.locator('#hubCinema').screenshot({path:process.env.VIP_QA_SCREEN});
  await viewer.setViewportSize({width:1280,height:720});
  await viewer.locator('#cinVideo').waitFor();
  await viewer.waitForTimeout(100);
  assert(await viewer.locator('#cinOrderDrink').evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<el.closest('main').getBoundingClientRect().bottom;}),'cinema controls visible at 720p');
  assert(await viewer.locator('#cinVolumeControls').evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<el.closest('main').getBoundingClientRect().bottom;}),'volume visible at 720p');
  if(process.env.VIP_QA_SCREEN)await viewer.locator('#hubCinema').screenshot({path:process.env.VIP_QA_SCREEN.replace('.png','-720.png')});
  await viewer.setViewportSize({width:1440,height:980});

  await viewer.click('#cinChatToggle');assert(await viewer.locator('#hubCinema aside').isHidden());await viewer.click('#cinChatToggle');assert(await viewer.locator('#hubCinema aside').isVisible());
  // Audio packets and microphone rosters are isolated by namespace.
  const guestPermit=await login('guest'),a=await socket('mira','/cinema-vip',permit.ticket),b=await socket('guest','/cinema-vip',guestPermit.ticket),pub=await socket('leo','/cinema');
  let heard=0,leaked=0;b.on('voice_audio',()=>heard++);pub.on('voice_audio',()=>leaked++);
  for(const sock of [a,b,pub])assert((await sock.timeout(4000).emitWithAck('voice_join')).ok);
  const packet=Buffer.alloc(1280,25);a.emit('voice_pcm',packet);await new Promise(r=>setTimeout(r,300));
  assert.equal(heard,1);assert.equal(leaked,0);
  await viewer.click('#cinPublic');await viewer.waitForFunction(()=>document.querySelector('#cinTitle').textContent==='Общий показ');assert.equal(await viewer.getByText('Сообщение в VIP',{exact:true}).count(),0);
  await viewer.click('#cinVipEnter');await viewer.waitForFunction(()=>document.querySelector('#cinTitle').textContent==='Золотая премьера');await viewer.getByText('Сообщение в VIP',{exact:true}).waitFor();
  assert.equal(await viewer.locator('#cinVipGate[open]').count(),0,'admission retained during account session');
  await viewer.reload();await viewer.click('#cinemaButton');await viewer.click('#cinVipEnter');await viewer.locator('#cinVipGate[open]').waitFor();
  assert.equal(await viewer.locator('#cinVipPassword').inputValue(),'','password is not saved by app');
  assert.equal((await mongoose.connection.collection('cinema_show').findOne({_id:'vip'})).title,'Золотая премьера');
  assert.equal((await mongoose.connection.collection('cinema_show').findOne({_id:'live'})).title,'Общий показ');
  assert.equal((await mongoose.connection.collection('cinema_chat').findOne({_id:'vip'})).messages[0].text,'Сообщение в VIP');
  assert.deepEqual(errors,[]);
  console.log('PASS VIP password, rate limit, account-bound/expiring tickets, unauthorized HTTP/socket denial, original private media ranges, two simultaneous 1080p films, independent controls, private chat/voice/guests, no public poster leak, persisted separate shows, active-film deletion guard and restart lock');
 }finally{
  for(const sock of sockets)sock.disconnect();await browser?.close();stopPC?.();if(io)await new Promise(r=>io.close(r));await mongoose.disconnect();await db?.stop();fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});

