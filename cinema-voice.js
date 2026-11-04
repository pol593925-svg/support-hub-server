'use strict';
// Mono 16 kHz PCM, 40 ms per packet. Only joined microphones can send or receive live audio.
module.exports=function createVoice(ns){
  const room='cinema-voice',members=new Map();
  const roster=()=>[...members.values()].map(({id,nick,muted})=>({id,nick,muted}));
  return socket=>{
    let since=0,frames=0;
    socket.emit('voice_roster',roster());
    function leave(){
      if(!members.delete(socket.id))return;
      socket.leave(room);ns.emit('voice_roster',roster());
    }
    socket.on('voice_join',ack=>{
      if(typeof ack!=='function')return;
      if(!members.has(socket.id)){
        socket.join(room);members.set(socket.id,{id:socket.id,nick:socket.data.nick,muted:false});ns.emit('voice_roster',roster());
      }
      ack({ok:true});
    });
    socket.on('voice_mute',muted=>{
      const member=members.get(socket.id);if(!member||typeof muted!=='boolean'||member.muted===muted)return;
      member.muted=muted;ns.emit('voice_roster',roster());
    });
    socket.on('voice_pcm',packet=>{
      const member=members.get(socket.id);if(!member||member.muted||!Buffer.isBuffer(packet)||packet.length!==1280)return;
      const now=Date.now();if(now-since>=1000){since=now;frames=0;}if(++frames>36)return;
      socket.to(room).volatile.emit('voice_audio',socket.id,packet);
    });
    socket.on('voice_leave',leave);socket.on('disconnect',leave);
  };
};
