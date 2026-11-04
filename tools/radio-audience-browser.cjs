// Exercise the desktop radio widget with real sockets, a streaming audio element and two accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),express=require('express'),{Server}=require('socket.io');
const {install}=require('../radio-service'),root=path.resolve(__dirname,'../../fifflaren-app');
const {MongoMemoryServer}=require('mongodb-memory-server'),mongoose=require('mongoose');
const tab=fs.readFileSync(path.join(root,'index.html'),'utf8').split('<div id="tab-radio"')[1].split('<div id="tab-admin"')[0];
function wave(){
  const bytes=Buffer.alloc(44+8000*2*45);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let n=0;n<(bytes.length-44)/2;n++)bytes.writeInt16LE(Math.round(Math.sin(n*2*Math.PI*125/8000)*12000),44+n*2);
  return bytes;
}
async function main(){
  let db,io,browser;
  try{
    db=await MongoMemoryServer.create({instance:{launchTimeout:60000},binary:{version:'8.2.6'}});await mongoose.connect(db.getUri());
    const app=express(),httpServer=http.createServer(app);app.use(express.json());io=new Server(httpServer);
    install({app,io,mongoose,authenticate:async t=>['fifflaren','mira'].includes(t)?{username:t}:null});
    app.get('/',(req,res)=>res.send('<meta charset="utf-8"><link rel="stylesheet" href="/radio.css"><header style="display:flex"><div class="hub-tools"></div></header><button id="radioTabButton"></button><div id="tab-radio"'+tab+'<script src="/socket.io/socket.io.js"></script><script src="/radio.js"></script><script>const nick=location.hash.slice(1); HubRadio.start({username:nick,token:nick,io,server:location.origin});if(nick==="fifflaren"){const el=document.querySelector("#tab-radio");el.style.display="block";el.classList.add("active");}</script>'));
    for(const file of ['radio.js','radio.css'])app.get('/'+file,(req,res)=>res.sendFile(path.join(root,file)));
    await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+httpServer.address().port;
    const upload=await fetch(url+'/api/radio/tracks?title=Pulse&duration=45',{method:'POST',headers:{Authorization:'Bearer fifflaren','Content-Type':'application/octet-stream'},body:wave()});
    assert(upload.ok,await upload.text());
    const executablePath=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
    browser=await chromium.launch({executablePath});const errors=[];
    async function open(nick){const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url+'/#'+nick);return p;}
    const host=await open('fifflaren'),a=await open('mira');
    const names=(p,nicks)=>p.waitForFunction(n=>document.querySelector('#radioCount')?.textContent===String(n.length)&&(!n.length||JSON.stringify(Array.from(document.querySelectorAll('#radioListeners li'),e=>e.textContent))===JSON.stringify(n)),nicks);
    await names(host,[]);await host.click('#radioBroadcast');await a.click('#radioLights');
    await names(host,['mira']);await a.waitForFunction(()=>!document.querySelector('#radioGlow').hidden);
    assert(await host.locator('#radioGlow').isHidden());await host.click('#radioAudience summary');assert(await host.locator('#radioListeners').getByText('mira').isVisible());
    await a.waitForFunction(()=>Number(document.querySelector('#radioGlow').style.getPropertyValue('--beat'))>0);
    await a.click('#radioLights');assert(await a.locator('#radioGlow').isHidden());await names(host,['mira']);
    await a.locator('#radioVolume').evaluate(el=>{el.value=0;el.dispatchEvent(new Event('input'));});await names(host,[]);
    await a.locator('#radioVolume').evaluate(el=>{el.value=35;el.dispatchEvent(new Event('input'));});await names(host,['mira']);
    const duplicate=await open('mira');await duplicate.click('#radioToggle');await duplicate.waitForTimeout(400);
    await a.close();await names(host,['mira']);
    await host.click('#radioToggle');await names(duplicate,['fifflaren','mira']);
    await host.click('#radioBroadcast');await names(duplicate,[]);await host.click('#radioBroadcast');await names(duplicate,['fifflaren','mira']);
    await duplicate.evaluate(()=>HubRadio.stop());await names(host,['fifflaren']);
    await host.click('#radioToggle');await names(host,[]);assert.deepEqual(errors,[]);
    console.log('PASS: real radio playback, live names, deduplicated accounts, pause/resume, volume, disconnect and local beat-reactive lights.');
  }finally{await browser?.close();if(io)await new Promise(r=>io.close(r));await mongoose.disconnect();await db?.stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
