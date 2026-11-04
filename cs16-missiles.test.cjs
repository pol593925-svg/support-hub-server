const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('./cs16-missiles');
function game(){
 const g=Array.from({length:48},()=>Array(48).fill(0)),a={team:'t',alive:true,nick:'A',rpgAmmo:4,lx:14,ly:0,lz:20},b={team:'ct',alive:true,nick:'B',lx:70,ly:0,lz:20},ally={team:'t',alive:true,nick:'Friend',lx:30,ly:0,lz:20};
 const state={phase:'live',map:'dust2',players:new Map([['a',a],['b',b],['f',ally]])},events=[],frames=[],hits=[];
 const m=M.create({state,grid:()=>g,army:()=>[],emit:(n,d)=>events.push({n,d}),frame:(_,d)=>frames.push(d),impact:(p,pos,kind)=>hits.push({p,pos,kind})});
 return {m,g,a,b,state,events,frames,hits};
}
function acquire(m,a,kind,dir,at=1000){let lock;for(let t=at;t<=at+800;t+=200)lock=m.seek(a,kind,dir,t);return lock;}
test('lock requires dwell and LOS; a rocket turns towards a moving hostile target',()=>{
 const {m,a,b,events,frames,hits}=game(),o=m.source(a,'rpg'),dir=[1,0,0];
 assert.equal(m.seek(a,'rpg',dir,1000).progress,0);assert.equal(m.seek(a,'rpg',dir,1200).progress,.25);
 assert.equal(acquire(m,a,'rpg',dir,1600).progress,1);m.fire(a,'rpg',o,dir,2400);assert(events[0].d.locked);
 b.lz+=6;for(let t=2450;t<4500;t+=50)m.tick(t);
 assert(frames.some(rows=>rows.some(r=>r[3]>210)));assert.equal(hits.length,1);assert(Math.abs(hits[0].pos[2]-b.lz)<.6);
});
test('a new wall breaks line of sight and intercepts an in-flight rocket; clearing the round clears the seeker',()=>{
 const {m,g,a,events,hits}=game(),dir=[1,0,0],o=m.source(a,'rpg');acquire(m,a,'rpg',dir);m.fire(a,'rpg',o,dir,1800);
 g[5][8]=1;assert.equal(m.seek(a,'rpg',dir,2000).progress,0);for(let t=1850;t<3000;t+=50)m.tick(t);
 assert.equal(hits.length,1);assert(hits[0].pos[0]>=32&&hits[0].pos[0]<32.25);
 m.clear();g[5][8]=0;m.fire(a,'rpg',o,dir,3200);assert.equal(events.at(-1).d.locked,false);
});
test('purchased vehicles share the seeker; a two-rocket salvo consumes one cooldown',()=>{
 const {m,a,events}=game(),dir=[1,0,0];assert.equal(m.vehicle(a,{dir},1000),false);
 a.veh={kind:'tank',hp:900,pos:[14,0,20],inside:true};assert.equal(acquire(m,a,'vehicle',dir).progress,1);
 assert(m.vehicle(a,{dir},1800));assert(!m.vehicle(a,{dir},2000));for(let t=1850;t<=2250;t+=50)m.tick(t);
 assert.equal(events.filter(e=>e.n==='cs16_missile_start').length,2);assert(events.filter(e=>e.n==='cs16_missile_start').every(e=>e.d.locked));
});
test('piloted and AI jet/heli launchers can lock independently; ground allies cannot be acquired',()=>{
 for(const kind of ['heli','jet']){
   const g=Array.from({length:48},()=>Array(48).fill(0)),pilot={nick:'Pilot',alive:true,frontSeat:0,team:'t'};
   const unit={id:0,rider:pilot,army:true,team:'t',kind,x:20,y:20,z:20,alive:true};
   const foe={id:1,army:true,team:'ct',kind:'heli',x:75,y:20,z:20,alive:true},started=[];
   const m=M.create({state:{phase:'live',map:'dust2',players:new Map([['p',pilot]])},grid:()=>g,army:()=>[unit,foe],emit:(n,d)=>{if(n==='cs16_missile_start')started.push(d);},frame(){},impact(){}});
   for(const [shooter,mode] of [[pilot,'front'],[unit,'ai']]){
     assert.equal(acquire(m,shooter,mode,[1,0,0]).progress,1);m.fire(shooter,mode,m.source(shooter,mode),[1,0,0],1800);assert(started.at(-1).locked);
   }
   foe.team='t';assert.equal(m.seek(pilot,'front',[1,0,0],2200).progress,0);
 }
});
