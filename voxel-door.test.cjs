const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('./voxel-core');
const oak=C.catalog.ids.get('wooden_door');
test('Every catalog door has two persistent halves, four directions and reversible hinges',()=>{
  const kinds=C.catalog.blockNames.filter(k=>k.endsWith('_door'));
  const all=new Set();
  for(const kind of kinds){
    const id=C.catalog.blockId(kind);
    for(let f=0;f<32;f++){
      const code=C.doorCode(id,f&3,!!(f&4),!!(f&8),!!(f&16)),d=C.doorState(code);
      assert(Number.isSafeInteger(code)&&code<0);
      assert.deepEqual([d.id,d.dir,d.right,d.open,d.upper],[id,f&3,!!(f&4),!!(f&8),!!(f&16)]);
      assert(!all.has(code));all.add(code);
    }
  }
  assert(!all.has(C.leverOn));assert.equal(C.doorState(oak).legacy,true);
  const planks=C.catalog.ids.get('oak_planks');
  assert(Object.values(C.recipes).some(r=>r.out[oak]===3&&C.matchRecipe([[planks,planks,0],[planks,planks,0],[planks,planks,0]],r.id)));
});
test('Panel collision, walking and sight agree on which side is open',()=>{
  const shut=C.doorCode(oak,0,false,false,false),open=C.doorCode(oak,0,false,true,false),mirror=C.doorCode(oak,0,true,true,false);
  assert(C.bodyHits([.5,0,.08],0,0,0,shut,false));
  assert(!C.bodyHits([.5,0,.08],0,0,0,open,false));
  assert(C.pointSolid(open,.10,.5,.6));assert(!C.pointSolid(mirror,.10,.5,.6));
  const sight=id=>C.ray([.5,.5,2],[0,0,-1],(x,y,z)=>x===0&&y===0&&z===0?id:0);
  assert.deepEqual(sight(shut)?.at,[0,0,0]);assert.equal(sight(open),null);
  assert.equal(C.mining(open).ms,C.mining(oak).ms);
  assert.equal(C.mining(C.catalog.ids.get('iron_door')).harvest,false);
});
test('Power crosses a chunk boundary and operates both halves without changing stored IDs',()=>{
  const iron=C.catalog.ids.get('iron_door'),world=new Map(),key=(x,y,z)=>[x,y,z].join();
  const get=(...at)=>world.get(key(...at))??0;
  for(const y of [40,41])world.set(key(15,y,2),C.doorCode(iron,0,false,false,y===41));
  for(const signal of [C.lever,C.leverOn,C.redstone,0]){
    world.set(key(16,40,2),signal);
    for(const y of [40,41]){
      assert.equal(C.doorState(C.effectiveBlock(get,15,y,2)).open,signal===C.leverOn||signal===C.redstone);
      assert.equal(C.doorState(get(15,y,2)).open,false);
    }
  }
});
