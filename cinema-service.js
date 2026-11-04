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
  const ns=io.of('/cinema'),read=async()=>await shows.findOne({_id:'live'})||empty();
  const fail=(status,message)=>Object.assign(Error(message),{status});
  const error=(res,e)=>res.status(e.status||503).json({success:false,message:e.status?e.message:/quota|space limit/i.test(e.message)?'Хранилище для фильмов заполнено.':'Кинотеатр временно недоступен.'});
  const guard=owner=>async(req,res,next)=>{try{
    const user=await authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));
    if(!user)throw fail(401,'Войди в Support Hub заново.');
    if(owner&&user.username.toLowerCase()!=='fifflaren')throw fail(403,'Эфиром управляет Fifflaren.');
    next();
  }catch(e){error(res,e);}};
  media.create({mongoose,app,kind:'cinema',guard,error});
  app.get('/api/cinema/state',guard(false),async(req,res)=>{try{res.set('Cache-Control','no-store').json(view(await read()));}catch(e){error(res,e);}});
  app.post('/api/cinema/control',guard(true),async(req,res)=>{try{
    const old=await read(),now=Date.now(),live=view(old,now),cmd=req.body||{};
    if(old.rev!==cmd.rev)throw fail(409,'Афиша изменилась. Обнови показ и попробуй ещё раз.');
    let {title,film,position,playing}=live,startsAt=0;
    if(cmd.op==='schedule'){
      if(cmd.film){const row=await films.findOne({_id:cmd.film,ready:true});if(!row)throw fail(404,'Фильм ещё не загружен.');film={id:row._id,title:row.title,duration:row.duration};}else film=null;
      title=String(cmd.title||film?.title||'').trim();if(!title||title.length>160)throw fail(400,'Укажи название до 160 символов.');
      if(!Number.isInteger(cmd.minutes)||cmd.minutes<0||cmd.minutes>43200)throw fail(400,'Укажи задержку от 0 до 43200 минут.');
      startsAt=now+cmd.minutes*60000;position=0;playing=false;
    }else if(cmd.op==='attach'){
      if(!old.title||old.film)throw fail(409,'Выбери анонс без видео.');
      const row=await films.findOne({_id:cmd.film,ready:true});if(!row)throw fail(404,'Фильм не найден.');
      film={id:row._id,title:row.title,duration:row.duration};startsAt=Math.max(old.startsAt,now);position=0;playing=false;
    }else if(cmd.op==='clear'){title='';film=null;position=0;playing=false;}
    else{
      if(!film)throw fail(409,'Сначала выбери фильм.');
      if(cmd.op==='play'){playing=true;if(position>=film.duration)position=0;}
      else if(cmd.op==='pause'){playing=false;}
      else if(cmd.op==='seek'&&Number.isFinite(cmd.position)){position=Math.max(0,Math.min(film.duration,cmd.position));if(live.phase==='countdown')throw fail(409,'Сначала начни показ.');}
      else throw fail(400,'Неизвестное действие.');
    }
    const update={rev:old.rev+1,title,film,startsAt,position,playing,anchor:now};
    let result;try{result=await shows.updateOne({_id:'live',rev:old.rev},{$set:update},{upsert:old.rev===0});}catch(e){if(e.code!==11000)throw e;}
    if(!result?.matchedCount&&!result?.upsertedCount)throw fail(409,'Управление уже изменилось.');
    const state=view(update);ns.emit('show',state);res.json(state);
  }catch(e){error(res,e);}});
  ns.use(async(socket,next)=>{try{const u=await authenticate(socket.handshake.auth?.token);if(!u)return next(Error('Войди в Support Hub заново.'));socket.data.nick=u.username;next();}catch{next(Error('Не удалось войти в кинозал.'));}});
  ns.on('connection',socket=>{
    let last=0;
    Promise.all([read(),chat.findOne({_id:'room'})]).then(([show,log])=>{socket.emit('show',view(show));socket.emit('history',log?.messages||[]);}).catch(()=>socket.emit('room_error','Не удалось загрузить кинозал.'));
    socket.on('say',async(text,ack)=>{
      if(typeof ack!=='function')return;
      if(typeof text!=='string'||!text.trim()||text.trim().length>600)return ack({error:'Сообщение должно содержать от 1 до 600 символов.'});
      if(Date.now()-last<500)return ack({error:'Подожди немного перед следующим сообщением.'});
      last=Date.now();const m={id:new mongoose.Types.ObjectId().toString(),nick:socket.data.nick,text:text.trim(),at:last};
      try{await chat.updateOne({_id:'room'},{$push:{messages:{$each:[m],$slice:-100}}},{upsert:true});ns.emit('message',m);ack({ok:true});}
      catch{ack({error:'Не удалось сохранить сообщение.'});}
    });
  });
}
module.exports={install,view};
