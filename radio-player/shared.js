(()=>{'use strict';
 const errors={2:'Некорректная ссылка.',5:'Этот ролик не воспроизводится на устройстве.',100:'Ролик удалён или закрыт.',101:'Автор запретил воспроизведение в приложении.',150:'Автор запретил воспроизведение в приложении.',153:'YouTube не подтвердил источник плеера. Перезапусти приложение.',network:'Не удалось загрузить плеер YouTube.'};
 function createPlayer(host,{server,onEvent}){
  const origin=new URL(server).origin,frame=document.createElement('iframe');let ready=false,wanted;
  frame.title='YouTube · Support Hub';frame.src=origin+'/radio-player/';frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';host.append(frame);
  function post(){if(ready&&wanted)frame.contentWindow?.postMessage({hubYouTube:true,event:'sync',...wanted},origin);}
  const receive=e=>{
   if(e.source!==frame.contentWindow||e.origin!==origin||!e.data?.hubYouTube)return;
   const m=e.data;if(m.event==='ready'){ready=true;post();}
   if(m.videoId&&wanted?.videoId!==m.videoId)return;
   onEvent?.({...m,...(m.event==='error'?{message:errors[m.code]||'Ролик недоступен. Открой его на YouTube или выбери другой.'}:{})});
  };
  window.addEventListener('message',receive);
  return {sync(c){wanted=c;post();},destroy(){window.removeEventListener('message',receive);frame.remove();},frame};
 }
 function mountLinkForm(host,{server,api,allowNow=false,onAdded,onPreviewPlaying}){
  let player=null,track=null,seconds=0,sequence=0,active=true,saving=false,timeout;
  host.classList.add('hub-yt-form');
  host.innerHTML='<form><label>Ссылка на песню YouTube / YouTube Music<input name="url" type="url" inputmode="url" placeholder="https://music.youtube.com/watch?v=…" required autocomplete="off" maxlength="2048"></label><button type="submit" class="yt-preview-button">Проверить ссылку →</button></form><div class="yt-preview" hidden><div class="yt-preview-player"></div><strong class="yt-title"></strong><small class="yt-meta"></small></div><p class="yt-notice" role="status" aria-live="polite">Добавь ссылку на отдельную песню. Она попадёт в конец общего эфира.</p><div class="yt-actions"><button type="button" data-add disabled>＋ В общую очередь</button><button type="button" data-now hidden disabled>Включить сейчас</button></div>';
  const q=s=>host.querySelector(s),input=q('input'),form=q('form'),preview=q('.yt-preview'),notice=q('.yt-notice'),add=q('[data-add]'),now=q('[data-now]'),submit=q('[type="submit"]');
  now.hidden=!allowNow;
  const say=(s,bad=false)=>{notice.textContent=s;notice.classList.toggle('error',bad);};
  function reset(){sequence++;clearTimeout(timeout);player?.destroy();player=null;track=null;seconds=0;add.disabled=now.disabled=true;preview.hidden=true;}
  input.oninput=()=>{reset();say('Проверь новую ссылку перед добавлением.');};
  form.onsubmit=async e=>{
   e.preventDefault();if(saving)return;reset();const seq=sequence;submit.disabled=true;say('Проверяем ссылку…');
   try{
    const result=await api('youtube/preview',{url:input.value});if(!active||seq!==sequence)return;
    track=result.track;preview.hidden=false;q('.yt-title').textContent=track.title;q('.yt-meta').textContent=track.author+' · YouTube';say('Проверяем воспроизведение. Если потребуется, нажми ▶ в плеере.');
    timeout=setTimeout(()=>{if(!seconds&&active&&seq===sequence)say('YouTube долго отвечает. Нажми ▶ в плеере или проверь ссылку ещё раз.',true);},20000);
    player=createPlayer(q('.yt-preview-player'),{server,onEvent:m=>{
     if(!active||seq!==sequence)return;
     if(m.event==='error'){seconds=0;add.disabled=now.disabled=true;clearTimeout(timeout);say(m.message,true);}
     if(m.event==='state'&&Number.isFinite(m.duration)&&m.duration>=1&&m.duration<=86400){
      if(!seconds){clearTimeout(timeout);say('Готово к добавлению · '+Math.floor(m.duration/60)+':'+String(Math.floor(m.duration%60)).padStart(2,'0'));}seconds=m.duration;
      if(!saving)add.disabled=now.disabled=false;
      if(m.state===1)onPreviewPlaying?.();
     }
    }});
    player.sync({videoId:track.videoId,playing:false,position:0,volume:40});
   }catch(e){if(active&&seq===sequence)say(e.message,true);}
   finally{if(active)submit.disabled=false;}
  };
  async function queue(playNow){
   if(!track||!seconds||saving)return;saving=true;add.disabled=now.disabled=submit.disabled=true;input.disabled=true;
   try{
    const result=await api('youtube/queue',{url:track.url,duration:seconds,playNow});if(!active)return;
    reset();input.value='';say(playNow?'✓ Трек включён в общем эфире.':'✓ Песня в общей очереди. Текущий трек продолжает играть.');onAdded?.(result,playNow);
   }catch(e){if(active)say(e.message,true);}
   finally{saving=false;if(active){input.disabled=submit.disabled=false;add.disabled=now.disabled=!seconds;}}
  }
  add.onclick=()=>queue(false);now.onclick=()=>queue(true);
  return {focus:()=>input.focus(),destroy(){active=false;reset();host.replaceChildren();}};
 }
 window.HubYouTube={createPlayer,mountLinkForm};
})();
