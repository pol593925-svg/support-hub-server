const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),rules=require('./cs16-round-rules');
const source=fs.readFileSync(require.resolve('./server.js'),'utf8');
function fixture(){const handlers={},events=[],state={phase:'lobby',players:new Map([['host',{nick:'host',team:'t'}]]),mode:3,gm:'cq',army:true,map:'frontline'};let seq=0,rounds=0;
 const socket={id:'host',on(n,fn){handlers[n]=fn},emit:(n,d)=>events.push([n,d])};const io={emit:(...e)=>events.push(e),to:()=>socket};
 const sandbox={socket,io,cs16:state,CS16Rounds:rules,cs16HostId:()=> 'host',cs16TeamCount:t=>rules.count(state,t),cs16Broadcast:()=>{},cs16Magic:{reset:()=>{}},cs16BotAdd:(_,team)=>state.players.set('bot'+(++seq),{nick:'bot'+seq,bot:true,team}),cs16StartRound:()=>rounds++};
 vm.createContext(sandbox);const a=source.indexOf("  socket.on('cs16_mode',"),b=source.indexOf("  socket.on('cs16_botadd',",a);vm.runInContext(source.slice(a,b),sandbox);
 return {state,handlers,events,rounds:()=>rounds,socket};}
test('start fills precisely 5+5, retires army and old mode even for old clients',()=>{const f=fixture();f.handlers.cs16_start();assert.equal(rules.count(f.state,'t'),5);assert.equal(rules.count(f.state,'ct'),5);assert.equal(f.state.players.size,10);assert.equal(f.state.gm,'classic');assert.equal(f.state.mode,5);assert.equal(f.state.army,false);assert.equal(f.state.map,'dust2');assert.equal(f.rounds(),1)});
test('only the host starts from lobby; a human must join a side',()=>{for(const change of [f=>f.socket.id='other',f=>f.state.phase='live',f=>f.state.players.get('host').team=null]){const f=fixture();change(f);f.handlers.cs16_start();assert.equal(f.rounds(),0);assert.equal(f.state.players.size,1)}});
test('legacy requests cannot re-enable modes, shrink teams or select the sector map',()=>{const f=fixture();rules.normalize(f.state);for(const mode of ['gg','cq','assault','anything']){f.handlers.cs16_gm(mode);assert.equal(f.state.gm,'classic')}f.handlers.cs16_mode(1);assert.equal(f.state.mode,5);f.handlers.cs16_map('frontline');assert.equal(f.state.map,'dust2');f.handlers.cs16_map('inferno');assert.equal(f.state.map,'inferno')});
test('full teams retain their humans and identify a bot slot for late joining',()=>{const f=fixture();f.handlers.cs16_start();const id=rules.replacementBot(f.state,'t');assert(f.state.players.get(id).bot);for(const p of f.state.players.values())p.bot=false;assert.equal(rules.replacementBot(f.state,'ct'),null)});
test('live bot replacement and leaving for spectators recheck the round; bot deletion is lobby-only',()=>{
 const f=fixture();f.handlers.cs16_start();f.state.players.set('guest',{nick:'guest',team:null,money:0});f.socket.id='guest';f.state.phase='live';
 let wipes=0,deletes=0;const sandbox={socket:f.socket,io:{emit:()=>{},to:()=>f.socket},cs16:f.state,CS16Rounds:rules,cs16Front:{leave:()=>{}},cs16Broadcast:()=>{},cs16CheckWipe:()=>wipes++,cs16HostId:()=> 'host',cs16BotDel:()=>deletes++};vm.createContext(sandbox);
 const a=source.indexOf("  socket.on('cs16_team',"),b=source.indexOf("  socket.on('cs16_mode',",a);vm.runInContext(source.slice(a,b),sandbox);
 f.handlers.cs16_team('ct');assert.equal(rules.count(f.state,'ct'),5);assert.equal(f.state.players.get('guest').alive,false);assert.equal(wipes,1);
 f.handlers.cs16_team(null);assert.equal(f.state.players.get('guest').team,null);assert.equal(f.state.players.get('guest').alive,false);assert.equal(wipes,2);
 const c=source.indexOf("  socket.on('cs16_botdel',"),d=source.indexOf("  socket.on('cs16_pos',",c);vm.runInContext(source.slice(c,d),sandbox);f.socket.id='host';f.handlers.cs16_botdel();assert.equal(deletes,0);f.state.phase='lobby';f.handlers.cs16_botdel();assert.equal(deletes,1);
});
