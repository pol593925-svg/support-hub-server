const test=require('node:test'),assert=require('node:assert/strict'),C=require('./voxel-core');
test('chunk generation matches authoritative terrain including negative coordinates and seams',()=>{for(const[cx,cz]of [[0,0],[-1,-1],[3,-2]]){const data=C.generate(cx,cz,758321);for(let z=0;z<16;z++)for(let x=0;x<16;x++)for(let y=0;y<48;y++)assert.equal(data[y*256+z*16+x],C.terrain(cx*16+x,y,cz*16+z,758321),`${cx}/${cz}: ${x},${y},${z}`);}});
test('craft checks inputs without mutating inventory, finite cells and placement collision',()=>{const bag={4:1};assert.deepEqual(C.craft(bag,'planks'),{4:0,6:4});assert.deepEqual(bag,{4:1});assert.throws(()=>C.craft({},'iron-pick'));assert.throws(()=>C.craft({},'missing'));assert(!C.validCell([1,NaN,1]));assert(!C.validCell([1,0,1]));assert(!C.validCell([1.5,2,1]));assert.deepEqual(C.chunk(-1,-17),[-1,-2]);assert.equal(C.key(-1,5,-17),'15_5_15');assert(C.intersects([1.5,2,1.5],1,2,1));assert(!C.intersects([1.5,2,1.5],3,2,1));});

test('shaped recipes accept translation and mirroring but reject extra items and invalid grids',()=>{
 assert.equal(C.matchRecipe([[0,4],[0,0]]).id,'planks');assert.equal(C.matchRecipe([[0,6,0],[0,6,0],[0,0,0]]).id,'sticks');
 assert.equal(C.matchRecipe([[6,6,0],[101,6,0],[101,0,0]]).id,'axe-0');
 assert.equal(C.matchRecipe([[6,6],[6,6]]).id,'table');assert.equal(C.matchRecipe([[6,6,6],[0,101,0],[0,101,0]]).id,'wood-pick');
 assert.equal(C.matchRecipe([[4,101],[0,0]]),null);assert.equal(C.matchRecipe([[4]]),null);assert.equal(C.matchRecipe([[0,-1],[0,0]]),null);
 for(const r of C.recipes.filter(r=>r.pattern)){const count={};for(const id of r.pattern.flat())if(id)count[id]=(count[id]||0)+1;assert.deepEqual(count,r.in,r.id);}
});
test('mining hardness and selected tool control speed and drops',()=>{
 assert(C.mining(4,110).ms<C.mining(4,104).ms);assert(C.mining(2,114).ms<C.mining(2,104).ms);assert(C.mining(3,107).ms<C.mining(3,104).ms);
 assert.equal(C.mining(3,0).harvest,false);assert.equal(C.mining(11,104).harvest,false);assert.equal(C.mining(11,105).harvest,true);assert.equal(C.mining(3,112).harvest,false);
 assert.equal(C.mining(12),null);assert.equal(C.mining(13),null);assert.equal(C.mining(0),null);
});

test('new-world biomes cover seven climates and match server cells at chunk seams',()=>{
 const examples=new Map(),seed=-758321;for(let z=-1600;z<=1600;z+=96)for(let x=-1600;x<=1600;x+=96)if(!examples.has(C.biome(x,z,seed)))examples.set(C.biome(x,z,seed),[Math.floor(x/16),Math.floor(z/16)]);
 assert.equal(examples.size,7);for(const[cx,cz]of examples.values()){const data=C.generate(cx,cz,seed);for(let z=0;z<16;z++)for(let x=0;x<16;x++)for(let y=0;y<48;y++)assert.equal(data[y*256+z*16+x],C.terrain(cx*16+x,y,cz*16+z,seed),`${cx}/${cz} ${x},${y},${z}`);}
 assert.equal(C.biome(0,0,758321),'plains');
});

test('tool durability consumes only the current tool and preserves spare tools',()=>{const bag={104:2},wear={104:1};const r=C.wearTool(bag,wear,104);assert.equal(r.inventory[104],1);assert.equal(r.wear[104],undefined);assert(r.broke);assert.equal(bag[104],2);assert.equal(wear[104],1);const next=C.wearTool(r.inventory,r.wear,104);assert.equal(next.wear[104],58);assert(!next.broke);assert.deepEqual(C.wearTool({}, {},104).inventory,{});});
test('food cannot heal dead players or be consumed without stock; hunger is capped',()=>{assert.equal(C.consume({118:1},{health:8,hunger:19},118).vitals.hunger,20);assert.throws(()=>C.consume({118:1},{health:0,hunger:0},118));assert.throws(()=>C.consume({118:1},{health:20,hunger:20},118));assert.throws(()=>C.consume({},{health:20,hunger:5},118));assert.throws(()=>C.consume({6:5},{health:20,hunger:5},6));});
