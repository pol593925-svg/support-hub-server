/* Shared compact 5v5 layout, objective metadata and authored house positions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.CS16TacticalMap=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const SIZE=126,definitions={
  dust2:{name:'Лазурный квартал',sites:{A:{x1:76,y1:48,x2:81,y2:54},B:{x1:44,y1:48,x2:49,y2:54}},houses:[[51,48],[71,48],[66,60],[59,76],[49,69],[72,72]]},
  inferno:{name:'Янтарные сады',sites:{A:{x1:76,y1:48,x2:81,y2:54},B:{x1:44,y1:48,x2:49,y2:54}},houses:[[51,48],[71,48],[66,60],[59,76],[49,69],[72,72]]}
 };
 function identify(grid){return grid.length===SIZE&&grid[1]?.[1]===11?(grid[1][2]===9?'dust2':grid[1][2]===11?'inferno':null):null;}
 function definition(map){return definitions[map]||definitions.dust2;}
 function buildings(grid){return identify(grid)?definition(identify(grid)).houses.map(([x,z],id)=>({x:x*4,z:z*4,id})):null;}
 function spawn(map,team,index=0){const i=Math.max(0,index|0)%5;return [(team==='ct'?60:62)*4+(i%3)*3,0,(team==='ct'?43:82)*4+Math.floor(i/3)*3];}
 function siteAt(map,pos){if(!Array.isArray(pos)||pos.length!==3||!pos.every(Number.isFinite)||pos[1]<-.3||pos[1]>1)return null;const x=pos[0]/4,z=pos[2]/4;for(const [id,s]of Object.entries(definition(map).sites))if(x>=s.x1&&x<s.x2+1&&z>=s.y1&&z<s.y2+1)return id;return null;}
 function waypoints(map){return [[62,44],[47,51],[78,51],[63,55],[59,66],[46,68],[78,69],[56,74],[70,77],[64,82]];}
 function generate(map){
  const g=Array.from({length:SIZE},()=>Array(SIZE).fill('#'));
  const rect=(x1,z1,x2,z2,c='.')=>{for(let z=z1;z<=z2;z++)for(let x=x1;x<=x2;x++)g[z][x]=c;};
  // Spawn courts, defender rotation, two distinct sites and three connected lanes.
  for(const r of [[58,41,68,47],[42,46,55,56],[70,46,83,56],[49,44,76,47],
   [44,54,48,72],[44,70,57,74],[53,72,58,81],[56,78,69,84],
   [77,54,81,76],[70,73,80,77],[66,77,72,81],
   [61,47,65,59],[58,58,65,64],[58,64,62,75],[59,74,67,81],
   [48,60,60,63],[64,57,78,60],[63,64,67,66],
   [64,58,70,65],[48,68,54,73],[70,70,77,77]])rect(...r);
  // Alternating walls interrupt long sightlines without closing a lane.
  for(const r of [[44,57,46,58],[47,64,48,65],[77,58,78,59],[80,66,81,67],
    [61,51,62,52],[64,55,65,56],[58,67,59,68],[61,72,62,73]])rect(...r,'#');
  // Two underground flanks with full 6/5/7 ramps on BOTH ends (no abrupt holes).
  function tunnel(x1,x2,z){rect(x1-1,z,x1-1,z+1);rect(x2+1,z,x2+1,z+1);for(let x=x1;x<=x2;x++){const d=Math.min(x-x1,x2-x);rect(x,z,x,z+1,d===0?'6':d===1?'5':d===2?'7':'4');}}
  tunnel(49,58,66);tunnel(66,76,64);
  if(map==='inferno'){
   // Garden route replaces the western straight approach; center retains a short archway.
   rect(44,60,45,63,'#');rect(49,57,52,60);rect(51,58,55,62);rect(54,61,59,63);
   rect(74,70,76,71,'#');rect(70,68,76,69);rect(70,69,72,74);
  }
  for(const [x,z]of definition(map).houses)rect(x-1,z-1,x+3,z+3);
  // Chest-high cover and taller crates are deliberate positions, not random barricades.
  for(const [x,z]of [[44,49],[48,53],[52,54],[75,53],[80,49],[73,55],[60,61],[64,49],[56,72],[70,78],[79,62]])g[z][x]='C';
  for(const [x,z]of [[46,55],[76,47],[62,58],[54,73],[78,74]])g[z][x]='D';
  g[1][1]='T';g[1][2]=map==='inferno'?'T':'B'; // isolated format signature outside the arena
  return g.map(r=>r.join(''));
 }
 return {identify,definition,buildings,spawn,siteAt,waypoints,generate};
});
