'use strict';
const crypto=require('node:crypto'),path=require('node:path'),express=require('express');
const bcrypt=require('bcryptjs'),QRCode=require('qrcode');
const PAIR_TTL=10*60*1000,SESSION_TTL=12*60*60*1000;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const secret=()=>crypto.randomBytes(32).toString('base64url');
const bearer=req=>String(req.headers.authorization||'').replace(/^Bearer /,'');
const fail=(status,message)=>Object.assign(Error(message),{status});
const DEFAULT_PIN_HASH='$2b$10$C/DOUu2aeE0q24SdBbUMAeDoqNU8oyX/7l5Xa0b4DV0TIqyWLhRUe';

function install({app,authenticate,online,now=Date.now,publicUrl=process.env.RADIO_PUBLIC_URL||'https://support-hub-server-v3.onrender.com',pinHash=process.env.RADIO_DJ_PASSWORD_HASH||DEFAULT_PIN_HASH}){
  const pairs=new Map(),grants=new Map();
  const origin=new URL(publicUrl).origin;
  function remove(pair){pairs.delete(pair.id);if(pair.grantHash)grants.delete(pair.grantHash);}
  function prune(){for(const p of pairs.values())if((p.connected?p.sessionExpires:p.expiresAt)<=now())remove(p);}
  function hostOnline(){try{online();return true;}catch{return false;}}
  function report(res,e){res.status(e.status||503).json({success:false,message:e.status?e.message:'Радио временно недоступно. Попробуй ещё раз.'});}
  async function actor(token){
    const user=await authenticate(token);
    if(!user?.username||user.isBanned||user.offboardedAt)throw fail(401,'Войди в Support Hub на компьютере и открой новый QR.');
    return user;
  }
  async function desktop(req){const token=bearer(req);if(token.startsWith('rph_'))throw fail(403,'Эта операция доступна в приложении.');return {user:await actor(token),token};}
  const snapshot=p=>({id:p.id,mode:p.mode,username:p.username,expiresAt:p.connected?p.sessionExpires:p.expiresAt,connected:!!p.connected,hostOnline:hostOnline(),uploads:Array.from(p.uploads.values()).slice(-20)});
  async function ownPair(req){
    prune();const {user,token}=await desktop(req),p=pairs.get(req.params.id);
    if(!p||p.parentHash!==hash(token)||p.username!==user.username)throw fail(404,'QR больше не действует. Создай новый.');return p;
  }
  async function phone(req){
    prune();const token=bearer(req),p=token.startsWith('rph_')&&grants.get(hash(token));
    if(!p)throw fail(401,'Подключение завершено. Отсканируй новый QR в Support Hub.');
    const u=await actor(p.parentToken);
    if(u.username!==p.username||(p.mode==='dj'&&u.username.toLowerCase()!=='fifflaren')){remove(p);throw fail(403,'Доступ к пульту закрыт.');}
    return {user:u,pair:p};
  }
  app.use('/api/radio/mobile',(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();});
  app.post('/api/radio/mobile/pairs',async(req,res)=>{try{
    prune();const {user,token}=await desktop(req),mode=req.body?.mode;
    if(!['upload','dj'].includes(mode))throw fail(400,'Выбери загрузку или DJ-пульт.');
    if(mode==='dj'&&user.username.toLowerCase()!=='fifflaren')throw fail(403,'DJ-пульт доступен только Fifflaren.');
    for(const p of pairs.values())if(p.parentHash===hash(token)&&p.mode===mode)remove(p);
    if(pairs.size>=1000)throw fail(429,'Слишком много подключений. Попробуй позже.');
    const id=crypto.randomBytes(16).toString('hex'),code=secret(),expiresAt=now()+PAIR_TTL;
    const url=origin+'/radio-phone/#'+new URLSearchParams({id,code,mode});
    const qr=await QRCode.toDataURL(url,{width:360,margin:4,errorCorrectionLevel:'M',color:{dark:'#173b30',light:'#ffffff'}});
    const p={id,mode,username:user.username,parentToken:token,parentHash:hash(token),codeHash:hash(code),expiresAt,attempts:0,uploads:new Map()};
    pairs.set(id,p);res.json({success:true,...snapshot(p),url,qr});
  }catch(e){report(res,e);}});
  app.get('/api/radio/mobile/pairs/:id',async(req,res)=>{try{res.json({success:true,...snapshot(await ownPair(req))});}catch(e){report(res,e);}});
  app.delete('/api/radio/mobile/pairs/:id',async(req,res)=>{try{remove(await ownPair(req));res.json({success:true});}catch(e){report(res,e);}});
  app.post('/api/radio/mobile/connect',async(req,res)=>{
    let p,locked=false;
    try{
      prune();const {id,code,password}=req.body||{};p=pairs.get(id);
      if(typeof code!=='string'||code.length!==43||!p||p.connected||p.codeHash!==hash(code))throw fail(401,'QR истёк или уже использован. Создай новый в приложении.');
      if(p.busy)throw fail(429,'Подключение уже проверяется.');p.busy=true;locked=true;
      const u=await actor(p.parentToken);
      if(p.mode==='dj'){
        if(u.username.toLowerCase()!=='fifflaren')throw fail(403,'Пульт доступен только Fifflaren.');
        p.attempts++;
        if(typeof password!=='string'||password.length>100||!await bcrypt.compare(password,pinHash)){
          if(p.attempts>=5){remove(p);throw fail(401,'Слишком много попыток. Создай новый QR.');}
          throw fail(403,'Неверный пароль DJ-пульта.');
        }
      }
      if(!pairs.has(p.id)||p.expiresAt<=now())throw fail(401,'QR уже отключён. Создай новый.');
      const token='rph_'+secret();p.connected=true;p.sessionExpires=now()+SESSION_TTL;p.grantHash=hash(token);delete p.codeHash;
      grants.set(p.grantHash,p);res.json({success:true,token,...snapshot(p)});
    }catch(e){report(res,e);}finally{if(locked)p.busy=false;}
  });
  app.get('/api/radio/mobile/info',async(req,res)=>{try{const {pair}=await phone(req);res.json({success:true,...snapshot(pair)});}catch(e){report(res,e);}});
  app.post('/api/radio/mobile/disconnect',async(req,res)=>{try{remove((await phone(req)).pair);res.json({success:true});}catch(e){report(res,e);}});

  // These tokens never become account tokens: only the explicitly listed radio routes accept them.
  async function authorize(req){
    const {user,pair:p}=await phone(req),route=req.path,method=req.method;
    const upload=/^\/api\/radio\/uploads\/([a-f0-9]{24})(?:\/(parts)\/(\d+)|\/(finish))?$/.exec(route);
    const allowedUpload=upload&&((method==='PUT'&&!upload[4])||(method==='POST'&&upload[4]));
    const control=p.mode==='dj'&&method==='POST'&&route==='/api/radio/control';
    const youtube=method==='POST'&&['/api/radio/youtube/preview','/api/radio/youtube/queue'].includes(route);
    if(!allowedUpload&&!control&&!youtube&&!(p.mode==='dj'&&method==='GET'&&route==='/api/radio/state'))throw fail(403,'Этот QR разрешает только добавление песен.');
    if(control){if(p.lastControl&&now()-p.lastControl<150)throw fail(429,'Слишком быстро. Подожди секунду.');p.lastControl=now();}
    req.radioMobileMode=p.mode;
    return {user,observe(res){
      if(!upload)return;
      const id=upload[1],meta=!upload[2]&&!upload[4]?{title:String(req.body?.title||'').slice(0,200),size:req.body?.size}:null;
      res.on('finish',()=>{
        if(res.statusCode>=300)return;
        if(meta&&!p.uploads.has(id)){
          if(p.uploads.size>=30)p.uploads.delete(p.uploads.keys().next().value);
          p.uploads.set(id,{id,title:meta.title,size:meta.size,percent:0,done:false});
        }
        const u=p.uploads.get(id);if(!u)return;
        if(upload[2])u.percent=Math.max(u.percent,Math.min(99,Math.floor((Number(upload[3])+1)*512*1024/u.size*100)));
        if(upload[4]){u.percent=100;u.done=true;}
      });
    }};
  }
  const files=path.join(__dirname,'radio-phone');
  app.use('/radio-phone',(_req,res,next)=>{
    res.set({'Referrer-Policy':'no-referrer','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; media-src blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});next();
  },express.static(files,{index:'index.html',dotfiles:'deny'}));
  return {authorize};
}
module.exports={install,PAIR_TTL,SESSION_TTL};
