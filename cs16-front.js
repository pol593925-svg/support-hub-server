(function(g,make){const api=make();if(typeof module==='object'&&module.exports)module.exports=api;if(g)g.CS16Front=api;})(typeof window==='undefined'?null:window,()=>{
 'use strict';
 const cell=4, key=(grid,x,z)=>Math.floor(z/cell)*grid[0].length+Math.floor(x/cell);
 function damage(grid){return grid.frontDamage||(grid.frontDamage={original:new Map(),revision:0});}
 function reset(grid){const d=damage(grid),w=grid[0].length;for(const [id,v] of d.original)grid[Math.floor(id/w)][id%w]=v;d.original.clear();d.crater=null;d.revision++;}
 function apply(grid,ids){const d=damage(grid),w=grid[0].length,added=[];
   for(const id of ids){if(!Number.isInteger(id)||id<0||id>=w*grid.length||d.original.has(id))continue;
     const x=id%w,z=Math.floor(id/w);if(x<1||z<1||x>=w-1||z>=grid.length-1)continue;
     d.original.set(id,grid[z][x]);grid[z][x]=0;added.push(id);
   }if(added.length)d.revision++;return added;
 }
 function footprint(grid,x,z,r){
   const ids=[],w=grid[0].length;for(let cz=Math.max(1,Math.floor((z-r)/4));cz<=Math.min(grid.length-2,Math.floor((z+r)/4));cz++)
     for(let cx=Math.max(1,Math.floor((x-r)/4));cx<=Math.min(w-2,Math.floor((x+r)/4));cx++){
       const dx=x-Math.max(cx*4,Math.min((cx+1)*4,x)),dz=z-Math.max(cz*4,Math.min((cz+1)*4,z));
       if(dx*dx+dz*dz<=r*r)ids.push(cz*w+cx);
     }return ids;
 }
 function ruined(grid,x,z){return grid.frontDamage?.original.has(key(grid,x,z))||false;}
 function depth(grid,x,z){
   if(!ruined(grid,x,z))return 0;
   const c=grid.frontDamage.crater;
   if(c){const t=Math.hypot(x-c.x,z-c.z)/c.r;if(t<1)return c.depth*(1-t*t)**2;}
   const u=x%4,v=z%4;return Math.min(u,v,4-u,4-v,1)*.85;
 }
 // Partition only boxes crossing demolished columns. Each remaining rectangle retains its original collision height.
 function clip(grid,b){
   if(!grid.frontDamage?.original.size)return [b];
   let rects=[b];const w=grid[0].length;
   for(let z=Math.floor(b.min[2]/4);z<=Math.floor((b.max[2]-.00001)/4);z++)
    for(let x=Math.floor(b.min[0]/4);x<=Math.floor((b.max[0]-.00001)/4);x++){
     if(!grid.frontDamage.original.has(z*w+x))continue;
     const next=[];for(const r of rects){
       const [l,y,n]=r.min,[h,top,s]=r.max,ax=Math.max(l,x*4),bx=Math.min(h,x*4+4),az=Math.max(n,z*4),bz=Math.min(s,z*4+4);
       if(ax>=bx||az>=bz){next.push(r);continue;}
       const keep=(x0,z0,x1,z1)=>{if(x1-x0>1e-5&&z1-z0>1e-5)next.push({...r,min:[x0,y,z0],max:[x1,top,z1]});};
       keep(l,n,ax,s);keep(bx,n,h,s);keep(ax,n,bx,az);keep(ax,bz,bx,s);
     }rects=next;
    }return rects;
 }
 function openCell(grid,x,z,seed=0){
   const w=grid[0].length,h=grid.length,cx=Math.floor(x/4),cz=Math.floor(z/4);
   for(let r=0;r<Math.max(w,h);r++){const candidates=[];
     for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){
       if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;const a=cx+dx,b=cz+dz;
       if(a>0&&a<w-1&&b>0&&b<h-1&&grid[b][a]===0)candidates.push([4*a+2,4*b+2]);
     }if(candidates.length)return candidates[Math.abs(seed)%candidates.length];
   }return null;
 }
 function sectors(grid,buildings){
   if(!buildings.length)throw Error('Карта без штурмовых зданий');
   const south=[...buildings].sort((a,b)=>b.z-a.z||a.x-b.x),hall=south[0],roof=south.at(-1);
   const road=openCell(grid,hall.x+6,hall.z+51);
   return [{name:'Уличный КПП',x:road[0],z:road[1],y:0,r:9},{name:'Командный пункт',x:hall.x+6,z:hall.z+6,y:0,r:5},{name:'Узел связи · крыша',x:roof.x+7,z:roof.z+7,y:7.2,r:4.8}];
 }
 // A third layout for the assault district; Blender and both game processes consume these exact rows.
 function district(){
   const n=126,rows=Array.from({length:n},(_,z)=>Array.from({length:n},(_,x)=>x<2||z<2||x>=n-2||z>=n-2?'#':'.'));
   const rect=(x,z,w,h,ch)=>{for(let j=z;j<z+h;j++)for(let i=x;i<x+w;i++)rows[j][i]=ch;};
   // Leave the centre boulevard and the northern/southern spawn roads open.
   for(let z=10;z<116;z+=18)for(let x=12;x<119;x+=20){
     if(x>=50&&x<=72)continue;rect(x,z,8,4,'#');rect(x+8,z+1,3,2,'#');
     rect(x+4,z+5,2,1,'C');if((z+x)%3===0)rect(x+10,z+7,1,2,'D');
   }
   for(const [x,z,w,h]of [[26,51,17,2],[78,69,20,2],[32,97,10,2],[76,35,10,2]])rect(x,z,w,h,'#');
   for(const [x,z]of [[36,45],[84,62],[32,86]]){rect(x,z,3,3,'T');rect(x+1,z+3,1,1,'S');}
   rect(44,73,15,2,'4');rect(43,73,1,2,'5');rect(59,73,1,2,'7');
   return rows.map(row=>row.join(''));
 }
 function setCrater(grid,c){const d=damage(grid);d.crater=c;d.revision++;}
 return {damage,apply,reset,footprint,ruined,depth,clip,key,openCell,sectors,district,setCrater};
});
