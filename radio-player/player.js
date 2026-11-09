(()=>{'use strict';
 let player,ready=false,wanted=null,loaded='',lastPlaying=null,lastSeek=0,lastSync=0,blocked=false;
 const send=data=>parent.postMessage({hubYouTube:true,...data},'*');
 const snap=()=>{if(!ready)return;send({event:'state',videoId:player.getVideoData()?.video_id||loaded,duration:player.getDuration(),position:player.getCurrentTime(),state:player.getPlayerState()});};
 function apply(command){
  if(!ready){wanted=command;return;}
  const time=performance.now(),seekRequested=lastSync&&wanted?.videoId===command.videoId&&Math.abs(command.position-(wanted.position+(wanted.playing?(time-lastSync)/1000:0)))>2;
  wanted=command;lastSync=time;
  player.setVolume(command.volume);if(command.volume>0)player.unMute();else player.mute();
  if(command.videoId!==loaded){loaded=command.videoId;blocked=false;lastPlaying=null;player.cueVideoById({videoId:loaded,startSeconds:command.position||0});}
  if(command.playing!==lastPlaying){lastPlaying=command.playing;if(command.playing&&!document.hidden&&!blocked)player.playVideo();else player.pauseVideo();}
  const state=player.getPlayerState();
  if(seekRequested||command.playing&&state===1&&Math.abs(player.getCurrentTime()-command.position)>6&&time-lastSeek>10000){lastSeek=time;player.seekTo(command.position,true);}
 }
 window.addEventListener('message',e=>{
  if(e.source!==parent||!e.data?.hubYouTube)return;const c=e.data;
  if(c.event!=='sync'||!/^[\w-]{11}$/.test(c.videoId)||!Number.isFinite(c.volume)||!Number.isFinite(c.position)||c.position<0||c.position>86400||typeof c.playing!=='boolean')return;
  apply({...c,volume:Math.max(0,Math.min(100,c.volume))});
 });
 window.onYouTubeIframeAPIReady=()=>{
  player=new YT.Player('player',{width:'100%',height:'100%',playerVars:{origin:location.origin,playsinline:1,controls:1,enablejsapi:1},events:{
   onReady(){ready=true;send({event:'ready'});if(wanted)apply(wanted);},
   onStateChange(e){if(e.data===1)blocked=false;snap();},
   onError(e){send({event:'error',code:e.data,videoId:loaded});},
   onAutoplayBlocked(){blocked=true;send({event:'blocked',videoId:loaded});}
  }});
 };
 const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>send({event:'error',code:'network'});document.head.append(script);
 const timer=setInterval(snap,1000);document.addEventListener('visibilitychange',()=>{if(document.hidden&&ready)player.pauseVideo();});
 window.addEventListener('pagehide',()=>{clearInterval(timer);player?.destroy();});
})();
