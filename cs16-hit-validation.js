'use strict';
const finite3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
// Recheck the visible hit point, not a lower, possibly hidden point in the torso.
function segment(attacker,target,shot){
 const origin=[attacker.lx,attacker.ly+(attacker.crouched?1.02:1.62),attacker.lz];
 const scale=target.crouched ? .72 : 1,zone=shot.head?'head':shot.zone;
 const targetPos=[target.bot?target.bx:target.lx,target.ly||0,target.bot?target.bz:target.lz];
 const point=[targetPos[0],targetPos[1]+(zone==='head'?1.72:zone==='leg'?.4:1.05)*scale,targetPos[2]];
 if(!finite3(origin)||!finite3(point))return null;
 if(shot.origin!==undefined||shot.point!==undefined){
  if(!finite3(shot.origin)||!finite3(shot.point))return null;
  if(Math.hypot(shot.origin[0]-origin[0],shot.origin[2]-origin[2])>1.8||Math.abs(shot.origin[1]-origin[1])>.65)return null;
  // Allow interpolation/network drift while keeping endpoints on the target.
  if(Math.hypot(shot.point[0]-targetPos[0],shot.point[2]-targetPos[2])>1.15||shot.point[1]<targetPos[1]-.12||shot.point[1]>targetPos[1]+1.96*scale+.12)return null;
  origin.splice(0,3,...shot.origin);point.splice(0,3,...shot.point);
 }
 const delta=point.map((v,i)=>v-origin[i]),distance=Math.hypot(...delta);
 if(distance<.001||distance>201||shot.point&&Math.abs(distance-Number(shot.dist))>.2)return null;
 return {origin,point,dir:delta.map(v=>v/distance),limit:Math.max(0,distance-(shot.point ? .02 : .36))};
}
module.exports={segment};
