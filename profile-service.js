'use strict';
const {teamOf}=require('./work-team');
const STATUSES=new Set(['available','break','dnd']);
const AVATAR_LIMIT=400000;
const bearer=req=>/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'')?.[1]||'';
const monthFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit'});
const labelFormatter=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kyiv',year:'numeric',month:'long'});
const offsetFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Kyiv',timeZoneName:'shortOffset'});

function monthBounds(time=Date.now()){
  const date=new Date(time),parts=Object.fromEntries(monthFormatter.formatToParts(date).map(part=>[part.type,part.value]));
  const year=Number(parts.year),month=Number(parts.month),days=new Date(Date.UTC(year,month,0)).getUTCDate();
  const prefix=parts.year+'-'+parts.month;
  return {from:prefix+'-01',to:prefix+'-'+String(days).padStart(2,'0'),label:labelFormatter.format(date),timezone:'Europe/Kyiv'};
}
function kyivMidnight(day){
  const utc=Date.parse(day+'T00:00:00Z');
  const offset=/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetFormatter.formatToParts(new Date(utc)).find(part=>part.type==='timeZoneName').value);
  if(!offset)throw Error('Unknown Kyiv offset');
  return new Date(utc-(offset[1]==='-'?-1:1)*(Number(offset[2])*60+Number(offset[3]||0))*60000);
}
function validAvatar(value){
  if(value==='')return true;
  if(typeof value!=='string'||value.length>AVATAR_LIMIT)return false;
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[2].length%4!==0)return false;
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.toString('base64')!==match[2])return false;
  if(match[1]==='jpeg')return bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
  if(match[1]==='png')return bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR';
  return bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16));
}
function updates(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Укажи изменения профиля.');
  const keys=Object.keys(body);
  if(!keys.length||keys.some(key=>!['avatar','telegram','status'].includes(key)))throw Error('Можно изменить только фото, Telegram и статус своего профиля.');
  const result={};
  if(Object.hasOwn(body,'avatar')){
    if(!validAvatar(body.avatar))throw Error('Выбери фото JPEG, PNG или WebP размером до 300 КБ после сжатия.');
    result.avatar=body.avatar;
  }
  if(Object.hasOwn(body,'telegram')){
    if(typeof body.telegram!=='string')throw Error('Укажи Telegram в формате @username.');
    const telegram=body.telegram.trim().replace(/^@/,'');
    if(telegram&&!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(telegram))throw Error('Telegram: от 5 до 32 латинских букв, цифр или _, первая — буква.');
    result.telegram=telegram;
  }
  if(Object.hasOwn(body,'status')){
    if(!STATUSES.has(body.status))throw Error('Выбери статус «На связи», «Перерыв» или «Не беспокоить».');
    result.status=body.status;
  }
  return result;
}
function eventPipeline(username,bounds){
  const isShift={$eq:['$type','shift']};
  return [
    {$match:{user:username,date:{$gte:bounds.from,$lte:bounds.to},type:{$in:['shift','log']}}},
    {$set:{_profileDuration:{$regexFind:{input:{$convert:{input:'$data.duration',to:'string',onError:'',onNull:''}},regex:'^\\s*(\\d{1,6})\\s*ч\\.?\\s*(\\d{1,2})\\s*мин\\.?\\s*$'}}}},
    {$group:{_id:null,
      shifts:{$sum:{$cond:[isShift,1,0]}},
      logs:{$sum:{$cond:[{$eq:['$type','log']},1,0]}},
      workedMinutes:{$sum:{$cond:[{$and:[isShift,{$ne:['$_profileDuration',null]}]},
        {$add:[{$multiply:[{$convert:{input:{$arrayElemAt:['$_profileDuration.captures',0]},to:'int',onError:0,onNull:0}},60]},{$convert:{input:{$arrayElemAt:['$_profileDuration.captures',1]},to:'int',onError:0,onNull:0}}]},0]}},
      durationUnknownShifts:{$sum:{$cond:[{$and:[isShift,{$eq:['$_profileDuration',null]}]},1,0]}}
    }}
  ];
}
async function monthlyStats({Event,DailyStat,username,time}){
  const bounds=monthBounds(time);
  const nextMonth=new Date(Date.parse(bounds.to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const [events,daily,closedCalls]=await Promise.all([
    Event.aggregate(eventPipeline(username,bounds)),
    DailyStat.aggregate([{$match:{username,date:{$gte:bounds.from,$lte:bounds.to}}},{$group:{_id:null,truffles:{$sum:'$truffles'},approves:{$sum:'$approves'}}}]),
    Event.countDocuments({user:username,type:'call','data.reviewStatus':'done','data.reviewedAt':{$gte:kyivMidnight(bounds.from),$lt:kyivMidnight(nextMonth)}})
  ]);
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:0;
  return {...bounds,shifts:number(events[0]?.shifts),logs:number(events[0]?.logs),workedMinutes:number(events[0]?.workedMinutes),
    closedCalls:number(closedCalls),durationUnknownShifts:number(events[0]?.durationUnknownShifts),
    truffles:number(daily[0]?.truffles),approves:number(daily[0]?.approves),recordedShiftsOnly:true};
}
function publicProfile(user){
  return {username:user.username,team:teamOf(user),position:user.position||'',avatar:user.avatar||'',telegram:user.telegram||'',status:STATUSES.has(user.status)?user.status:'available'};
}
module.exports=function install({app,User,Event,DailyStat,authenticate,now=Date.now}){
  const fail=(res,status,message)=>res.status(status).json({success:false,message});
  async function actor(req,res){
    res.set?.('Cache-Control','no-store');
    const token=bearer(req),user=token&&await authenticate(token);
    if(!user||!user.username||user.isBanned||user.offboardedAt){fail(res,401,'Войди в Support Hub заново.');return null;}
    return user;
  }
  async function present(user){
    const profile=publicProfile(user);
    try{profile.month=await monthlyStats({Event,DailyStat,username:user.username.toLowerCase(),time:now()});}
    catch{profile.month=null;profile.statsUnavailable=true;}
    return profile;
  }
  app.get('/api/profile/me',async(req,res)=>{
    try{
      const user=await actor(req,res);if(!user)return;
      res.json({success:true,profile:await present(user)});
    }catch{fail(res,503,'Не удалось загрузить профиль. Повтори попытку.');}
  });
  async function save(req,res,legacy=false){
    try{
      const user=await actor(req,res);if(!user)return;
      let patch;
      try{
        if(legacy){
          if(typeof req.body?.username!=='string'||req.body.username.trim().toLowerCase()!==user.username.toLowerCase())return fail(res,403,'Можно изменить только свой профиль.');
          patch=updates({avatar:req.body.avatar});
        }else patch=updates(req.body);
      }catch(error){return fail(res,400,error.message);}
      // Atomic partial update keeps a concurrent status change from overwriting a new avatar.
      const next=await User.findOneAndUpdate({username:user.username.toLowerCase(),isBanned:{$ne:true},offboardedAt:null},{$set:patch},{new:true,runValidators:true});
      if(!next)return fail(res,401,'Аккаунт недоступен. Войди в Support Hub заново.');
      res.json({success:true,profile:await present(next)});
    }catch{fail(res,503,'Не удалось сохранить профиль. Повтори попытку.');}
  }
  app.patch('/api/profile/me',(req,res)=>save(req,res));
  // Older avatar controls must authenticate as the owner too; body.username is never authority.
  app.post('/api/profile',(req,res)=>save(req,res,true));
};
module.exports.monthBounds=monthBounds;
module.exports.validAvatar=validAvatar;
module.exports.updates=updates;
module.exports.eventPipeline=eventPipeline;
module.exports.monthlyStats=monthlyStats;
