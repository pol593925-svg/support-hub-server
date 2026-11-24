'use strict';
const {teamOf}=require('./work-team');
const OWNER='fifflaren';
const name=user=>String(user?.username||'').trim().toLowerCase();
const active=user=>!!name(user)&&!user.isBanned&&!user.offboardedAt;

module.exports=function install({app,User,Event,Loan,authenticate,onlineUsers}){
  app.get('/api/owner/dashboard',async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try{
      const owner=await authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));
      if(!active(owner))return res.status(401).json({success:false,message:'Войди в Support Hub заново.'});
      if(name(owner)!==OWNER)return res.status(403).json({success:false,message:'Обзор доступен только Fifflaren.'});
      const team=teamOf(owner);
      // Only roster metadata is read. Passwords, sessions and personal contact data are excluded.
      const roster=await User.find({}).select('username team isBanned offboardedAt +callsReviewAccess').lean();
      const members=roster.filter(user=>teamOf(user)===team).map(name);
      const pending={type:'call','data.reviewStatus':{$nin:['done','rejected','returned']},$or:[
        {'data.teamAtSubmission':team},{'data.teamAtSubmission':{$exists:false},user:{$in:members}}
      ]};
      const [callCounts,calls,loanCounts,loans]=await Promise.all([
        Event.aggregate([{$match:pending},{$group:{_id:{$cond:[{$eq:['$data.requestType','network']},'network','call']},count:{$sum:1}}}]),
        Event.find(pending).select('user createdAt data.serviceName data.callType data.requestType').sort({createdAt:-1,_id:-1}).limit(8).lean(),
        Loan.aggregate([{$match:{status:'requested'}},{$group:{_id:null,count:{$sum:1},points:{$sum:'$quantity'}}}]),
        Loan.find({status:'requested'}).select('borrower quantity createdAt').sort({createdAt:-1,_id:-1}).limit(8).lean()
      ]);
      const connected=new Set(Array.from(onlineUsers().values(),value=>String(value).trim().toLowerCase()));
      const employees=roster.filter(user=>active(user)&&(name(user)===OWNER||teamOf(user)===team)).map(user=>({
        username:user.username,team:teamOf(user),online:connected.has(name(user)),
        canReview:name(user)===OWNER||(user.callsReviewAccess?.by===OWNER&&user.callsReviewAccess.team===team)
      })).sort((a,b)=>Number(b.online)-Number(a.online)||a.username.localeCompare(b.username,'ru'));
      const requests=[...calls.map(row=>({id:String(row._id),kind:row.data?.requestType==='network'?'network':'call',
        title:row.data?.requestType==='network'?'Скачать пасы':row.data?.serviceName||row.data?.callType||'Новый колл',
        username:row.user,createdAt:row.createdAt,status:'pending',
        // Match the existing call inbox's +03:00 day boundary, including requests close to midnight.
        date:new Date(+new Date(row.createdAt)+3*3600000).toISOString().slice(0,10)})),
        ...loans.map(row=>({id:String(row._id),kind:'loan',title:'Заявка на трюфели',username:row.borrower,
          createdAt:row.createdAt,status:'requested',quantity:row.quantity}))]
        .sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)||b.id.localeCompare(a.id)).slice(0,8);
      const count=kind=>callCounts.find(row=>row._id===kind)?.count||0;
      res.json({success:true,isOwner:true,updatedAt:new Date(),stats:{pendingCalls:count('call'),pendingNetwork:count('network'),
        pendingLoans:loanCounts[0]?.count||0,requestedPoints:loanCounts[0]?.points||0,
        onlineEmployees:employees.filter(user=>user.online).length,totalEmployees:employees.length},requests,employees:employees.slice(0,12)});
    }catch{
      res.status(503).json({success:false,message:'Не удалось обновить обзор. Повтори попытку.'});
    }
  });
};
