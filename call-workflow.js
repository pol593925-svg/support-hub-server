'use strict';
function linkKey(raw){
  if(typeof raw!=='string'||raw.length>2048)return '';
  try{const u=new URL(raw.trim());return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
function snapshot(data){
  return {kind:data.callType||'',service:data.serviceName||'',link:data.callLink||'',note:data.callNote||'',
    status:data.reviewStatus||'pending',reason:data.reviewReason||''};
}
function versionFilter(n){
  return n===0?{$or:[{'data.reviewVersion':0},{'data.reviewVersion':{$exists:false}}]}:{'data.reviewVersion':n};
}
function install({app,Event,actor,bearer,notify,callRow}){
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
      const service=String(input.serviceName||'').trim(),link=String(input.callLink||'').trim(),note=String(input.callNote||'').trim(),kind=String(input.callType||'');
      if(!['Колл на биржу','Колл на почту'].includes(kind)||!service||service.length>160||!linkKey(link)||note.length>3000)
        return res.status(400).json({success:false,message:'Проверь тип, название, ссылку и заметку.'});
      const at=new Date(),username=user.username.toLowerCase();
      const next={callType:kind,serviceName:service,callLink:link,callNote:note,reviewStatus:'pending',reviewReason:''};
      const before=await Event.findOne({_id:id,type:'call',user:username,'data.reviewStatus':'returned',...versionFilter(version)});
      if(!before)return res.status(409).json({success:false,message:'Колл уже изменился. Обнови список.'});
      const history=[];if(!(before.data.reviewHistory||[]).some(h=>h.link))history.push({action:'previous',by:username,at:before.createdAt,...snapshot(before.data)});
      history.push({action:'resubmitted',by:username,at,...snapshot(next)});
      const row=await Event.findOneAndUpdate({_id:id,type:'call',user:username,'data.reviewStatus':'returned',...versionFilter(version)},
        {$set:{...Object.fromEntries(Object.entries(next).map(([k,v])=>['data.'+k,v])),'data.linkKey':linkKey(link),'data.resubmittedAt':at},
          $inc:{'data.reviewVersion':1},$push:{'data.reviewHistory':{$each:history}}},{new:true});
      if(!row)return res.status(409).json({success:false,message:'Колл уже изменился. Обнови список.'});
      await notify(row,true).catch(()=>{});res.json({success:true,call:callRow(row)});
    }catch{res.status(500).json({success:false,message:'Не удалось вернуть колл на проверку.'});}
  });
}
module.exports={install,linkKey,snapshot,versionFilter};
