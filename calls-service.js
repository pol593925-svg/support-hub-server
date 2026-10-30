const crypto=require('crypto');
const OWNER='fifflaren',OFFSET=3*3600000;
function calendar(now=Date.now()){
 const local=new Date(now+OFFSET),day=local.toISOString().slice(0,10);
 return {day,reportDay:new Date(now+OFFSET-(local.getUTCHours()<19?86400000:0)).toISOString().slice(0,10),timezone:'Europe/Simferopol'};
}
function dayBounds(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Некорректная дата');
 const start=new Date(day+'T00:00:00+03:00');
 if(!Number.isFinite(+start)||new Date(+start+OFFSET).toISOString().slice(0,10)!==day)throw Error('Некорректная дата');
 return {$gte:start,$lt:new Date(+start+86400000)};
}
module.exports=function install({app,io,User,Event}){
 const hash=token=>crypto.createHash('sha256').update(String(token)).digest('hex');
 async function issue(user){
  if(!user.username||user.isBanned)return undefined;
  const token=crypto.randomBytes(32).toString('base64url');
  await User.updateOne({username:user.username.toLowerCase()},{$push:{callsSessions:{$each:[{hash:hash(token),expiresAt:new Date(Date.now()+30*86400000)}],$slice:-8}}});
  return token;
 }
 async function valid(token){
  if(typeof token!=='string'||token.length!==43)return false;
  const owner=await User.findOne({username:OWNER}).select('+callsSessions');
  return !!owner&&!owner.isBanned&&(owner.callsSessions||[]).some(s=>s.hash===hash(token)&&+new Date(s.expiresAt)>Date.now());
 }
 async function actor(token){
  if(typeof token!=='string'||token.length!==43)return null;
  const user=await User.findOne({'callsSessions.hash':hash(token)}).select('+callsSessions');
  return user&&!user.isBanned&&(user.callsSessions||[]).some(s=>s.hash===hash(token)&&+new Date(s.expiresAt)>Date.now())?user:null;
 }
 const bearer=req=>String(req.headers.authorization||'').replace(/^Bearer /,'');
 async function ownerTeam(){const owner=await User.findOne({username:OWNER});return owner&&!owner.isBanned?(owner.team||OWNER).trim().toLowerCase():null;}
 async function allowed(token){return await valid(token)&&!!await ownerTeam();}
 function callRow(ev){return {id:String(ev._id),user:ev.user,createdAt:ev.createdAt,service:ev.data.serviceName||'',kind:ev.data.callType||'',link:ev.data.callLink||'',note:ev.data.callNote||'',status:['done','rejected'].includes(ev.data.reviewStatus)?ev.data.reviewStatus:'pending',reason:ev.data.reviewReason||'',reviewedAt:ev.data.reviewedAt||null};}
 const subscribers=new Map();
 io.on('connection',socket=>{
  socket.on('calls_subscribe',async token=>{try{if(await actor(token)&&socket.connected!==false)subscribers.set(socket.id,{socket,token});}catch{}});
  socket.on('calls_unsubscribe',()=>subscribers.delete(socket.id));
  socket.on('disconnect',()=>subscribers.delete(socket.id));
 });
 async function notify(event,updated=false){
  if(event.type!=='call')return;const team=await ownerTeam();
  for(const [id,entry] of subscribers){const user=await actor(entry.token);if(!user){subscribers.delete(id);continue;}
   const own=String(event.user).toLowerCase()===user.username.toLowerCase();
   const lead=user.username.toLowerCase()===OWNER&&team===event.data.teamAtSubmission;
   if(own||lead)entry.socket.emit(updated?'call_updated':lead?'fifflaren_call':'my_call',callRow(event));
  }
 }
 const teamOf=user=>String(user?.team||'').trim().toLowerCase();
 const logRow=e=>({id:String(e._id),user:e.user,createdAt:e.createdAt,link:e.data.link,comment:e.data.comment});
 app.get('/api/logs/team',async(req,res)=>{try{const user=await actor(bearer(req));if(!user||!teamOf(user))return res.status(403).json({success:false,message:'Войди в аккаунт своей команды.'});const events=await Event.find({type:'log','data.teamAtSubmission':teamOf(user),'data.verifiedLog':true}).sort({createdAt:-1,_id:-1}).limit(60);res.json({success:true,logs:events.map(logRow)});}catch{res.status(500).json({success:false,message:'Не удалось загрузить ленту'});}});
 app.post('/api/logs',async(req,res)=>{try{const user=await actor(bearer(req));if(!user||!teamOf(user))return res.status(403).json({success:false,message:'Войди в аккаунт своей команды.'});const link=String(req.body.link||'').trim(),comment=String(req.body.comment||'').trim();let url;try{url=new URL(link);}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password||link.length>2048||!comment||comment.length>3000)return res.status(400).json({success:false,message:'Проверь ссылку и описание (до 3000 символов).'});const event=new Event({user:user.username.toLowerCase(),type:'log',date:calendar().day,data:{link,comment,teamAtSubmission:teamOf(user),verifiedLog:true}});await event.save();res.json({success:true,log:logRow(event)});for(const [id,entry]of subscribers){try{const member=await actor(entry.token);if(!member){subscribers.delete(id);continue;}if(teamOf(member)===teamOf(user))entry.socket.emit('team_log',logRow(event));}catch{}}}catch{if(!res.headersSent)res.status(500).json({success:false,message:'Не удалось сохранить лог'});}});
 app.get('/api/calls/mine',async(req,res)=>{
  try{const user=await actor(bearer(req));if(!user)return res.status(403).json({success:false,message:'Войди заново, чтобы увидеть свои колы.'});
   const page=Math.max(0,Math.floor(Number(req.query.page)||0)),limit=100,filter={type:'call',user:user.username.toLowerCase()};
   const [events,total]=await Promise.all([Event.find(filter).sort({createdAt:-1,_id:-1}).skip(page*limit).limit(limit),Event.countDocuments(filter)]);
   res.json({success:true,calls:events.map(callRow),total,hasMore:(page+1)*limit<total});
  }catch(e){res.status(500).json({success:false,message:'Не удалось загрузить колы'});}
 });
 app.patch('/api/fifflaren/calls/:id',async(req,res)=>{
  try{if(!await allowed(bearer(req)))return res.status(403).json({success:false,message:'Изменять статусы может только Fifflaren.'});
   const status=req.body.status,reason=String(req.body.reason||'').trim();
   if(!['pending','done','rejected'].includes(status)||reason.length>500||(status==='rejected'&&!reason)||!(/^[a-f0-9]{24}$/i).test(req.params.id))return res.status(400).json({success:false,message:'Выбери статус; для отклонения укажи причину (до 500 символов).'});
   const team=await ownerTeam();const members=await User.find({team:new RegExp('^'+team.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')},{username:1});
   const filter={_id:req.params.id,type:'call',$or:[{'data.teamAtSubmission':team},{'data.teamAtSubmission':{$exists:false},user:{$in:members.map(m=>m.username)}}]};
   const event=await Event.findOneAndUpdate(filter,{$set:{'data.reviewStatus':status,'data.reviewReason':status==='rejected'?reason:'','data.reviewedAt':new Date(),'data.reviewedBy':OWNER}},{new:true});
   if(!event)return res.status(404).json({success:false,message:'Колл не найден в твоей команде.'});
   await notify(event,true);res.json({success:true,call:callRow(event)});
  }catch(e){res.status(500).json({success:false,message:'Не удалось сохранить статус'});}
 });
 app.get('/api/calls/status',(_req,res)=>res.json({version:'3.27.0',...calendar()}));
 app.get('/api/fifflaren/calls',async(req,res)=>{
  try{
   const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
   if(!await allowed(token))return res.status(403).json({success:false,message:'Войди заново в аккаунт Fifflaren для доступа к личным колам.'});
   const team=await ownerTeam(),date=req.query.date||calendar().day,createdAt=dayBounds(date);
   const members=await User.find({team:new RegExp('^'+team.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')},{username:1});
   const filter={type:'call',createdAt,$or:[{'data.teamAtSubmission':team},{'data.teamAtSubmission':{$exists:false},user:{$in:members.map(m=>m.username)}}]};
   const page=Math.max(0,Math.floor(Number(req.query.page)||0)),limit=200;
   const [events,total]=await Promise.all([Event.find(filter).sort({createdAt:1,_id:1}).skip(page*limit).limit(limit),Event.countDocuments(filter)]);
   res.json({success:true,date,team,total,page,hasMore:(page+1)*limit<total,calls:events.map(callRow),...calendar()});
  }catch(error){res.status(400).json({success:false,message:error.message});}
 });
 return {issue,valid,notify,actor};
};
module.exports.calendar=calendar;module.exports.dayBounds=dayBounds;
