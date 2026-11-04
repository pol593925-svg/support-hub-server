'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('./voxel-core'),book=C.catalog;
test('every Bedrock block maps into the shared registry and every active specification crafts an output',()=>{
 assert.equal(book.blockNames.length,1466);
 assert(book.blockNames.every(k=>C.blocks[book.blockId(k)]));
 assert.equal(book.rows.length,1892);
 assert.equal(new Set(book.rows.map(r=>r.id)).size,book.rows.length);
 for(const r of book.rows){
   if(r.tags.includes('deprecated')){assert(r.reference);continue;}
   assert(!r.reference,r.key);
   const picks=r.flat.map(v=>Array.isArray(v)?v[0]:v),bag={};
   for(const id of picks){assert(C.items[id],r.key);bag[id]=(bag[id]||0)+1;}
   if(r.fuel)bag[102]=(bag[102]||0)+1;
   let grid;
   if(r.pattern){grid=Array.from({length:3},(_,j)=>Array.from({length:3},(_,i)=>r.pattern[j]?.[i]||0));assert.equal(C.matchRecipe(grid,r.id)?.id,r.id,r.key);}
   const result=C.craft(bag,r.id,grid,r.transform?picks:undefined);
   assert(Object.values(result).every(Number.isSafeInteger),r.key);
   const expected=r.transform?{[r.transform(picks)]:1}:r.out;
   for(const [id,n] of Object.entries(expected))assert.equal(result[id],n,r.key);
 }
});
test('a chest accepts mixed planks, shapeless recipes reject extras, fuel and refunds are charged correctly',()=>{
 const birch=book.ids.get('birch_planks'),chest=book.rows.find(r=>r.key==='chest');
 const grid=[[6,birch,6],[birch,0,birch],[6,birch,6]];
 assert.equal(C.matchRecipe(grid,chest.id),chest);
 const bag={6:4,[birch]:4},made=C.craft(bag,chest.id,grid);
 assert.equal(made[25],1);assert.equal(made[birch],0);assert.equal(bag[birch],4);
 assert.throws(()=>C.craft({6:8},chest.id,grid));
 const honey=book.rows.find(r=>r.key==='honey_block'),bottle=book.ids.get('honey_bottle');
 const sg=[[bottle,bottle],[bottle,bottle]];
 assert.equal(C.matchRecipe(sg,honey.id),honey);
 assert.equal(C.craft({[bottle]:4},honey.id,sg)[book.ids.get('glass_bottle')],4);
 assert.equal(C.matchRecipe([[6,6],[bottle,bottle]],honey.id),null);
 const furnace=book.rows.find(r=>r.type==='furnace'&&!r.reference&&!r.flat.some(Array.isArray));
 assert.throws(()=>C.craft({[furnace.flat[0]]:1},furnace.id));
});
test('potion type and armor trim survive container changes and smithing upgrades',()=>{
 const brew=book.rows.find(r=>r.key==='brew_potion_sulphur'),drink=book.ids.get('potion_type:strength'),powder=book.ids.get('gunpowder');
 const splash=brew.transform([drink,powder]);assert.equal(C.items[splash].potionType,'potion_type:strength');
 assert.equal(C.craft({[drink]:1,[powder]:1},brew.id,null,[drink,powder])[splash],1);
 assert.throws(()=>C.craft({[drink]:1,[powder]:1},brew.id,null,[powder,drink]));
 const trim=book.rows.find(r=>r.type==='smithing_trim'),helmet=book.ids.get('diamond_helmet'),template=trim.flat[0][0],gold=108;
 const armor=trim.transform([template,helmet,gold]);
 const upgrade=book.rows.find(r=>r.key==='smithing_netherite_helmet'),up=upgrade.transform([upgrade.flat[0],armor,upgrade.flat[2]]);
 assert.equal(C.items[up].trimTemplate,template);assert.equal(C.items[up].trimMaterial,gold);
});
test('crouching lowers both eye position and PvP hitbox without changing standing players',()=>{
 assert(C.eyeHeight(true)<C.eyeHeight(false));const pos=[2,8.5,2];
 assert(C.intersects(pos,2,10,2));assert(!C.intersects(pos,2,10,2,true));
 const foe={pos:[2,2,2]};assert.notEqual(C.melee([2,3.65,.5],[0,0,1],foe,()=>0),null);
 assert.equal(C.melee([2,3.65,.5],[0,0,1],{...foe,crouched:true},()=>0),null);
});
