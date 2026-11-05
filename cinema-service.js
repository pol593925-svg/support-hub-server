'use strict';
const media=require('./radio-media');
const empty=()=>({rev:0,title:'',film:null,startsAt:0,position:0,playing:false,anchor:0});
function view(show,now=Date.now()){
  const scheduled=show.startsAt>0,future=scheduled&&now<show.startsAt;
  const runtime=scheduled?(future?0:(now-show.startsAt)/1000):show.position+(show.playing?Math.max(0,now-show.anchor)/1000:0);
  const position=show.film?Math.min(show.film.duration,runtime):0;
  const playing=!!show.film&&!future&&(scheduled||show.playing)&&position<show.film.duration;
  return {...show,now,position,playing,phase:future?'countdown':!show.film?'waiting':position>=show.film.duration?'ended':playing?'playing':'paused'};
}
function install({io,app,mongoose,authenticate}){
  const db=mongoose.connection,shows=db.collection('cinema_show'),films=db.collection('cinema_tracks'),chat=db.collection('cinema_chat');
  const readShow=async(key='live')=>await shows.findOne({_id:key})||empty();
  const fail=(status,message)=>Object.assign(Error(message),{status});
  const error=(res,e)=>res.status(e.status||503).json({success:false,message:e.status?e.message:/quota|space limit/i.test(e.message)?'Хранилище для фильмов заполнено.':'Кинотеатр временно недоступен.'});
  const guard=owner=>async(req,res,next)=>{try{
    const user=await authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));
    if(!user)throw fail(401,'Войди в Support Hub заново.');
    if(owner&&user.username.toLowerCase()!=='fifflaren')throw fail(403,'Эфиром управляет Fifflaren.');
    req.cinemaUser=user.username;req.cinemaOwner=user.username.toLowerCase()==='fifflaren';next();
  }catch(e){error(res,e);}};
  require('./cinema-snacks').install({app,mongoose,guard,error});
  const vip=require('./cinema-vip').create({app,mongoose,guard,error});
  const origin=require('./cinema-origin').create({io,mongoose,authenticate});
  media.create({mongoose,app,kind:'cinema',guard,error,origin,mayWatch:async(req,id)=>{
    if(req.cinemaOwner||(await readShow()).film?.id===id)return true;
    const grant=await vip.access(req.cinemaUser,req.headers['x-cinema-vip']);
    if(!grant||(await readShow('vip')).film?.id!==id)return false;
    req.mediaTicketExpires=grant.expires;return true;
  }});
  async function selectFilm(id){
    if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))throw fail(400,'Выбери фильм из библиотеки.');
    const local=await origin.find(id);if(local)return local;
    const row=await films.findOne({_id:id,ready:true});if(!row)throw fail(404,'Фильм не найден.');
    return {id:row._id,title:row.title,duration:row.duration};
  }
  app.delete('/api/cinema/library/:id',guard(true),async(req,res)=>{try{
    await origin.run(async()=>{
      const id=req.params.id;if(!/^[0-9a-f]{24}$/.test(id))throw fail(400,'Неверный фильм.');
      if(await shows.findOne({_id:{$in:['live','vip']},'film.id':id}))throw fail(409,'Сначала сними фильм с афиши, затем удали его из библиотеки.');
      if(await origin.find(id)){await origin.remove(id);return;}
      const old=await films.findOne({_id:id});if(!old)return;
      if(!/^[a-f0-9]{32}$/.test(old.series))throw fail(409,'Не удалось определить части фильма.');
      await db.collection('cinema_parts').deleteMany({_id:{$gte:old.series+':',$lt:old.series+';'}});
      await films.deleteOne({_id:id,series:old.series});
    });res.json({success:true});
  }catch(e){error(res,e);}});
  function installRoom(key,privateRoom){
    const ns=io.of(privateRoom?'/cinema-vip':'/cinema'),posters=io.of(privateRoom?'/cinema-vip-posters':'/cinema-posters');
    const read=()=>readShow(key),chatKey=privateRoom?'vip':'room',prefix='/api/cinema'+(privateRoom?'/vip':'');
    const protect=privateRoom?vip.protect:(_req,_res,next)=>next();
    function expiry(socket){
      if(!socket.data.vipExpires)return;
      const timer=setTimeout(()=>{socket.emit('room_error','Время доступа истекло. Введи пароль VIP-ложи снова.');socket.disconnect(true);},Math.max(1,socket.data.vipExpires-Date.now()));
      timer.unref?.();socket.once('disconnect',()=>clearTimeout(timer));
    }
    function audience(){ns.emit('audience',[...new Set([...ns.sockets.values()].map(s=>s.data.nick))].sort());}
    app.get(prefix+'/state',guard(false),protect,async(req,res)=>{try{res.set('Cache-Control','no-store').json(view(await read()));}catch(e){error(res,e);}});
    app.post(prefix+'/control',guard(true),protect,async(req,res)=>{try{await origin.run(async()=>{
      const old=await read(),now=Date.now(),live=view(old,now),cmd=req.body||{};
      if(old.rev!==cmd.rev)throw fail(409,'Афиша изменилась. Обнови показ и попробуй ещё раз.');
      let {title,film,position,playing}=live,startsAt=0;
      if(cmd.op==='schedule'){
        film=cmd.film?await selectFilm(cmd.film):null;
        title=String(cmd.title||film?.title||'').trim();if(!title||title.length>160)throw fail(400,'Укажи название до 160 символов.');
        if(!Number.isInteger(cmd.minutes)||cmd.minutes<0||cmd.minutes>43200)throw fail(400,'Укажи задержку от 0 до 43200 минут.');
        startsAt=now+cmd.minutes*60000;position=0;playing=false;
      }else if(cmd.op==='attach'){
        if(!old.title||old.film)throw fail(409,'Выбери анонс без видео.');
        film=await selectFilm(cmd.film);startsAt=Math.max(old.startsAt,now);position=0;playing=false;
      }else if(cmd.op==='clear'){title='';film=null;position=0;playing=false;}
      else{
        if(!film)throw fail(409,'Сначала выбери фильм.');
        if(cmd.op==='play'){playing=true;if(position>=film.duration)position=0;}
        else if(cmd.op==='pause'){playing=false;}
        else if(cmd.op==='seek'&&Number.isFinite(cmd.position)){position=Math.max(0,Math.min(film.duration,cmd.position));if(live.phase==='countdown')throw fail(409,'Сначала начни показ.');}
        else throw fail(400,'Неизвестное действие.');
      }
      const update={rev:old.rev+1,title,film,startsAt,position,playing,anchor:now};
      if(cmd.op==='schedule')update.poster={id:update.rev,title,startsAt};
      else if(cmd.op==='clear')update.poster=null;
      let result;try{result=await shows.updateOne({_id:key,rev:old.rev},{$set:update},{upsert:old.rev===0});}catch(e){if(e.code!==11000)throw e;}
      if(!result?.matchedCount&&!result?.upsertedCount)throw fail(409,'Управление уже изменилось.');
      const state=view(update);ns.emit('show',state);
      if(cmd.op==='schedule')posters.emit('poster',{...update.poster,phase:state.phase});
      res.json(state);
    });}catch(e){error(res,e);}});
    const authorize=async(socket,next)=>{try{const u=await authenticate(socket.handshake.auth?.token);if(!u)return next(Error('Войди в Support Hub заново.'));socket.data.nick=u.username;
        if(privateRoom){const grant=await vip.access(u.username,socket.handshake.auth?.vip);if(!grant)return next(Error('Введи пароль VIP-ложи.'));socket.data.vipExpires=grant.expires;}
        next();}catch{next(Error('Не удалось войти в кинозал.'));}};
    ns.use(authorize);posters.use(authorize);
    posters.on('connection',async socket=>{
      expiry(socket);
      try{
        const show=await read(),phase=view(show).phase;
        if(socket.connected&&show.poster&&['countdown','playing'].includes(phase))socket.emit('poster',{...show.poster,phase});
      }catch{/* Live announcements remain subscribed during a database outage. */}
    });
    const bindVoice=require('./cinema-voice')(ns);
    ns.on('connection',socket=>{
      expiry(socket);bindVoice(socket);audience();
      socket.on('disconnect',audience);
      let last=0;
      Promise.all([read(),chat.findOne({_id:chatKey})]).then(([show,log])=>{socket.emit('show',view(show));socket.emit('history',log?.messages||[]);}).catch(()=>socket.emit('room_error','Не удалось загрузить кинозал.'));
      socket.on('say',async(text,ack)=>{
        if(typeof ack!=='function')return;
        if(typeof text!=='string'||!text.trim()||text.trim().length>600)return ack({error:'Сообщение должно содержать от 1 до 600 символов.'});
        if(Date.now()-last<500)return ack({error:'Подожди немного перед следующим сообщением.'});
        last=Date.now();const m={id:new mongoose.Types.ObjectId().toString(),nick:socket.data.nick,text:text.trim(),at:last};
        try{await chat.updateOne({_id:chatKey},{$push:{messages:{$each:[m],$slice:-100}}},{upsert:true});ns.emit('message',m);ack({ok:true});}
        catch{ack({error:'Не удалось сохранить сообщение.'});}
      });
    });
  }
  installRoom('live',false);installRoom('vip',true);
}
module.exports={install,view};
