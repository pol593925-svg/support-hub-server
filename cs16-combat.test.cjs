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
  const shot={target:'B',weapon:'ak47',head:true,zone:'head',dist:15,hitId:27};
  handler({...shot,weapon:'made-up'});handler({...shot,dist:NaN});handler({...shot,dist:-1});handler({...shot,weapon:'knife',dist:10});
  assert.equal(applied.length,0);
  handler(shot);handler(shot);assert.equal(applied.length,1);assert.equal(applied[0][8],27);
  clock+=100;handler(shot);assert.equal(applied.length,2);
  clock+=100;target.team='ct';handler(shot);assert.equal(applied.length,2);
  context.cs16.gm='gg';handler(shot);assert.equal(applied.length,3);
  clock+=100;p.alive=false;handler(shot);assert.equal(applied.length,3);
});
test('actual damage application consumes armor and reports it to the client',()=>{
  const code=source.slice(source.indexOf('function cs16ApplyHit('),source.indexOf('// 3.24.0: Gun-Game'));
  const events=[];const context={cs16Magic:{absorb:(p,n)=>n},cs16:{gm:'classic'},CS16Combat,io:{emit:(name,data)=>events.push({name,data})}};
  vm.runInNewContext(code,context);
  const target={nick:'B',hp:100,armor:100};
  context.cs16ApplyHit({nick:'A'},target,'ak47',false,'body',0,false,undefined,27);
  assert.equal(target.hp,72);assert.equal(target.armor,96);
  assert.equal(events[0].data.armor,96);assert.equal(events[0].data.dmg,28);
  assert.equal(events[0].data.armorDamage,4);assert.equal(events[0].data.armorBreak,false);
  assert.equal(events[0].data.zone,'body');assert.equal(events[0].data.weapon,'ak47');
  assert.equal(events[0].data.hitId,27);
});
test('confirmed armor break, leg and head metadata match the actual damage calculation',()=>{
 const code=source.slice(source.indexOf('function cs16ApplyHit('),source.indexOf('// 3.24.0: Gun-Game')),events=[];
 const context={cs16Magic:{absorb:(p,n)=>n},cs16:{gm:'classic'},CS16Combat,io:{emit:(name,data)=>events.push({name,data})}};
 vm.runInNewContext(code,context);
 context.cs16ApplyHit({nick:'A'},{nick:'B',hp:1000,armor:2},'ak47',false,'body',0,false);
 assert.equal(events.at(-1).data.armorDamage,2);assert.equal(events.at(-1).data.armorBreak,true);
 context.cs16ApplyHit({nick:'A'},{nick:'B',hp:1000,armor:100},'ak47',false,'leg',0,false);
 assert.equal(events.at(-1).data.armorDamage,0);assert.equal(events.at(-1).data.zone,'leg');
 context.cs16ApplyHit({nick:'A'},{nick:'B',hp:1000,armor:100},'ak47',false,'head',0,false);
 assert.equal(events.at(-1).data.head,true);assert.equal(events.at(-1).data.zone,'head');
});

test('actual handler accepts a visible rooftop head but rejects geometry in the actual shot path',()=>{
 const B=require('./cs16-buildings'),T=require('./cs16-tactical-map'),Hit=require('./cs16-hit-validation');
 const codes={'#':1,'.':0,D:2,C:3,4:4,5:5,6:6,7:7,V:8,B:9,S:10,T:11},grid=T.generate('dust2').map(r=>Array.from(r,c=>codes[c]));
 const house=B.layout(grid,'dust2').buildings[0];let candidate;
 for(const u of [1,2,4.5,7,8.2,10.7])for(const z of [2,6,9,10.8])for(const dx of [-8,5,18])for(const dz of [-12,24]){
  const p={nick:'A',team:'ct',alive:true,lx:house.x+dx,ly:0,lz:house.z+dz};
  const q={nick:'B',team:'t',alive:true,lx:house.x+u,ly:z<5.25&&u<8.85?B.roofHeight(u)+.06:7.2,lz:house.z+z};
  const h=Hit.segment(p,q,{head:true}),b=Hit.segment(p,q,{zone:'body'}),blocked=s=>B.ray(grid,'dust2',s.origin,s.dir,s.limit)!==null||B.gridHit(grid,s.origin,s.dir,s.limit);
  if(!blocked(h)&&blocked(b)){candidate={p,q,h};break;}
 }
 assert(candidate);const {p,q,h}=candidate;let handler,clock=10000;const applied=[];
 const context={socket:{id:'a',on:(name,fn)=>handler=fn},cs16:{phase:'live',map:'dust2',gm:'classic',players:new Map([['a',p],['b',q]])},CS16Combat,CS16HitValidation:Hit,CS16Buildings:B,CS16_GRID:{dust2:grid},cs16Front:{rayUnit:()=>null},Date:{now:()=>clock},cs16ApplyHit:(...a)=>applied.push(a)};
 vm.runInNewContext(source.slice(start,end),context);
 const shot={target:'B',weapon:'ak47',zone:'head',head:true,origin:h.origin,point:h.point,dist:Math.hypot(...h.point.map((v,i)=>v-h.origin[i]))};
 handler(shot);assert.equal(applied.length,1,'visible head denied');clock+=200;
 handler({...shot,origin:[p.lx+5,1.62,p.lz]});assert.equal(applied.length,1,'spoofed origin accepted');
 // Aim through the visible solid house roof, rather than removing roof occlusion.
 p.lx=q.lx=house.x+4.5;p.lz=q.lz=house.z+2;p.ly=12;q.ly=3.6;clock+=200;
 handler({target:'B',weapon:'ak47',zone:'body',dist:9});assert.equal(applied.length,1,'solid roof penetrated');
});
