'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),rules=require('./cs16-round-rules');
const source=fs.readFileSync(require.resolve('./server.js'),'utf8');
function fixture(){
 const state={phase:'lobby',players:new Map([['h',{nick:'Host',team:'t'}],['g',{nick:'Guest',team:'ct'}],['bt',{nick:'Bot T',bot:true,team:'t'}],['bc',{nick:'Bot CT',bot:true,team:'ct'}]])},handlers={},events=[];
 const socket={id:'h',on:(n,f)=>handlers[n]=f},ctx={socket,cs16:state,cs16HostId:()=> 'h',cs16Broadcast:()=>events.push(['state']),io:{emit:(...e)=>events.push(e)}};
 vm.runInNewContext(source.slice(source.indexOf("  socket.on('cs16_botclear',"),source.indexOf("  socket.on('cs16_botdel',")),ctx);
 return {state,handlers,events,socket};
}
test('clear removes only bots and disables both start and loading-barrier autofill',()=>{
 const f=fixture();f.handlers.cs16_botclear();assert.equal(f.state.players.size,2);assert(f.state.players.has('h')&&f.state.players.has('g'));assert.equal(f.state.botFill,false);
 let added=0;rules.fill(f.state,()=>added++);rules.fill(f.state,()=>added++);assert.equal(added,0);assert(rules.canStart(f.state));assert.equal(f.events.filter(e=>e[0]==='cs16_leave').length,2);
 f.handlers.cs16_botclear();assert.equal(f.state.players.size,2);
 f.handlers.cs16_botfill(true);rules.fill(f.state,team=>f.state.players.set('b'+(++added),{team,bot:true}));assert.equal(added,8);assert.equal(rules.count(f.state,'t'),5);assert.equal(rules.count(f.state,'ct'),5);
});
test('host-only lobby controls reject strangers, active matches and invalid values',()=>{
 for(const change of [f=>f.socket.id='g',f=>f.state.phase='live',f=>f.state.phase='loading']){const f=fixture();change(f);f.handlers.cs16_botclear();f.handlers.cs16_botfill(false);assert.equal(f.state.players.size,4);assert.equal(f.state.botFill,undefined);}
 const f=fixture();for(const value of ['false',null,0,{}])f.handlers.cs16_botfill(value);assert.equal(f.state.botFill,undefined);
});
test('without autofill each side needs a participant; original default stays 5x5',()=>{
 const f=fixture();f.handlers.cs16_botclear();f.state.players.get('g').team=null;assert.equal(rules.canStart(f.state),false);f.handlers.cs16_botfill(true);assert(rules.canStart(f.state));
});
