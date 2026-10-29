'use strict';
const Buildings=require('./cs16-buildings');
function shot(grid,map,p,d,players,combat,now=Date.now()){
 if(!p?.alive||!(p.rpgAmmo>0)||p.veh?.inside||p.vehSeat||now-(p.rpgLast||0)<3900)return null;
 if(!Array.isArray(d?.origin)||!Array.isArray(d?.dir)||d.origin.length!==3||d.dir.length!==3||![...d.origin,...d.dir].every(Number.isFinite))return null;
 if(!Number.isFinite(p.lx+p.ly+p.lz)||Math.hypot(d.origin[0]-p.lx,d.origin[1]-(p.ly+1.5),d.origin[2]-p.lz)>2)return null;
 const len=Math.hypot(...d.dir);if(len<.99||len>1.01)return null;const dir=d.dir.map(v=>v/len),origin=d.origin.slice();let distance=Buildings.trace(grid,map,origin,dir,180);
 for(const target of players){if(target===p||!target.alive||target.team===p.team)continue;const x=target.bot?target.bx:target.lx,z=target.bot?target.bz:target.lz,y=target.bot?0:target.ly;if(!Number.isFinite(x+y+z))continue;const hit=combat.playerHit(origin,dir,{x,y,z},distance);if(hit)distance=hit.t; if(target.veh?.pos){const at=target.veh.pos,t=Buildings.rayBox(origin,dir,{min:[at[0]-2,at[1],at[2]-2],max:[at[0]+2,at[1]+3,at[2]+2]},distance);if(t!==null)distance=t;}}
 p.rpgAmmo--;p.rpgLast=now;return {origin,dir,pos:origin.map((v,i)=>v+dir[i]*Math.max(0,distance-.15)),duration:Math.max(80,distance/55*1000),ammo:p.rpgAmmo};
}
module.exports={shot};
