const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('./cs16-loading-gate');
function fixture(){
 let time=10000,next=0,started=0;const timers=new Map(),events=[],errors=[];
 const state={phase:'lobby',map:'dust2',players:new Map([
  ['a',{nick:'Alice',team:'t'}],['b',{nick:'Bob',team:'ct'}],['bot',{nick:'Bot',team:'ct',bot:true}],['watch',{nick:'Watcher',team:null}]
 ])};
 const gate=create({state,publish:d=>events.push(d),start:()=>{started++;state.phase='freeze';},abort:m=>{errors.push(m);state.phase='lobby';},
  now:()=>time,schedule:(f,ms)=>{const id=++next;timers.set(id,{f,at:time+ms});return id;},unschedule:id=>timers.delete(id)});
 function advance(ms){const end=time+ms;while(true){const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;time=entry[1].at;timers.delete(entry[0]);entry[1].f();}time=end;}
 function ready(id,more={}){const d=gate.snapshot();return gate.report(id,{id:d.id,map:d.map,percent:100,stage:'ready',ready:true,...more});}
 gate.begin();return {gate,state,events,errors,advance,ready,timers,started:()=>started};
}
test('round clock stays stopped until every human is ready; bots and spectators never block',()=>{
 const f=fixture();assert.equal(f.state.freezeEnds,0);assert.equal(f.gate.snapshot().players.length,3);
 f.ready('a');f.advance(50000);assert.equal(f.started(),0);assert.equal(f.state.phase,'loading');
 f.ready('b');f.advance(250);assert(f.gate.snapshot().startAt);f.advance(2999);assert.equal(f.started(),0);f.advance(1);
 assert.equal(f.started(),1);assert.equal(f.gate.snapshot(),null);f.advance(50000);assert.equal(f.started(),1);assert.equal(f.timers.size,0);
});
test('stale tokens, wrong map, spectators and invalid percentages cannot unlock the round',()=>{
 const f=fixture();
 for(const change of [{id:'old'},{map:'inferno'},{percent:NaN},{percent:101},{percent:-1},{stage:'made-up'}])assert.equal(f.ready('a',change),false);
 assert.equal(f.ready('watch'),false);assert.equal(f.ready('bot'),false);
 f.ready('a',{ready:false});f.advance(250);assert.equal(f.gate.snapshot().players[0].percent,99);assert.equal(f.gate.snapshot().players[0].ready,false);
 f.ready('b');f.advance(3500);assert.equal(f.started(),0);
});
test('ordinary progress is monotonic; graphics reset cancels the countdown and permits retry',()=>{
 const f=fixture();f.ready('a',{percent:70,stage:'models',ready:false});f.ready('a',{percent:20,stage:'map',ready:false});
 assert.equal(f.gate.snapshot().players[0].percent,70);
 f.ready('a');f.ready('b');f.advance(250);assert(f.gate.snapshot().startAt);
 f.ready('a',{percent:0,stage:'error',ready:false,reset:true});f.advance(4000);
 assert.equal(f.started(),0);assert.equal(f.gate.snapshot().players[0].ready,false);
 f.ready('a');f.advance(3250);assert.equal(f.started(),1);
});
test('disconnect removes a waiting player; a new human joining during countdown must load too',()=>{
 const f=fixture();f.ready('a');f.state.players.delete('b');f.advance(250);assert(f.gate.snapshot().startAt);
 f.state.players.set('c',{nick:'Carol',team:'ct'});f.advance(250);assert.equal(f.gate.snapshot().startAt,0);
 f.advance(4000);assert.equal(f.started(),0);f.ready('c');f.advance(3250);assert.equal(f.started(),1);
});
test('missing readiness returns to lobby after two minutes; old packets cannot affect a retry',()=>{
 const f=fixture(),old=f.gate.snapshot();f.ready('a');f.advance(120000);
 assert.equal(f.started(),0);assert.equal(f.state.phase,'lobby');assert.equal(f.errors.length,1);assert.equal(f.timers.size,0);
 f.gate.begin();assert.notEqual(f.gate.snapshot().id,old.id);
 assert.equal(f.gate.report('b',{id:old.id,map:'dust2',percent:100,stage:'ready',ready:true}),false);
 f.ready('a');f.ready('b');f.advance(3250);assert.equal(f.started(),1);
});
test('empty teams, admin cancellation and map changes cannot leave a delayed round start',()=>{
 for(const action of [f=>f.state.players.clear(),f=>{f.gate.cancel();f.state.phase='lobby';},f=>{f.state.map='inferno';}]){
  const f=fixture();f.ready('a');f.ready('b');f.advance(250);action(f);f.advance(5000);
  assert.equal(f.started(),0);assert.equal(f.gate.snapshot(),null);assert.equal(f.timers.size,0);
 }
});
test('progress broadcasts are coalesced and unchanged idle state is not spammed',()=>{
 const f=fixture(),count=f.events.length;f.advance(5000);assert.equal(f.events.length,count);
 for(let i=1;i<80;i++)f.ready('a',{percent:i,stage:'models',ready:false});
 assert.equal(f.events.length,count);f.advance(250);assert.equal(f.events.length,count+1);
});
test('actual match entry point waits, preserves the buy window, and cleans up an admin cancellation',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),rules=require('./cs16-round-rules'),source=fs.readFileSync(require.resolve('./server'),'utf8');
 const state={phase:'lobby',map:'dust2',timers:[],players:new Map([['host',{nick:'host',team:'t'}]])},timers=new Map(),events=[];
 let time=1000,id=0,starts=0,bots=0;
 const box={cs16:state,CS16Rounds:rules,Date:{now:()=>time},clearTimeout:key=>timers.delete(key),io:{to:()=>({emit:(...e)=>events.push(e)})},
  require:()=>({create:options=>create({...options,now:()=>time,schedule:(f,ms)=>{const key=++id;timers.set(key,{f,at:time+ms});return key;},unschedule:key=>timers.delete(key)})}),
  cs16Missiles:{clear(){}},cs16Front:{clear(){}},cs16Broadcast(){},
  cs16BotAdd:(_,team,preparing)=>{assert(preparing);state.players.set('bot'+(++bots),{nick:'bot'+bots,bot:true,team});},
  cs16StartRound:()=>{starts++;state.phase='freeze';state.freezeEnds=time+6000;state.buyUntil=time+21000;}};
 vm.createContext(box);
 const a=source.indexOf('function cs16ClearTimers()'),b=source.indexOf('function cs16Later',a);
 const c=source.indexOf("const cs16Loading=require('./cs16-loading-gate')"),d=source.indexOf('function cs16State()',c);
 vm.runInContext(source.slice(a,b)+source.slice(c,d)+'globalThis.gate=cs16Loading;',box);
 function tick(ms){time+=ms;const work=[...timers].filter(([,v])=>v.at<=time);for(const [key,v]of work){timers.delete(key);v.f();}}
 box.cs16PrepareMatch();assert.equal(state.players.size,10);assert.equal(starts,0);
 let data=box.gate.snapshot();box.gate.report('host',{id:data.id,map:data.map,ready:true,percent:100,stage:'ready'});
 tick(250);tick(3000);assert.equal(starts,1);assert.equal(state.freezeEnds-time,6000);assert.equal(state.buyUntil-time,21000);
 box.cs16PrepareMatch();box.cs16ClearTimers();state.phase='lobby';tick(150000);assert.equal(starts,1);assert.equal(timers.size,0);
});
