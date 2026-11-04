const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),F=require('./cs16-front'),B=require('./cs16-buildings'),T=require('./cs16-terrain'),Front=require('./cs16-front-server');
function grid(map){
 const source=fs.readFileSync(__dirname+'/server.js','utf8'),ctx={require};
 vm.runInNewContext(source.slice(source.indexOf('const CS16_MAP_ROWS ='),source.indexOf('// вейпоинты для ботов'))+'\nglobalThis.grid=CS16_GRID;',ctx);
 return ctx.grid[map];
}
function game(map,army,gm='assault',hitHuman=()=>{}){
 const g=grid(map),state={map,gm,army,phase:'live',players:new Map(),freezeEnds:1000},events=[],results=[],frames=[];
 const service=Front.create({state,grid:()=>g,emit:(n,d)=>events.push({n,d}),frame:(n,d)=>frames.push(d),hitHuman,credit(){},wipe(){},radial(){},respawn:(p,pos)=>{p.alive=true;p.lx=pos[0];p.ly=pos[1];p.lz=pos[2];p.cqRespawnAt=0;},finish:t=>{results.push(t);state.phase='matchend';}});
 service.reset();return {g,state,service,events,results,frames};
}
for(const map of ['dust2','inferno','frontline']){
 test(map+' demolition opens geometry for walking, bullets and restores on round reset',()=>{
   const {g,service}=game(map,false);const b=B.layout(g,map).buildings[0],o=[b.x-2,1,b.z+5],d=[1,0,0];
   assert(B.ray(g,map,o,d,3)!==null);const p={team:'t',alive:true,lx:o[0],ly:-.5,lz:o[2]};
   assert.equal(service.requestCharge(p,d,10000),null);assert(service.requestCharge(p,d,10001));
   service.tick(11900);assert(F.ruined(g,b.x+.2,b.z+5));assert.equal(B.ray(g,map,o,d,3),null);
   assert.deepEqual(B.collide(g,map,b.x+.2,b.z+5,0,1.8,.35),[b.x+.2,b.z+5]);
   const snap=service.snapshot(),copy=grid(map);B.layout(copy,map);F.apply(copy,snap.ids);
   assert.equal(B.ray(copy,map,o,d,3),null);assert(T.height(copy,b.x+2,b.z+6)<0);
   service.reset();assert(B.ray(g,map,o,d,3)!==null);assert.equal(service.snapshot().ids.length,0);
 });
 test(map+' has 100 additional combatant slots; both allied aircraft accept one pilot each',()=>{
   const {state,service,frames}=game(map,true),p={team:'t',alive:true,nick:'Pilot',hp:100},q={team:'t',alive:true,nick:'Wing',hp:100};
   state.players.set(1,p);state.players.set(2,q);const units=service.units();
   for(const team of ['t','ct']){assert.equal(units.filter(u=>u.team===team).length,50);assert.equal(units.filter(u=>u.team===team&&u.kind==='foot').length,46);}
   let now=1000;
   for(const kind of ['jet','heli']){
     assert.equal(service.board(p,kind),undefined);assert(service.board(q,kind));const u=units[p.frontSeat],y=u.y,z=u.z;
     service.control(p,{yaw:0,pitch:0,forward:1,side:0,lift:1,fire:false},now+=200);service.tick(now+=200);
     assert(u.y>y);assert(u.z<z);assert.equal(frames.at(-1).rows.length,100);assert.equal(service.snapshot().pilots[0][0],p.nick);
     service.leave(p);assert.equal(p.frontSeat,null);assert(!u.rider);
   }
   service.clear();assert.equal(service.units().length,0);
 });
}
test('three sequential sectors, contested capture, finite attacking tickets and timer',()=>{
 const {state,service,results}=game('dust2',false),p={team:'t',alive:true,nick:'A'},q={team:'ct',alive:true,nick:'B'};
 state.players.set(1,p);state.players.set(2,q);let now=1000;
 for(let i=0;i<3;i++){const o=service.status().objective;assert.equal(service.status().stage,i);for(const a of [p,q])Object.assign(a,{lx:o.x,ly:o.y,lz:o.z});service.tick(now+=200);assert.equal(service.status().capture,0);
   q.lz+=50;for(let t=0;t<41;t++)service.tick(now+=200);
 }assert.deepEqual(results,['t']);
 const other=game('inferno',false);for(let i=0;i<100;i++)other.service.lost({team:'t'},2000);
 other.service.tick(3000);assert.deepEqual(other.results,['ct']);
 const timed=game('frontline',false);timed.service.tick(timed.state.roundEnds+1);assert.deepEqual(timed.results,['ct']);
});
test('spread spawns, visible human engagement and player bullet damage',()=>{
 const hits=[], {service,state,g}=game('frontline',true,'assault',(...a)=>hits.push(a));
 const units=service.units();
 for(const team of ['t','ct']){
   const own=units.filter(u=>u.team===team);
   assert(new Set(own.map(u=>Math.floor(u.x/64)+','+Math.floor(u.z/64))).size>=8);
   assert(own.every(u=>g[Math.floor(u.z/4)][Math.floor(u.x/4)]===0));
 }
 const bot=units[50],p={nick:'Tester',team:'t',alive:true,weapon:'ak47',lx:239,ly:0,lz:209};
 state.players.set('p',p);
 for(const u of units){u.alive=false;u.respawn=Infinity;}
 Object.assign(bot,{alive:true,x:239,y:0,z:199,protectedUntil:0,nextShot:0});
 service.tick(3000);
 assert(hits.some(h=>h[1]===p));
 const dir=[bot.x-p.lx,bot.y+1.4-1.5,bot.z-p.lz],d=Math.hypot(...dir);
 for(let i=0;i<8&&bot.alive;i++)service.shoot(p,{origin:[p.lx,1.5,p.lz],dir:dir.map(v=>v/d),distance:d,weapon:'ak47'},4000+i*170);
 assert(!bot.alive);
});
test('purchased fast aircraft, one drop per match, crater and exclusive thermal rifle pickup',()=>{
 const {service,state,g,events}=game('dust2',true);const p={nick:'Pilot',team:'t',alive:true},q={nick:'Wing',team:'t',alive:true};
 state.players.set('p',p);state.players.set('q',q);
 assert(service.dropBomb(p,3000));assert.equal(service.buyJet(p),null);assert(service.buyJet(q));
 const u=service.units()[p.frontSeat];Object.assign(u,{x:240,z:240,y:50,yaw:0});
 service.control(p,{yaw:0,pitch:0,lift:0,side:0,forward:1,fire:false},2900);service.tick(3000);
 assert(240-u.z>19);assert.equal(service.dropBomb(p,3100),null);assert(service.dropBomb(p,3200));
 service.leave(p);service.tick(6050);assert(!service.status().gold);service.tick(6200);
 const c=service.snapshot().crater;assert(c&&service.status().gold);assert(service.snapshot().ids.length>100);
 assert(F.depth(g,c.x,c.z)>7);assert.equal(events.filter(e=>e.n==='cs16_army_impact').length,1);
 assert(service.claim(q));Object.assign(q,{lx:c.x,ly:T.height(g,c.x,c.z),lz:c.z});assert.equal(service.claim(q),null);
 assert.equal(q.goldWeapon,'ak47');assert(service.claim(q));assert(!service.snapshot().gold);
 state.round=2;service.reset();assert(service.status().bombUsed);state.round=1;service.reset();assert(!service.status().bombUsed);
});

test('pilot kills, respawns, reset and snapshot frame budget',()=>{
 const {service,state,frames}=game('frontline',true);const bot=service.units()[50];bot.hp=10;const p={team:'t',alive:true,nick:'Alpha',kills:0};state.players.set(1,p);
 service.blast(p,[bot.x,bot.y,bot.z],4,2700);assert(!bot.alive);service.tick(9250);assert(bot.alive);
 const started=performance.now();for(let t=0;t<60;t++)service.tick(9200+t*200);const elapsed=performance.now()-started;
 const payload=Buffer.byteLength(JSON.stringify(frames.at(-1)));console.log('Army simulation: average '+(elapsed/60).toFixed(2)+' ms/tick; frame '+payload+' bytes');assert(payload<9000);
});
