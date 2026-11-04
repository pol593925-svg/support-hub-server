'use strict';
module.exports=function({app,Exchange,authenticate}){
 const auth=req=>authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));
 app.post('/api/exchanges/:id/report',async(req,res)=>{try{
   if(!await auth(req))return res.status(403).json({success:false,message:'Войди в приложение заново.'});
   if(!/^[a-f0-9]{24}$/i.test(req.params.id))return res.sendStatus(400);
   const r=await Exchange.updateOne({_id:req.params.id},{$set:{needsReview:true}});
   if(!r.matchedCount)return res.status(404).json({success:false,message:'Запись не найдена.'});res.json({success:true});
 }catch{res.status(500).json({success:false,message:'Не удалось отправить на пересмотр.'});}});
 app.patch('/api/exchanges/:id/verify',async(req,res)=>{try{
   const user=await auth(req);if(!user||user.role!=='admin')return res.status(403).json({success:false,message:'Нужны права администратора.'});
   const {section}=req.body,condition=String(req.body.condition||'').trim();let u;try{u=new URL(req.body.sourceUrl);}catch{}
   if(!/^[a-f0-9]{24}$/i.test(req.params.id)||!u||u.protocol!=='https:'||u.username||u.password||u.href.length>2048||!['yes','condition','no'].includes(section)||condition.length>1500||(section==='condition'&&!condition))return res.status(400).json({success:false,message:'Укажи HTTPS-источник, ответ и необходимые условия.'});
   const entry=await Exchange.findByIdAndUpdate(req.params.id,{$set:{sourceUrl:u.href,verifiedBy:user.username,verifiedAt:new Date(),section,condition,needsReview:false}},{new:true});
   if(!entry)return res.status(404).json({success:false,message:'Запись не найдена.'});res.json({success:true,entry});
 }catch(e){res.status(e.code===11000?409:500).json({success:false,message:e.code===11000?'В этом разделе уже есть запись с таким названием.':'Не удалось сохранить проверку.'});}});
};
