// Provide a short real MP4 with an audio track in CINEMA_QA_FILM.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),express=require('express'),mongoose=require('mongoose'),{Server}=require('socket.io'),{MongoMemoryServer}=require('mongodb-memory-server');
const {install}=require('../cinema-service'),radio=require('../radio-service'),root=path.resolve(__dirname,'../../fifflaren-app');
const tab=fs.readFileSync(path.join(root,'index.html'),'utf8').split('<div id="tab-radio"')[1].split('<div id="tab-admin"')[0];
async function main(){
  let db,io,browser;
  try{
    const filmFile=process.env.CINEMA_QA_FILM;assert(filmFile&&fs.existsSync(filmFile),'set CINEMA_QA_FILM to an MP4');
    db=await MongoMemoryServer.create({instance:{launchTimeout:60000},binary:{version:'8.2.6'}});await mongoose.connect(db.getUri());
    const app=express(),server=http.createServer(app);app.use(express.json());io=new Server(server);
    const cfg={app,io,mongoose,authenticate:async t=>['fifflaren','mira','leo'].includes(t)?{username:t}:null};install(cfg);radio.install(cfg);
    app.get('/',(req,res)=>res.send('<meta charset="utf-8"><link rel="stylesheet" href="/radio.css"><link rel="stylesheet" href="/cinema.css"><header style="display:flex"><div class="hub-tools"></div></header><button id="radioTabButton"></button><div id="tab-radio"'+tab+'<script src="/socket.io/socket.io.js"></script><script src="/cinema.js"></script><script src="/radio.js"></script><script>const nick=location.hash.slice(1);window.posters=[];HubRadio.start({username:nick,token:nick,io,server:location.origin,notify:p=>posters.push(p)});</script>'));
    for(const f of ['radio.js','cinema.js','radio.css','cinema.css'])app.get('/'+f,(req,res)=>res.sendFile(path.join(root,f)));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe'});const errors=[];
    async function login(nick){const p=await browser.newPage({viewport:{width:1150,height:790}});p.on('pageerror',e=>errors.push(e.message));await p.goto(url+'/#'+nick);return p;}
    async function join(nick){const p=await login(nick);await p.click('#cinemaButton');await p.waitForFunction(()=>document.getElementById('cinPhase').textContent!=='Подключаемся…');return p;}
    const host=await join('fifflaren'),viewer=await join('mira'),outside=await login('leo');assert(await viewer.locator('#cinHost').isHidden());
    assert.equal((await fetch(url+'/api/cinema/control',{method:'POST',headers:{Authorization:'Bearer mira','Content-Type':'application/json'},body:'{"op":"clear","rev":0}'})).status,403);
    assert.equal((await fetch(url+'/api/cinema/uploads/'+'a'.repeat(24),{method:'PUT',headers:{Authorization:'Bearer mira'}})).status,403);
    await host.click('#cinHost summary');await host.fill('#cinName','Ночной сеанс');await host.fill('#cinDelay','1');await host.click('#cinSchedule');
    await viewer.waitForFunction(()=>document.getElementById('cinPhase').textContent==='До начала показа'&&document.getElementById('cinTitle').textContent==='Ночной сеанс');
    for(const p of [host,viewer,outside])await p.waitForFunction(()=>posters.length===1&&posters[0].kind==='cinema'&&posters[0].title==='Афиша · Ночной сеанс'&&posters[0].text.includes('Начало'));
    assert.equal(await outside.locator('#hubCinema[open]').count(),0);
    await outside.evaluate(()=>HubCinema.openNotice('mira'));assert.equal(await outside.locator('#hubCinema[open]').count(),0);
    await outside.evaluate(()=>HubCinema.openNotice(posters[0].username));await outside.locator('#hubCinema[open]').waitFor();
    await outside.reload();
    const fresh=await login('leo');await fresh.waitForFunction(()=>posters.length===1);
    assert.equal(await outside.evaluate(()=>posters.length),0);await fresh.close();
    const time=await viewer.locator('#cinClock').textContent();await viewer.waitForFunction(t=>document.getElementById('cinClock').textContent!==t,time);
    await viewer.fill('#cinText','Привет <экран>');await viewer.locator('#cinChat button').click();await host.getByText('Привет <экран>',{exact:true}).waitFor();
    const clip=fs.readFileSync(filmFile);const padding=Buffer.alloc(2*1024*1024);padding.writeUInt32BE(padding.length);padding.write('free',4);
    await host.locator('#cinFiles').setInputFiles({name:'Film.mp4',mimeType:'video/mp4',buffer:Buffer.concat([clip,padding])});
    await host.waitForFunction(()=>Array.from(document.querySelector('#cinFilms').options).some(o=>o.text==='Film'),null,{timeout:45000});
    await host.selectOption('#cinFilms',{label:'Film'});await host.click('#cinAttach');
    if(process.env.CINEMA_QA_SCREEN)await viewer.locator('#hubCinema').screenshot({path:process.env.CINEMA_QA_SCREEN});
    await viewer.waitForFunction(()=>document.querySelector('#cinPhase').textContent==='Сейчас в эфире',null,{timeout:70000});
    async function watching(p){
      await p.waitForFunction(()=>document.querySelector('#cinVideo').currentTime>.15||!document.querySelector('#cinUnmute').hidden,null,{timeout:16000});
      if(await p.locator('#cinUnmute').isVisible())await p.click('#cinUnmute');
      await p.waitForFunction(()=>{const v=document.querySelector('#cinVideo');return v.videoWidth>0&&v.currentTime>.25&&!v.paused&&v.webkitAudioDecodedByteCount>0;});
    }
    await watching(viewer);await watching(host);await host.click('#cinPause');
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
    const afterClear=await join('leo');assert.equal(await afterClear.evaluate(()=>posters.length),0,'cancelled show is not announced on login');
    assert.deepEqual(errors,[]);console.log('PASS posters outside the hall, reconnect, notification navigation, marquee countdown, automatic start, audible movie, multipart upload, host controls, seek, late join, chat history and exit',times);
  }finally{await browser?.close();if(io)await new Promise(r=>io.close(r));await mongoose.disconnect();await db?.stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
