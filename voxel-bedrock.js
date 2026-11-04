(function(root,build){
 const data=root?root.HubBedrockData:require('./voxel-bedrock-data');
 const api=build(data);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.HubBedrock=api;
})(typeof window==='undefined'?null:window,function(data){
 'use strict';
 const legacy={air:0,grass_block:1,dirt:2,stone:3,oak_log:4,oak_leaves:5,oak_planks:6,brick_block:7,glass:8,sand:9,coal_ore:10,
   iron_ore:11,water:12,bedrock:13,crafting_table:14,furnace:15,glowstone:16,gold_ore:17,diamond_ore:18,snow:19,clay:20,cactus:21,
   spruce_log:22,spruce_leaves:23,red_sandstone:24,chest:25,farmland:26,wheat_seeds:121,wheat:122,bread:123,wooden_hoe:124,
   stick:101,coal:102,iron_ingot:103,wooden_pickaxe:104,stone_pickaxe:105,iron_pickaxe:106,diamond_pickaxe:107,gold_ingot:108,diamond:109,
   wooden_axe:110,stone_axe:111,iron_axe:112,diamond_axe:113,wooden_shovel:114,stone_shovel:115,iron_shovel:116,diamond_shovel:117,
   apple:118,wooden_sword:125,stone_sword:126,iron_sword:127,diamond_sword:128,bucket:130,water_bucket:131,beef:132,cooked_beef:133,white_wool:134,leather:135};
 const tests={
   planks:n=>n.endsWith('_planks'),logs:n=>/(?:_log|_stem|_hyphae|_wood)$/.test(n)||n==='bamboo_block',
   logs_that_burn:n=>tests.logs(n)&&!/(warped|crimson)/.test(n),wooden_slabs:n=>n.endsWith('_slab')&&tests.planks(n.replace(/_slab$/,'_planks')),
   coals:n=>['coal','charcoal'].includes(n),mushrooms_for_stew:n=>['red_mushroom','brown_mushroom'].includes(n),
   stone_crafting_materials:n=>['cobblestone','blackstone','cobbled_deepslate'].includes(n),stone_tool_materials:n=>tests.stone_crafting_materials(n),
   metal_nuggets:n=>n==='iron_nugget'||n==='gold_nugget',soul_fire_base_blocks:n=>n==='soul_sand'||n==='soul_soil',
   egg:n=>['egg','brown_egg','blue_egg'].includes(n),wool:n=>n.endsWith('_wool'),is_pickaxe:n=>n.endsWith('_pickaxe'),
   trim_templates:n=>n.endsWith('_armor_trim_smithing_template'),trimmable_armors:n=>/_(helmet|chestplate|leggings|boots)$/.test(n),
   trim_materials:n=>['amethyst_shard','copper_ingot','diamond','emerald','gold_ingot','iron_ingot','lapis_lazuli','netherite_ingot','quartz','redstone','resin_brick'].includes(n)
 };
 function hash(key){let h=2166136261;for(const ch of key)h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;}
 const dyes={white:'#e5e3da',light_gray:'#a5a69d',gray:'#565659',black:'#313038',red:'#b14c43',orange:'#cc8244',yellow:'#d7b84d',lime:'#90b650',green:'#637f45',cyan:'#4d989c',light_blue:'#7db4d4',blue:'#526b9e',purple:'#8658a1',magenta:'#aa649d',pink:'#d99db1',brown:'#835d49'};
 function color(n){
   const dye=Object.keys(dyes).find(k=>n.startsWith(k+'_'));if(dye)return dyes[dye];
   for(const [part,col] of [['birch','#d8c699'],['cherry','#d7aea8'],['spruce','#8e694d'],['oak','#ad8559'],['bamboo','#baa958'],['crimson','#8b475a'],['warped','#47968d'],['copper','#bb845f'],['sandstone','#d4bd88'],['quartz','#d8d5ca'],['deepslate','#535965'],['glass','#afcbd4'],['leaves','#749365'],['brick','#aa705e'],['gold','#c1a24e'],['iron','#b2b1a6']])if(n.includes(part))return col;
   const h=hash(n);return '#'+[110+(h%39),108+((h>>>8)%36),105+((h>>>16)%34)].map(x=>x.toString(16)).join('');
 }
 function install(blocks,items,recipes){
   const ids=new Map(),keys=new Map(),groups=new Map(),blockNames=[];
   for(const [key,label,isBlock] of data.entries){
     const id=legacy[key]??(1000+hash(key));
     if(keys.has(id))throw Error('Duplicate Bedrock ID '+key);
     ids.set(key,id);keys.set(id,key);if(isBlock)blockNames.push(key);
     if(items[id]){if(isBlock&&!blocks[id]&&key==='white_wool'){blocks[id]=items[id];Object.assign(blocks[id],{color:color(key),hardness:.8,kind:'shears'});}continue;}
     const entry={name:label,key};
     if(isBlock){const wood=/planks|logs?$|_wood$|_stem$|_fence|bamboo/.test(key);
       Object.assign(entry,{color:color(key),hardness:wood?2:1.5,kind:wood?'axe':'pick',transparent:/glass|leaves|ice/.test(key)});
       if(key.endsWith('_tulip')){entry.flower=true;entry.transparent=true;entry.hardness=.1;entry.color=({red_tulip:'#e45d64',orange_tulip:'#ed995b',pink_tulip:'#e6a5ba',white_tulip:'#f1e5d7'})[key]||entry.color;}
       blocks[id]=entry;
     }
     items[id]=entry;
   }
   for(const [tag,test] of Object.entries(tests))groups.set(tag,[...ids].filter(([n])=>test(n)).map(([,id])=>id));
   function variant(key,name,details){const id=1000+hash(key);if(keys.has(id))throw Error('Variant ID collision: '+key);keys.set(id,key);items[id]={name,...details};return id;}
   const bottles=new Map(),trims=new Map(),baseArmors=groups.get('trimmable_armors');
   const drinkTypes=[...ids.keys()].filter(k=>k.startsWith('potion_type:'));
   for(const form of ['potion','splash_potion','lingering_potion'])for(const type of ['plain',...drinkTypes]){
     const id=type==='plain'?ids.get(form):form==='potion'?ids.get(type):variant(form+'/'+type,(items[ids.get(form)]?.name||form)+' · '+type.split(':')[1],{});
     if(!id)continue;bottles.set(form+'/'+type,id);Object.assign(items[id],{bottle:form,potionType:type});
   }
   function trimmedId(base,template,material){return trims.get([base,template,material].join('/'));}
   for(const base of baseArmors)for(const template of groups.get('trim_templates'))for(const material of groups.get('trim_materials')){
     const signature=[base,template,material].join('/');const id=variant('trim/'+signature,items[base].name+' · '+items[template].name+' · '+items[material].name,{armorBase:base,trimTemplate:template,trimMaterial:material});trims.set(signature,id);
   }
   const choice=n=>!n?0:n.startsWith('#')?(groups.get(n.slice(1))||[]):ids.get(n);
   const incoming=s=>Array.isArray(s)?s[0]:s;
   const rows=[];
   for(const [key,type,tags,source,out,priority] of data.rules){
     const stations=tags.filter(s=>s!=='deprecated').map(s=>s==='stonecutter'?(ids.get('stonecutter_block')??ids.get(s)):ids.get(s)).filter(Number.isInteger);
     let ingredients=source.map(row=>row.map(choice));
     if(type==='shaped'){while(ingredients.length&&!ingredients[0].some(Boolean))ingredients.shift();while(ingredients.length&&!ingredients.at(-1).some(Boolean))ingredients.pop();
       const cols=ingredients.flatMap(row=>row.map((s,i)=>s?i:-1)).filter(i=>i>=0);if(cols.length){const start=Math.min(...cols),width=Math.max(...cols)-start+1;ingredients=ingredients.map(row=>Array.from({length:width},(_,i)=>row[start+i]||0));}}
     const flat=ingredients.flat().filter(Boolean);
     const baseResult=Object.keys(out)[0];let transform=null;
     if(type==='smithing_trim'){
       flat[1]=[...baseArmors,...trims.values()];transform=([template,armor,mat])=>trimmedId(items[armor].armorBase||armor,template,mat);
     }else if(type==='smithing_transform'&&baseArmors.includes(flat[1])&&baseArmors.includes(ids.get(baseResult))){
       const base=flat[1],target=ids.get(baseResult);flat[1]=[base,...[...trims.values()].filter(id=>items[id].armorBase===base)];
       transform=([,armor])=>items[armor].trimTemplate?trimmedId(target,items[armor].trimTemplate,items[armor].trimMaterial):target;
     }else if(type==='brewing_container'){
       const baseForm=source[0][0];flat[0]=[...bottles.values()].filter(id=>items[id].bottle===baseForm);
       transform=([potion])=>bottles.get(baseResult+'/'+items[potion].potionType);
     }else if(type==='brewing_mix'){
       const baseType=source[0][0];flat[0]=[...bottles.values()].filter(id=>items[id].potionType===baseType);
       transform=([potion])=>bottles.get(items[potion].bottle+'/'+baseResult);
     }
     const outputs=Object.fromEntries(Object.entries(out).map(([k,n])=>[ids.get(k),n]));
     const rid='bedrock/'+key,primary=ids.get(Object.keys(out)[0]);
     const table=stations.includes(14),shaped=type==='shaped',shapeless=type==='shapeless';
     const first=ingredients.map(row=>row.map(incoming)),pattern=table?(shaped?first:Array.from({length:Math.ceil(flat.length/(flat.length<=4?2:3))},(_,i)=>flat.slice(i*(flat.length<=4?2:3),(i+1)*(flat.length<=4?2:3)).map(incoming))):null;
     const station=table?(pattern.length>2||pattern.some(row=>row.length>2)?14:0):stations[0];
     const counts={};for(const a of flat){const id=incoming(a);if(id)counts[id]=(counts[id]||0)+1;}
     const heat=type==='furnace';
     const reference=tags.includes('deprecated')||!stations.length||flat.some(v=>!incoming(v))||(!primary&&!transform);
     const r={id:rid,key,type,tags,stations,station,pattern:reference?null:pattern,options:ingredients,
       flat,in:counts,out:outputs,name:items[primary]?.name||key.replace(/_/g,' '),primary,shapeless,reference,priority,transform};
     if(type==='smithing_trim')r.name='Отделка доспеха';
     if(heat){r.smeltMs=10000;r.fuel=true;r.charcoalId=ids.get('charcoal');}rows.push(r);
   }
   recipes.push(...rows);
   const heaters=new Set(['furnace','blast_furnace','smoker','campfire','soul_campfire'].map(n=>ids.get(n)));
   const blockId=k=>k==='wheat'?27:ids.get(k);
   return {version:data.version,rows,ids,keys,blockNames,blockId,heaters,stations:new Set(rows.filter(r=>!r.reference).flatMap(r=>r.stations))};
 }
 const accepts=(v,id)=>Array.isArray(v)?v.includes(id):v===id;
 function match(r,shape){
   if(!r.pattern||r.reference)return false;
   if(r.shapeless){
     const a=shape.flat().filter(Boolean);if(a.length!==r.flat.length)return false;
     const slots=[...r.flat].sort((x,y)=>Number(Array.isArray(x))-Number(Array.isArray(y)));
     function take(i,mask){if(i===slots.length)return true;return a.some((id,j)=>!(mask&(1<<j))&&accepts(slots[i],id)&&take(i+1,mask|(1<<j)));}
     return take(0,0);
   }
   if(shape.length!==r.options.length||shape[0]?.length!==r.options[0]?.length)return false;
   return [false,true].some(m=>shape.every((row,y)=>row.every((id,x)=>accepts(r.options[y][m?row.length-1-x:x],id))));
 }
 function plan(r,bag,grid){
   if(r.reference)throw Error('Это справочный рецепт.');
   const used={};
   if(grid){for(const id of grid.flat())if(id)used[id]=(used[id]||0)+1;}
   else {
     const slots=r.flat,assigned=new Map();
     function bind(i,seen){const opts=Array.isArray(slots[i])?slots[i]:[slots[i]];
       for(const id of opts){if(!bag[id]||seen.has(id))continue;seen.add(id);
         const owners=assigned.get(id)||[];
         if(owners.length<bag[id]){owners.push(i);assigned.set(id,owners);return true;}
         for(let j=0;j<owners.length;j++)if(bind(owners[j],seen)){owners[j]=i;return true;}
       }return false;
     }
     for(let i=0;i<slots.length;i++)if(!bind(i,new Set()))throw Error('Не хватает ресурсов');
     for(const [id,owners] of assigned)used[id]=owners.length;
   }
   if(r.fuel){const fuel=[102,...(r.charcoalId?[r.charcoalId]:[])].find(id=>(bag[id]||0)>(used[id]||0));if(!fuel)throw Error('Нужен уголь для плавки');used[fuel]=(used[fuel]||0)+1;}
   return used;
 }
 function custom(r,bag,selections){
   if(!r.transform||!Array.isArray(selections)||selections.length!==r.flat.length)throw Error('Выбери ингредиенты станции.');
   const used={};for(const [i,id] of selections.entries()){
     if(!Number.isInteger(id)||!accepts(r.flat[i],id))throw Error('Неверный ингредиент.');used[id]=(used[id]||0)+1;if(used[id]>(bag[id]||0))throw Error('Не хватает ресурсов');
   }
   const result=r.transform(selections);if(!result||used[result])throw Error('Такое превращение недоступно.');return {used,result};
 }
 return {install,match,plan,custom};
});
