const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Props=require('./cs16-props');
test('map props are deterministic; destruction needs a nearby seated tank; duplicates and remote IDs rejected',()=>{
 const source=fs.readFileSync(__dirname+'/server.js','utf8'),ctx={};vm.runInNewContext(source.slice(source.indexOf('const CS16_MAP_ROWS ='),source.indexOf('// вейпоинты для ботов'))+'\nglobalThis.grid=CS16_GRID;',ctx);
 for(const map of ['dust2','inferno']){const items=Props.generate(ctx.grid[map],map);assert(items.length>3000);assert.deepEqual(items,Props.generate(ctx.grid[map],map));assert(items.every(i=>ctx.grid[map][Math.floor(i.z/4)][Math.floor(i.x/4)]===0));}
 const items=Props.generate(ctx.grid.dust2,'dust2'),first=items[0],p={alive:true,veh:{kind:'tank',inside:true,pos:[first.x,0,first.z]}};let handler;const sent=[],broken=new Set();
 vm.runInNewContext(source.slice(source.indexOf("  socket.on('cs16_props',"),source.indexOf("  socket.on('cs16_crew',")),{socket:{id:'pilot',on:(_,fn)=>handler=fn},cs16:{phase:'live',map:'dust2',players:new Map([['pilot',p]])},cs16Field:()=>items,cs16BrokenProps:broken,io:{emit:(n,d)=>sent.push(d)}});
 handler({ids:[first.id,first.id,-1,'0',999999]});assert.deepEqual([...broken],[first.id]);assert.equal(sent.length,1);handler({ids:[first.id]});assert.equal(sent.length,1);
 broken.clear();p.veh.kind='heli';handler({ids:[first.id]});assert.equal(broken.size,0);p.veh.kind='tank';p.veh.inside=false;handler({ids:[first.id]});assert.equal(broken.size,0);p.veh.inside=true;p.veh.pos=[500,0,500];handler({ids:[first.id]});assert.equal(broken.size,0);
});
