(()=>{
  'use strict';
  const $=id=>document.getElementById(id),KEY='hub-radio-phone',PENDING=KEY+'-pair';
  let session=null,pair=null,state=null,busy=false,polling=false,controlBusy=false,uploadAbort=null,queueRev=-1,linkForm;
  const say=(text,error=false)=>{$('notice').textContent=text;$('notice').classList.toggle('error',error);};
  const time=s=>Math.floor((s||0)/60)+':'+String(Math.floor((s||0)%60)).padStart(2,'0');
  function read(key){try{return JSON.parse(sessionStorage.getItem(key));}catch{return null;}}
  function save(key,value){try{value?sessionStorage.setItem(key,JSON.stringify(value)):sessionStorage.removeItem(key);}catch{}}
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('code')){pair={id:fragment.get('id'),code:fragment.get('code'),mode:fragment.get('mode')};save(PENDING,pair);save(KEY,null);history.replaceState(null,'',location.pathname);}
  else{session=read(KEY);pair=read(PENDING);}
  function lock(message){linkForm?.destroy();linkForm=null;session=null;state=null;save(KEY,null);uploadAbort?.abort();$('connected').hidden=true;$('gate').hidden=true;say(message,true);}
  async function api(route,{method='GET',body,signal,auth=true}={}){
    const headers={'X-SupportHub-Radio':'youtube-v1'};if(auth&&session)headers.Authorization='Bearer '+session.token;
    if(body!==undefined)headers['Content-Type']=body instanceof Blob?'application/octet-stream':'application/json';
    const controller=new AbortController(),cancel=()=>controller.abort();if(signal?.aborted)cancel();signal?.addEventListener('abort',cancel,{once:true});const timeout=setTimeout(cancel,35000);
    try{
    const response=await fetch('/api/radio/'+route,{method,headers,cache:'no-store',body:body===undefined?undefined:body instanceof Blob?body:JSON.stringify(body),signal:controller.signal});
    let data;try{data=await response.json();}catch{throw Error('Сервер временно недоступен. Попробуй ещё раз.');}
    if(!response.ok){if(auth&&response.status===401)lock(data.message);throw Object.assign(Error(data.message||'Не удалось выполнить действие.'),{status:response.status});}return data;
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
  }
  function showConnected(){
    const dj=session.mode==='dj';
    linkForm?.destroy();linkForm=HubYouTube.mountLinkForm($('youtubeForm'),{server:location.origin,api:(route,body)=>api(route,{method:'POST',body}),allowNow:dj,onAdded:s=>{if(dj){state=s;draw();}}});$('gate').hidden=true;$('connected').hidden=false;$('deck').hidden=!dj;$('queuePanel').hidden=!dj;
    $('modeLabel').textContent=dj?'FIFFLAREN / DJ-ПУЛЬТ':'МУЗЫКА ОБЪЕДИНЯЕТ';
    $('pageTitle').textContent=dj?'Ты задаёшь ритм.':'Твои песни. Наш общий эфир.';
    $('intro').textContent=dj?'Весь эфир — под рукой. Выбирай треки и управляй очередью.':'Добавляй музыку с телефона в очередь команды.';
    $('identity').textContent=session.username;say(dj?'Пульт подключён. Управляешь общим эфиром.':'Телефон подключён. Можно выбирать песни.');
  }
  async function connect(event){
    event?.preventDefault();if(busy||!pair)return;busy=true;$('unlock').disabled=true;
    try{const data=await api('mobile/connect',{method:'POST',auth:false,body:{id:pair.id,code:pair.code,...(pair.mode==='dj'?{password:$('pin').value}:{})}});
      session={token:data.token,mode:data.mode,username:data.username};save(KEY,session);save(PENDING,null);pair=null;showConnected();await poll();
    }catch(e){say(e.message,true);}finally{busy=false;$('unlock').disabled=false;$('pin').value='';}
  }
  function draw(){
    if(!state)return;const track=state.queue.find(t=>t.id===state.current);
    $('trackTitle').textContent=track?.title||'Очередь пока пуста';$('trackBy').textContent=track?.addedBy?'Добавил: '+track.addedBy:'';
    $('airStatus').textContent=state.playing?'● В ЭФИРЕ':'ПАУЗА';$('play').textContent=state.playing?'Пауза':'Начать эфир';
    for(const id of ['play','previous','next','seek'])$(id).disabled=!track||controlBusy;
    if(document.activeElement!==$('seek')){$('seek').max=track?.duration||1;$('seek').value=state.position||0;}
    $('elapsed').textContent=time(state.position);$('duration').textContent=time(track?.duration);
    $('queueCount').textContent=state.queue.length;
    const key=state.rev+':'+state.current;if(queueRev!==key){queueRev=key;drawQueue();}
  }
  function action(label,op,id,disabled=false){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=disabled;b.onclick=()=>control(op,{id});return b;}
  function drawQueue(){
    const list=$('queue');list.replaceChildren();if(!state)return;
    const search=$('search').value.trim().toLowerCase(),found=state.queue.map((t,i)=>({t,i})).filter(({t})=>t.title.toLowerCase().includes(search));
    for(const {t,i} of found.slice(0,100)){
      const li=document.createElement('li'),title=document.createElement('strong'),meta=document.createElement('small'),actions=document.createElement('div');
      li.classList.toggle('on-air',t.id===state.current);title.textContent=(i+1)+'. '+t.title;meta.textContent=(t.source==='youtube'?'YouTube · ':'Файл · ')+time(t.duration)+(t.addedBy?' · '+t.addedBy:'');actions.className='queue-actions';
      actions.append(action('В эфир','select',t.id),action('↑','up',t.id,i===0),action('↓','down',t.id,i===state.queue.length-1),action('Из очереди','remove',t.id));
      li.append(title,meta,actions);list.append(li);
    }
    $('queueHint').textContent=found.length>100?'Показаны первые 100 треков. Найди остальные через поиск.':found.length?'':'Песен пока нет. Добавь музыку выше.';
  }
  async function pullState(){
    const s=await api('state'+(state?'?since='+state.rev:''));if(!s.queue)s.queue=state?.queue||[];
    if(!state||s.rev>=state.rev){state=s;draw();}
  }
  async function poll(){
    if(!session||polling||document.hidden)return;polling=true;
    try{const info=await api('mobile/info');$('hostStatus').textContent=info.hostOnline?'ПК Fifflaren в сети':'ПК Fifflaren не в сети';
      if(session?.mode==='dj')await pullState();
    }catch(e){say(e.message,true);}finally{polling=false;}
  }
  async function control(op,extra={}){
    if(!state||controlBusy)return;controlBusy=true;draw();
    try{const next=await api('control',{method:'POST',body:{op,rev:state.rev,...extra}});state=next;say('Эфир обновлён.');draw();}
    catch(e){say(e.message,true);try{await pullState();}catch{}}
    finally{controlBusy=false;draw();}
  }
  function duration(file){return new Promise((resolve,reject)=>{
    const audio=new Audio(),url=URL.createObjectURL(file);let done=false;
    function finish(ok){if(done)return;done=true;clearTimeout(timeout);const d=audio.duration;audio.onloadedmetadata=audio.onerror=null;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);ok&&Number.isFinite(d)&&d>0?resolve(d):reject(Error('Телефон не смог прочитать аудиофайл. Выбери MP3, M4A или другой поддерживаемый формат.'));}
    const timeout=setTimeout(()=>finish(false),30000);audio.preload='metadata';audio.onloadedmetadata=()=>finish(true);audio.onerror=()=>finish(false);audio.src=url;
  });}
  async function uploadFile(file,row,signal){
    const seconds=await duration(file),name=file.name.replace(/\.[a-z0-9]+$/i,'').slice(0,200)||'Песня';
    const sample=new Blob([JSON.stringify([file.name,file.size,file.lastModified]),file.slice(0,65536),file.slice(-65536)]);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await sample.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
    const key='hub-radio-upload:'+session.username+':'+digest;let id;try{id=localStorage.getItem(key);}catch{}
    if(!/^[a-f0-9]{24}$/.test(id)){id=Math.floor(Date.now()/1000).toString(16).padStart(8,'0')+Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>v.toString(16).padStart(2,'0')).join('');try{localStorage.setItem(key,id);}catch{}}
    async function step(route,opts){
      for(let n=0;;n++){if(signal.aborted)throw Error('Загрузка остановлена.');
        try{return await api(route,{...opts,signal});}
        catch(e){if(signal.aborted||n>=3||e.status&&e.status<500&&e.status!==429)throw e;row.message.textContent='Восстанавливаем соединение…';await new Promise(r=>setTimeout(r,800*2**n));}
      }
    }
    const uri='uploads/'+id,s=await step(uri,{method:'PUT',body:{title:name,size:file.size,duration:seconds}});
    for(let n=s.next;n<Math.ceil(file.size/s.partSize);n++){
      const end=Math.min(file.size,(n+1)*s.partSize);await step(uri+'/parts/'+n,{method:'PUT',body:file.slice(n*s.partSize,end)});
      const percent=Math.min(99,Math.floor(end/file.size*100));row.progress.value=percent;row.message.textContent=percent+'% · передаём на ПК';
    }
    row.message.textContent='Сохраняем в библиотеку…';await step(uri+'/finish',{method:'POST'});row.progress.value=100;row.message.textContent='✓ В общей очереди';try{localStorage.removeItem(key);}catch{}
  }
  async function upload(){
    if(uploadAbort||!session)return;const files=Array.from($('files').files);if(!files.length)return;
    uploadAbort=new AbortController();const job=uploadAbort;$('files').disabled=true;let success=0;
    const list=$('uploads');list.replaceChildren();
    try{for(const file of files){
      if(job.signal.aborted)break;
      const el=document.createElement('div'),title=document.createElement('strong'),message=document.createElement('span'),progress=document.createElement('progress');
      el.className='upload-row';title.textContent=file.name;message.textContent='Готовим файл…';progress.max=100;progress.value=0;progress.setAttribute('aria-label',file.name);el.append(title,message,progress);list.append(el);
      try{await uploadFile(file,{message,progress},job.signal);success++;}catch(e){message.textContent=job.signal.aborted?'Загрузка остановлена.':e.message+' Выбери этот файл повторно, чтобы продолжить.';}
    }if(session){say('Добавлено в очередь: '+success+' из '+files.length+'.',success!==files.length);await poll();}}
    finally{uploadAbort=null;$('files').disabled=false;$('files').value='';}
  }
  function sourceTab(youtube){$('youtubePanel').hidden=!youtube;$('filePanel').hidden=youtube;$('sourceYouTube').setAttribute('aria-selected',String(youtube));$('sourceFiles').setAttribute('aria-selected',String(!youtube));if(!youtube){linkForm?.destroy();linkForm=null;}else if(!linkForm&&session){linkForm=HubYouTube.mountLinkForm($('youtubeForm'),{server:location.origin,api:(route,body)=>api(route,{method:'POST',body}),allowNow:session.mode==='dj',onAdded:s=>{if(session?.mode==='dj'){state=s;draw();}}});}}
  $('sourceYouTube').onclick=()=>sourceTab(true);$('sourceFiles').onclick=()=>sourceTab(false);
  for(const button of [$('sourceYouTube'),$('sourceFiles')])button.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const youtube=button.id==='sourceFiles';sourceTab(youtube);$(youtube?'sourceYouTube':'sourceFiles').focus();}};
  $('pinForm').onsubmit=connect;$('files').onchange=upload;$('search').oninput=drawQueue;
  $('play').onclick=()=>control(state?.playing?'pause':'play');$('previous').onclick=()=>control('previous');$('next').onclick=()=>control('next');
  $('seek').onchange=()=>control('seek',{id:state?.current,position:Number($('seek').value)});
  $('disconnect').onclick=async()=>{uploadAbort?.abort();try{await api('mobile/disconnect',{method:'POST'});}catch{}save(PENDING,null);lock('Телефон отключён. Для нового подключения отсканируй QR в приложении.');};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  setInterval(poll,3000);
  if(session){showConnected();poll();}
  else if(pair?.mode==='dj'){$('gate').hidden=false;say('Для DJ-пульта нужен пароль.');}
  else if(pair?.mode==='upload')connect();
  else lock('Открой «С телефона» рядом с «+ Песня» в Support Hub и отсканируй QR.');
})();
