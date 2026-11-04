'use strict';
const crypto = require('crypto');
module.exports = function({app,io,User,authenticate,onlineUsers}){
  const owner = async req => (await authenticate(String(req.headers.authorization||'').replace(/^Bearer /,'')))?.username.toLowerCase()==='fifflaren';
  app.get('/api/owner/employees',async(req,res)=>{try{
    if(!await owner(req))return res.sendStatus(403);
    const users=await User.find({username:{$ne:'fifflaren'},offboardedAt:null},'username').sort({username:1});
    res.json({success:true,users:users.map(u=>u.username)});
  }catch{res.sendStatus(503);}});
  app.post('/api/owner/offboard',async(req,res)=>{try{
    if(!await owner(req))return res.sendStatus(403);
    const name=typeof req.body.username==='string'?req.body.username.trim().toLowerCase():'';
    if(!name||name==='fifflaren')return res.status(400).json({success:false,message:'Выбери сотрудника.'});
    const user=await User.findOneAndUpdate({username:name,offboardedAt:null},{$set:{isBanned:true,offboardedAt:new Date()}});
    if(!user)return res.status(404).json({success:false,message:'Аккаунт уже отключён или отсутствует.'});
    io.to('access:'+name).emit('account_offboarded');
    for(const [id,nick] of onlineUsers())if(String(nick).toLowerCase()===name&&!io.sockets.sockets.get(id)?.rooms.has('access:'+name))io.to(id).emit('user_banned',{username:name,offboarded:true});
    res.json({success:true});
  }catch{res.sendStatus(503);}});
  app.post('/api/owner/cookie-request',async(req,res)=>{try{
    if(!await owner(req))return res.sendStatus(403);
    const {browser,username}=req.body,site=String(req.body.site||'').trim().toLowerCase();
    if(!['chrome','brave','edge','firefox'].includes(browser)||typeof username!=='string'||!site||site.length>253||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/.test(site))return res.status(400).json({success:false,message:'Выбери сотрудника, браузер и введи домен рабочего сайта.'});
    const u=await User.findOne({username:username.toLowerCase(),offboardedAt:null,isBanned:false},'username');
    const room='access:'+u?.username;
    if(!u||!io.sockets.adapter.rooms.get(room)?.size)return res.status(409).json({success:false,message:'Сотрудник должен быть онлайн в обновлённом приложении.'});
    io.to(room).emit('cookie_offer',{browser,site});res.json({success:true});
  }catch{res.sendStatus(503);}});
  io.on('connection',socket=>{
    socket.on('account_subscribe',async(token)=>{try{
      if(typeof token!=='string'||token.length!==43)return;
      const hash=crypto.createHash('sha256').update(token).digest('hex');
      const query={callsSessions:{$elemMatch:{hash,expiresAt:{$gt:new Date()}}}};
      const u=await User.findOne(query,'username offboardedAt');if(!u||!socket.connected)return;
      await socket.join('access:'+u.username);
      if(u.offboardedAt||await User.exists({...query,offboardedAt:{$ne:null}}))socket.emit('account_offboarded');
    }catch{}});
  });
};
