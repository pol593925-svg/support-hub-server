'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Combat=require('./cs16-combat');
const Vehicles=require('./cs16-vehicles');
const HitValidation=require('./cs16-hit-validation');
const Missiles=require('./cs16-missiles');
const source=fs.readFileSync(require.resolve('./server.js'),'utf8');

function hitFixture(){
 let clock=10000;const events=[],broadcasts=[];
 const pilot={nick:'Pilot',alive:true,team:'ct',lx:10,ly:300,lz:10,veh:{kind:'heli',inside:true,pos:[10,300,10],hp:600,max:600}};
 const enemy={nick:'Enemy',alive:true,team:'t',lx:410,ly:0,lz:10,hp:100,armor:0};
 const state={phase:'live',gm:'classic',map:'dust2',players:new Map([['pilot',pilot],['enemy',enemy]])};
 const socket={id:'pilot',on(){},broadcast:{emit:(name,data)=>broadcasts.push({name,data})}};
 const context={socket,cs16:state,CS16Combat:Combat,CS16Vehicles:Vehicles,CS16HitValidation:HitValidation,
  CS16Buildings:{gridHit:()=>false,ray:()=>null},CS16_GRID:{dust2:[]},cs16Front:{shoot(){},rayUnit:()=>null},fieldEnvironment:{shoot(){}},
  Date:{now:()=>clock},io:{emit:(name,data)=>events.push({name,data})},cs16Magic:{absorb:(p,n)=>n},
  cs16StatAdd(){},cs16OnKill(){},cs16Broadcast(){},cs16CheckWipe(){}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function cs16ApplyHit('),source.indexOf('// 3.24.0: Gun-Game')),context);
 const start=source.indexOf("  socket.on('cs16_shoot',"),end=source.indexOf('  // Граната:',start);
 let shoot,hit;context.socket.on=(name,fn)=>{if(name==='cs16_shoot')shoot=fn;if(name==='cs16_hit')hit=fn;};
 vm.runInContext(source.slice(start,end),context);
 return {pilot,enemy,events,broadcasts,shoot,hit,advance:n=>clock+=n};
}

test('helicopter MG deals authoritative long-range damage only from an active vehicle',()=>{
 const f=hitFixture(),shot={target:'Enemy',weapon:'mgveh',zone:'body',dist:500},damage=Combat.damage('mgveh','body',500,0).damage;
 const afterOne=100-damage,afterTwo=100-damage*2;
 f.shoot({weapon:'mgveh',origin:[10,301.15,10],dir:[1,0,0],distance:700});
 assert.equal(f.broadcasts.length,1);assert.equal(f.broadcasts[0].data.distance,700);
 f.hit(shot);assert.equal(f.enemy.hp,afterOne);assert.equal(f.events.at(-1).data.weapon,'mgveh');
 f.hit(shot);assert.equal(f.enemy.hp,afterOne,'duplicate hit inside the RPM window');
 f.advance(100);f.pilot.veh.inside=false;f.hit(shot);assert.equal(f.enemy.hp,afterOne,'on-foot MG forgery');
 f.advance(100);f.pilot.veh.inside=true;f.enemy.team='ct';f.hit(shot);assert.equal(f.enemy.hp,afterOne,'friendly fire');
 f.advance(100);f.enemy.team='t';f.hit({...shot,dist:1201});assert.equal(f.enemy.hp,afterOne,'over-range hit');
 f.advance(100);f.hit(shot);assert.equal(f.enemy.hp,afterTwo);
 f.pilot.veh.inside=false;f.shoot({weapon:'mgveh',origin:[10,301.15,10],dir:[1,0,0],distance:700});
 assert.equal(f.broadcasts.length,1,'on-foot MG tracer forgery');
});

test('vehicle MG damages hostile vehicles with the same authoritative rate limit',()=>{
 let clock=5000,handler;const events=[];
 const pilot={nick:'Pilot',alive:true,team:'ct',veh:{kind:'heli',inside:true}};
 const enemy={nick:'Enemy',alive:true,team:'t',veh:{kind:'tank',hp:1000,max:1000}};
 const context={socket:{id:'pilot',on:(name,fn)=>handler=fn},cs16:{phase:'live',gm:'classic',players:new Map([['pilot',pilot],['enemy',enemy]])},
  CS16Vehicles:Vehicles,CS16Combat:Combat,Date:{now:()=>clock},io:{emit:(name,data)=>events.push({name,data})},cs16VehDestroy(){throw Error('unexpected destruction');}};
 vm.runInNewContext(source.slice(source.indexOf("  socket.on('cs16_vehhit',"),source.indexOf('  // 3.32.0:',source.indexOf("  socket.on('cs16_vehhit',"))),context);
 const shot={target:'Enemy',weapon:'mgveh',dist:800};handler(shot);assert.equal(enemy.veh.hp,980);
 handler(shot);assert.equal(enemy.veh.hp,980);clock+=100;pilot.veh.inside=false;handler(shot);assert.equal(enemy.veh.hp,980);
 clock+=100;pilot.veh.inside=true;handler({...shot,dist:1201});assert.equal(enemy.veh.hp,980);
 clock+=100;handler(shot);assert.equal(enemy.veh.hp,960);assert.equal(events.length,2);
});

test('a vehicle rocket reaches and impacts a target beyond the old 245 m limit',()=>{
 const grid=Array.from({length:128},()=>Array(128).fill(0));
 const pilot={nick:'Pilot',alive:true,team:'t',lx:10,ly:297,lz:10,veh:{kind:'heli',inside:true,pos:[10,297,10],hp:600,max:600}};
 const enemy={nick:'Enemy',alive:true,team:'ct',lx:400,ly:297,lz:10};
 const impacts=[],events=[];const missiles=Missiles.create({state:{phase:'live',map:'dust2',players:new Map([['pilot',pilot],['enemy',enemy]])},grid:()=>grid,army:()=>[],emit:(n,d)=>events.push({n,d}),frame(){},impact:(p,pos,kind)=>impacts.push({pos,kind})});
 assert(missiles.vehicle(pilot,{dir:[1,0,0]},1000));
 for(let time=1050;time<=8000;time+=50)missiles.tick(time);
 assert(impacts.length>0);assert(impacts.every(hit=>hit.kind==='vehicle'));
 assert(impacts[0].pos[0]>390,'rocket stopped before the distant target');
 assert.equal(events.filter(e=>e.n==='cs16_missile_start').length,2);
 assert.equal(events.filter(e=>e.n==='cs16_missile_end').length,impacts.length);
});
