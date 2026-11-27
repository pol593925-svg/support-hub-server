const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./server.js'),'utf8');
function fixture(kind='tank',team='ct'){
 const attacker={nick:'Rocketeer',team:'t',alive:true,kills:0,money:0};
 const hp=kind==='tank'?1000:600;
 const owner={nick:'Vehicle',team,alive:false,veh:{kind,pos:[10,0,10],hp,max:hp,inside:false}};
 const events=[],state={phase:'live',gm:'classic',map:'dust2',players:new Map([['a',attacker],['v',owner]])};
 const box={cs16:state,CS16_GRID:{dust2:[[0]]},cs16Front:{blast(){}},CS16Buildings:{trace:()=>Infinity},cs16VehDestroy:null,
  io:{emit:(...e)=>events.push(e)},cs16Magic:{absorb:(_,dmg)=>dmg},cs16StatAdd(){},cs16OnKill(){},cs16CheckWipe(){},cs16Broadcast(){}};
 vm.createContext(box);const a=source.indexOf('function cs16VehBoom('),b=source.indexOf('// ---------- 3.24.0: БОТЫ',a);vm.runInContext(source.slice(a,b),box);
 return {box,attacker,owner,events};
}
for(const kind of ['tank','heli'])test(`one RPG rocket destroys a full-health ${kind}`,()=>{
 const f=fixture(kind),before=f.owner.veh.max;f.box.cs16VehBoom(f.attacker,[10,1,10],'rpg');
 assert.equal(f.owner.veh,null);assert(f.events.some(e=>e[0]==='cs16_vehdie'&&e[1].by==='Vehicle'&&e[1].kind===kind));
 assert.equal(before,kind==='tank'?1000:600);
});
test('other explosions still remove 120 vehicle HP instead of copying RPG damage',()=>{
 const f=fixture();f.box.cs16VehBoom(f.attacker,[10,1,10],'tankgun');assert.equal(f.owner.veh.hp,880);assert(f.events.some(e=>e[0]==='cs16_vehhit'&&e[1].hp===880));
});
test('RPG friendly fire remains disabled for allied vehicles',()=>{
 const f=fixture('heli','t');f.box.cs16VehBoom(f.attacker,[10,1,10],'rpg');assert.equal(f.owner.veh.hp,600);assert.equal(f.events.filter(e=>e[0]==='cs16_vehdie').length,0);
});
