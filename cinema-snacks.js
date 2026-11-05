'use strict';
const IDS=['cola','sprite','fanta'];
const fail=(status,message)=>Object.assign(Error(message),{status});
function links(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail(400,'Укажи ссылки для напитков.');
  const result={};
  for(const id of IDS){
    if(typeof value[id]!=='string'||value[id].length>2048)throw fail(400,'Ссылка должна быть не длиннее 2048 символов.');
    const raw=value[id].trim();if(!raw){result[id]='';continue;}
    let url;try{url=new URL(raw);}catch{throw fail(400,'Нужна полная ссылка с https:// или http://.');}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||/[\u0000-\u0020\u007f]/.test(raw))throw fail(400,'Разрешены только обычные ссылки на сайты без логина и пароля в адресе.');
    result[id]=url.href;
  }
  return result;
}
function install({app,mongoose,guard,error}){
  const settings=mongoose.connection.collection('cinema_settings'),initial={rev:0,links:{cola:'',sprite:'',fanta:''}};
  app.get('/api/cinema/drinks',guard(false),async(req,res)=>{try{
    const row=await settings.findOne({_id:'drinks'});
    res.set('Cache-Control','no-store').json(row?{rev:row.rev,links:row.links}:initial);
  }catch(e){error(res,e);}});
  app.post('/api/cinema/drinks',guard(true),async(req,res)=>{try{
    const rev=req.body?.rev;if(!Number.isSafeInteger(rev)||rev<0)throw fail(400,'Обнови настройки напитков.');
    const next={rev:rev+1,links:links(req.body.links)};let saved;
    try{saved=await settings.updateOne({_id:'drinks',rev},{$set:next},{upsert:rev===0});}catch(e){if(e.code!==11000)throw e;}
    if(!saved?.matchedCount&&!saved?.upsertedCount)throw fail(409,'Ссылки уже изменены. Нажми «Обновить» и проверь их.');
    res.json(next);
  }catch(e){error(res,e);}});
}
module.exports={install,links};
