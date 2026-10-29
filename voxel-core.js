/* Original Support Hub block world. Shared deterministic generation and rules. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.HubVoxelCore=api;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const SIZE=16,HEIGHT=64,LIMIT=1000000,WATER=12;
 const blocks={
  0:{name:'Воздух'},1:{name:'Дёрн',color:'#6d9e46'},2:{name:'Земля',color:'#88613e'},3:{name:'Камень',color:'#898c88',tool:1},
  4:{name:'Бревно',color:'#79603d'},5:{name:'Листва',color:'#527e3c'},6:{name:'Доски',color:'#b58c54'},7:{name:'Кирпичи',color:'#ab6e58'},8:{name:'Стекло',color:'#b0d8df',transparent:true},
  9:{name:'Песок',color:'#d7c38d'},10:{name:'Угольная руда',color:'#55595a',tool:1,drop:102},11:{name:'Железная руда',color:'#ab9a86',tool:2,drop:103},
  12:{name:'Вода',color:'#428ab8',transparent:true,fluid:true},13:{name:'Основание',color:'#414847',unbreakable:true},14:{name:'Верстак',color:'#9b713e'},15:{name:'Печь',color:'#646967'},16:{name:'Светокамень',color:'#eac878'},
  17:{name:'Золотая руда',color:'#c6aa54',tool:3,drop:108},18:{name:'Кристальная руда',color:'#55b5ba',tool:3,drop:109},19:{name:'Снег',color:'#e2ebeb'},20:{name:'Глина',color:'#a3a29b'},21:{name:'Кактус',color:'#54824b'},22:{name:'Хвойное бревно',color:'#59432f'},23:{name:'Хвоя',color:'#335c4a'},24:{name:'Красный песчаник',color:'#b86f46',tool:1}
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
 // Timings are shared for feedback, but the server owns the mining clock.
 const profiles={1:[.6,'shovel'],2:[.5,'shovel'],3:[1.5,'pick'],4:[2,'axe'],5:[.2,''],6:[2,'axe'],7:[2,'pick'],8:[.3,''],9:[.5,'shovel'],10:[3,'pick'],11:[3,'pick'],14:[2.5,'axe'],15:[3.5,'pick'],16:[.3,''],17:[3,'pick'],18:[3,'pick'],19:[.2,'shovel'],20:[.6,'shovel'],21:[.4,'axe'],22:[2,'axe'],23:[.2,''],24:[.8,'pick']};
 for(const[id,[hardness,kind]]of Object.entries(profiles))Object.assign(blocks[id],{hardness,kind});
 for(const id of [104,105,106,107])items[id].kind='pick';
 for(const [id,name,kind,tier]of [[110,'Деревянный топор','axe',1],[111,'Каменный топор','axe',2],[112,'Железный топор','axe',3],[113,'Кристальный топор','axe',4],[114,'Деревянная лопата','shovel',1],[115,'Каменная лопата','shovel',2],[116,'Железная лопата','shovel',3],[117,'Кристальная лопата','shovel',4]])items[id]={name,kind,tier};
 const patterns={planks:[[4]],sticks:[[6],[6]],table:[[6,6],[6,6]],'wood-pick':[[6,6,6],[0,101,0],[0,101,0]],'stone-pick':[[3,3,3],[0,101,0],[0,101,0]],'iron-pick':[[103,103,103],[0,101,0],[0,101,0]],'crystal-pick':[[109,109,109],[0,101,0],[0,101,0]],furnace:[[3,3,3],[3,0,3],[3,3,3]],light:[[3,102,3],[3,102,3]]};
 for(const r of recipes)if(patterns[r.id])r.pattern=patterns[r.id];
 for(const[kind,start]of [['axe',110],['shovel',114]])for(let i=0;i<4;i++){const material=[6,3,103,109][i],id=start+i;recipes.push({id:kind+'-'+i,name:items[id].name,in:{[material]:kind==='axe'?3:1,101:2},out:{[id]:1},station:14,pattern:kind==='axe'?[[material,material],[material,101],[0,101]]:[[material],[101],[101]]});}
 recipes.push({id:'pine-planks',name:'Доски из хвойного бревна ×4',in:{22:1},out:{6:4},pattern:[[22]]},{id:'clay-bricks',name:'Кирпичи из глины ×4',in:{20:4,102:1},out:{7:4},station:15});
 const biomeNames={plains:'Равнины',forest:'Лес',taiga:'Тайга',snow:'Тундра',desert:'Пустыня',badlands:'Красные скалы',swamp:'Болото'};
 // Positive seeds preserve generation v1 exactly. New worlds use negative seeds (v2).
 function biome(x,z,seed){if(seed>=0)return 'plains';const heat=noise(x/150,z/150,seed+991),wet=noise(x/130,z/130,seed+1927);return heat<.28?'snow':heat<.4?'taiga':heat>.68?(wet<.48?'desert':'badlands'):wet>.72?'swamp':wet>.48?'forest':'plains';}
 function surface(x,z,seed,h){if(h<=WATER+1)return 9;const b=biome(x,z,seed);return b==='snow'?19:b==='desert'?9:b==='badlands'?24:b==='swamp'?20:1;}
 function subsoil(x,z,seed){const b=biome(x,z,seed);return b==='desert'?9:b==='badlands'?24:b==='swamp'?20:2;}
 function logAt(x,z,seed){return ['taiga','snow'].includes(biome(x,z,seed))?22:4;}
 function cactus(x,z,seed){return seed<0&&biome(x,z,seed)==='desert'&&height(x,z,seed)>WATER+1&&hash(x,z,seed+555)>.985&&Math.hypot(x,z)>5;}
 function trimmed(grid){const rows=grid.filter(row=>row.some(Boolean));if(!rows.length)return [];let left=Infinity,right=-1;for(const row of rows)row.forEach((id,x)=>{if(id){left=Math.min(left,x);right=Math.max(right,x);}});const top=grid.findIndex(row=>row.some(Boolean)),bottom=grid.length-1-[...grid].reverse().findIndex(row=>row.some(Boolean));return grid.slice(top,bottom+1).map(row=>row.slice(left,right+1));}
 function matchRecipe(grid){if(!Array.isArray(grid)||![2,3].includes(grid.length)||grid.some(row=>!Array.isArray(row)||row.length!==grid.length||row.some(id=>!Number.isInteger(id)||id<0||id&&!items[id])))return null;const shape=JSON.stringify(trimmed(grid));return recipes.find(r=>r.pattern&&(JSON.stringify(r.pattern)===shape||JSON.stringify(r.pattern.map(row=>[...row].reverse()))===shape))||null;}
 function mining(block,tool=0){const b=blocks[block],t=items[tool];if(!b||!b.hardness||b.fluid||b.unbreakable)return null;const correct=t?.kind===b.kind,harvest=!b.tool||(t?.kind==='pick'&&(t.tier||0)>=b.tool);const speed=correct?[1,2,4,6,8][t.tier||0]:1;return {ms:Math.ceil(b.hardness*(harvest?1500:5000)/speed/50)*50,harvest};}
 function hash(x,z,seed=1){let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;}
 function noise(x,z,seed){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);const a=hash(ix,iz,seed)*(1-u)+hash(ix+1,iz,seed)*u,b=hash(ix,iz+1,seed)*(1-u)+hash(ix+1,iz+1,seed)*u;return a*(1-v)+b*v;}
 function height(x,z,seed){return Math.floor(9+noise(x/55,z/55,seed)*17+noise(x/16,z/16,seed+91)*5);}
 function tree(x,z,seed){const b=biome(x,z,seed);return b!=='desert'&&b!=='badlands'&&height(x,z,seed)>WATER+1&&hash(x,z,seed+318)>(seed>=0?.993:b==='forest'||b==='taiga'?.978:.993)&&Math.hypot(x,z)>5;}
 function terrain(x,y,z,seed){if(y<0)return 13;if(y>=HEIGHT)return 0;const h=height(x,z,seed);if(y===0)return 13;
  if(y<=h){if(y<h-4&&y>3&&noise(x/8,z/8,seed+y*11)>.81)return 0;if(y===h)return surface(x,z,seed,h);if(y>h-3)return subsoil(x,z,seed);
   const r=hash(x+y*97,z-y*53,seed+712);return r>.997&&y<9?18:r>.992&&y<13?17:r>.978?11:r>.95?10:3;
  }
  if(y<=WATER)return 12;
  if(cactus(x,z,seed)&&y<=h+3)return 21;if(tree(x,z,seed)&&y<=h+5)return logAt(x,z,seed);
  if(y>h+8)return 0;
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){const tx=x+dx,tz=z+dz,th=height(tx,tz,seed);if(y>=th+3&&y<=th+6&&Math.abs(dx)+Math.abs(dz)+(y===th+6?1:0)<=3&&tree(tx,tz,seed))return logAt(tx,tz,seed)===22?23:5;}
  return 0;
 }
 function generate(cx,cz,seed){const data=new Uint8Array(HEIGHT*256),heights=new Map(),trees=[];for(let z=-2;z<18;z++)for(let x=-2;x<18;x++){const wx=cx*16+x,wz=cz*16+z,h=height(wx,wz,seed);heights.set(x+','+z,h);if(tree(wx,wz,seed))trees.push({x,z,h,log:logAt(wx,wz,seed)});}
  for(let z=0;z<16;z++)for(let x=0;x<16;x++){const wx=cx*16+x,wz=cz*16+z,h=heights.get(x+','+z);for(let y=0;y<=Math.max(h,WATER);y++){let id=0;if(y===0)id=13;else if(y<=h){if(y<h-4&&y>3&&noise(wx/8,wz/8,seed+y*11)>.81)id=0;else if(y===h)id=surface(wx,wz,seed,h);else if(y>h-3)id=subsoil(wx,wz,seed);else{const r=hash(wx+y*97,wz-y*53,seed+712);id=r>.997&&y<9?18:r>.992&&y<13?17:r>.978?11:r>.95?10:3;}}else id=12;data[y*256+z*16+x]=id;}
   for(const t of trees){if(Math.abs(t.x-x)>2||Math.abs(t.z-z)>2)continue;for(let y=Math.max(h+1,t.h+1);y<=Math.min(h+8,t.h+6,HEIGHT-1);y++){const index=y*256+z*16+x;if(data[index]===12)continue;if(t.x===x&&t.z===z&&y<=t.h+5)data[index]=t.log;else if(y>=t.h+3&&Math.abs(t.x-x)+Math.abs(t.z-z)+(y===t.h+6?1:0)<=3&&data[index]===0)data[index]=t.log===22?23:5;}}
   if(cactus(wx,wz,seed))for(let y=h+1;y<=Math.min(h+3,HEIGHT-1);y++)data[y*256+z*16+x]=21;
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
 return {SIZE,HEIGHT,LIMIT,WATER,blocks,items,recipes,hash,height,terrain,generate,chunk,key,solid,validPos,validCell,intersects,craft,ray,matchRecipe,mining,biome,biomeNames};
});
