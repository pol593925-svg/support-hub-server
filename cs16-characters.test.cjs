const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),CS16Characters=require('./cs16-characters');
test('character handler validates roster, keeps stats, restricts live swaps and acknowledges selection',()=>{
 const source=fs.readFileSync(require('path').join(__dirname,'server.js'),'utf8');
 const start=source.indexOf("  socket.on('cs16_character',"),end=source.indexOf("  socket.on('cs16_class',",start);
 assert(start>0&&end>start);let handler,clock=1000,broadcasts=0;const events=[],p={nick:'A',team:null,alive:true,hp:100,armor:50,weapon:'ak47'};
 const cs16={phase:'lobby',players:new Map([['a',p]])};vm.runInNewContext(source.slice(start,end),{CS16Characters,cs16,Date:{now:()=>clock},cs16Broadcast:()=>broadcasts++,socket:{id:'a',on:(n,f)=>{assert.equal(n,'cs16_character');handler=f;},emit:(n,d)=>events.push({n,d})}});
 for(const id of ['__proto__','constructor','made-up',{},null])handler(id);assert.equal(broadcasts,0);
 for(const id of Object.keys(CS16Characters.profiles)){clock+=300;handler(id);assert.equal(p.characterId,id);assert.equal(events.at(-1).n,'cs16_character_selected');}
 assert.equal(p.hp,100);assert.equal(p.armor,50);assert.equal(p.weapon,'ak47');
 const before=broadcasts;handler('ember');assert.equal(broadcasts,before);
 cs16.phase='live';p.team='ct';clock+=500;handler('ember');assert.equal(p.characterId,'classic');assert.equal(events.at(-1).n,'cs16_err');
 p.alive=false;handler('jade');assert.equal(p.characterId,'jade');assert.equal(CS16Characters.normalize('../../bad'),'classic');
 assert(fs.readFileSync('cs16-characters.js').equals(fs.readFileSync('../fifflaren-app/cs16-characters.js')));
});
