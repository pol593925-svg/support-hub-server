'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Mines=require('./cs16-mines');
function fixture(){
 const owner={nick:'Miner',team:'t',alive:true,lx:10,ly:0,lz:10,money:16000};
 const enemy={nick:'Enemy',team:'ct',alive:true,lx:10.7,ly:0,lz:10};
 const ally={nick:'Ally',team:'t',alive:true,lx:10.7,ly:0,lz:10};
 const state={phase:'live',gm:'classic',map:'dust2',players:new Map([['o',owner],['e',enemy],['a',ally]])};
 const events=[],blasts=[];
 const api=Mines.create({state,emit:(...event)=>events.push(event),personal:()=>{},onDetonate:(mine,target)=>blasts.push({kind:mine.kind,target:target.nick})});
 return {owner,enemy,ally,state,events,blasts,api};
}
function placed(f,kind='ap',now=10000){f.owner.mines={[kind]:5,ap:kind==='ap'?5:0,at:kind==='at'?5:0};const result=f.api.place(f.owner,{kind},now);assert(!result.error,result.error);return result;}
test('a 1000-dollar shop pack contains five mines and respects inventory cap',()=>{
 const f=fixture();for(let i=1;i<=5;i++){const result=f.api.buy(f.owner,'mine_ap');assert.equal(result.count,Math.min(25,i*5));}
 assert.match(f.api.buy(f.owner,'mine_ap').error,/максимум/);
});
test('placement is server-authoritative, consumes one mine and rejects duplicates',()=>{
 const f=fixture(),first=placed(f);assert.equal(first.count,4);assert.equal(f.api.count(),1);
 assert.match(f.api.place(f.owner,{kind:'ap'},10300).error,/Подожди/);
 assert.match(f.api.place(f.owner,{kind:'ap'},11000).error,/уже установлена/);
 assert.equal(f.owner.mines.ap,4);
});
test('anti-personnel mine arms, ignores allies and detonates once near an enemy',()=>{
 const f=fixture();placed(f);assert.equal(f.api.tick(10899),0);
 assert.equal(f.api.tick(10901),1);assert.equal(f.api.count(),0);assert.deepEqual(f.blasts,[{kind:'ap',target:'Miner'}]);
 assert(f.events.some(e=>e[0]==='cs16_mine_boom'&&e[1].kind==='ap'));
 assert.equal(f.api.tick(12000),0);
});
test('anti-personnel mine does not detonate for owner, ally or vehicle occupants',()=>{
 const f=fixture();f.state.players.delete('e');placed(f);assert.equal(f.api.tick(12000),0);
 f.enemy.veh={inside:true};f.state.players.set('e',f.enemy);assert.equal(f.api.tick(12000),0);
});
test('anti-tank mine triggers only on an enemy ground tank, not infantry or a helicopter',()=>{
 const f=fixture();placed(f,'at');assert.equal(f.api.tick(12000),0);
 f.enemy.veh={kind:'heli',hp:600,pos:[10,0,10]};assert.equal(f.api.tick(12000),0);
 f.enemy.veh={kind:'tank',hp:1000,pos:[11.8,0,10]};assert.equal(f.api.tick(12000),1);
 assert.deepEqual(f.blasts,[{kind:'at',target:'Miner'}]);
});
test('mine coordinates are sent only to their owner; snapshots hide other players mines',()=>{
 const f=fixture(),visible=[];f.api=Mines.create({state:f.state,emit:(...event)=>f.events.push(event),visible:(...event)=>visible.push(event),personal:()=>{},onDetonate:()=>{}});
 placed(f);assert.equal(visible.length,1);assert.equal(visible[0][0],'cs16_mine_add');assert.equal(visible[0][2],f.owner);
 assert.equal(f.api.snapshot(f.owner).rows.length,1);assert.equal(f.api.snapshot(f.enemy).rows.length,0);
 assert(!f.events.some(e=>e[0]==='cs16_mine_add'));
});
test('round reset removes all ordnance and both inventories',()=>{
 const f=fixture();placed(f);f.api.buy(f.owner,'mine_at');f.api.reset();
 assert.equal(f.api.count(),0);assert.deepEqual(f.owner.mines,{ap:0,at:0});assert.deepEqual(f.api.snapshot().rows,[]);
});
