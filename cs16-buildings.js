(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.CS16Buildings=api;})(typeof window!=='undefined'?window:null,function(){'use strict';
 const cache=new WeakMap();
 function layout(grid,map){if(cache.has(grid))return cache.get(grid);const buildings=[];for(let z=26;z<grid.length-18;z+=15)for(let x=9;x<grid[0].length-15;x+=13){if(buildings.length>=6)break;let open=true;for(let dz=-1;dz<=4;dz++)for(let dx=-1;dx<=4;dx++)if(grid[z+dz]?.[x+dx]!==0)open=false;if(!open)continue;buildings.push({x:x*4,z:z*4,id:buildings.length});}const boxes=[];for(const b of buildings){const add=(x,y,z,w,h,d,kind='wall')=>boxes.push({min:[b.x+x,y,b.z+z],max:[b.x+x+w,y+h,b.z+z+d],kind,building:b.id});
  add(0,-.2,0,12,.2,12,'floor');add(0,3.35,0,9,.25,12,'floor');add(9,3.35,10,3,.25,2,'floor');add(0,6.95,0,10.5,.25,12,'roof');add(10.5,6.95,10,1.5,.25,2,'roof');
  // Ground entrance, window openings, continuous corner posts.
  for(const y of [0,3.6]){add(0,y,0,.25,3.6,12);add(11.75,y,0,.25,3.6,12);add(0,y,11.75,12,3.6,.25);if(y===0){add(0,0,0,4,3.6,.25);add(7,0,0,5,3.6,.25);add(4,2.6,0,3,1,.25);}else{add(0,y,0,12,.9,.25);add(0,y+2.4,0,12,1.2,.25);for(const x of [0,3.5,7,10.5])add(x,y+.9,0,1.5,1.5,.25);}}
  // Two adjacent flights; the second returns toward the front and exits onto the roof.
  for(let n=0;n<20;n++){add(9,n*.18,.5+n*.5,1.375,.18,.5,'step');add(10.375,3.6+n*.18,10-n*.5,1.375,.18,.5,'step');}
  add(0,7.2,0,.2,.75,12,'rail');add(0,7.2,11.8,12,.75,.2,'rail');add(0,7.2,0,9,.75,.2,'rail');
  // Stone lintels and sills; openings retain their original collision dimensions.
  add(3.8,0,-.12,.2,2.6,.24,'trim');add(7,0,-.12,.2,2.6,.24,'trim');add(3.8,2.6,-.12,3.4,.2,.24,'trim');
  for(const x of [1.5,5,8.5]){add(x-.12,4.38,-.15,2.24,.12,.35,'trim');add(x-.12,6,-.1,2.24,.12,.25,'trim');add(x-.12,4.5,-.1,.12,1.5,.25,'trim');add(x+2,4.5,-.1,.12,1.5,.25,'trim');}
  for(const z of [2.3,7.6])for(const y of [1.05,4.65]){add(12.005,y,z,.025,1.3,1.8,'glass');add(11.98,y-.12,z-.12,.2,.12,2.04,'trim');add(11.98,y+1.3,z-.12,.12,.12,2.04,'trim');add(12.03,y,z+.87,.07,1.3,.06,'trim');}
  add(-.08,3.25,-.08,12.16,.12,.22,'trim');add(-.08,6.83,-.08,12.16,.12,.22,'trim');
  add(2,0,8,.55,3.35,.55,'wall');add(6.5,0,8,.55,3.35,.55,'wall');
 }const data={buildings,boxes};cache.set(grid,data);return data;}
 function contains(grid,map,x,z,margin=0){return layout(grid,map).buildings.some(b=>x>b.x-margin&&x<b.x+12+margin&&z>b.z-margin&&z<b.z+12+margin);}
 function rayBox(o,d,b,maxT){let lo=0,hi=maxT;for(let i=0;i<3;i++){if(Math.abs(d[i])<1e-9){if(o[i]<b.min[i]||o[i]>b.max[i])return null;continue;}let a=(b.min[i]-o[i])/d[i],c=(b.max[i]-o[i])/d[i];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(hi<lo)return null;}return lo<=maxT?lo:null;}
 function ray(grid,map,o,d,maxT){let best=null;for(const b of layout(grid,map).boxes){const t=rayBox(o,d,b,best??maxT);if(t!==null&&(best===null||t<best))best=t;}return best;}
 function collide(grid,map,x,z,y,height=1.8,r=.35){for(const b of layout(grid,map).boxes){if(b.max[1]<=y+.4||b.min[1]>=y+height-.03)continue;const nx=Math.max(b.min[0],Math.min(x,b.max[0])),nz=Math.max(b.min[2],Math.min(z,b.max[2])),dx=x-nx,dz=z-nz,dist=Math.hypot(dx,dz);if(dist>=r)continue;if(dist>.00001){x+=dx/dist*(r-dist);z+=dz/dist*(r-dist);}else{const choices=[[Math.abs(x-b.min[0]),0,b.min[0]-r],[Math.abs(b.max[0]-x),0,b.max[0]+r],[Math.abs(z-b.min[2]),1,b.min[2]-r],[Math.abs(b.max[2]-z),1,b.max[2]+r]].sort((a,b)=>a[0]-b[0]);if(choices[0][1])z=choices[0][2];else x=choices[0][2];}}return [x,z];}
 function vertical(grid,map,x,z,y,height=1.8){let floor=-Infinity,ceiling=Infinity;for(const b of layout(grid,map).boxes){if(x<b.min[0]||x>b.max[0]||z<b.min[2]||z>b.max[2])continue;if(b.max[1]<=y+.4)floor=Math.max(floor,b.max[1]);if(b.min[1]>=y+height-.08)ceiling=Math.min(ceiling,b.min[1]);}return {floor,ceiling};}
 function trace(grid,map,o,d,maxT=180){let distance=ray(grid,map,o,d,maxT)??maxT;for(let t=.1;t<distance;t+=.2){const x=o[0]+d[0]*t,y=o[1]+d[1]*t,z=o[2]+d[2]*t,c=grid[Math.floor(z/4)]?.[Math.floor(x/4)]??1,h=({1:4,2:2.6,3:1.15,11:4.2})[c]||0;if((h&&y>=0&&y<=h)||(c===4&&y>=-1.3&&y<=0)||(y<=0&&![4,5,6,7].includes(c))){distance=t;break;}}return distance;}
 function create(T,scene,grid,map){
  const group=new T.Group();group.name='Walkable two-storey buildings';scene.add(group);const source=new T.BoxGeometry(1,1,1),textures=[],materials=[],geometries=[];
  for(const kind of ['wall','floor','roof','step','rail','trim','glass']){
   const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d');c.fillStyle=kind==='glass'?'#263c42':kind==='trim'?'#a99b81':kind==='wall'?(map==='inferno'?'#b49f84':'#c4b397'):kind==='roof'?'#89857b':kind==='rail'?'#66706e':'#a39883';c.fillRect(0,0,256,256);let seed=49;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   for(let n=0;n<12000;n++){const v=random();c.fillStyle=v>.5?'rgba(255,249,235,.10)':'rgba(51,40,27,.10)';c.fillRect(random()*256,random()*256,1+random()*3,1+random()*2);}
   for(let n=0;n<16;n++){const x=random()*256,y=random()*256,r=12+random()*35,g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba(62,48,32,.12)');g.addColorStop(1,'rgba(62,48,32,0)');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}
   if(kind==='floor'||kind==='roof'){c.strokeStyle='#3e392c55';c.lineWidth=1.5;for(let y=0;y<256;y+=64){c.beginPath();c.moveTo(0,y);c.lineTo(256,y);c.stroke();for(let x=(y%128?32:0);x<256;x+=64){c.beginPath();c.moveTo(x,y);c.lineTo(x,y+64);c.stroke();}}}else if(kind==='wall'){for(let n=0;n<5;n++){let x=random()*256,y=random()*256;c.strokeStyle='#5b514233';c.lineWidth=.7;c.beginPath();c.moveTo(x,y);for(let k=0;k<6;k++){x+=(random()-.5)*12;y+=random()*9;c.lineTo(x,y);}c.stroke();}}
   const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=4;textures.push(texture);const bump=texture.clone();bump.colorSpace=T.NoColorSpace;bump.needsUpdate=true;textures.push(bump);
   const mat=new T.MeshStandardMaterial({map:texture,bumpMap:bump,bumpScale:kind==='wall'?.035:.02,roughness:kind==='glass'?.22:kind==='rail'?.64:.94,metalness:kind==='glass'?.35:kind==='rail'?.25:0,dithering:true,vertexColors:true});materials.push(mat);
   const positions=[],normals=[],uvs=[],colors=[],indices=[],pos=source.attributes.position,norm=source.attributes.normal;
   for(const box of layout(grid,map).boxes.filter(b=>b.kind===kind)){const base=positions.length/3,tint=1-((box.building*17)%7)*.012;for(let i=0;i<pos.count;i++){const v=[pos.getX(i),pos.getY(i),pos.getZ(i)].map((v,j)=>(v+.5)*(box.max[j]-box.min[j])+box.min[j]);const n=[norm.getX(i),norm.getY(i),norm.getZ(i)];positions.push(...v);normals.push(...n);uvs.push((Math.abs(n[0])>.5?v[2]:v[0])*.5,(Math.abs(n[1])>.5?v[2]:v[1])*.5);colors.push(tint,tint,tint);}for(const index of source.index.array)indices.push(base+index);}
   const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeBoundingSphere();geometries.push(geo);const mesh=new T.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }source.dispose();return {dispose(){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.removeFromParent();}};
 }

 return {layout,contains,rayBox,ray,collide,vertical,trace,create};
});
