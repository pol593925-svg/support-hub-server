const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const CS16Combat=require('./cs16-combat');
// Isolate real socket-handler code; never start the server or access MongoDB.
const source=fs.readFileSync(require('path').join(__dirname,'server.js'),'utf8');
const start=source.indexOf("  socket.on('cs16_hit', (d) => {");
const end=source.indexOf('  // Граната:',start);
test('actual hit handler rejects invalid targets/ranges and throttles duplicate damage',()=>{
  let handler,clock=10000;const applied=[];
  const p={nick:'A',alive:true,team:'ct'},target={nick:'B',alive:true,team:'t'};
  const context={socket:{id:'a',on:(name,fn)=>{assert.equal(name,'cs16_hit');handler=fn;}},cs16:{phase:'live',gm:'classic',players:new Map([['a',p],['b',target]])},CS16Combat,Date:{now:()=>clock},cs16ApplyHit:(...args)=>applied.push(args)};
  vm.runInNewContext(source.slice(start,end),context);
  const shot={target:'B',weapon:'ak47',head:true,zone:'head',dist:15};
  handler({...shot,weapon:'made-up'});handler({...shot,dist:NaN});handler({...shot,dist:-1});handler({...shot,weapon:'knife',dist:10});
  assert.equal(applied.length,0);
  handler(shot);handler(shot);assert.equal(applied.length,1);
  clock+=100;handler(shot);assert.equal(applied.length,2);
  clock+=100;target.team='ct';handler(shot);assert.equal(applied.length,2);
  context.cs16.gm='gg';handler(shot);assert.equal(applied.length,3);
  clock+=100;p.alive=false;handler(shot);assert.equal(applied.length,3);
});
test('actual damage application consumes armor and reports it to the client',()=>{
  const code=source.slice(source.indexOf('function cs16ApplyHit('),source.indexOf('// 3.24.0: Gun-Game'));
  const events=[];const context={cs16:{gm:'classic'},CS16Combat,io:{emit:(name,data)=>events.push({name,data})}};
  vm.runInNewContext(code,context);
  const target={nick:'B',hp:100,armor:100};
  context.cs16ApplyHit({nick:'A'},target,'ak47',false,'body',0,false);
  assert.equal(target.hp,72);assert.equal(target.armor,96);
  assert.equal(events[0].data.armor,96);assert.equal(events[0].data.dmg,28);
});
