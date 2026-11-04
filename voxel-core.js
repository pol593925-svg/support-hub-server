/* Original Support Hub block world. Shared deterministic generation and rules. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.HubVoxelCore=api;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const SIZE=16,HEIGHT=64,LIMIT=1000000,WATER=12;
 const blocks={
  0:{name:'Воздух'},1:{name:'Дёрн',color:'#6d9e46'},2:{name:'Земля',color:'#88613e'},3:{name:'Камень',color:'#898c88',tool:1},
  4:{name:'Бревно',color:'#79603d'},5:{name:'Листва',color:'#527e3c'},6:{name:'Доски',color:'#b58c54'},7:{name:'Кирпичи',color:'#ab6e58'},8:{name:'Стекло',color:'#b0d8df',transparent:true},
  9:{name:'Песок',color:'#d7c38d'},10:{name:'Угольная руда',color:'#55595a',tool:1,drop:102},11:{name:'Железная руда',color:'#ab9a86',tool:2,drop:103},
  12:{name:'Вода',color:'#428ab8',transparent:true,fluid:true},13:{name:'Основание',color:'#414847',unbreakable:true},14:{name:'Верстак',color:'#9b713e'},15:{name:'Печь',color:'#646967'},16:{name:'Светокамень',color:'#eac878'},
  17:{name:'Золотая руда',color:'#c6aa54',tool:3,drop:108},18:{name:'Кристальная руда',color:'#55b5ba',tool:3,drop:109},19:{name:'Снег',color:'#e2ebeb'},20:{name:'Глина',color:'#a3a29b'},21:{name:'Кактус',color:'#54824b'},22:{name:'Хвойное бревно',color:'#59432f'},23:{name:'Хвоя',color:'#335c4a'},24:{name:'Красный песчаник',color:'#b86f46',tool:1},25:{name:'Сундук',color:'#b68642'},26:{name:'Грядка',color:'#705034'},27:{name:'Ростки пшеницы',color:'#77a340',transparent:true},28:{name:'Спелая пшеница',color:'#d6b657',transparent:true}
 };
 for(let level=1;level<=8;level++)blocks[28+level]={name:level===8?'Падающая вода':'Текущая вода',color:'#428ab8',transparent:true,fluid:true,level};
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
 const profiles={1:[.6,'shovel'],2:[.5,'shovel'],3:[1.5,'pick'],4:[2,'axe'],5:[.2,''],6:[2,'axe'],7:[2,'pick'],8:[.3,''],9:[.5,'shovel'],10:[3,'pick'],11:[3,'pick'],14:[2.5,'axe'],15:[3.5,'pick'],16:[.3,''],17:[3,'pick'],18:[3,'pick'],19:[.2,'shovel'],20:[.6,'shovel'],21:[.4,'axe'],22:[2,'axe'],23:[.2,''],24:[.8,'pick'],25:[2.5,'axe'],26:[.6,'shovel'],27:[.1,''],28:[.1,'']};
 for(const[id,[hardness,kind]]of Object.entries(profiles))Object.assign(blocks[id],{hardness,kind});
 for(const id of [104,105,106,107])items[id].kind='pick';
 for(const [id,name,kind,tier]of [[110,'Деревянный топор','axe',1],[111,'Каменный топор','axe',2],[112,'Железный топор','axe',3],[113,'Кристальный топор','axe',4],[114,'Деревянная лопата','shovel',1],[115,'Каменная лопата','shovel',2],[116,'Железная лопата','shovel',3],[117,'Кристальная лопата','shovel',4]])items[id]={name,kind,tier};
 const patterns={planks:[[4]],sticks:[[6],[6]],table:[[6,6],[6,6]],'wood-pick':[[6,6,6],[0,101,0],[0,101,0]],'stone-pick':[[3,3,3],[0,101,0],[0,101,0]],'iron-pick':[[103,103,103],[0,101,0],[0,101,0]],'crystal-pick':[[109,109,109],[0,101,0],[0,101,0]],furnace:[[3,3,3],[3,0,3],[3,3,3]],light:[[3,102,3],[3,102,3]]};
 for(const r of recipes)if(patterns[r.id])r.pattern=patterns[r.id];
 for(const[kind,start]of [['axe',110],['shovel',114]])for(let i=0;i<4;i++){const material=[6,3,103,109][i],id=start+i;recipes.push({id:kind+'-'+i,name:items[id].name,in:{[material]:kind==='axe'?3:1,101:2},out:{[id]:1},station:14,pattern:kind==='axe'?[[material,material],[material,101],[0,101]]:[[material],[101],[101]]});}
 recipes.push({id:'pine-planks',name:'Доски из хвойного бревна ×4',in:{22:1},out:{6:4},pattern:[[22]]},{id:'clay-bricks',name:'Кирпичи из глины ×4',in:{20:4,102:1},out:{7:4},station:15});
 Object.assign(items,{121:{name:'Семена пшеницы'},122:{name:'Пшеница'},123:{name:'Хлеб',food:5},124:{name:'Деревянная мотыга',kind:'hoe',tier:1},118:{name:'Яблоко',food:4},119:{name:'Плод кактуса',food:3},120:{name:'Печёное яблоко',food:6}});
 for(let i=0;i<4;i++){const id=125+i,material=[6,3,103,109][i];items[id]={name:['Деревянный меч','Каменный меч','Железный меч','Кристальный меч'][i],kind:'sword',tier:i+1,damage:4+i};recipes.push({id:'sword-'+i,name:items[id].name,in:{[material]:2,101:1},out:{[id]:1},station:14,pattern:[[material],[material],[101]]});}
 Object.assign(items,{130:{name:'Ведро'},131:{name:'Ведро воды'},132:{name:'Сырое мясо',food:3},133:{name:'Жареное мясо',food:8},134:{name:'Шерсть'},135:{name:'Кожа'}});
 recipes.push({id:'bucket',name:'Ведро',in:{103:3},out:{130:1},station:14,pattern:[[103,0,103],[0,103,0]]},{id:'cooked-meat',name:'Жареное мясо ×4',in:{132:4,102:1},out:{133:4},station:15});
 for(const item of Object.values(items))if(item.kind)item.durability=[0,59,131,250,1561][item.tier];
 recipes.push({id:'baked-apples',name:'Печёные яблоки ×4',in:{118:4,102:1},out:{120:4},station:15});
 recipes.push({id:'chest',name:'Сундук',in:{6:8},out:{25:1},station:14,pattern:[[6,6,6],[6,0,6],[6,6,6]]},{id:'wood-hoe',name:'Деревянная мотыга',in:{6:2,101:2},out:{124:1},station:14,pattern:[[6,6],[0,101],[0,101]]},{id:'bread',name:'Хлеб',in:{122:3},out:{123:1},station:14,pattern:[[122,122,122]]});
 const charcoal=recipes.find(r=>r.id==='charcoal');charcoal.in={4:1,6:2};charcoal.out={102:1};charcoal.name='Древесный уголь';
 for(const recipe of recipes)if(recipe.station===15)recipe.smeltMs=10000*Math.max(...Object.values(recipe.out));
 const Bedrock=typeof window==='undefined'?require('./voxel-bedrock'):window.HubBedrock;
 const catalog=Bedrock.install(blocks,items,recipes);
 // Encode both halves in the existing chunk edits so a single revision carries a whole door.
 const doorIds=new Set(catalog.blockNames.filter(k=>k.endsWith('_door')).map(catalog.blockId));
 const lever=catalog.ids.get('lever'),leverOn=-(lever*32+1),redstone=catalog.ids.get('redstone_block');
 const doorStates=new Map(),width=3/16;
 const panels=[[0,0,0,1,1,width],[1-width,0,0,1,1,1],[0,0,1-width,1,1,1],[0,0,0,width,1,1]];
 function doorCode(id,dir,right,open,upper){return -(id*32+(dir&3)+(right?4:0)+(open?8:0)+(upper?16:0)+1);}
 for(const id of doorIds){
   const metal=/iron|copper/.test(catalog.keys.get(id));
   Object.assign(blocks[id],{kind:metal?'pick':'axe',hardness:metal?5:3,tool:metal?1:0});
   doorStates.set(id,{id,dir:0,right:false,open:false,upper:false,legacy:true,bounds:panels[0]});
   for(let flags=0;flags<32;flags++){
     const dir=flags&3,right=!!(flags&4),open=!!(flags&8),upper=!!(flags&16);
     const side=(dir+(open?(right?1:3):0))%4;
     doorStates.set(doorCode(id,dir,right,open,upper),{id,dir,right,open,upper,bounds:panels[side]});
   }
 }
 const doorState=id=>doorStates.get(id),baseBlock=id=>doorState(id)?.id??(id===leverOn?lever:id);
 const powerOffsets=[[0,-1,0],[0,2,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1],[-1,1,0],[1,1,0],[0,1,-1],[0,1,1]];
 function effectiveBlock(get,x,y,z){
   const id=get(x,y,z),d=doorState(id);
   if(!d||d.legacy||d.open)return id;
   const baseY=d.upper?y-1:y;
   for(const [dx,dy,dz] of powerOffsets){
     const n=get(x+dx,baseY+dy,z+dz);if(n===leverOn||n===redstone)return doorCode(d.id,d.dir,d.right,true,d.upper);
   }
   return id;
 }
 function pointSolid(id,px,py,pz){
   const d=doorState(id);if(!d)return solid(id);
   const [x0,,z0,x1,,z1]=d.bounds,x=px-Math.floor(px),z=pz-Math.floor(pz);
   return x>=x0&&x<=x1&&z>=z0&&z<=z1;
 }
 function bodyHits(pos,x,y,z,id,low){
   if(!solid(id))return false;
   const b=doorState(id)?.bounds;
   if(!b)return intersects(pos,x,y,z,low);
   return pos[0]+.28>x+b[0]&&pos[0]-.28<x+b[3]&&pos[1]+bodyHeight(low)>y&&pos[1]<y+1&&pos[2]+.28>z+b[2]&&pos[2]-.28<z+b[5];
 }

 function costs(r,bag,grid){return r.options?Bedrock.plan(r,bag,grid):r.in;}
 function chestSlots(contents){return Object.entries(contents).reduce((n,[id,count])=>n+Math.ceil(count/(items[id]?.durability?1:64)),0);}
 function transfer(inventory,contents,wear,item,count,direction){if(!Number.isInteger(item)||!items[item]||item<=0||!Number.isInteger(count)||count<1||count>64||!['put','take'].includes(direction))throw Error('Неверный перенос');const bag={...inventory},chest={...contents},source=direction==='put'?bag:chest,target=direction==='put'?chest:bag;if((source[item]||0)<count)throw Error('Не хватает предметов');if(direction==='put'&&wear[item]!==undefined&&(bag[item]||0)-count<1)throw Error('Изношенный инструмент остаётся при тебе. Можно убрать новый запасной.');source[item]-=count;target[item]=(target[item]||0)+count;if(target[item]>9999||chestSlots(chest)>27)throw Error('Недостаточно места');return {inventory:bag,contents:chest};}
 function wearTool(inventory,wear,tool){const bag={...inventory},next={...wear},max=items[tool]?.durability;let broke=false;if(max&&bag[tool]>0){next[tool]=(Number.isFinite(next[tool])?Math.min(max,Math.max(1,next[tool])):max)-1;if(next[tool]<=0){bag[tool]--;delete next[tool];broke=true;}}return {inventory:bag,wear:next,broke};}
 function consume(inventory,vitals,id){const food=items[id]?.food;if(!food||!(inventory[id]>0))throw Error('Нет такой еды');if(vitals.hunger>=20)throw Error('Ты уже сыт');if(vitals.health<=0)throw Error('Сначала возродись');return {inventory:{...inventory,[id]:inventory[id]-1},vitals:{...vitals,hunger:Math.min(20,vitals.hunger+food)}};}
 const biomeNames={plains:'Равнины',forest:'Лес',taiga:'Тайга',snow:'Тундра',desert:'Пустыня',badlands:'Красные скалы',swamp:'Болото'};
 // Positive seeds preserve generation v1 exactly. New worlds use negative seeds (v2).
 function biome(x,z,seed){if(seed>=0)return 'plains';const heat=noise(x/150,z/150,seed+991),wet=noise(x/130,z/130,seed+1927);return heat<.28?'snow':heat<.4?'taiga':heat>.68?(wet<.48?'desert':'badlands'):wet>.72?'swamp':wet>.48?'forest':'plains';}
 function surface(x,z,seed,h){if(h<=WATER+1)return 9;const b=biome(x,z,seed);return b==='snow'?19:b==='desert'?9:b==='badlands'?24:b==='swamp'?20:1;}
 function subsoil(x,z,seed){const b=biome(x,z,seed);return b==='desert'?9:b==='badlands'?24:b==='swamp'?20:2;}
 function logAt(x,z,seed){return ['taiga','snow'].includes(biome(x,z,seed))?22:4;}
 function cactus(x,z,seed){return seed<0&&biome(x,z,seed)==='desert'&&height(x,z,seed)>WATER+1&&hash(x,z,seed+555)>.985&&Math.hypot(x,z)>5;}
 function trimmed(grid){const rows=grid.filter(row=>row.some(Boolean));if(!rows.length)return [];let left=Infinity,right=-1;for(const row of rows)row.forEach((id,x)=>{if(id){left=Math.min(left,x);right=Math.max(right,x);}});const top=grid.findIndex(row=>row.some(Boolean)),bottom=grid.length-1-[...grid].reverse().findIndex(row=>row.some(Boolean));return grid.slice(top,bottom+1).map(row=>row.slice(left,right+1));}
 function matchRecipe(grid,wanted){if(!Array.isArray(grid)||![2,3].includes(grid.length)||grid.some(row=>!Array.isArray(row)||row.length!==grid.length||row.some(id=>!Number.isInteger(id)||id<0||id&&!items[id])))return null;const trimmedShape=trimmed(grid),shape=JSON.stringify(trimmedShape);if(!trimmedShape.length)return null;return recipes.find(r=>(!wanted||r.id===wanted)&&r.pattern&&(r.options?Bedrock.match(r,trimmedShape):JSON.stringify(r.pattern)===shape||JSON.stringify(r.pattern.map(row=>[...row].reverse()))===shape))||null;}
 function mining(block,tool=0){const b=blocks[doorState(block)?.id??(block===leverOn?lever:block)],t=items[tool];if(!b||!b.hardness||b.fluid||b.unbreakable)return null;const correct=t?.kind===b.kind,harvest=!b.tool||(t?.kind==='pick'&&(t.tier||0)>=b.tool);const speed=correct?[1,2,4,6,8][t.tier||0]:1;return {ms:Math.ceil(b.hardness*(harvest?1500:5000)/speed/50)*50,harvest};}
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
 const fluid=id=>id===12||(id>=29&&id<=36);
 const solid=id=>id!==0&&!fluid(id)&&id!==27&&id!==28&&id!==lever&&id!==leverOn&&!blocks[id]?.flower;
 function validPos(p){return Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&Math.abs(p[0])<LIMIT&&Math.abs(p[2])<LIMIT&&p[1]>=-8&&p[1]<HEIGHT+16;}
 function validCell(p){return validPos(p)&&p.every(Number.isInteger)&&p[1]>0&&p[1]<HEIGHT;}
 const eyeHeight=crouched=>crouched?1.22:1.6,bodyHeight=crouched=>crouched?1.45:1.75;
 function intersects(pos,x,y,z,crouched=false){return pos[0]+.28>x&&pos[0]-.28<x+1&&pos[1]+bodyHeight(crouched)>y&&pos[1]<y+1&&pos[2]+.28>z&&pos[2]-.28<z+1;}
 function craft(inventory,id,grid,selections){const r=recipes.find(r=>r.id===id);if(!r||r.reference||(grid&&!matchRecipe(grid,id)))throw Error('Неизвестный рецепт');const out={...inventory},custom=r.transform?Bedrock.custom(r,inventory,selections):null;for(const [item,n]of Object.entries(custom?.used||costs(r,out,grid))){if((out[item]||0)<n)throw Error('Не хватает ресурсов');out[item]-=n;}for(const [item,n]of Object.entries(custom?{[custom.result]:1}:r.out)){out[item]=(out[item]||0)+n;if(out[item]>9999)throw Error('Инвентарь заполнен');}return out;}
 function ray(origin,dir,get,range=6){let current=origin.map(Math.floor),previous=current;for(let t=0;t<=range;t+=.04){const p=origin.map((v,i)=>v+dir[i]*t),at=p.map(Math.floor);if(at.some((v,i)=>v!==current[i])){previous=current;current=at;}const id=get(...at);if(id&&!fluid(id)&&(!doorState(id)||pointSolid(id,...p)))return {at,previous};}return null;}
 const animals={cow:{name:'Корова',health:10,height:1.35,width:.5,speed:1.1,drop:{132:2,135:1}},sheep:{name:'Овца',health:8,height:1.15,width:.45,speed:1.25,drop:{132:1,134:2}},pig:{name:'Свинья',health:10,height:.95,width:.45,speed:1.15,drop:{132:2}}};
 function rayBox(origin,dir,min,max,range=3.2){let near=0,far=range;for(let i=0;i<3;i++){if(Math.abs(dir[i])<1e-8){if(origin[i]<min[i]||origin[i]>max[i])return null;continue;}let a=(min[i]-origin[i])/dir[i],b=(max[i]-origin[i])/dir[i];if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(far<near)return null;}return near;}
 function melee(origin,dir,target,get){if(!validPos(origin)||!Array.isArray(dir)||dir.length!==3||!dir.every(Number.isFinite)||Math.abs(Math.hypot(...dir)-1)>.02||!validPos(target.pos))return null;const spec=animals[target.kind],w=spec?.width||.28,h=spec?.height||bodyHeight(target.crouched),[x,y,z]=target.pos;const distance=rayBox(origin,dir,[x-w,y,z-w],[x+w,y+h,z+w]);if(distance===null)return null;for(let t=0;t<distance;t+=.05){const p=origin.map((v,i)=>v+dir[i]*t);if(pointSolid(get(...p.map(Math.floor)),...p))return null;}return distance;}
 // Finite seven-block horizontal flow; vertical water columns propagate downward.
 function flowAt(x,y,z,get){const old=get(x,y,z);if(old===12||old!==0&&!fluid(old))return old;if(y<=0||y>=HEIGHT)return old;const above=get(x,y+1,z);if(fluid(above))return 36;let level=8;for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const id=get(x+dx,y,z+dz);if(fluid(id)&&(id===12||solid(get(x+dx,y-1,z+dz))||get(x+dx,y-1,z+dz)===12))level=Math.min(level,(id===12||id===36?0:id-28)+1);}return level<=7?28+level:0;}
 function fluidHeight(id){return id===12?.9:id===36?1:fluid(id)?(8-(id-28))/8:1;}
 return {catalog,costs,baseBlock,doorState,doorCode,effectiveBlock,pointSolid,bodyHits,lever,leverOn,redstone,eyeHeight,bodyHeight,fluid,fluidHeight,flowAt,animals,melee,rayBox,SIZE,HEIGHT,LIMIT,WATER,blocks,items,recipes,hash,height,terrain,generate,chunk,key,solid,validPos,validCell,intersects,craft,ray,matchRecipe,mining,biome,biomeNames,wearTool,consume,chestSlots,transfer};
});
