// Provide a short real MP4 with an audio track in CINEMA_QA_FILM.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),express=require('express'),mongoose=require('mongoose'),{Server}=require('socket.io'),{MongoMemoryServer}=require('mongodb-memory-server');
const {install}=require('../cinema-service'),radio=require('../radio-service'),root=path.resolve(__dirname,'../../fifflaren-app');
const tab=fs.readFileSync(path.join(root,'index.html'),'utf8').split('<div id="tab-radio"')[1].split('<div id="tab-admin"')[0];
async function main(){
  let db,io,browser,stopPC;
  const dir=fs.mkdtempSync(path.join(require('os').tmpdir(),'cinema-pc-browser-')),localFile=path.join(dir,'Film.mp4');
  const handlers=new Map(),sender={isDestroyed:()=>false,send(){}},evt={sender};
  try{
    const filmFile=process.env.CINEMA_QA_FILM;assert(filmFile&&fs.existsSync(filmFile),'set CINEMA_QA_FILM to an MP4');
    db=await MongoMemoryServer.create({instance:{launchTimeout:60000},binary:{version:'8.2.6'}});await mongoose.connect(db.getUri());
    const app=express(),server=http.createServer(app);app.use(express.json());io=new Server(server);
    const cfg={app,io,mongoose,authenticate:async t=>['fifflaren','mira','leo'].includes(t)?{username:t}:null};install(cfg);radio.install(cfg);
    app.get('/',(req,res)=>res.send('<meta charset="utf-8"><link rel="stylesheet" href="/radio.css"><link rel="stylesheet" href="/media-volume.css"><link rel="stylesheet" href="/cinema.css"><link rel="stylesheet" href="/cinema-snacks.css"><header style="display:flex"><div class="hub-tools"></div></header><button id="radioTabButton"></button><div id="tab-radio"'+tab+'<script src="/socket.io/socket.io.js"></script><script src="/cinema-voice.js"></script><script src="/cinema-snacks.js"></script><script src="/cinema.js"></script><script src="/media-volume.js"></script><script src="/radio.js"></script><script>const nick=location.hash.slice(1);window.posters=[];HubRadio.start({username:nick,token:nick,io,server:location.origin,cinemaPC:{connect:(token,bind)=>qaConnect(token,bind),stop:()=>{},add:(file,meta)=>qaAdd(meta)},notify:p=>posters.push(p)});</script>'));
    for(const f of ['media-volume.js','media-volume.css','radio.js','cinema-voice.js','cinema.js','radio.css','cinema.css','cinema-snacks.js','cinema-snacks.css'])app.get('/'+f,(req,res)=>res.sendFile(path.join(root,f)));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
    stopPC=require(path.join(root,'cinema-host-main')).install({serverUrl:url,app:{getPath:()=>dir,on(){}},getWindow:()=>({isDestroyed:()=>false,webContents:sender}),ipcMain:{on(){},handle:(n,h)=>handlers.set(n,h)}});
    browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...(process.env.CINEMA_QA_MIC?['--use-file-for-fake-audio-capture='+process.env.CINEMA_QA_MIC]:[])]});const errors=[];
    async function login(nick){const p=await browser.newPage({viewport:{width:1150,height:790}});p.on('pageerror',e=>errors.push(e.message));
      await p.exposeFunction('qaConnect',(token,bind)=>handlers.get('cinema-pc-connect')(evt,{token,bind}));
      await p.exposeFunction('qaAdd',meta=>handlers.get('cinema-pc-add')(evt,{source:localFile,meta}));
      await p.addInitScript(()=>{
        window.testMic=[];window.heardVoice=0;
        const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const stream=await get(c);testMic.push(...stream.getAudioTracks());return stream;};
        const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer?.length===640&&this.buffer.getChannelData(0).some(v=>Math.abs(v)>.003))heardVoice++;return start.apply(this,args);};
      });
      await p.goto(url+'/#'+nick);return p;}
    async function join(nick){const p=await login(nick);await p.click('#cinemaButton');await p.waitForFunction(()=>document.getElementById('cinPhase').textContent!=='Подключаемся…');return p;}
    const host=await join('fifflaren'),viewer=await join('mira'),outside=await login('leo');assert(await viewer.locator('#cinHost').isHidden());
    assert.equal((await fetch(url+'/api/cinema/control',{method:'POST',headers:{Authorization:'Bearer mira','Content-Type':'application/json'},body:'{"op":"clear","rev":0}'})).status,403);
    assert.equal((await fetch(url+'/api/cinema/uploads/'+'a'.repeat(24),{method:'PUT',headers:{Authorization:'Bearer mira'}})).status,403);
    assert.equal(await viewer.locator('#cinVolume').textContent(),'70%');
    await viewer.click('#cinVolumeUp');await viewer.click('#cinVolumeUp');
    assert.equal(await viewer.locator('#cinVideo').evaluate(v=>v.volume),.8);
    assert.equal(await host.locator('#cinVolume').textContent(),'70%');
    await viewer.click('#cinVolumeMute');assert.equal(await viewer.locator('#cinVideo').evaluate(v=>v.volume),0);
    await viewer.click('#cinExit');await viewer.waitForFunction(()=>!document.fullscreenElement);
    await viewer.click('#cinemaButton');assert.equal(await viewer.locator('#cinVolume').textContent(),'0%');
    await viewer.click('#cinVolumeMute');assert.equal(await viewer.locator('#cinVolume').textContent(),'80%');
    await viewer.click('#cinVolumeDown');assert.equal(await viewer.locator('#cinVolume').textContent(),'75%');
    await viewer.click('#cinExit');await viewer.waitForFunction(()=>!document.fullscreenElement);
    await viewer.reload();await viewer.click('#cinemaButton');
    assert.equal(await viewer.locator('#cinVolume').textContent(),'75%','cinema volume survives restart');
    assert.equal(await viewer.locator('#radioVolume').textContent(),'40%','radio and cinema volumes are independent');
    for(let n=0;n<5;n++)await viewer.click('#cinVolumeUp');
    assert.equal(await viewer.locator('#cinVideo').evaluate(v=>v.volume),1);assert(await viewer.locator('#cinVolumeUp').isDisabled());
    await viewer.click('#cinVolumeDown');
    await host.click('#cinHost summary');await host.fill('#cinName','Ночной сеанс');await host.fill('#cinDelay','1');await host.click('#cinSchedule');
    await viewer.waitForFunction(()=>document.getElementById('cinPhase').textContent==='До начала показа'&&document.getElementById('cinTitle').textContent==='Ночной сеанс');
    for(const p of [host,viewer,outside])await p.waitForFunction(()=>posters.length===1&&posters[0].kind==='cinema'&&posters[0].title==='Афиша · Ночной сеанс'&&posters[0].text.includes('Начало'));
    assert.equal(await outside.locator('#hubCinema[open]').count(),0);
    for(const p of [host,viewer]){
      assert.equal(await p.evaluate(()=>testMic.length),0);
      assert(await p.evaluate(()=>{const box=document.querySelector('#hubCinema').getBoundingClientRect(),chat=document.querySelector('#hubCinema aside').getBoundingClientRect();return Math.abs(box.width-innerWidth)<3&&Math.abs(box.height-innerHeight)<3&&innerHeight-chat.bottom<35&&innerWidth-chat.right<35;}),'fullscreen with chat docked bottom-right');
    }
    await host.click('#cinVoiceJoin');await viewer.click('#cinVoiceJoin');
    for(const p of [host,viewer])await p.waitForFunction(()=>document.querySelector('#cinVoicePeople').textContent.includes('fifflaren')&&document.querySelector('#cinVoicePeople').textContent.includes('mira')&&heardVoice>0,null,{timeout:22000});
    await host.click('#cinVoiceMute');await viewer.waitForFunction(()=>document.querySelector('#cinVoicePeople').textContent.includes('fifflaren (микрофон выкл.)'));
    assert.equal(await host.evaluate(()=>testMic.at(-1).enabled),false);
    await viewer.waitForTimeout(500);const quiet=await viewer.evaluate(()=>heardVoice);await viewer.waitForTimeout(350);assert.equal(await viewer.evaluate(()=>heardVoice),quiet);
    await host.click('#cinVoiceMute');await viewer.waitForFunction(n=>heardVoice>n,quiet);
    await host.click('#cinVoiceLeave');await viewer.waitForFunction(()=>!document.querySelector('#cinVoicePeople').textContent.includes('fifflaren'));
    assert.equal(await host.evaluate(()=>testMic.at(-1).readyState),'ended');
    await outside.evaluate(()=>HubCinema.openNotice('mira'));assert.equal(await outside.locator('#hubCinema[open]').count(),0);
    await outside.evaluate(()=>HubCinema.openNotice(posters[0].username));await outside.locator('#hubCinema[open]').waitFor();
    await outside.reload();
    const fresh=await login('leo');await fresh.waitForFunction(()=>posters.length===1);
    assert.equal(await outside.evaluate(()=>posters.length),0);await fresh.close();
    const time=await viewer.locator('#cinClock').textContent();await viewer.waitForFunction(t=>document.getElementById('cinClock').textContent!==t,time);
    await viewer.fill('#cinText','Привет <экран>');await viewer.locator('#cinChat button').click();await host.getByText('Привет <экран>',{exact:true}).waitFor();
    const clip=fs.readFileSync(filmFile);const padding=Buffer.alloc(2*1024*1024);padding.writeUInt32BE(padding.length);padding.write('free',4);
    const original=Buffer.concat([clip,padding]);fs.writeFileSync(localFile,original);await host.locator('#cinFiles').setInputFiles(localFile);
    await host.waitForFunction(()=>Array.from(document.querySelector('#cinFilms').options).some(o=>o.text==='Film'),null,{timeout:45000});
    await host.selectOption('#cinFilms',{label:'Film'});
    const id=await host.locator('#cinFilms').inputValue(),stateBefore=await mongoose.connection.collection('cinema_show').findOne({_id:'live'});
    assert.equal((await fetch(url+'/api/cinema/video/'+id+'/ticket',{method:'POST',headers:{Authorization:'Bearer mira'}})).status,403);
    await host.click('#cinTest');await host.waitForFunction(()=>{const v=document.querySelector('#cinTestVideo');return v.currentTime>.15&&v.videoWidth>=1920&&v.webkitAudioDecodedByteCount>0;});
    assert.equal(await viewer.locator('#cinTestPanel').isVisible(),false);assert.equal((await mongoose.connection.collection('cinema_show').findOne({_id:'live'})).rev,stateBefore.rev);
    await host.click('#cinTestClose');
    const [attached]=await Promise.all([host.waitForResponse(r=>r.url()===url+'/api/cinema/control'&&r.request().method()==='POST'),host.click('#cinAttach')]);
    assert.equal(attached.status(),200);assert.equal((await attached.json()).film.id,id);
    const capacity=await (await fetch(url+'/api/cinema/library',{headers:{Authorization:'Bearer fifflaren'}})).json();
    assert.equal(capacity.space.limit,10_000_000_000);assert.equal(capacity.space.used,original.length);
    assert((await host.locator('#cinSpace').textContent()).includes('из 10 ГБ'));
    const ticket=await (await fetch(url+'/api/cinema/video/'+id+'/ticket',{method:'POST',headers:{Authorization:'Bearer mira'}})).json(),streamURL=url+'/api/cinema/video/'+id+'?ticket='+ticket.ticket;
    const full=await fetch(streamURL);assert.equal(full.status,200);assert.deepEqual(Buffer.from(await full.arrayBuffer()),original);
    const piece=await fetch(streamURL,{headers:{Range:'bytes=511999-525512'}});assert.equal(piece.status,206);assert.deepEqual(Buffer.from(await piece.arrayBuffer()),original.subarray(511999,525513));
    assert.equal(await mongoose.connection.collection('cinema_parts').countDocuments({}),0);
    assert.equal((await fetch(url+'/api/cinema/library/'+id,{method:'DELETE',headers:{Authorization:'Bearer fifflaren'}})).status,409);
    assert.equal((await fetch(url+'/api/cinema/library/'+id,{method:'DELETE',headers:{Authorization:'Bearer mira'}})).status,403);
    if(process.env.CINEMA_QA_SCREEN)await viewer.locator('#hubCinema').screenshot({path:process.env.CINEMA_QA_SCREEN});
    await viewer.waitForFunction(()=>document.querySelector('#cinPhase').textContent==='Сейчас в эфире',null,{timeout:70000});
    async function watching(p){
      await p.waitForFunction(()=>document.querySelector('#cinVideo').currentTime>.15||!document.querySelector('#cinUnmute').hidden,null,{timeout:16000});
      if(await p.locator('#cinUnmute').isVisible())await p.click('#cinUnmute');
      await p.waitForFunction(()=>{const v=document.querySelector('#cinVideo');return v.videoWidth>0&&v.currentTime>.25&&!v.paused&&v.webkitAudioDecodedByteCount>0;});
    }
    await watching(viewer);await watching(host);
    await viewer.click('#cinVolumeDown');
    assert.equal(await viewer.locator('#cinVideo').evaluate(v=>v.paused),false,'volume keeps playback running');
    assert.equal(await viewer.locator('#cinVideo').evaluate(v=>v.volume),.9);
    await viewer.click('#cinPopcorn');await viewer.waitForTimeout(300);assert.equal(await viewer.locator('#cinVideo').evaluate(v=>v.paused),false);await viewer.click('#cinPopCancel');assert(await viewer.locator('#cinQuality').textContent().then(x=>x.includes('1920 × 1080')));await viewer.click('#cinVideoFull');await viewer.waitForFunction(()=>document.fullscreenElement===document.querySelector('#cinVideo'));await viewer.evaluate(()=>document.exitFullscreen());await host.click('#cinPause');
    await viewer.waitForFunction(()=>document.querySelector('#cinVideo').paused&&document.querySelector('#cinPhase').textContent==='Пауза');
    await host.locator('#cinSeek').evaluate(e=>{e.value=12;e.dispatchEvent(new Event('change'));});
    await viewer.waitForFunction(()=>Math.abs(document.querySelector('#cinVideo').currentTime-12)<.7);
    await host.click('#cinPlay');const late=await join('leo');await watching(late);
    const times=await Promise.all([viewer,late].map(p=>p.locator('#cinVideo').evaluate(v=>v.currentTime)));assert(times[1]>=11.5&&Math.abs(times[0]-times[1])<2,'aligned playback '+times);
    await late.getByText('Привет <экран>',{exact:true}).waitFor();
    await late.click('#cinExit');await late.waitForFunction(()=>document.querySelector('#cinVideo').paused&&!document.querySelector('#cinVideo').hasAttribute('src'));
    assert.equal(await viewer.evaluate(()=>posters.length),1,'attaching, starting, pausing and seeking do not announce again');
    assert.equal(await outside.evaluate(()=>posters.length),0,'the seen poster is not repeated on reconnect');
    await host.fill('#cinName','Второй сеанс');await host.click('#cinSchedule');
    await outside.waitForFunction(()=>posters.length===1&&posters[0].title==='Афиша · Второй сеанс');
    await host.click('#cinClear');await viewer.waitForFunction(()=>document.querySelector('#cinTitle').textContent==='Скоро на экране');
    await viewer.click('#cinExit');await viewer.waitForFunction(()=>testMic.at(-1).readyState==='ended');await host.waitForFunction(()=>document.querySelector('#cinVoicePeople').textContent.includes('никого'));
    const afterClear=await join('leo');assert.equal(await afterClear.evaluate(()=>posters.length),0,'cancelled show is not announced on login');
    stopPC();
    const disconnected=await fetch(url+'/api/cinema/video/'+id+'/ticket',{method:'POST',headers:{Authorization:'Bearer fifflaren'}});assert.equal(disconnected.status,503);
    await host.evaluate(()=>qaConnect('fifflaren',true));
    const same=await fetch(streamURL,{headers:{Range:'bytes=-64'}});assert.equal(same.status,206);assert.deepEqual(Buffer.from(await same.arrayBuffer()),original.subarray(-64));
    await host.selectOption('#cinFilms',{label:'Film'});host.once('dialog',d=>d.accept());await host.click('#cinDelete');
    await host.waitForFunction(()=>!Array.from(document.querySelector('#cinFilms').options).some(o=>o.text==='Film'));
    assert.deepEqual(fs.readFileSync(localFile),original);assert.equal((await fetch(streamURL)).status,404);
    assert.deepEqual(errors,[]);console.log('PASS fullscreen, bottom-right chat, bidirectional voice, mute, microphone teardown, posters outside the hall, reconnect, notification navigation, marquee countdown, automatic start, audible 1080p PC stream, exact original bytes and ranges, private preview, offline/reconnect, safe removal, host controls, late join and chat',times);
  }finally{await browser?.close();stopPC?.();if(io)await new Promise(r=>io.close(r));await mongoose.disconnect();await db?.stop();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
