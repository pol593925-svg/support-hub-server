const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const T=require('./cs16-tactical-map'),B=require('./cs16-buildings'),Terrain=require('./cs16-terrain'),Bots=require('./cs16-bot-objectives');
const codes={'#':1,'.':0,D:2,C:3,4:4,5:5,6:6,7:7,V:8,B:9,S:10,T:11};
const source=fs.readFileSync(require.resolve('./server.js'),'utf8');
for(const map of ['dust2','inferno'])test(map+': bots navigate from every spawn to either site without entering walls',()=>{
 const grid=T.generate(map).map(r=>Array.from(r,c=>codes[c]));
 const context={CS16Buildings:B,CS16Terrain:Terrain,CS16_WPS:{[map]:T.waypoints(map)},cs16:{map}};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function cs16BotStep('),source.indexOf('function cs16StartRound(')),context);
 for(const team of ['t','ct'])for(let i=0;i<5;i++)for(const wp of [1,2]){
  const [x,,z]=T.spawn(map,team,i),p={bx:x,bz:z,ly:0,bwp:wp};let ticks=0;
  while(p.bwp===wp&&ticks++<1500){const next=Bots.tacticalDestination(p,{map},grid);if(next){const dx=next.x-p.bx,dz=next.z-p.bz,d=Math.hypot(dx,dz);context.cs16BotStep(p,dx/d,dz/d,grid);}assert.equal(grid[Math.floor(p.bz/4)][Math.floor(p.bx/4)],0);}
  const target=T.waypoints(map)[wp];assert(Math.hypot(p.bx-(target[0]*4+2),p.bz-(target[1]*4+2))<2.1,team+' spawn '+i+' site '+wp+' stalled '+JSON.stringify(p));
 }
});
test('bot sight respects house walls and floor height',()=>{
 const map='dust2',grid=T.generate(map).map(r=>Array.from(r,c=>codes[c])),b=B.layout(grid,map).buildings[0];
 assert.equal(Bots.visible({bx:b.x-1,bz:b.z+5,ly:0},{lx:b.x+2,lz:b.z+5,ly:0},grid,map),false);
 assert.equal(Bots.visible({bx:b.x+5.5,bz:b.z-1,ly:0},{lx:b.x+5.5,lz:b.z+2,ly:0},grid,map),true);
 assert.equal(Bots.visible({bx:b.x+5.5,bz:b.z+5,ly:0},{lx:b.x+5.5,lz:b.z+5,ly:3.6},grid,map),false);
});
test('plant areas reject non-finite coordinates, roofs, tunnels and spawn courts',()=>{
 for(const map of ['dust2','inferno'])for(const p of [[NaN,0,200],[310,8,204],[310,-3.2,204],T.spawn(map,'t'),T.spawn(map,'ct'),null])assert.equal(T.siteAt(map,p),null);
 assert.equal(T.siteAt('dust2',[310,0,204]),'A');assert.equal(T.siteAt('dust2',[190,0,204]),'B');
});
test('actual bomb handlers require the player at the objective and reject spoofed floor positions',()=>{
 const handlers={},events=[],player={nick:'tester',alive:true,team:'t',lx:310,ly:0,lz:204};
 const state={map:'dust2',phase:'live',gm:'classic',bomb:null,players:new Map([['p',player]])};
 const context={socket:{id:'p',on:(n,f)=>handlers[n]=f},cs16:state,CS16TacticalMap:T,io:{emit:(...x)=>events.push(x)},setTimeout:()=>1,clearTimeout:()=>{},cs16StatAdd:()=>{},cs16Broadcast:()=>{},cs16EndRound:()=>{state.phase='end';}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf("  socket.on('cs16_plant',"),source.indexOf("  // Только Fifflaren: переназначить")),context);
 for(const [x,y,z] of [[310,7.2,204],[310,-3.2,204],[250,0,328]]){
  Object.assign(player,{lx:x,ly:y,lz:z});handlers.cs16_plant({site:'A',pos:[310,0,204]});assert.equal(state.bomb,null);
 }
 Object.assign(player,{lx:310,ly:0,lz:204});handlers.cs16_plant({site:'B',pos:[310,0,204]});assert.equal(state.bomb,null);
 handlers.cs16_plant({site:'A',pos:[310,0,204]});assert.equal(state.bomb.site,'A');
 player.team='ct';player.lx=250;handlers.cs16_defuse();assert.equal(state.phase,'live');
 player.lx=310;player.ly=7.2;handlers.cs16_defuse();assert.equal(state.phase,'live');
 player.ly=0;handlers.cs16_defuse();assert.equal(state.phase,'end');assert(events.some(e=>e[0]==='cs16_bomb_defused'));
});
