'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Mines=require('./cs16-mines');
const server=fs.readFileSync(require.resolve('./server.js'),'utf8');
function fixture(){
 const owner={nick:'Miner',team:'t',alive:true,lx:10,ly:0,lz:10,money:16000};
 const enemy={nick:'Enemy',team:'ct',alive:true,lx:10.7,ly:0,lz:10};
 const ally={nick:'Ally',team:'t',alive:true,lx:10.7,ly:0,lz:10};
 const state={phase:'live',gm:'classic',map:'dust2',players:new Map([['o',owner],['e',enemy],['a',ally]])};
 const events=[],blasts=[],visible=[],personal=[];
 const api=Mines.create({state,emit:(...event)=>events.push(event),visible:(...event)=>visible.push(event),personal:p=>personal.push(p),onDetonate:(mine,target)=>blasts.push({kind:mine.kind,target:target.nick})});
 return {owner,enemy,ally,state,events,blasts,visible,personal,api};
}
function placed(f,kind='ap',now=10000){f.owner.mines={ap:5};const result=f.api.place(f.owner,{kind},now);assert(!result.error,result.error);return result;}
test('a 1000-dollar shop pack contains five AP mines and respects inventory cap',()=>{
 const f=fixture();for(let i=1;i<=5;i++){const result=f.api.buy(f.owner,'mine_ap');assert.equal(result.count,Math.min(25,i*5));}
 assert.match(f.api.buy(f.owner,'mine_ap').error,/максимум/);
 assert.equal(f.api.buy(f.owner,'mine_at'),null);
});
test('placement is server-authoritative, consumes one mine and rejects duplicates and AT packets',()=>{
 const f=fixture(),first=placed(f);assert.equal(first.count,4);assert.equal(f.api.count(),1);
 assert.match(f.api.place(f.owner,{kind:'ap'},10300).error,/Подожди/);
 assert.match(f.api.place(f.owner,{kind:'ap'},11000).error,/уже установлена/);
 assert.match(f.api.place(f.owner,{kind:'at'},12000).error,/Неизвестный тип/);
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
test('mine coordinates are sent only to their owner; snapshots hide other players mines',()=>{
 const f=fixture();placed(f);assert.equal(f.visible.length,1);assert.equal(f.visible[0][0],'cs16_mine_add');assert.equal(f.visible[0][2],f.owner);
 assert.equal(f.api.snapshot(f.owner).rows.length,1);assert.equal(f.api.snapshot(f.enemy).rows.length,0);
 assert(!f.events.some(e=>e[0]==='cs16_mine_add'));
});
test('deployed mine and remaining inventory survive all 16 round syncs until one detonation',()=>{
 const f=fixture();f.enemy.lx=80;f.enemy.lz=80;const mine=placed(f);f.api.buy(f.owner,'mine_ap');
 assert.equal(f.owner.mines.ap,9);
 for(let round=1;round<=16;round++){
  f.state.phase='freeze';f.api.sync();f.state.phase='live';
  assert.equal(f.api.tick(11000+round),0,'round '+round);
  assert.equal(f.api.count(),1,'round '+round);
  assert.equal(f.api.snapshot(f.owner).rows[0].id,mine.mine.id);
  assert.equal(f.api.snapshot(f.enemy).rows.length,0);
  assert.equal(f.owner.mines.ap,9);
 }
 assert.equal(f.visible.filter(e=>e[0]==='cs16_mines').length,48,'each player receives only a private snapshot');
 assert.equal(f.personal.length,49,'placement plus three players across 16 round syncs');
 f.enemy.lx=10.7;f.enemy.lz=10;assert.equal(f.api.tick(13000),1);assert.equal(f.api.count(),0);
 assert.equal(f.blasts.length,1);assert.equal(f.api.tick(14000),0);assert.equal(f.owner.mines.ap,9);
});
test('round sync follows a side swap without retargeting the mine to new allies',()=>{
 const f=fixture();f.enemy.lx=80;f.enemy.lz=80;placed(f);f.owner.team='ct';f.ally.team='ct';f.enemy.team='t';f.api.sync();
 assert.equal(f.api.snapshot(f.owner).rows[0].team,'ct');
 f.ally.lx=10.7;f.ally.lz=10;assert.equal(f.api.tick(12000),0,'new ally must not trigger the mine');
 f.enemy.lx=10.7;f.enemy.lz=10;assert.equal(f.api.tick(12001),1,'new enemy must trigger the mine');
});
test('new-match reset removes ordnance and inventory; round wiring uses sync instead',()=>{
 const f=fixture();placed(f);f.api.reset();
 assert.equal(f.api.count(),0);assert.deepEqual(f.owner.mines,{ap:0});assert.deepEqual(f.api.snapshot().rows,[]);
 const start=server.slice(server.indexOf('function cs16StartRound()'),server.indexOf('function cs16EndRound('));
 const prepare=server.slice(server.indexOf('function cs16PrepareMatch()'),server.indexOf('function cs16State()'));
 assert.match(start,/cs16Mines\.sync\(\)/);assert.doesNotMatch(start,/cs16Mines\.reset\(\)/);
 assert.match(prepare,/cs16Mines\.reset\(\)/);
});
