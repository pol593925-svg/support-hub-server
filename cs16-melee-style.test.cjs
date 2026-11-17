const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const CS16Characters=require('./cs16-characters'),source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const start=source.indexOf("  socket.on('cs16_pos', (d) => {"),end=source.indexOf('  // 3.24.0: шаги',start);
assert(start>0&&end>start);
function fixture(){
 const player={nick:'A',team:'ct',alive:true,hp:73,armor:42,money:2500,kills:4,deaths:2,weapon:'ak47'},events=[];let handler,clock=1000;
 const cs16={phase:'live',players:new Map([['a',player]])};
 vm.runInNewContext(source.slice(start,end),{cs16,CS16Characters,CS16_SKINS:{},Date:{now:()=>clock},socket:{id:'a',on:(name,fn)=>{assert.equal(name,'cs16_pos');handler=fn;},broadcast:{emit:(name,data)=>events.push({name,data})}}});
 return {player,events,cs16,advance:ms=>clock+=ms,send:payload=>handler({pos:[1,2,3],yaw:0,pitch:0,weapon:'knife',move:false,...payload})};
}
test('actual position handler relays and persists cosmetic styles without changing weapon or combat stats',()=>{
 const {player,events,send}=fixture(),stats=()=>[player.hp,player.armor,player.money,player.kills,player.deaths,player.weapon],before=stats();
 send({meleeStyle:'karambit'});assert.equal(player.meleeStyle,'karambit');assert.equal(events.at(-1).name,'cs16_pos');assert.equal(events.at(-1).data.meleeStyle,'karambit');assert.equal(events.at(-1).data.weapon,'knife');
 send({});assert.equal(events.at(-1).data.meleeStyle,'karambit','older payload does not reset a selected cosmetic');
 for(const meleeStyle of ['__proto__','constructor','bowie','Karambit','',null,0,{},[],new String('knife')]){send({meleeStyle});assert.equal(player.meleeStyle,'karambit');assert.equal(events.at(-1).data.meleeStyle,'karambit');}
 send({meleeStyle:'knife'});assert.equal(player.meleeStyle,'knife');assert.equal(events.at(-1).data.meleeStyle,'knife');assert.deepEqual(stats(),before);
});
test('position validation runs before cosmetic changes and legacy players receive the knife default',()=>{
 const {player,events,send,cs16}=fixture();send({});assert.equal(events.at(-1).data.meleeStyle,'knife');
 send({meleeStyle:'karambit'});const count=events.length;
 for(const pos of [null,[1,2],[1,NaN,3]])send({pos,meleeStyle:'knife'});
 player.alive=false;send({meleeStyle:'knife'});player.alive=true;player.frontSeat=0;send({meleeStyle:'knife'});delete player.frontSeat;
 assert.equal(events.length,count);assert.equal(player.meleeStyle,'karambit');cs16.players.clear();send({meleeStyle:'knife'});assert.equal(events.length,count);
});
test('full state includes the stored style for late joiners and normalizes absent or invalid values',()=>{
 const {player,cs16,send}=fixture();send({meleeStyle:'karambit',meleeSwing:7});
 cs16.players.set('legacy',{nick:'Legacy',weapon:'knife'});cs16.players.set('invalid',{nick:'Invalid',weapon:'knife',meleeStyle:'__proto__'});
 const context={cs16,CS16Characters,CS16Magic:{petValid:()=>false},cs16HostId:()=>null,cs16Loading:{snapshot:()=>null},cs16LvlOf:()=>1,Date};
 const first=source.indexOf('function cs16State()'),last=source.indexOf('function cs16Broadcast()',first);assert(first>0&&last>first);vm.runInNewContext(source.slice(first,last),context);
 const players=context.cs16State().players;assert.equal(players[0].meleeStyle,'karambit');assert.equal(players[0].meleeSwing,7);assert.equal(players[0].weapon,'ak47');assert.equal(players[1].meleeStyle,'knife');assert.equal(players[1].meleeSwing,0);assert.equal(players[2].meleeStyle,'knife');
 cs16.phase='freeze';assert.equal(context.cs16State().players[0].meleeStyle,'karambit');assert.equal(player.hp,73);
});
test('cosmetic swing accepts only bounded integer knife sequences and throttles changed values',()=>{
 const {player,events,send,advance}=fixture();send({});assert.equal(events.at(-1).data.meleeSwing,0);
 for(const meleeSwing of [-1,2147483648,Infinity,NaN,.5,'1',null,{},[]]){send({meleeSwing});assert.equal(events.at(-1).data.meleeSwing,0);assert.equal(player.meleeSwingAt,undefined);}
 send({weapon:'ak47',meleeSwing:1});assert.equal(events.at(-1).data.meleeSwing,0);
 send({meleeSwing:1});assert.equal(player.meleeSwing,1);assert.equal(player.meleeSwingAt,1000);
 advance(199);send({meleeSwing:2});assert.equal(player.meleeSwing,1);assert.equal(events.at(-1).data.meleeSwing,1);assert.equal(player.meleeSwingAt,1000);
 // Repeated position packets with the accepted sequence cannot extend the throttle.
 send({meleeSwing:1});assert.equal(player.meleeSwingAt,1000);
 advance(1);send({meleeSwing:2});assert.equal(player.meleeSwing,2);assert.equal(player.meleeSwingAt,1200);
 advance(200);send({meleeSwing:2147483647});assert.equal(player.meleeSwing,2147483647);
 advance(200);send({meleeSwing:0});assert.equal(player.meleeSwing,0,'counter may wrap to zero');
 assert.equal(player.weapon,'ak47');assert.equal(player.hp,73);assert.equal(player.armor,42);assert.equal(player.money,2500);assert.equal(player.kills,4);assert.equal(player.deaths,2);assert(events.every(event=>event.name==='cs16_pos'));
});
