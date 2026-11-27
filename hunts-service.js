'use strict';
const crypto=require('node:crypto');
const {teamOf}=require('./work-team');
const LIMIT=20;
function cleanUrl(value){
 const raw=typeof value==='string'?value.trim():'';if(!raw||raw.length>2048)return null;
 try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;return url.href;}catch{return null;}
}
function rows(user){return [...(user?.hunts||[])].sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)).map(h=>({id:String(h._id),url:h.url,note:h.note,createdAt:h.createdAt}));}
module.exports=function install({app,User,actor,reviewActor}){
 const bearer=req=>String(req.headers.authorization||'').replace(/^Bearer /,'');
 const fail=(res,status,message)=>res.status(status).json({success:false,message});
 const noStore=res=>res.set?.('Cache-Control','no-store');
 app.get('/api/hunts/mine',async(req,res)=>{
  noStore(res);try{const user=await actor(bearer(req));if(!user)return fail(res,401,'Войди в Support Hub заново.');
   const stored=await User.findOne({username:user.username.toLowerCase()}).select('+hunts');res.json({success:true,hunts:rows(stored),limit:LIMIT});
  }catch{fail(res,503,'Не удалось загрузить ханты. Повтори попытку.');}
 });
 app.post('/api/hunts/mine',async(req,res)=>{
  noStore(res);try{const user=await actor(bearer(req));if(!user)return fail(res,401,'Войди в Support Hub заново.');
   const url=cleanUrl(req.body.url),note=typeof req.body.note==='string'?req.body.note.trim():'';
   if(!url||!note||note.length>300)return fail(res,400,'Добавь HTTP/HTTPS-ссылку и краткую информацию до 300 символов.');
   const entry={_id:crypto.randomBytes(12).toString('hex'),url,note,createdAt:new Date()};
   const stored=await User.findOneAndUpdate({username:user.username.toLowerCase(),isBanned:{$ne:true},offboardedAt:null,'hunts.19':{$exists:false}},{$push:{hunts:entry}},{new:true}).select('+hunts');
   if(!stored)return fail(res,409,'Уже сохранено 20 хантов. Удали лишний, чтобы добавить новый.');
   res.status(201).json({success:true,hunts:rows(stored),limit:LIMIT});
  }catch{fail(res,503,'Не удалось сохранить хант. Повтори попытку.');}
 });
 app.delete('/api/hunts/mine/:id',async(req,res)=>{
  noStore(res);try{const user=await actor(bearer(req));if(!user)return fail(res,401,'Войди в Support Hub заново.');
   const id=String(req.params.id||'');if(!/^[a-f0-9]{24}$/i.test(id))return fail(res,400,'Некорректный идентификатор ханта.');
   const stored=await User.findOneAndUpdate({username:user.username.toLowerCase(),'hunts._id':id},{$pull:{hunts:{_id:id}}},{new:true}).select('+hunts');
   if(!stored)return fail(res,404,'Этот хант уже удалён. Обнови список.');
   res.json({success:true,hunts:rows(stored),limit:LIMIT});
  }catch{fail(res,503,'Не удалось удалить хант. Повтори попытку.');}
 });
 app.get('/api/fifflaren/hunts/:username',async(req,res)=>{
  noStore(res);try{const reviewer=await reviewActor(bearer(req));if(!reviewer)return fail(res,403,'Нет доступа к коллам и хантам команды.');
   const username=String(req.params.username||'').trim().toLowerCase();if(!username||username.length>100)return fail(res,400,'Выбери сотрудника.');
   const target=await User.findOne({username,isBanned:{$ne:true},offboardedAt:null}).select('+hunts');
   if(!target||teamOf(target)!==reviewer.team)return fail(res,404,'Сотрудник не найден в твоей команде.');
   res.json({success:true,username:target.username,hunts:rows(target),limit:LIMIT});
  }catch{fail(res,503,'Не удалось загрузить ханты сотрудника.');}
 });
};
module.exports.cleanUrl=cleanUrl;module.exports.rows=rows;module.exports.LIMIT=LIMIT;
