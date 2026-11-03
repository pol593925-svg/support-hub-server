'use strict';
const {randomUUID}=require('crypto'),{validate,version}=require('./assistance-protocol');
module.exports=function install({io,authenticate,audit=async()=>{}}){
 const ns=io.of('/assistance'),sessions=new Map(),used=new Map();
 const clean=s=>({id:s.id,admin:s.adminName,worker:s.workerName,expires:s.expires,protocol:version});
 function end(id,reason='stopped'){
  const s=sessions.get(id);if(!s)return;
  sessions.delete(id);used.delete(s.admin);used.delete(s.worker);clearTimeout(s.timer);
  for(const sid of [s.admin,s.worker])ns.to(sid).emit('ended',{id,reason});
  audit({action:'ended',admin:s.adminName,target:s.workerName,reason}).catch(()=>{});
 }
 async function authorized(s){
  if(Date.now()>s.expires){end(s.id,'timeout');throw Error('Сеанс завершён');}
  if(Date.now()-s.verifiedAt>30000){
   if(!s.authPromise)s.authPromise=(async()=>{
    const a=ns.sockets.get(s.admin),w=ns.sockets.get(s.worker);
    const [actor,target]=await Promise.all([a&&authenticate(a.handshake.auth?.token),w&&authenticate(w.handshake.auth?.token)]);
    if(actor?.role!=='admin'||!target){end(s.id,'auth');throw Error('Доступ отозван');}
    s.verifiedAt=Date.now();
   })().finally(()=>{s.authPromise=null;});
   await s.authPromise;
  }
  if(sessions.get(s.id)!==s)throw Error('Сеанс завершён');
 }
 function bound(socket,id,role){const s=sessions.get(id);if(!s||s[role]!==socket.id)throw Error('Сеанс завершён');return s;}
 ns.use(async(socket,next)=>{try{const actor=await authenticate(socket.handshake.auth?.token);if(!actor)return next(Error('Войди заново в Support Hub'));socket.data.actor={username:actor.username.toLowerCase(),role:actor.role};next();}catch{next(Error('Не удалось проверить вход'));}});
 ns.on('connection',socket=>{
  function rpc(name,handler){socket.on(name,async(data,ack)=>{if(typeof ack!=='function')return;try{ack({ok:true,...await handler(data||{})});}catch(e){ack({ok:false,error:e.message});}});}
  rpc('start',async data=>{
   const actor=await authenticate(socket.handshake.auth?.token);
   if(actor?.role!=='admin')throw Error('Доступно только администратору');
   if(socket.handshake.auth?.protocol!==version)throw Error('Обнови Support Hub до 3.44.1');
   if(used.has(socket.id))throw Error('Сначала заверши текущий сеанс');
   const target=String(data.target||'').trim().toLowerCase();
   const worker=[...ns.sockets.values()].find(s=>s!==socket&&s.data.actor.username===target&&!used.has(s.id)&&s.handshake.auth?.protocol===version);
   if(!worker)throw Error('Сотрудник не в сети, занят или ещё не обновил приложение до 3.44.1');
   if(worker.data.actor.username===actor.username.toLowerCase())throw Error('Выбери другого сотрудника');
   if(Date.now()-(socket.data.lastStart||0)<3000)throw Error('Подожди перед повторным подключением');
   socket.data.lastStart=Date.now();
   const current=await authenticate(worker.handshake.auth?.token);if(!current)throw Error('Сотруднику нужно войти заново');
   if(used.has(socket.id)||used.has(worker.id)||!socket.connected||!worker.connected)throw Error('Сеанс уже изменился');
   const s={id:randomUUID(),admin:socket.id,worker:worker.id,adminName:actor.username,workerName:target,expires:Date.now()+600000,ready:false,events:0,windowAt:Date.now(),verifiedAt:Date.now(),signalCount:0};
   sessions.set(s.id,s);used.set(socket.id,s.id);used.set(worker.id,s.id);
   s.timer=setTimeout(()=>end(s.id,'timeout'),600000);s.timer.unref();
   try{await audit({action:'started',admin:actor.username,target});}catch{end(s.id,'audit_failed');throw Error('Не удалось записать начало сеанса');}
   if(sessions.get(s.id)!==s)throw Error('Сеанс завершён');
   worker.emit('begin',clean(s));return {session:clean(s)};
  });
  rpc('ready',data=>{const s=bound(socket,data.id,'worker');s.ready=true;ns.to(s.admin).emit('ready',clean(s));return {};});
  async function command(data,moveOnly=false){
   const s=bound(socket,data.id,'admin');if(!s.ready)throw Error('Управление не подключено');
   const c=validate(data);if(moveOnly&&c.kind!=='move')return;
   await authorized(s);const now=Date.now();
   if(now-s.windowAt>=1000){s.events=0;s.moves=0;s.windowAt=now;}
   if(c.kind==='move'){if((s.moves=(s.moves||0)+1)>40)return;}
   else if(c.kind!=='release'&&++s.events>100)throw Error('Слишком много команд');
   if(['url','paste'].includes(c.kind)){const k=c.kind+'At';if(now-(s[k]||0)<500)throw Error('Подожди');s[k]=now;}
   const target=ns.sockets.get(s.worker);if(!target)throw Error('Сотрудник отключился');
   if(c.kind==='move')target.volatile.emit('command',{id:s.id,...c});
   else target.emit('command',{id:s.id,...c});
   return {};
  }
  rpc('command',d=>command(d));
  // Latest position only: no acknowledgement wait and no backlog of mouse movements.
  socket.on('pointer',d=>{command(d,true).catch(()=>{});});
  rpc('signal',async d=>{
   const s=sessions.get(d.id);if(!s||![s.admin,s.worker].includes(socket.id)||!s.ready)throw Error('Сеанс завершён');
   await authorized(s);if(++s.signalCount>250)throw Error('Слишком много сигналов');let payload;
   if(d.type==='offer'||d.type==='answer'){
    if(socket.id!==s[d.type==='offer'?'worker':'admin']||typeof d.sdp!=='string'||d.sdp.length>40000)throw Error('Неверный сигнал');
    payload={type:d.type,sdp:d.sdp};
   }else if(d.type==='ice'){
    if(!d.candidate||typeof d.candidate.candidate!=='string'||d.candidate.candidate.length>4096||!Number.isInteger(d.candidate.sdpMLineIndex)||d.candidate.sdpMLineIndex<0||d.candidate.sdpMLineIndex>8)throw Error('Неверный ICE');
    payload={type:'ice',candidate:{candidate:d.candidate.candidate,sdpMid:String(d.candidate.sdpMid||'').slice(0,32),sdpMLineIndex:d.candidate.sdpMLineIndex}};
   }else throw Error('Неверный сигнал');
   ns.to(socket.id===s.worker?s.admin:s.worker).emit('signal',{id:s.id,...payload});return {};
  });
  rpc('quality',d=>{const s=bound(socket,d.id,'admin');if(!['economy','balanced','sharp'].includes(d.quality))throw Error('Неверное качество');ns.to(s.worker).emit('quality',{id:s.id,quality:d.quality});return {};});
  rpc('frame',async d=>{
   const s=bound(socket,d.id,'worker');if(!s.ready||s.framePending||Date.now()-(s.frameAt||0)<150)throw Error('Кадр ещё передаётся');
   if(!Number.isSafeInteger(d.seq)||!Buffer.isBuffer(d.bytes)||d.bytes.length<4||d.bytes.length>180000||d.bytes[0]!==255||d.bytes[1]!==216)throw Error('Неверный кадр');
   await authorized(s);s.framePending=true;s.frameAt=Date.now();
   try{await new Promise((resolve,reject)=>{
    const viewer=ns.sockets.get(s.admin);if(!viewer)return reject(Error('Просмотр закрыт'));
    viewer.timeout(2500).emit('frame',{id:s.id,seq:d.seq,bytes:d.bytes},(err,reply)=>err||reply?.seq!==d.seq?reject(Error('Кадр пропущен')):resolve());
   });return {};}finally{s.framePending=false;}
  });
  rpc('stop',d=>{const id=used.get(socket.id);if(id&&(!d.id||id===d.id))end(id);return {};});
  socket.on('disconnect',()=>{const id=used.get(socket.id);if(id)end(id,'offline');});
 });
 return {stop(){for(const id of [...sessions.keys()])end(id,'server_stop');},sessions};
};
