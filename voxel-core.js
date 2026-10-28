/* Original Support Hub block world. Shared deterministic generation and rules. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.HubVoxelCore=api;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const SIZE=16,HEIGHT=64,LIMIT=1000000,WATER=12;
 const blocks={
  0:{name:'Воздух'},1:{name:'Дёрн',color:'#6d9e46'},2:{name:'Земля',color:'#88613e'},3:{name:'Камень',color:'#898c88',tool:1},
  4:{name:'Бревно',color:'#79603d'},5:{name:'Листва',color:'#527e3c'},6:{name:'Доски',color:'#b58c54'},7:{name:'Кирпичи',color:'#ab6e58'},8:{name:'Стекло',color:'#b0d8df',transparent:true},
  9:{name:'Песок',color:'#d7c38d'},10:{name:'Угольная руда',color:'#55595a',tool:1,drop:102},11:{name:'Железная руда',color:'#ab9a86',tool:2,drop:103},
  12:{name:'Вода',color:'#428ab8',transparent:true,fluid:true},13:{name:'Основание',color:'#414847',unbreakable:true},14:{name:'Верстак',color:'#9b713e'},15:{name:'Печь',color:'#646967'},16:{name:'Светокамень',color:'#eac878'},
  17:{name:'Золотая руда',color:'#c6aa54',tool:3,drop:108},18:{name:'Кристальная руда',color:'#55b5ba',tool:3,drop:109}
 };
 const items={...blocks,101:{name:'Палка'},102:{name:'Уголь'},103:{name:'Железная заготовка'},104:{name:'Деревянная кирка',tier:1},105:{name:'Каменная кирка',tier:2},106:{name:'Железная кирка',tier:3},107:{name:'Кристальная кирка',tier:4},108:{name:'Золотая заготовка'},109:{name:'Кристалл'}};
 const recipes=[
  {id:'planks',name:'Доски ×4',in:{4:1},out:{6:4}}, {id:'sticks',name:'Палки ×4',in:{6:2},out:{101:4}},
  {id:'table',name:'Верстак',in:{6:4},out:{14:1}}, {id:'wood-pick',name:'Деревянная кирка',in:{6:3,101:2},out:{104:1},station:14},
  {id:'stone-pick',name:'Каменная кирка',in:{3:3,101:2},out:{105:1},station:14}, {id:'iron-pick',name:'Железная кирка',in:{103:3,101:2},out:{106:1},station:14},
  {id:'crystal-pick',name:'Кристальная кирка',in:{109:3,101:2},out:{107:1},station:14}, {id:'furnace',name:'Печь',in:{3:8},out:{15:1},station:14},
  {id:'glass',name:'Стекло ×4',in:{9:4,102:1},out:{8:4},station:15}, {id:'bricks',name:'Кирпичи ×4',in:{3:4,102:1},out:{7:4},station:15},
  {id:'charcoal',name:'Уголь ×2',in:{4:2},out:{102:2},station:15}, {id:'light',name:'Светокамень ×4',in:{3:4,102:2},out:{16:4},station:14}
 ];
 function hash(x,z,seed=1){let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;}
 function noise(x,z,seed){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);const a=hash(ix,iz,seed)*(1-u)+hash(ix+1,iz,seed)*u,b=hash(ix,iz+1,seed)*(1-u)+hash(ix+1,iz+1,seed)*u;return a*(1-v)+b*v;}
 function height(x,z,seed){return Math.floor(9+noise(x/55,z/55,seed)*17+noise(x/16,z/16,seed+91)*5);}
 function tree(x,z,seed){return height(x,z,seed)>WATER+1&&hash(x,z,seed+318)>.993&&Math.hypot(x,z)>5;}
 function terrain(x,y,z,seed){if(y<0)return 13;if(y>=HEIGHT)return 0;const h=height(x,z,seed);if(y===0)return 13;
  if(y<=h){if(y<h-4&&y>3&&noise(x/8,z/8,seed+y*11)>.81)return 0;if(y===h)return h<=WATER+1?9:1;if(y>h-3)return 2;
   const r=hash(x+y*97,z-y*53,seed+712);return r>.997&&y<9?18:r>.992&&y<13?17:r>.978?11:r>.95?10:3;
  }
  if(y<=WATER)return 12;
  if(tree(x,z,seed)&&y<=h+5)return 4;
  if(y>h+8)return 0;
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){const tx=x+dx,tz=z+dz,th=height(tx,tz,seed);if(y>=th+3&&y<=th+6&&Math.abs(dx)+Math.abs(dz)+(y===th+6?1:0)<=3&&tree(tx,tz,seed))return 5;}
  return 0;
 }
 function generate(cx,cz,seed){const data=new Uint8Array(HEIGHT*256),heights=new Map(),trees=[];for(let z=-2;z<18;z++)for(let x=-2;x<18;x++){const wx=cx*16+x,wz=cz*16+z,h=height(wx,wz,seed);heights.set(x+','+z,h);if(h>WATER+1&&hash(wx,wz,seed+318)>.993&&Math.hypot(wx,wz)>5)trees.push({x,z,h});}
  for(let z=0;z<16;z++)for(let x=0;x<16;x++){const wx=cx*16+x,wz=cz*16+z,h=heights.get(x+','+z);for(let y=0;y<=Math.max(h,WATER);y++){let id=0;if(y===0)id=13;else if(y<=h){if(y<h-4&&y>3&&noise(wx/8,wz/8,seed+y*11)>.81)id=0;else if(y===h)id=h<=WATER+1?9:1;else if(y>h-3)id=2;else{const r=hash(wx+y*97,wz-y*53,seed+712);id=r>.997&&y<9?18:r>.992&&y<13?17:r>.978?11:r>.95?10:3;}}else id=12;data[y*256+z*16+x]=id;}
   for(const t of trees){if(Math.abs(t.x-x)>2||Math.abs(t.z-z)>2)continue;for(let y=Math.max(h+1,t.h+1);y<=Math.min(h+8,t.h+6,HEIGHT-1);y++){const index=y*256+z*16+x;if(data[index]===12)continue;if(t.x===x&&t.z===z&&y<=t.h+5)data[index]=4;else if(y>=t.h+3&&Math.abs(t.x-x)+Math.abs(t.z-z)+(y===t.h+6?1:0)<=3&&data[index]!==4)data[index]=5;}}
  }return data;
 }
 const chunk=(x,z)=>[Math.floor(x/SIZE),Math.floor(z/SIZE)];
 const key=(x,y,z)=>`${((x%SIZE)+SIZE)%SIZE}_${y}_${((z%SIZE)+SIZE)%SIZE}`;
 const solid=id=>id!==0&&id!==12;
 function validPos(p){return Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&Math.abs(p[0])<LIMIT&&Math.abs(p[2])<LIMIT&&p[1]>=-8&&p[1]<HEIGHT+16;}
 function validCell(p){return validPos(p)&&p.every(Number.isInteger)&&p[1]>0&&p[1]<HEIGHT;}
 function intersects(pos,x,y,z){return pos[0]+.28>x&&pos[0]-.28<x+1&&pos[1]+1.75>y&&pos[1]<y+1&&pos[2]+.28>z&&pos[2]-.28<z+1;}
 function craft(inventory,id){const r=recipes.find(r=>r.id===id);if(!r)throw Error('Неизвестный рецепт');const out={...inventory};for(const [item,n]of Object.entries(r.in)){if((out[item]||0)<n)throw Error('Не хватает ресурсов');out[item]-=n;}for(const [item,n]of Object.entries(r.out)){out[item]=(out[item]||0)+n;if(out[item]>9999)throw Error('Инвентарь заполнен');}return out;}
 function ray(origin,dir,get,range=6){let previous=origin.map(Math.floor);for(let t=0;t<=range;t+=.04){const at=origin.map((v,i)=>Math.floor(v+dir[i]*t));if(solid(get(...at)))return {at,previous};previous=at;}return null;}
 return {SIZE,HEIGHT,LIMIT,WATER,blocks,items,recipes,hash,height,terrain,generate,chunk,key,solid,validPos,validCell,intersects,craft,ray};
});
