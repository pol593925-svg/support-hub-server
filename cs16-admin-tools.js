'use strict';

// Private in-game testing controls. A game nickname never establishes identity.
module.exports=function install({io,authenticate,setTimer=setTimeout,clearTimer=clearTimeout,recheckMs=30000}){
  io.on('connection',socket=>{
    let live=true,revision=0,timer=null;
    socket.data ||= {};
    const denied=()=>({allowed:false,wallhack:false,aimbot:false});
    socket.data.cs16AdminTools=denied();
    function cancelTimer(){if(timer!==null){clearTimer(timer);timer=null;}}
    function publish(state){
      socket.data.cs16AdminTools=state;
      socket.emit('cs16_admin_tools_state',{...state});
    }
    async function verify(desired){
      cancelTimer();const request=++revision;
      const token=socket.handshake?.auth?.token;
      let allowed=false;
      try{
        // callsService.actor checks the stored session hash, expiry and ban status.
        const actor=typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)?await authenticate(token):null;
        allowed=typeof actor?.username==='string'&&actor.username.toLowerCase()==='fifflaren'&&!actor.isBanned&&!actor.offboardedAt;
      }catch{/* Authentication/backend failures fail closed. */}
      if(!live||socket.connected===false||request!==revision)return;
      const previous=socket.data.cs16AdminTools;
      publish(allowed?{allowed:true,wallhack:desired?.wallhack??previous.wallhack,aimbot:desired?.aimbot??previous.aimbot}:denied());
      if(allowed){timer=setTimer(()=>verify(),recheckMs);timer?.unref?.();}
    }
    socket.on('cs16_admin_tools',data=>{
      const valid=data&&typeof data==='object'&&!Array.isArray(data)&&
        Object.hasOwn(data,'wallhack')&&Object.hasOwn(data,'aimbot')&&
        typeof data.wallhack==='boolean'&&typeof data.aimbot==='boolean';
      // Invalid payloads cannot enable a tool or partially change an existing selection.
      return verify(valid?{wallhack:data.wallhack,aimbot:data.aimbot}:undefined);
    });
    socket.on('disconnect',()=>{
      live=false;++revision;cancelTimer();socket.data.cs16AdminTools=denied();
    });
    // Capability is sent only to this socket, never to a room or a game snapshot.
    return verify();
  });
};
