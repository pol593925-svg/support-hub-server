'use strict';
const crypto=require('node:crypto');
const OWNER='fifflaren',PAGE_SIZE=40;
const STATUSES=['requested','assigned','active','return_pending','closed','rejected'];
const fail=(status,message)=>Object.assign(new Error(message),{status});
const username=user=>String(user?.username||'').trim().toLowerCase();
const active=user=>!!username(user)&&!user.isBanned&&!user.offboardedAt;
const owner=user=>username(user)===OWNER;
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'});
function kyivToday(now=new Date()){
  const parts=Object.fromEntries(dateFormat.formatToParts(now).map(part=>[part.type,part.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;
}
function input(body,user){
  if(!body||!Number.isSafeInteger(body.quantity)||body.quantity<1||body.quantity>1000000)throw fail(400,'Количество должно быть целым числом от 1 до 1 000 000.');
  if(!validDate(body.startDate)||!validDate(body.dueDate)||body.dueDate<body.startDate)throw fail(400,'Укажи даты: срок возврата не может быть раньше начала.');
  if(body.commitment!==true)throw fail(400,'Подтверди обязательство вернуть указанное количество в срок.');
  if(body.nickname!==undefined&&(typeof body.nickname!=='string'||body.nickname.trim().toLowerCase()!==username(user)))throw fail(400,'Ник должен совпадать с аккаунтом, из которого отправляется заявка.');
  if(body.terms!==undefined&&(typeof body.terms!=='string'||body.terms.length>1500))throw fail(400,'Условия должны быть не длиннее 1500 символов.');
  if(typeof body.requestId!=='string'||! /^[a-zA-Z0-9_-]{16,128}$/.test(body.requestId))throw fail(400,'Открой форму заново и повтори отправку.');
  return {borrower:username(user),quantity:body.quantity,startDate:body.startDate,dueDate:body.dueDate,terms:(body.terms||'').trim(),commitment:true};
}
function overdue(row,today){return ['active','return_pending'].includes(row.status)&&row.dueDate<today;}
function actions(row,user){
  const actor=username(user),list=[];
  if(!active(user))return list;
  if(owner(user)&&row.status==='requested')list.push('assign','reject');
  if(row.lender===actor&&row.status==='assigned')list.push('confirm_issue','decline_issue');
  if(row.borrower===actor&&row.status==='active')list.push('request_return');
  if(row.lender===actor&&row.status==='return_pending')list.push('confirm_return','deny_return');
  return list;
}
function publicLoan(row,user,today){
  const result={id:String(row._id),borrower:row.borrower,lender:row.lender||'',quantity:row.quantity,startDate:row.startDate,dueDate:row.dueDate,
    status:row.status,overdue:overdue(row,today),version:row.version,createdAt:row.createdAt,assignedAt:row.assignedAt||null,issuedAt:row.issuedAt||null,
    returnRequestedAt:row.returnRequestedAt||null,closedAt:row.closedAt||null,rejectedAt:row.rejectedAt||null,commitment:row.commitment===true,actions:actions(row,user)};
  if(owner(user)||[row.borrower,row.lender].includes(username(user))){result.terms=row.terms||'';result.history=row.history||[];}
  return result;
}

function install({app,io,mongoose,User,authenticate}){
  const schema=new mongoose.Schema({
    borrower:{type:String,required:true,immutable:true},lender:{type:String,default:''},quantity:{type:Number,required:true,min:1,max:1000000,immutable:true},
    startDate:{type:String,required:true,immutable:true},dueDate:{type:String,required:true,immutable:true},terms:{type:String,default:'',maxlength:1500,select:false,immutable:true},commitment:{type:Boolean,required:true,immutable:true},
    requestHash:{type:String,required:true,select:false,immutable:true},status:{type:String,enum:STATUSES,default:'requested'},version:{type:Number,default:0},
    createdAt:{type:Date,default:Date.now},assignedAt:Date,issuedAt:Date,returnRequestedAt:Date,closedAt:Date,rejectedAt:Date,
    history:{type:[{at:Date,by:String,action:String,from:String,to:String,reason:String}],default:[],select:false}
  });
  schema.index({createdAt:-1,_id:-1});schema.index({status:1,dueDate:1,createdAt:-1});
  const Loan=mongoose.models?.TruffleLoan||mongoose.model('TruffleLoan',schema);
  const subscribers=new Map(),bearer=req=>String(req.headers.authorization||'').replace(/^Bearer /,'');
  const error=(res,e)=>res.status(e.status||503).json({success:false,message:e.status?e.message:'Не удалось выполнить действие. Повтори попытку.'});
  async function account(req,res){
    res.set?.('Cache-Control','no-store');const user=await authenticate(bearer(req));
    if(!active(user))throw fail(401,'Войди в Support Hub заново.');return user;
  }
  async function notify(row,action,actor){
    let recipients=[];
    if(action==='request')recipients=[OWNER];
    if(action==='assign'||action==='request_return')recipients=[row.lender];
    if(['confirm_issue','decline_issue','confirm_return','deny_return','reject'].includes(action))recipients=[row.borrower,OWNER];
    for(const [id,entry] of subscribers){
      try{
        const user=await authenticate(entry.token);if(!active(user)||entry.socket.connected===false){subscribers.delete(id);continue;}
        const name=username(user);entry.socket.emit('loan_changed',{id:String(row._id),notify:name!==actor&&recipients.includes(name)});
      }catch{}
    }
  }
  io.on('connection',socket=>{
    socket.on('loan_subscribe',async token=>{try{if(active(await authenticate(token))&&socket.connected!==false)subscribers.set(socket.id,{socket,token});}catch{}});
    socket.on('loan_unsubscribe',()=>subscribers.delete(socket.id));
    socket.on('disconnect',()=>subscribers.delete(socket.id));
  });

  app.get('/api/loans/employees',async(req,res)=>{
    try{
      const user=await account(req,res);if(!owner(user))throw fail(403,'Назначать сотрудников может только Fifflaren.');
      const users=await User.find({isBanned:{$ne:true},offboardedAt:null},'username').sort({username:1});
      res.json({success:true,users:users.map(member=>({username:username(member)}))});
    }catch(e){error(res,e);}
  });
  app.get('/api/loans',async(req,res)=>{
    try{
      const user=await account(req,res),today=kyivToday(),status=req.query.status||'all',page=Number(req.query.page||0);
      if(!Number.isSafeInteger(page)||page<0||page>10000||!['all','overdue',...STATUSES].includes(status))throw fail(400,'Проверь фильтр и номер страницы.');
      const filter=status==='all'?{}:status==='overdue'?{status:{$in:['active','return_pending']},dueDate:{$lt:today}}:{status};
      const [rows,total]=await Promise.all([Loan.find(filter).select('+terms +history').sort({createdAt:-1,_id:-1}).skip(page*PAGE_SIZE).limit(PAGE_SIZE),Loan.countDocuments(filter)]);
      res.json({success:true,actor:username(user),isOwner:owner(user),today,page,pageSize:PAGE_SIZE,total,hasMore:(page+1)*PAGE_SIZE<total,loans:rows.map(row=>publicLoan(row,user,today))});
    }catch(e){error(res,e);}
  });
  app.get('/api/loans/:id',async(req,res)=>{
    try{
      const user=await account(req,res);if(!/^[a-f0-9]{24}$/i.test(req.params.id))throw fail(404,'Заявка не найдена.');
      const row=await Loan.findById(req.params.id).select('+terms +history');if(!row)throw fail(404,'Заявка не найдена.');
      res.json({success:true,loan:publicLoan(row,user,kyivToday())});
    }catch(e){error(res,e);}
  });
  app.post('/api/loans',async(req,res)=>{
    let id,hash,user;
    try{
      user=await account(req,res);const fields=input(req.body,user);
      id=crypto.createHash('sha256').update('truffle-loan\0'+username(user)+'\0'+req.body.requestId).digest('hex').slice(0,24);
      hash=crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
      const at=new Date(),row=new Loan({_id:id,...fields,requestHash:hash,status:'requested',version:0,createdAt:at,
        history:[{at,by:username(user),action:'request',from:'',to:'requested',reason:''}]});
      await row.save();await notify(row,'request',username(user));
      res.status(201).json({success:true,loan:publicLoan(row,user,kyivToday()),replayed:false});
    }catch(e){
      if(e?.code===11000&&id&&user){
        try{
          const row=await Loan.findById(id).select('+terms +history +requestHash');
          if(row&&row.borrower===username(user)&&row.requestHash===hash)return res.json({success:true,loan:publicLoan(row,user,kyivToday()),replayed:true});
          return error(res,fail(409,'Эта отправка уже использована для другой заявки. Открой форму заново.'));
        }catch(retryError){return error(res,retryError);}
      }
      error(res,e);
    }
  });
  app.patch('/api/loans/:id',async(req,res)=>{
    try{
      const user=await account(req,res),actor=username(user),{action,version}=req.body||{};
      if(!/^[a-f0-9]{24}$/i.test(req.params.id)||!Number.isSafeInteger(version)||version<0)throw fail(400,'Обнови список: нужна актуальная версия заявки.');
      const row=await Loan.findById(req.params.id).select('+terms +history');if(!row)throw fail(404,'Заявка не найдена.');
      if(row.version!==version)throw fail(409,'Заявка уже изменилась. Обнови список.');
      if(!actions(row,user).includes(action))throw fail(403,'Это действие недоступно для твоего аккаунта или текущего статуса.');
      const at=new Date(),next={},reason=typeof req.body.reason==='string'?req.body.reason.trim():'';
      if(reason.length>500||(['reject','decline_issue','deny_return'].includes(action)&&!reason))throw fail(400,'Укажи причину длиной до 500 символов.');
      if(action==='assign'){
        const lender=typeof req.body.lender==='string'?req.body.lender.trim().toLowerCase():'';
        if(!lender||lender.length>100||lender===row.borrower)throw fail(400,'Выбери действующего сотрудника, который отличается от заёмщика.');
        const member=await User.findOne({username:lender,isBanned:{$ne:true},offboardedAt:null});if(!member)throw fail(400,'Выбранный сотрудник сейчас недоступен.');
        Object.assign(next,{status:'assigned',lender,assignedAt:at});
      }
      if(action==='reject')Object.assign(next,{status:'rejected',rejectedAt:at});
      if(action==='confirm_issue')Object.assign(next,{status:'active',issuedAt:at});
      if(action==='decline_issue')Object.assign(next,{status:'requested',lender:'',assignedAt:null});
      if(action==='request_return')Object.assign(next,{status:'return_pending',returnRequestedAt:at});
      if(action==='confirm_return')Object.assign(next,{status:'closed',closedAt:at});
      if(action==='deny_return')Object.assign(next,{status:'active',returnRequestedAt:null});
      const changed=await Loan.findOneAndUpdate({_id:row._id,version,status:row.status},{$set:next,$inc:{version:1},
        $push:{history:{$each:[{at,by:actor,action,from:row.status,to:next.status,reason}],$slice:-80}}},{new:true}).select('+terms +history');
      if(!changed)throw fail(409,'Заявка уже изменилась. Обнови список.');
      // This ledger records confirmations only. No balances or transfers are changed.
      await notify(changed,action,actor);res.json({success:true,loan:publicLoan(changed,user,kyivToday())});
    }catch(e){error(res,e);}
  });
  return {Loan};
}
module.exports=install;
module.exports.kyivToday=kyivToday;
module.exports.input=input;
module.exports.publicLoan=publicLoan;
module.exports.actions=actions;
