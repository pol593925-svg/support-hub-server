'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./server.js'),'utf8');
const vehicles=require('./cs16-vehicles');

function fixture(kind='tank'){
 const handlers={},broadcasts=[];
 const hp=kind==='tank'?1000:600;
 const driver={nick:'Driver',alive:true,team:'ct',veh:{kind,variant:kind,hp,max:hp,inside:false,passenger:null}};
 const observer={nick:'Observer',alive:true,team:'t'};
 const socket={id:'driver',on(name,fn){handlers[name]=fn;},broadcast:{emit(name,data){broadcasts.push({name,data});}}};
 const state={players:new Map([['driver',driver],['observer',observer]])};
 const sandbox={socket,cs16:state,CS16Vehicles:vehicles};
 vm.createContext(sandbox);
 const a=source.indexOf("  socket.on('cs16_veh',"),b=source.indexOf("  socket.on('cs16_vehboom',",a);
 assert(a>=0&&b>a,'server vehicle handler must be discoverable');
 vm.runInContext(source.slice(a,b),sandbox);
 return {handlers,driver,broadcasts};
}

test('server relays real tank and helicopter transforms with authoritative variant and HP',()=>{
 for(const kind of ['tank','heli']){
  const f=fixture(kind),pos=kind==='tank'?[227.41,0,179.91]:[229.33,3.6,178.73];
  f.handlers.cs16_veh({kind:'forged',variant:'forged',team:'t',hp:1,max:1,pos,yaw:.55,turret:-.2,inside:true});
  assert.deepEqual(f.driver.veh.pos,pos);
  assert.equal(f.driver.veh.inside,true);
  assert.equal(f.broadcasts.length,1);
  assert.equal(f.broadcasts[0].name,'cs16_veh');
  assert.deepEqual(JSON.parse(JSON.stringify(f.broadcasts[0].data)),{kind,variant:kind,team:'ct',passenger:null,pos,yaw:.55,turret:-.2,by:'Driver',hp:kind==='tank'?1000:600,max:kind==='tank'?1000:600});
 }
});

test('server rejects malformed transforms without mutating or broadcasting them',()=>{
 for(const pos of [null,[],[1,2],[1,NaN,3],[1,Infinity,3],'224,0,182']){
  const f=fixture();f.handlers.cs16_veh({pos,inside:true});
  assert.equal(f.driver.veh.pos,undefined);
  assert.equal(f.driver.veh.inside,false);
  assert.equal(f.broadcasts.length,0);
 }
 const f=fixture();f.driver.alive=false;f.handlers.cs16_veh({pos:[1,0,2],inside:true});
 assert.equal(f.broadcasts.length,0);assert.equal(f.driver.veh.inside,false);
});
