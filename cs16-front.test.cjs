const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),F=require('./cs16-front'),B=require('./cs16-buildings'),T=require('./cs16-terrain'),Front=require('./cs16-front-server');
function grid(map){
 const source=fs.readFileSync(__dirname+'/server.js','utf8'),ctx={require};
 vm.runInNewContext(source.slice(source.indexOf('const CS16_MAP_ROWS ='),source.indexOf('// вейпоинты для ботов'))+'\nglobalThis.grid=CS16_GRID;',ctx);
 return ctx.grid[map];
}
function game(map,army,gm='assault'){
 const g=grid(map),state={map,gm,army,phase:'live',players:new Map(),freezeEnds:1000},events=[],results=[],frames=[];
 const service=Front.create({state,grid:()=>g,emit:(n,d)=>events.push({n,d}),frame:(n,d)=>frames.push(d),hitHuman(){},credit(){},wipe(){},radial(){},respawn:(p,pos)=>{p.alive=true;p.lx=pos[0];p.ly=pos[1];p.lz=pos[2];p.cqRespawnAt=0;},finish:t=>{results.push(t);state.phase='matchend';}});
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
test('pilot kills, respawns, reset and snapshot frame budget',()=>{
 const {service,state,frames}=game('frontline',true);const bot=service.units()[50];bot.hp=10;const p={team:'t',alive:true,nick:'Alpha',kills:0};state.players.set(1,p);
 service.blast(p,[bot.x,bot.y,bot.z],4,2700);assert(!bot.alive);service.tick(9250);assert(bot.alive);
 const started=performance.now();for(let t=0;t<60;t++)service.tick(9200+t*200);const elapsed=performance.now()-started;
 const payload=Buffer.byteLength(JSON.stringify(frames.at(-1)));console.log('Army simulation: average '+(elapsed/60).toFixed(2)+' ms/tick; frame '+payload+' bytes');assert(payload<9000);
});
