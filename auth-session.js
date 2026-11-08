'use strict';
const crypto=require('node:crypto');
const bearer=req=>{const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'');return match?.[1]||'';};
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
module.exports=function install({app,User,authenticate,now=Date.now}){
 app.get('/api/auth/session',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const token=bearer(req),user=token&&await authenticate(token);
   const session=user?.callsSessions?.find(s=>s.hash===hash(token)&&+new Date(s.expiresAt)>now());
   if(!user||user.isBanned||user.offboardedAt||!session)return res.status(401).json({success:false,message:'Срок действия пропуска истёк. Войди с паролем.'});
   res.json({success:true,username:user.username,role:user.role||'user',team:user.team||'',isMuted:!!user.isMuted,callsToken:token,sessionExpiresAt:+new Date(session.expiresAt)});
  }catch{res.status(503).json({success:false,message:'Не удалось проверить пропуск. Попробуй ещё раз.'});}
 });
 app.post('/api/auth/logout',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{const token=bearer(req);if(token)await User.updateOne({'callsSessions.hash':hash(token)},{$pull:{callsSessions:{hash:hash(token)}}});res.json({success:true});}
  catch{res.status(503).json({success:false,message:'Не удалось завершить сессию на сервере.'});}
 });
};
