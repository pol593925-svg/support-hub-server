const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),rules=require('./cs16-round-rules');
const source=fs.readFileSync(require.resolve('./server.js'),'utf8');
test('vehicle and AT-mine packets are blocked; manual RPG and infantry play remain available',()=>{
 let middleware;const events=[];rules.guard({use:fn=>middleware=fn,emit:(...e)=>events.push(e)});
 const retired=['cs16_army','cs16_army_loader','cs16_army_ready','cs16_army_bomb','cs16_army_claim','cs16_front_charge','cs16_front_board','cs16_front_controls','cs16_seek','cs16_vehicle_rocket','cs16_crew','cs16_veh','cs16_vehboom','cs16_vehhit','cs16_vehcrate'];
 for(const event of retired){let passed=false;middleware([event,{}],()=>passed=true);assert.equal(passed,false,event);}
 for(const item of ['veh_jet','veh_bastion','veh_storm','veh_tank','veh_heli','mgveh','tankgun','mine_at']){let passed=false;middleware(['cs16_buy',item],()=>passed=true);assert.equal(passed,false,item);}
 for(const packet of [['cs16_buy','rpg'],['cs16_buy','mine_ap'],['cs16_rpg',{}],['cs16_buy','awp'],['cs16_shoot',{}],['cs16_environment',{}],['cs16_magic',{}]]){let passed=false;middleware(packet,()=>passed=true);assert(passed,packet[0]+':'+packet[1]);}
 assert.equal(events.length,1,'legacy packets must not flood the error channel');
});
test('shop sells RPG for 4000 with four rockets and AP mines; vehicles and AT mines stay unavailable',()=>{
 const combat=require('./cs16-combat'),classes=require('./cs16-classes'),vehicles=require('./cs16-vehicles');
 for(const id of ['rpg','tankgun'])assert.equal(combat.weapons[id],undefined,'RPG is a server projectile, not hitscan');
 assert.deepEqual(combat.weapons.mgveh,{dmg:20,penetration:.65,rangeModifier:.99,rpm:600,spread:.08});
 const p={nick:'player',alive:true,team:'ct',weapon:'usp',money:16000,classId:'antitank',nextClass:'antitank',rpgAmmo:3,veh:{kind:'tank',inside:true}};
 classes.apply(p);assert.equal(p.weapon,'m4a1');assert.equal(p.rpgAmmo,0);assert.equal(p.classId,'assault');p.veh=null;
 const handlers={},emitted=[],socket={id:'p',on:(n,f)=>handlers[n]=f},state={players:new Map([['p',p]]),gm:'classic',phase:'freeze'},box={socket,cs16:state,CS16Vehicles:vehicles,cs16Mines:{buy:()=>({kind:'ap',count:5})},io:{to:()=>({emit:(...e)=>emitted.push(e)})},cs16Personal:()=>{},cs16Broadcast:()=>{}};
 vm.createContext(box);let a=source.indexOf('const CS16_W = {'),b=source.indexOf('\n};',a)+3;vm.runInContext(source.slice(a,b),box);
 const shop=vm.runInContext('CS16_W',box);
 assert.equal(shop.mine_ap.price,1000);assert.equal(shop.rpg.price,4000);
 for(const item of ['veh_tank','veh_heli','mine_at'])assert.equal(shop[item],undefined,item);
 a=source.indexOf("  socket.on('cs16_buy',");b=source.indexOf("  socket.on('cs16_plant',",a);vm.runInContext(source.slice(a,b),box);
 for(const item of ['veh_jet','veh_bastion','veh_storm','veh_tank','veh_heli','mgveh','tankgun','mine_at'])handlers.cs16_buy(item);
 assert.equal(p.money,16000);assert.equal(p.weapon,'m4a1');assert.equal(p.veh,null);
 p.money=3999;handlers.cs16_buy('rpg');assert.equal(p.money,3999);assert.equal(p.weapon,'m4a1');
 p.money=16000;handlers.cs16_buy('rpg');assert.equal(p.money,12000);assert.equal(p.weapon,'rpg');assert.equal(p.rpgAmmo,4);
 p.rpgAmmo=1;handlers.cs16_buy('rpg');assert.equal(p.money,8000);assert.equal(p.rpgAmmo,4,'repurchase restores the four-rocket loadout');
 assert(emitted.some(e=>e[0]==='cs16_bought'&&e[1].item==='rpg'&&e[1].money===8000));
 p.weapon='m4a1';p.rpgAmmo=0;p.money=16000;handlers.cs16_buy('mine_ap');assert.equal(p.money,15000);assert.equal(p.weapon,'m4a1');
 state.phase='live';state.buyUntil=Date.now()-1;handlers.cs16_buy('veh_tank');assert.equal(p.money,15000);assert.equal(p.veh,null);
 state.phase='freeze';handlers.cs16_buy('awp');assert.equal(p.weapon,'awp');assert.equal(p.money,10250);
 assert(!emitted.some(e=>e[0]==='cs16_bought'&&['veh_tank','veh_heli','mine_at'].includes(e[1].item)));
});
function fixture(){const handlers={},events=[],state={phase:'lobby',players:new Map([['host',{nick:'host',team:'t'}]]),mode:3,gm:'cq',army:true,map:'frontline'};let seq=0,rounds=0;
 const socket={id:'host',on(n,fn){handlers[n]=fn},emit:(n,d)=>events.push([n,d])};const io={emit:(...e)=>events.push(e),to:()=>socket};
 const sandbox={socket,io,cs16:state,CS16Rounds:rules,cs16HostId:()=> 'host',cs16TeamCount:t=>rules.count(state,t),cs16Broadcast:()=>{},cs16Magic:{reset:()=>{}},cs16BotAdd:(_,team)=>state.players.set('bot'+(++seq),{nick:'bot'+seq,bot:true,team}),cs16PrepareMatch:()=>rounds++};
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
