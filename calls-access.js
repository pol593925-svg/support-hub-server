'use strict';
const crypto=require('crypto');
const {teamOf}=require('./work-team');
const {linkKey,snapshot}=require('./call-workflow');
const OWNER='fifflaren';

module.exports=function install({app,User,Event,actor,bearer,ownerTeam,accessFor,subscribers,notify,callRow,calendar}){
  const fail=(res,status,message)=>res.status(status).json({success:false,message});
  async function owner(req,res){
    res.set?.('Cache-Control','no-store');
    const user=await actor(bearer(req));
    if(!user||user.username.toLowerCase()!==OWNER){fail(res,403,'Настраивать доступ может только Fifflaren.');return null;}
    return user;
  }
  async function accessChanged(username){
    const team=await ownerTeam();
    for(const [id,entry] of subscribers){
      const user=await actor(entry.token);
      if(!user){subscribers.delete(id);continue;}
      if(user.username.toLowerCase()===username)entry.socket.emit('calls_access_changed',accessFor(user,team));
    }
  }

  app.get('/api/calls/access',async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try{
      const user=await actor(bearer(req));if(!user)return fail(res,401,'Войди в Support Hub заново.');
      res.json({success:true,...accessFor(user,await ownerTeam())});
    }catch{fail(res,503,'Не удалось проверить доступ к коллам.');}
  });

  app.get('/api/owner/calls-access',async(req,res)=>{
    try{
      if(!await owner(req,res))return;
      const team=await ownerTeam();
      const users=await User.find({username:{$ne:OWNER},isBanned:{$ne:true},offboardedAt:null}).select('username team +callsReviewAccess').sort({username:1});
      res.json({success:true,team:team||'',users:users.map(user=>({username:user.username,team:teamOf(user),canReview:accessFor(user,team).canReview}))});
    }catch{fail(res,503,'Не удалось загрузить список сотрудников.');}
  });

  app.patch('/api/owner/calls-access/:username',async(req,res)=>{
    try{
      if(!await owner(req,res))return;
      const username=typeof req.params.username==='string'?req.params.username.trim().toLowerCase():'';
      if(!username||username.length>100||username===OWNER||typeof req.body.enabled!=='boolean')return fail(res,400,'Выбери сотрудника и состояние доступа.');
      const team=await ownerTeam();if(!team)return fail(res,409,'Команда Fifflaren сейчас недоступна.');
      const at=new Date(),enabled=req.body.enabled;
      const update={
        $set:{callsReviewAccess:enabled?{team,by:OWNER,at}:null},
        $push:{callsReviewAudit:{$each:[{enabled,team,by:OWNER,at}],$slice:-50}}
      };
      const user=await User.findOneAndUpdate({username,isBanned:{$ne:true},offboardedAt:null},update,{new:true}).select('+callsReviewAccess');
      if(!user)return fail(res,404,'Действующий сотрудник не найден.');
      // The grant and its audit trail are written atomically on the same user document.
      await accessChanged(username).catch(()=>{});
      res.json({success:true,username,...accessFor(user,team)});
    }catch{fail(res,503,'Не удалось сохранить доступ. Повтори попытку.');}
  });

  app.post('/api/calls/network-requests',async(req,res)=>{
    let id,user,link,requestId;
    try{
      user=await actor(bearer(req));if(!user)return fail(res,401,'Войди в Support Hub заново.');
      link=typeof req.body.link==='string'?req.body.link.trim():'';
      requestId=typeof req.body.requestId==='string'?req.body.requestId:'';
      if(!linkKey(link)||! /^[a-zA-Z0-9_-]{16,128}$/.test(requestId))return fail(res,400,'Укажи корректную HTTP/HTTPS-ссылку и повтори отправку.');
      const team=await ownerTeam();if(!team)return fail(res,409,'Приём заявок временно недоступен.');
      const username=user.username.toLowerCase();
      // Mongo's existing unique _id index makes retries and concurrent submissions atomic.
      id=crypto.createHash('sha256').update('network-request\0'+username+'\0'+requestId).digest('hex').slice(0,24);
      const data={requestType:'network',requestId,requestOriginalLink:link,callType:'Скачать пасы',serviceName:'Пасы · сеть',
        callLink:link,callNote:'',linkKey:linkKey(link),teamAtSubmission:team,submittedByTeam:teamOf(user),
        reviewStatus:'pending',reviewReason:'',reviewVersion:0};
      const at=new Date();data.reviewHistory=[{action:'submitted',by:username,at,...snapshot(data)}];
      const event=new Event({_id:id,user:username,type:'call',date:calendar().day,createdAt:at,data});
      // The supplied link is stored for manual review. It is never fetched or downloaded.
      await event.save();
      await notify(event).catch(()=>{});
      res.status(201).json({success:true,call:callRow(event),replayed:false});
    }catch(error){
      if(error?.code===11000&&id&&user){
        try{
          const event=await Event.findOne({_id:id,type:'call',user:user.username.toLowerCase(),'data.requestType':'network','data.requestId':requestId});
          if(event&&(event.data.requestOriginalLink||event.data.callLink)===link)return res.json({success:true,call:callRow(event),replayed:true});
          return fail(res,409,'Эта отправка уже использована для другой заявки. Открой форму заново.');
        }catch{}
      }
      fail(res,503,'Не удалось отправить заявку. Повтори попытку — копия не появится.');
    }
  });
};
