'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),express=require('express');
const {install,PAIR_TTL,SESSION_TTL}=require('./radio-mobile');
test('QR access: single use, scope isolation, server-side DJ password, expiry, logout and revocation',async()=>{
  const app=express();app.use(express.json());const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;let now=Date.now(),valid=true,online=true;
  const mobile=install({app,publicUrl:url,now:()=>now,online:()=>{if(!online)throw Error('offline');},authenticate:async token=>valid&&['mira','fifflaren','leo'].includes(token)?{username:token}:null});
  app.all(['/api/radio/state','/api/radio/control','/api/radio/uploads/:id','/api/radio/uploads/:id/parts/:n','/api/radio/uploads/:id/finish','/api/radio/library/:id/queue'],async(req,res)=>{
    try{const a=await mobile.authorize(req);a.observe(res);res.json({username:a.user.username,mode:req.radioMobileMode});}catch(e){res.status(e.status||500).json({message:e.message});}
  });
  const call=async(route,token,method='GET',body)=>{const r=await fetch(url+'/api/radio/'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body&&method!=='GET'?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  async function pair(token,mode='upload'){const r=await call('mobile/pairs',token,'POST',{mode});assert.equal(r.status,200,JSON.stringify(r.data));assert(r.data.qr.startsWith('data:image/png;base64,'));assert(!r.data.url.includes(token));const params=new URLSearchParams(new URL(r.data.url).hash.slice(1));return {...r.data,code:params.get('code')};}
  const claim=(p,password)=>call('mobile/connect',null,'POST',{id:p.id,code:p.code,password});
  try{
    assert.equal((await call('mobile/pairs',null,'POST',{mode:'upload'})).status,401);
    assert.equal((await call('mobile/pairs','mira','POST',{mode:'dj'})).status,403);
    const p=await pair('mira');assert(p.hostOnline);assert.equal((await call('mobile/pairs/'+p.id,'leo')).status,404);
    const a=await claim(p);assert.equal(a.status,200);const token=a.data.token;assert(token.startsWith('rph_'));assert.equal(a.data.username,'mira');
    assert.equal((await claim(p)).status,401);assert.equal((await call('mobile/info',token)).status,200);
    for(const [route,method] of [['state','GET'],['control','POST'],['library/'+ 'a'.repeat(24)+'/queue','POST'],['mobile/pairs','POST']])assert.equal((await call(route,token,method,{op:'play'})).status,403,route);
    const id='a'.repeat(24);assert.equal((await call('uploads/'+id,token,'PUT',{title:'Phone song',size:1024})).status,200);
    await call('uploads/'+id+'/parts/0',token,'PUT',{});await call('uploads/'+id+'/finish',token,'POST',{});
    const status=await call('mobile/pairs/'+p.id,'mira');assert(status.data.connected);assert.deepEqual(status.data.uploads,[{id,title:'Phone song',size:1024,percent:100,done:true}]);
    assert(!JSON.stringify(status.data).includes('parentToken'));assert(!JSON.stringify(status.data).includes(token));
    assert.equal((await call('mobile/pairs/'+p.id,'mira','DELETE')).status,200);assert.equal((await call('mobile/info',token)).status,401);
    const expired=await pair('mira');now+=PAIR_TTL+1;assert.equal((await claim(expired)).status,401);
    const dj=await pair('fifflaren','dj');assert.equal((await claim(dj,'wrong')).status,403);
    const granted=await claim(dj,'19971234');assert.equal(granted.status,200);const dt=granted.data.token;
    assert.equal((await call('state',dt)).status,200);assert.equal((await call('control',dt,'POST',{op:'play'})).status,200);
    assert.equal((await call('control',dt,'POST',{op:'play'})).status,429);
    assert.equal((await call('library/'+id+'/queue',dt,'POST',{})).status,403);
    const next=await pair('fifflaren','dj');assert.equal((await call('mobile/info',dt)).status,401);
    for(let i=0;i<5;i++)assert.equal((await claim(next,'wrong')).status,i===4?401:403);
    assert.equal((await claim(next,'19971234')).status,401);
    const re=await pair('mira'),rt=(await claim(re)).data.token;valid=false;assert.equal((await call('mobile/info',rt)).status,401);valid=true;
    now+=SESSION_TTL+1;assert.equal((await call('mobile/info',rt)).status,401);
    online=false;assert.equal((await pair('mira')).hostOnline,false);
    const page=await fetch(url+'/radio-phone/');assert.equal(page.status,200);assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const js=await (await fetch(url+'/radio-phone/phone.js')).text();assert(!js.includes('19971234'));assert(!js.includes('parentToken'));
  }finally{await new Promise(r=>server.close(r));}
});
