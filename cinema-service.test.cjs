const {test}=require('node:test'),assert=require('node:assert/strict'),{view}=require('./cinema-service');
test('cinema countdown and late arrival derive from the same durable show, even after restart',()=>{
  const stored={rev:1,title:'Премьера',film:{id:'a',duration:100},startsAt:50000,position:0,playing:false,anchor:20000};
  assert.equal(view(stored,49000).phase,'countdown');assert.equal(view(stored,50000).playing,true);
  assert.equal(view(stored,60000).position,10);assert.equal(view(JSON.parse(JSON.stringify(stored)),151000).phase,'ended');
  assert.equal(view({...stored,film:null},60000).phase,'waiting');
  const paused={...stored,startsAt:0,anchor:90000,position:19,playing:false};
  assert.equal(view(paused,95000).position,19);assert.equal(view({...paused,playing:true},95000).position,24);
});
