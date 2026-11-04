const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require('express'),mongoose=require('mongoose');
const {install,change,empty}=require('./radio-service'),{PART,mediaType}=require('./radio-media');
test('the queue accepts more than forty tracks and recognizes common audio containers',()=>{
 let st=empty();for(let n=0;n<100;n++)st=change(st,{op:'add',track:{id:String(n),duration:7200}},0);
 assert.equal(st.queue.length,100);assert.equal(mediaType(Buffer.from('fLaC')),'audio/flac');assert.equal(mediaType(Buffer.from('0000ftypM4A ')),'audio/mp4');assert.equal(mediaType(Buffer.from('<html>')),null);
});
test('large resumable upload, scoped streaming ranges, legacy and permanent library across restart',{skip:!process.env.HUB_RADIO_MONGO_PORT},async()=>{
 const port=Number(process.env.HUB_RADIO_MONGO_PORT),db='radio_test_'+crypto.randomBytes(8).toString('hex');
 const connection=await mongoose.createConnection('mongodb://127.0.0.1:'+port+'/'+db,{serverSelectionTimeoutMS:5000}).asPromise();
 const make=async()=>{
   const app=express();app.use(express.json());install({app,mongoose:{connection,Types:mongoose.Types},authenticate:async t=>['fifflaren','worker'].includes(t)?{username:t}:null});
   const srv=app.listen(0,'127.0.0.1');await new Promise(ok=>srv.once('listening',ok));return srv;
 };
 let srv=await make();
 const req=(path,user='fifflaren',method='GET',data,headers={})=>fetch('http://127.0.0.1:'+srv.address().port+'/api/radio/'+path,{method,headers:{Authorization:'Bearer '+user,...(Buffer.isBuffer(data)?{'Content-Type':'application/octet-stream'}:data?{'Content-Type':'application/json'}:{}),...headers},body:Buffer.isBuffer(data)?data:data?JSON.stringify(data):undefined});
 const read=async(...args)=>{const r=await req(...args);const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
 const restart=async()=>{srv.closeAllConnections();await new Promise(ok=>srv.close(ok));srv=await make();};
 try{
 const oldId='000000000000000000000001',oldBytes=Buffer.from('RIFF0000WAVE-test');
 await connection.collection('radio_audio').insertOne({_id:oldId,mime:'audio/wav',data:oldBytes});
 await connection.collection('radio_station').insertOne({_id:'live',...empty(),current:oldId,queue:[{id:oldId,title:'Old',duration:6}]});
 assert.deepEqual((await read('library')).tracks.map(t=>t.title),['Old']);
 const id='123456789abcdef012345678',path='uploads/'+id,body=Buffer.alloc(19*1024*1024+123);
 for(let i=0;i<body.length;i++)body[i]=i%251;body.write('RIFF');body.write('WAVE',8);
 const info={title:'Long set',duration:8000,size:body.length};
 assert.equal((await req(path,'worker','PUT',info)).status,403);
 assert.equal((await read(path,'fifflaren','PUT',info)).next,0);
 const put=n=>read(path+'/parts/'+n,'fifflaren','PUT',body.subarray(n*PART,(n+1)*PART));
 await put(0);await put(0);assert.equal((await req(path+'/parts/0','fifflaren','PUT',Buffer.alloc(PART,42))).ok,false);
 assert.equal((await req(path+'/finish','fifflaren','POST')).status,409);
 await restart();assert.equal((await read(path,'fifflaren','PUT',info)).next,1);
 for(let n=1;n<Math.ceil(body.length/PART);n++)await put(n);
 let state=await read(path+'/finish','fifflaren','POST');assert.equal(state.queue.length,2);assert.equal((await read(path+'/finish','fifflaren','POST')).queue.length,2);
 assert.equal((await read('state?compact=1','worker')).queue,undefined);
 const {ticket}=await read('audio/'+id+'/ticket','worker','POST');
 assert.equal((await req('audio/'+id,'nobody')).status,403);assert.equal((await req('audio/'+oldId+'?ticket='+ticket,'nobody')).status,403);
 await restart();
 const response=await req('audio/'+id+'?ticket='+ticket,'nobody','GET',null,{Range:'bytes='+(PART-2)+'-'+(PART+3)});
 assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),body.subarray(PART-2,PART+4));
 const full=await req('audio/'+id,'worker');assert.deepEqual(Buffer.from(await full.arrayBuffer()),body);
 assert.equal((await req('audio/'+id,'worker','GET',null,{Range:'bytes='+body.length+'-'})).status,416);
 assert.deepEqual(Buffer.from(await (await req('audio/'+oldId,'worker')).arrayBuffer()),oldBytes);
 state=await read('control','fifflaren','POST',{rev:state.rev,op:'remove',id});
 await restart();assert.equal((await read('library')).tracks.length,2);
 assert.equal((await read('library/'+id+'/queue','fifflaren','POST')).queue.length,2);
 }finally{srv.closeAllConnections();await new Promise(ok=>srv.close(ok));await connection.dropDatabase();await connection.close();}
});
