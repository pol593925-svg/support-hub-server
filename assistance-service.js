'use strict';
const {randomUUID}=require('crypto');
module.exports=function install({io,authenticate,audit=async()=>{}}){
 const ns=io.of('/assistance'),sessions=new Map(),used=new Map();
 const clean=s=>({id:s.id,admin:s.adminName,worker:s.workerName,expires:s.expires});
 function end(id,reason='stopped'){const s=sessions.get(id);if(!s)return;sessions.delete(id);used.delete(s.admin);used.delete(s.worker);clearTimeout(s.timer);for(const sid of [s.admin,s.worker])ns.to(sid).emit('ended',{id,reason});audit({action:'ended',admin:s.adminName,target:s.workerName,reason}).catch(()=>{});}
 ns.use(async(socket,next)=>{try{const actor=await authenticate(socket.handshake.auth?.token);if(!actor)return next(Error('Войди заново в Support Hub'));socket.data.actor={username:actor.username.toLowerCase(),role:actor.role};next();}catch{next(Error('Не удалось проверить вход'));}});
 ns.on('connection',socket=>{
  function rpc(name,handler){socket.on(name,async(data,ack)=>{if(typeof ack!=='function')return;try{ack({ok:true,...await handler(data||{})});}catch(e){ack({ok:false,error:e.message});}});}
  rpc('start',async data=>{const actor=await authenticate(socket.handshake.auth?.token);if(actor?.role!=='admin')throw Error('Доступно только администратору');if(used.has(socket.id))throw Error('Сначала заверши текущий сеанс');const target=String(data.target||'').trim().toLowerCase();const worker=[...ns.sockets.values()].find(s=>s!==socket&&s.data.actor.username===target&&!used.has(s.id));if(!worker)throw Error('Сотрудник не в сети, не обновил приложение или уже занят');if(worker.data.actor.username===actor.username.toLowerCase())throw Error('Выбери другого сотрудника');if(Date.now()-(socket.data.lastStart||0)<3000)throw Error('Подожди перед повторным подключением');socket.data.lastStart=Date.now();
   const current=await authenticate(worker.handshake.auth?.token);if(!current)throw Error('Сотруднику нужно войти заново');if(used.has(socket.id)||used.has(worker.id)||!socket.connected||!worker.connected)throw Error('Сеанс уже изменился');const s={id:randomUUID(),admin:socket.id,worker:worker.id,adminName:actor.username,workerName:target,expires:Date.now()+600000,ready:false,frames:0,events:0,windowAt:Date.now(),verifiedAt:Date.now()};sessions.set(s.id,s);used.set(socket.id,s.id);used.set(worker.id,s.id);s.timer=setTimeout(()=>end(s.id,'timeout'),600000);s.timer.unref();worker.emit('begin',clean(s));try{await audit({action:'started',admin:actor.username,target});}catch{end(s.id,'audit_failed');throw Error('Не удалось записать начало сеанса');}return {session:clean(s)};
  });
  rpc('ready',data=>{const s=sessions.get(data.id);if(!s||s.worker!==socket.id)throw Error('Сеанс завершён');s.ready=true;ns.to(s.admin).emit('ready',clean(s));return {};});
  rpc('command',async data=>{const s=sessions.get(data.id);if(!s||s.admin!==socket.id||!s.ready)throw Error('Управление не подключено');const now=Date.now();if(now>s.expires){end(s.id,'timeout');throw Error('Сеанс завершён');}if(now-s.verifiedAt>30000){const actor=await authenticate(socket.handshake.auth?.token),worker=ns.sockets.get(s.worker),target=worker&&await authenticate(worker.handshake.auth?.token);if(actor?.role!=='admin'||!target){end(s.id,'auth');throw Error('Доступ отозван');}s.verifiedAt=now;}if(sessions.get(s.id)!==s)throw Error('Сеанс завершён');if(now-s.windowAt>1000){s.events=0;s.windowAt=now;}if(++s.events>35)throw Error('Слишком много команд');let command;
   if(data.kind==='url'){let u;try{u=new URL(data.url);}catch{}if(!u||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2048)throw Error('Нужна ссылка HTTP или HTTPS');if(now-(s.lastUrl||0)<1500)throw Error('Подожди');s.lastUrl=now;command={kind:'url',url:u.href};}
   else {if(!['move','click','right','wheel'].includes(data.kind)||![data.x,data.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Неверные координаты');command={kind:data.kind,x:data.x,y:data.y};if(data.kind==='wheel')command.delta=Math.max(-3,Math.min(3,Number(data.delta)||0));}
   ns.to(s.worker).emit('command',{id:s.id,...command});return {};
  });
  socket.on('frame',data=>{const s=sessions.get(data?.id);if(!s||s.worker!==socket.id||!s.ready||Date.now()-(s.frameAt||0)<180||typeof data.dataUrl!=='string'||data.dataUrl.length>900000||!data.dataUrl.startsWith('data:image/jpeg;base64,'))return;s.frameAt=Date.now();ns.to(s.admin).volatile.emit('frame',{id:s.id,dataUrl:data.dataUrl});});
  rpc('stop',data=>{const id=used.get(socket.id);if(id&&(!data.id||id===data.id))end(id);return {};});
  socket.on('disconnect',()=>{const id=used.get(socket.id);if(id)end(id,'offline');});
 });
 return {stop(){for(const id of [...sessions.keys()])end(id,'server_stop');},sessions};
};
