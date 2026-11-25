'use strict';
const {authorsFor}=require('./call-authors');
const {teamOf}=require('./work-team');
const validLogQuantity=value=>Number.isInteger(value)&&value>=1&&value<=100000;
function linkKey(raw){
  if(typeof raw!=='string'||raw.length>2048)return '';
  try{const u=new URL(raw.trim());return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
function snapshot(data){
  return {kind:data.callType||'',service:data.serviceName||'',link:data.callLink||'',note:data.callNote||'',
    status:data.reviewStatus||'pending',reason:data.reviewReason||'',
    ...(data.requestType==='logs'||data.requestQuantity!==undefined?{quantity:data.requestQuantity}: {})};
}
function versionFilter(n){
  return n===0?{$or:[{'data.reviewVersion':0},{'data.reviewVersion':{$exists:false}}]}:{'data.reviewVersion':n};
}
function install({app,User,Event,actor,bearer,notify,callRow}){
  app.get('/api/work/duplicates',async(req,res)=>{
    try{
      const user=await actor(bearer(req)),team=String(user?.team||'').trim().toLowerCase();
      if(!user)return res.status(403).json({success:false,message:'Войди в приложение заново.'});
      const key=linkKey(req.query.link);if(!key)return res.status(400).json({success:false,message:'Проверь ссылку.'});
      if(!team)return res.json({success:true,matches:[]});
      const url=new URL(key);const aliases=[key,req.query.link.trim()];if(url.pathname==='/'&&!url.search&&!url.hash)aliases.push(key.slice(0,-1));
      const rows=await Event.find({$and:[{$or:[{type:'call'},{type:'log','data.verifiedLog':true}]}],'data.teamAtSubmission':team,
        $or:[{'data.linkKey':key},{'data.callLink':{$in:aliases}},{'data.link':{$in:aliases}}]})
        .sort({createdAt:-1,_id:-1}).limit(5);
      res.json({success:true,matches:rows.map(e=>({id:String(e._id),type:e.type,user:e.user,createdAt:e.createdAt,status:e.type==='log'?'log':(e.data.reviewStatus||'pending')}))});
    }catch{res.status(500).json({success:false,message:'Не удалось проверить ссылку команды.'});}
  });
  app.patch('/api/calls/mine/:id',async(req,res)=>{
    try{
      const user=await actor(bearer(req));if(!user)return res.status(403).json({success:false,message:'Войди в приложение заново.'});
      const id=req.params.id,version=req.body.version,input=req.body;
      if(!/^[a-f0-9]{24}$/i.test(id)||!Number.isInteger(version)||version<0)return res.status(400).json({success:false,message:'Некорректная версия колла.'});
      const at=new Date(),username=user.username.toLowerCase();
      const before=await Event.findOne({_id:id,type:'call',user:username,'data.reviewStatus':'returned',...versionFilter(version)});
      if(!before)return res.status(409).json({success:false,message:'Колл уже изменился. Обнови список.'});
      const network=before.data.requestType==='network',logs=before.data.requestType==='logs';
      if(logs&&teamOf(user)!==before.data.teamAtSubmission)return res.status(403).json({success:false,message:'Заявки доступны сотрудникам команды.'});
      if(logs&&!validLogQuantity(input.quantity))return res.status(400).json({success:false,message:'Укажи целое количество от 1 до 100000.'});
      const service=logs?'Запрос логов · '+input.quantity:network?'Пасы · сеть':String(input.serviceName||'').trim(),link=logs?'':String(input.callLink||'').trim(),note=logs||network?'':String(input.callNote||'').trim(),kind=logs?'Запросить логов':network?'Скачать пасы':String(input.callType||'');
      if((!logs&&!network&&!['Колл на биржу','Колл на почту'].includes(kind))||!service||service.length>160||(!logs&&!linkKey(link))||note.length>3000)
        return res.status(400).json({success:false,message:'Проверь тип, название, ссылку и заметку.'});
      const next={callType:kind,serviceName:service,callLink:link,callNote:note,reviewStatus:'pending',reviewReason:'',reviewedAt:null,reviewedBy:'',...(logs?{requestQuantity:input.quantity}: {})};
      const history=[];if(!(before.data.reviewHistory||[]).some(h=>h.link||h.quantity!==undefined))history.push({action:'previous',by:username,at:before.createdAt,...snapshot(before.data)});
      history.push({action:'resubmitted',by:username,at,...snapshot(next)});
      const row=await Event.findOneAndUpdate({_id:id,type:'call',user:username,'data.reviewStatus':'returned',...versionFilter(version)},
        {$set:{...Object.fromEntries(Object.entries(next).map(([k,v])=>['data.'+k,v])),'data.linkKey':linkKey(link),'data.resubmittedAt':at},
          $inc:{'data.reviewVersion':1},$push:{'data.reviewHistory':{$each:history}}},{new:true});
      if(!row)return res.status(409).json({success:false,message:'Колл уже изменился. Обнови список.'});
      await notify(row,true).catch(()=>{});res.json({success:true,call:callRow(row),authors:await authorsFor(User,[row])});
    }catch{res.status(500).json({success:false,message:'Не удалось вернуть колл на проверку.'});}
  });
}
module.exports={install,linkKey,snapshot,versionFilter,validLogQuantity};
