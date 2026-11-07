'use strict';
// Reverse breadth-first fields are shared by every squad, not rebuilt per bot tick.
const Buildings=require('./cs16-buildings');
const cache=new WeakMap();
function field(grid,flag){let maps=cache.get(grid);if(!maps){maps=new Map();cache.set(grid,maps);}const key=flag.x+','+flag.z;if(maps.has(key))return maps.get(key);
 const h=grid.length,w=grid[0].length,dist=new Int32Array(w*h).fill(-1),queue=new Int32Array(w*h);let tail=0,head=0;
 const start=Math.floor(flag.z/4)*w+Math.floor(flag.x/4);dist[start]=0;queue[tail++]=start;
 while(head<tail){const at=queue[head++],x=at%w,z=Math.floor(at/w);for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,ni=nz*w+nx;if(nx<0||nz<0||nx>=w||nz>=h||grid[nz][nx]!==0||dist[ni]>=0||Buildings.contains(grid,'',nx*4+2,nz*4+2,1))continue;dist[ni]=dist[at]+1;queue[tail++]=ni;}}
 maps.set(key,dist);return dist;
}
function destination(p,state,grid){const flags=state.cq?.flags||[],w=grid[0].length,x=Math.floor(p.bx/4),z=Math.floor(p.bz/4),at=z*w+x;
 const squad=Math.floor([...state.players.values()].filter(q=>q.bot&&q.team===p.team).indexOf(p)/2);
 const reachable=flags.filter(f=>field(grid,f)[at]>=0);if(!reachable.length)return null;
 const defense=reachable.filter(f=>f.owner===p.team&&(f.contested||f.capturing));
 const attack=reachable.filter(f=>f.owner!==p.team);const choices=defense.length?defense:attack.length?attack:reachable;
 const flag=choices[squad%choices.length],dist=field(grid,flag);p.cqObjective=flag.id;
 if(dist[at]<=1)return Math.hypot(p.bx-flag.x,p.bz-flag.z)>3?{x:flag.x,z:flag.z}:null;
 // Reach the current cell centre first, so a turn cannot cut a wall corner.
 const centre={x:x*4+2,z:z*4+2};if(Math.hypot(p.bx-centre.x,p.bz-centre.z)>.55&&p.cqPathCell!==at)return centre;
 p.cqPathCell=at;
 for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz;if(grid[nz]?.[nx]===0&&dist[nz*w+nx]===dist[at]-1)return {x:nx*4+2,z:nz*4+2};}return null;
}
function tacticalDestination(p,state,grid){
 const wps=require('./cs16-tactical-map').waypoints(state.map),wp=wps[p.bwp%wps.length],goal={x:wp[0]*4+2,z:wp[1]*4+2};
 if(Math.hypot(goal.x-p.bx,goal.z-p.bz)<2){p.bwp=(p.bwp+1)%wps.length;return null;}
 const x=Math.floor(p.bx/4),z=Math.floor(p.bz/4),at=z*grid[0].length+x,dist=field(grid,goal);
 if(dist[at]<0){p.bwp=(p.bwp+1)%wps.length;return null;}
 const centre={x:x*4+2,z:z*4+2};if(p.pathCell!==at&&Math.hypot(p.bx-centre.x,p.bz-centre.z)>.45)return centre;
 p.pathCell=at;
 for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])if(grid[z+dz]?.[x+dx]===0&&dist[(z+dz)*grid[0].length+x+dx]===dist[at]-1)return{x:(x+dx)*4+2,z:(z+dz)*4+2};
 return null;
}
function visible(p,q,grid,map){const o=[p.bx,(p.ly||0)+1.5,p.bz],target=[q.bot?q.bx:q.lx,(q.ly||0)+1.2,q.bot?q.bz:q.lz],d=target.map((v,i)=>v-o[i]),length=Math.hypot(...d);return length>0&&Buildings.trace(grid,map,o,d.map(v=>v/length),length)>=length-.25;}
module.exports={destination,field,tacticalDestination,visible};
