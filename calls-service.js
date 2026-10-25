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
  if(user.username.toLowerCase()!==OWNER||user.isBanned)return undefined;
  const token=crypto.randomBytes(32).toString('base64url');
  await User.updateOne({username:OWNER},{$push:{callsSessions:{$each:[{hash:hash(token),expiresAt:new Date(Date.now()+30*86400000)}],$slice:-8}}});
  return token;
 }
 async function valid(token){
  if(typeof token!=='string'||token.length!==43)return false;
  const owner=await User.findOne({username:OWNER}).select('+callsSessions');
  return !!owner&&!owner.isBanned&&(owner.callsSessions||[]).some(s=>s.hash===hash(token)&&+new Date(s.expiresAt)>Date.now());
 }
 async function ownerTeam(){const owner=await User.findOne({username:OWNER});return owner&&!owner.isBanned?(owner.team||OWNER).trim().toLowerCase():null;}
 async function allowed(token){return await valid(token)&&!!await ownerTeam();}
 function callRow(ev){return {id:String(ev._id),user:ev.user,createdAt:ev.createdAt,service:ev.data.serviceName||'',kind:ev.data.callType||'',link:ev.data.callLink||'',note:ev.data.callNote||''};}
 const subscribers=new Map();
 io.on('connection',socket=>{
  socket.on('calls_subscribe',async token=>{try{if(await allowed(token)&&socket.connected!==false)subscribers.set(socket.id,{socket,token});}catch{}});
  socket.on('calls_unsubscribe',()=>subscribers.delete(socket.id));
  socket.on('disconnect',()=>subscribers.delete(socket.id));
 });
 async function notify(event){
  if(event.type!=='call')return;
  const team=await ownerTeam();if(!team||event.data.teamAtSubmission!==team)return;
  for(const [id,entry] of subscribers){if(!await valid(entry.token)){subscribers.delete(id);continue;}entry.socket.emit('fifflaren_call',callRow(event));}
 }
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
 return {issue,valid,notify};
};
module.exports.calendar=calendar;module.exports.dayBounds=dayBounds;
