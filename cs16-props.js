(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CS16Props=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function generate(grid,map){const out=[],seed=map==='inferno'?917:331;
  const hash=(x,z)=>{let n=Math.imul(x+seed,374761393)^Math.imul(z+11,668265263);n=Math.imul(n^(n>>>13),1274126177);return(n^(n>>>16))>>>0;};
  for(let z=2;z<grid.length-2;z++)for(let x=2;x<grid[0].length-2;x++){
   if(grid[z][x]!==0)continue;const h=hash(x,z);if(h%100>56)continue;
   let open=0,underground=false;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const v=grid[z+dz][x+dx];if(v===0)open++;if(v>=4&&v<=11)underground=true;}if(underground)continue;
   const kind=open>=7&&h%9===0?'tree':h%7===0?'fence':h%11===0?'barrel':h%5===0?'sandbags':h%3===0?'grass':'shrub';
   out.push({id:out.length,x:x*4+(h&1?.65:3.35),z:z*4+(h&2?.65:3.35),kind,scale:.75+(h%50)/100,yaw:(h%628)/100});
  }return out;
 }
 function create(T,scene,grid,map){const items=generate(grid,map),group=new T.Group();group.name='CS16 destructible field';scene.add(group);
  const slots=new Map(),bins=new Map(),batches=new Map(),broken=new Set(),debris=[],dummy=new T.Object3D(),zero=new T.Matrix4().makeScale(0,0,0);
  const dry=map!=='inferno';
  function cards(){const vertices=[],uv=[],indices=[];for(let i=0;i<3;i++){const a=i*Math.PI/3,c=Math.cos(a),s=Math.sin(a),base=vertices.length/3;vertices.push(-c,-1,-s,c,-1,s,c,1,s,-c,1,-s);uv.push(0,0,1,0,1,1,0,1);indices.push(base,base+1,base+2,base,base+2,base+3);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;}
  function foliageTexture(grass){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');let seed=431;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   if(grass){for(let n=0;n<65;n++){const x=78+random()*100,y=35+random()*170,bend=(random()-.5)*130,g=100+Math.floor(random()*140);ctx.strokeStyle='rgb('+g+','+g+','+Math.floor(g*.82)+')';ctx.lineWidth=1+random()*3;ctx.beginPath();ctx.moveTo(x,255);ctx.quadraticCurveTo(x+bend*.3,155,x+bend,y);ctx.stroke();}}
   else{ctx.strokeStyle='#635f50';ctx.lineWidth=5;for(let n=0;n<15;n++){const a=random()*Math.PI*2,r=40+random()*60;ctx.beginPath();ctx.moveTo(128,245);ctx.quadraticCurveTo(128,135,128+Math.cos(a)*r,110+Math.sin(a)*r);ctx.stroke();}for(let n=0;n<1050;n++){const a=random()*Math.PI*2,r=Math.sqrt(random()),x=128+Math.cos(a)*r*113,y=120+Math.sin(a)*r*108,g=75+Math.floor(random()*175);ctx.fillStyle='rgb('+Math.floor(g*.91)+','+g+','+Math.floor(g*.8)+')';ctx.beginPath();ctx.ellipse(x,y,2+random()*6,1.5+random()*4,a,0,Math.PI*2);ctx.fill();}}
   const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;return texture;
  }
  const leafTexture=foliageTexture(false),grassTexture=foliageTexture(true);
  const resources={wood:[new T.CylinderGeometry(.12,.18,1,7),0x66543b],leaf:[cards(),dry?0xa7aa73:0x91a777],bush:[cards(),dry?0xb3ac79:0xa0b47a],grass:[cards(),dry?0xc9b486:0x9baa72],plank:[new T.BoxGeometry(1,1,1),0x85714d],bag:[new T.SphereGeometry(1,8,5),0x9d9473],barrel:[new T.CylinderGeometry(.38,.38,.9,12),0x58665c]};
  function part(item,type,x,y,z,sx,sy,sz,rotation=0){if(!batches.has(type))batches.set(type,[]);dummy.position.set(item.x+x,y,item.z+z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(0,rotation,0);dummy.updateMatrix();batches.get(type).push({id:item.id,matrix:dummy.matrix.clone()});}
  for(const item of items){const s=item.scale,key=Math.floor(item.x/4)+','+Math.floor(item.z/4);bins.set(key,item.id);
   if(item.kind==='tree'){part(item,'wood',0,2*s,0,1,4*s,1);if(dry){for(let n=0;n<6;n++){const a=n*Math.PI/3;part(item,'leaf',Math.cos(a)*1.1*s,4*s,Math.sin(a)*1.1*s,1.7*s,.3*s,.6*s,-a);}}else{part(item,'leaf',0,3.6*s,0,1.2*s,2.5*s,1.2*s);part(item,'leaf',0,5*s,0,.65*s,1.7*s,.65*s);}}
   else if(item.kind==='shrub'){for(let n=0;n<3;n++)part(item,'bush',Math.cos(n*2.1)*.4,.4*s,Math.sin(n*2.1)*.4,.7*s,.65*s,.65*s);}
   else if(item.kind==='grass'){for(let n=0;n<4;n++)part(item,'grass',Math.cos(n*2.4)*.5,.3*s,Math.sin(n*2.4)*.5,.45,.4*s,.45,item.yaw+n);}
   else if(item.kind==='fence'){for(const x of [-.8,.8])part(item,'plank',x,.55,0,.12,1.1,.12);for(const y of [.35,.8])part(item,'plank',0,y,0,1.8,.17,.09);}
   else if(item.kind==='sandbags'){for(let n=0;n<5;n++)part(item,'bag',(n%3-.8)*.55,.2+Math.floor(n/3)*.3,0,.42,.21,.27,item.yaw);}
   else{part(item,'barrel',0,.45,0,1,1,1);part(item,'barrel',.65,.45,.25,.85,1,.85);}
  }
  for(const [type,parts] of batches){const [geo,color]=resources[type],plant=['leaf','bush','grass'].includes(type),mat=new T.MeshStandardMaterial({color,roughness:.92,metalness:type==='barrel'?.35:0,...(plant?{map:type==='grass'?grassTexture:leafTexture,alphaTest:.4,side:T.DoubleSide}: {})});const mesh=new T.InstancedMesh(geo,mat,parts.length);mesh.castShadow=type!=='grass';mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.name='Field '+type;
   parts.forEach((p,index)=>{mesh.setMatrixAt(index,p.matrix);if(!slots.has(p.id))slots.set(p.id,[]);slots.get(p.id).push({mesh,index,matrix:p.matrix});});mesh.computeBoundingSphere();group.add(mesh);
  }
  function destroy(id,fx=true){const item=items[id];if(!item||broken.has(id))return false;broken.add(id);for(const slot of slots.get(id)||[]){slot.mesh.setMatrixAt(slot.index,zero);slot.mesh.instanceMatrix.needsUpdate=true;}
   if(fx&&debris.length<70){for(let n=0;n<5;n++){const mesh=new T.Mesh(new T.BoxGeometry(.17,.12,.35),new T.MeshStandardMaterial({color:item.kind==='tree'||item.kind==='shrub'?0x6c8244:0x9c8659,roughness:1}));mesh.position.set(item.x,.5,item.z);group.add(mesh);debris.push({mesh,vx:(Math.random()-.5)*5,vz:(Math.random()-.5)*5,vy:2+Math.random()*3,t:0});}}return true;
  }
  function near(x,z){const ids=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const id=bins.get((Math.floor(x/4)+dx)+','+(Math.floor(z/4)+dz)),v=items[id];if(v&&!broken.has(id)&&Math.hypot(v.x-x,v.z-z)<3.2)ids.push(id);}return ids;}
  function update(dt){for(let i=debris.length-1;i>=0;i--){const d=debris[i];d.t+=dt;d.vy-=9*dt;d.mesh.position.x+=d.vx*dt;d.mesh.position.y+=d.vy*dt;d.mesh.position.z+=d.vz*dt;d.mesh.rotation.x+=dt*4;if(d.t>1.4){d.mesh.removeFromParent();d.mesh.geometry.dispose();d.mesh.material.dispose();debris.splice(i,1);}}}
  function reset(){broken.clear();for(const ss of slots.values())for(const s of ss){s.mesh.setMatrixAt(s.index,s.matrix);s.mesh.instanceMatrix.needsUpdate=true;}}
  function dispose(){group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});leafTexture.dispose();grassTexture.dispose();group.removeFromParent();debris.length=0;}
  return {items,destroy,near,update,reset,dispose,broken};
 }
 return {generate,create};
});
