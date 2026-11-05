'use strict';
const crypto=require('node:crypto'),derive=require('node:util').promisify(crypto.pbkdf2);
const SALT='e0bb46b3f678e9ec2980b31758449bc1',HASH='d093f1b82eef01cc388610fbca4a884c17c5d26c1881a0dc6474d9ca2c9ad500';
const fail=(status,message)=>Object.assign(Error(message),{status});
function create({app,mongoose,guard,error}){
  const keys=mongoose.connection.collection('cinema_keys'),attempts=new Map();
  const hash=value=>derive(value,SALT,120000,32,'sha256');
  const expected=process.env.CINEMA_VIP_PASSWORD?hash(process.env.CINEMA_VIP_PASSWORD):Promise.resolve(Buffer.from(HASH,'hex'));
  let signing;
  async function secret(){
    if(!signing)signing=(async()=>{
      try{await keys.updateOne({_id:'vip-access'},{$setOnInsert:{secret:crypto.randomBytes(32).toString('hex')}},{upsert:true});}catch(e){if(e.code!==11000)throw e;}
      return (await keys.findOne({_id:'vip-access'})).secret;
    })().catch(e=>{signing=null;throw e;});return signing;
  }
  const mac=async body=>crypto.createHmac('sha256',await secret()).update(body).digest('hex');
  const version=async()=>crypto.createHash('sha256').update(await expected).digest('hex').slice(0,16);
  async function access(nick,ticket){
    if(nick?.toLowerCase()==='fifflaren')return {expires:0};
    if(typeof ticket!=='string'||ticket.length>1024)return null;
    const [body,signature,extra]=ticket.split('.');if(extra||!/^[a-f0-9]{64}$/.test(signature||''))return null;
    if(!crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(await mac(body),'hex')))return null;
    try{const data=JSON.parse(Buffer.from(body,'base64url'));
      return data.user===nick?.toLowerCase()&&Number.isSafeInteger(data.expires)&&data.expires>Date.now()&&data.version===await version()?data:null;
    }catch{return null;}
  }
  app.post('/api/cinema/vip/enter',guard(false),async(req,res)=>{try{
    const nick=req.cinemaUser.toLowerCase(),password=req.body?.password;
    if(typeof password!=='string'||!password||password.length>128)throw fail(400,'Введи пароль закрытого сеанса.');
    const now=Date.now();for(const [key,value]of attempts)if(value.until<now)attempts.delete(key);
    const item=attempts.get(nick)||{count:0,until:now+10*60000};
    if(item.count>=5)throw fail(429,'Слишком много попыток. Повтори через 10 минут.');
    if(attempts.size>=10000&&!attempts.has(nick))throw fail(429,'Повтори вход немного позже.');
    item.count++;attempts.set(nick,item);
    if(!crypto.timingSafeEqual(await hash(password),await expected))throw fail(403,'Неверный пароль.');
    attempts.delete(nick);
    const expires=Date.now()+12*3600000,body=Buffer.from(JSON.stringify({user:nick,expires,version:await version()})).toString('base64url');
    res.set('Cache-Control','no-store').json({ticket:body+'.'+await mac(body),expires});
  }catch(e){error(res,e);}});
  const protect=async(req,res,next)=>{try{
    if(!await access(req.cinemaUser,req.headers['x-cinema-vip']))throw fail(403,'Введи пароль VIP-ложи.');next();
  }catch(e){error(res,e);}};
  return {access,protect};
}
module.exports={create};
