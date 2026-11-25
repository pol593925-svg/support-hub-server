const crypto=require('crypto'),workflow=require('./call-workflow');
const {teamOf,requireTeam}=require('./work-team');
const {authorsFor,avatar}=require('./call-authors');
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
  if(!user.username||user.isBanned||user.offboardedAt)return undefined;
  const token=crypto.randomBytes(32).toString('base64url');
  await User.updateOne({username:user.username.toLowerCase()},{$push:{callsSessions:{$each:[{hash:hash(token),expiresAt:new Date(Date.now()+30*86400000)}],$slice:-8}}});
  return token;
 }
 async function valid(token){
  if(typeof token!=='string'||token.length!==43)return false;
  const owner=await User.findOne({username:OWNER}).select('+callsSessions');
  return !!owner&&!owner.isBanned&&!owner.offboardedAt&&(owner.callsSessions||[]).some(s=>s.hash===hash(token)&&+new Date(s.expiresAt)>Date.now());
 }
 async function actor(token){
  if(typeof token!=='string'||token.length!==43)return null;
  const user=await User.findOne({'callsSessions.hash':hash(token)}).select('+callsSessions +callsReviewAccess');
  return user&&!user.isBanned&&!user.offboardedAt&&(user.callsSessions||[]).some(s=>s.hash===hash(token)&&+new Date(s.expiresAt)>Date.now())?user:null;
 }
 const bearer=req=>String(req.headers.authorization||'').replace(/^Bearer /,'');
 async function ownerTeam(){const owner=await User.findOne({username:OWNER});return owner&&!owner.isBanned&&!owner.offboardedAt?teamOf(owner):null;}
 function accessFor(user,team){
  const isOwner=!!user&&user.username.toLowerCase()===OWNER;
  const grant=user?.callsReviewAccess;
  return {isOwner,canReview:!!user&&!user.isBanned&&!user.offboardedAt&&!!team&&(isOwner||(grant?.by===OWNER&&grant.team===team)),team:team||''};
 }
 async function reviewActor(token){const user=await actor(token),team=await ownerTeam();return accessFor(user,team).canReview?{user,team}:null;}
 function callRow(ev){return {id:String(ev._id),user:ev.user,createdAt:ev.createdAt,service:ev.data.serviceName||'',kind:ev.data.callType||'',link:ev.data.callLink||'',note:ev.data.callNote||'',requestType:['network','logs'].includes(ev.data.requestType)?ev.data.requestType:'call',...(ev.data.requestType==='logs'?{quantity:ev.data.requestQuantity}:{}),status:['done','rejected','returned'].includes(ev.data.reviewStatus)?ev.data.reviewStatus:'pending',reason:ev.data.reviewReason||'',reviewedAt:ev.data.reviewedAt||null,reviewedBy:ev.data.reviewedBy||'',version:ev.data.reviewVersion||0,history:ev.data.reviewHistory||[]};}
 const subscribers=new Map();
 io.on('connection',socket=>{
  socket.on('calls_subscribe',async token=>{try{if(await actor(token)&&socket.connected!==false)subscribers.set(socket.id,{socket,token});}catch{}});
  socket.on('calls_unsubscribe',()=>subscribers.delete(socket.id));
  socket.on('disconnect',()=>subscribers.delete(socket.id));
 });
 async function notify(event,updated=false){
  if(event.type!=='call')return;const team=await ownerTeam();
  const authors=await authorsFor(User,[event]),row={...callRow(event),avatar:authors[String(event.user).toLowerCase()]?.avatar||''};
  for(const [id,entry] of subscribers){const user=await actor(entry.token);if(!user){subscribers.delete(id);continue;}
   const own=String(event.user).toLowerCase()===user.username.toLowerCase();
   const lead=accessFor(user,team).canReview&&team===event.data.teamAtSubmission;
   if(own||lead)entry.socket.emit(updated?'call_updated':lead?'fifflaren_call':'my_call',row);
  }
 }
 require('./calls-access')({app,User,Event,actor,bearer,ownerTeam,accessFor,subscribers,notify,callRow,calendar});
 require('./log-requests')({app,Event,actor,bearer,ownerTeam,notify,callRow,calendar});

 const logRow=e=>({id:String(e._id),user:e.user,createdAt:e.createdAt,link:e.data.link,comment:e.data.comment});
 app.get('/api/logs/team',async(req,res)=>{try{const user=await actor(bearer(req));if(!requireTeam(user,res))return;const events=await Event.find({type:'log','data.teamAtSubmission':teamOf(user),'data.verifiedLog':true}).sort({createdAt:-1,_id:-1}).limit(60);res.json({success:true,logs:events.map(logRow),authors:await authorsFor(User,events)});}catch{res.status(500).json({success:false,message:'Не удалось загрузить ленту'});}});
 app.post('/api/logs',async(req,res)=>{try{const user=await actor(bearer(req));if(!requireTeam(user,res))return;const link=String(req.body.link||'').trim(),comment=String(req.body.comment||'').trim();let url;try{url=new URL(link);}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password||link.length>2048||!comment||comment.length>3000)return res.status(400).json({success:false,message:'Проверь ссылку и описание (до 3000 символов).'});const event=new Event({user:user.username.toLowerCase(),type:'log',date:calendar().day,data:{link,linkKey:workflow.linkKey(link),comment,teamAtSubmission:teamOf(user),verifiedLog:true}});await event.save();const row={...logRow(event),avatar:avatar(user.avatar)};res.json({success:true,log:row});for(const [id,entry]of subscribers){try{const member=await actor(entry.token);if(!member){subscribers.delete(id);continue;}if(teamOf(member)===teamOf(user))entry.socket.emit('team_log',row);}catch{}}}catch{if(!res.headersSent)res.status(500).json({success:false,message:'Не удалось сохранить лог'});}});
 app.get('/api/calls/mine',async(req,res)=>{
  try{const user=await actor(bearer(req));if(!user)return res.status(403).json({success:false,message:'Войди заново, чтобы увидеть свои колы.'});
   const page=Math.max(0,Math.floor(Number(req.query.page)||0)),limit=100,filter={type:'call',user:user.username.toLowerCase()};
   const [events,total]=await Promise.all([Event.find(filter).sort({createdAt:-1,_id:-1}).skip(page*limit).limit(limit),Event.countDocuments(filter)]);
   res.json({success:true,calls:events.map(callRow),authors:await authorsFor(User,events),total,hasMore:(page+1)*limit<total});
  }catch(e){res.status(500).json({success:false,message:'Не удалось загрузить колы'});}
 });
 app.patch('/api/fifflaren/calls/:id',async(req,res)=>{
  try{const reviewer=await reviewActor(bearer(req));if(!reviewer)return res.status(403).json({success:false,message:'Нет доступа к коллам команды.'});
   const status=req.body.status,reason=String(req.body.reason||'').trim();
   if(!['pending','done','rejected','returned'].includes(status)||reason.length>500||(['returned','rejected'].includes(status)&&!reason)||!(/^[a-f0-9]{24}$/i).test(req.params.id))return res.status(400).json({success:false,message:'Выбери статус; для отклонения укажи причину (до 500 символов).'});
   const {team,user}=reviewer;const reviewedBy=user.username.toLowerCase();const members=await User.find({team:new RegExp('^'+team.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')},{username:1});
   const filter={_id:req.params.id,type:'call',$or:[{'data.teamAtSubmission':team},{'data.teamAtSubmission':{$exists:false},user:{$in:members.map(m=>m.username)}}]};
   const at=new Date(),note=['returned','rejected'].includes(status)?reason:'';
   if(req.body.version!==undefined||reviewedBy!==OWNER){if(!Number.isInteger(req.body.version)||req.body.version<0)return res.status(400).json({success:false,message:'Обнови список: нужна актуальная версия колла.'});filter.$and=[workflow.versionFilter(req.body.version)];}
   const event=await Event.findOneAndUpdate(filter,{$set:{'data.reviewStatus':status,'data.reviewReason':note,'data.reviewedAt':at,'data.reviewedBy':reviewedBy},
     $inc:{'data.reviewVersion':1},$push:{'data.reviewHistory':{action:'review',by:reviewedBy,at,status,reason:note}}},{new:true});
   if(!event)return res.status(req.body.version===undefined?404:409).json({success:false,message:'Колл уже изменился или недоступен. Обнови список.'});
   await notify(event,true).catch(()=>{});res.json({success:true,call:callRow(event),authors:await authorsFor(User,[event])});
  }catch(e){res.status(500).json({success:false,message:'Не удалось сохранить статус'});}
 });
 app.get('/api/calls/status',(_req,res)=>res.json({version:'3.27.0',...calendar()}));
 app.get('/api/fifflaren/calls',async(req,res)=>{
  try{
   const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
   const reviewer=await reviewActor(token);if(!reviewer)return res.status(403).json({success:false,message:'Нет доступа к коллам команды.'});
   const team=reviewer.team,date=req.query.date||calendar().day,createdAt=dayBounds(date);
   const members=await User.find({team:new RegExp('^'+team.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')},{username:1});
   const filter={type:'call',createdAt,$or:[{'data.teamAtSubmission':team},{'data.teamAtSubmission':{$exists:false},user:{$in:members.map(m=>m.username)}}]};
   const page=Math.max(0,Math.floor(Number(req.query.page)||0)),limit=200;
   const [events,total]=await Promise.all([Event.find(filter).sort({createdAt:1,_id:1}).skip(page*limit).limit(limit),Event.countDocuments(filter)]);
   res.json({success:true,date,team,total,page,hasMore:(page+1)*limit<total,calls:events.map(callRow),authors:await authorsFor(User,events),...calendar()});
  }catch(error){res.status(400).json({success:false,message:error.message});}
 });
 workflow.install({app,User,Event,actor,bearer,notify,callRow});
 return {issue,valid,notify,actor};
};
module.exports.calendar=calendar;module.exports.dayBounds=dayBounds;
