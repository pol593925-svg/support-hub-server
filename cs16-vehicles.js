'use strict';
const types={tank:{kind:'tank',hp:1000},bastion:{kind:'tank',hp:1500},heli:{kind:'heli',hp:600},storm:{kind:'heli',hp:900}};
const ownerOf=(players,nick)=>[...players.values()].find(p=>p.nick===nick);
function leave(players,p){const o=ownerOf(players,p.vehSeat);if(o&&o.veh&&o.veh.passenger===p.nick)o.veh.passenger=null;p.vehSeat=null;}
function clean(players){
  for(const p of players.values()){
    if(p.vehSeat){const o=ownerOf(players,p.vehSeat);if(!p.alive||!o||!o.alive||!o.veh||o.team!==p.team||o.veh.passenger!==p.nick)leave(players,p);}
    if(p.veh&&p.veh.passenger){const g=ownerOf(players,p.veh.passenger);if(!g||!g.alive||g.vehSeat!==p.nick)p.veh.passenger=null;}
  }
}
function join(players,p,nick){
  clean(players);const o=ownerOf(players,nick);
  if(!p.alive||!o||!o.alive||!o.veh||o===p||!p.team||o.team!==p.team)return 'Нужна техника живого союзника';
  if(p.veh||p.vehSeat)return 'Ты уже управляешь техникой';
  if(o.veh.passenger)return 'Место стрелка занято';
  const pos=o.veh.pos;
  if(!pos||!Number.isFinite(p.lx)||!Number.isFinite(p.lz)||!Number.isFinite(p.ly)||Math.hypot(p.lx-pos[0],p.lz-pos[2])>5||Math.abs(p.ly-pos[1])>3)return 'Подойди ближе к технике';
  o.veh.passenger=p.nick;p.vehSeat=o.nick;return null;
}
function active(players,p){clean(players);return !!(p.alive&&((p.veh&&p.veh.inside)||p.vehSeat));}
module.exports={types,join,leave,clean,active};
