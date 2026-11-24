'use strict';
// Explicit maintenance command. Never runs at application startup or during deployment.
// Preview contains identifiers only; credentials and working history are never exported.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const mongoose=require('mongoose');
const normalize=value=>String(value||'').trim().toLowerCase();
const protectedUser=user=>normalize(user.username)==='fifflaren'||normalize(user.team)==='fifflaren';
function planFor(users,teams){
  const list=users.map(user=>({id:String(user._id),username:user.username,team:user.team||''})).sort((a,b)=>a.id.localeCompare(b.id));
  const groups=teams.map(team=>({id:String(team._id),name:team.name})).sort((a,b)=>a.id.localeCompare(b.id));
  if(!list.some(user=>normalize(user.username)==='fifflaren'))throw new Error('OWNER_MISSING');
  const keepUsers=list.filter(protectedUser),removeUsers=list.filter(user=>!protectedUser(user));
  const keepTeams=groups.filter(team=>normalize(team.name)==='fifflaren'),removeTeams=groups.filter(team=>normalize(team.name)!=='fifflaren');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({list,groups})).digest('hex');
  return {fingerprint,keepUsers,removeUsers,keepTeams,removeTeams};
}
async function main(){
  const args=process.argv.slice(2),apply=args.includes('--apply'),planIndex=args.indexOf('--plan');
  if(planIndex<0||!args[planIndex+1])throw new Error('PLAN_PATH_REQUIRED');
  const planPath=path.resolve(args[planIndex+1]);
  const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const uri=process.env.MONGO_URI||source.match(/const MONGO_URI\s*=\s*process\.env\.MONGO_URI\s*\|\|\s*['"]([^'"]+)['"]/u)?.[1];
  if(!uri)throw new Error('DATABASE_CONFIG_MISSING');
  const connection=await mongoose.createConnection(uri,{serverSelectionTimeoutMS:12000}).asPromise();
  try{
    const db=connection.db;
    async function snapshot(session){
      const options={projection:{username:1,team:1},...(session?{session}:{})};
      const users=await db.collection('users').find({},options).toArray();
      const teams=await db.collection('teams').find({},{projection:{name:1},...(session?{session}:{})}).toArray();
      return planFor(users,teams);
    }
    if(!apply){
      const plan=await snapshot();fs.mkdirSync(path.dirname(planPath),{recursive:true});
      fs.writeFileSync(planPath,JSON.stringify({createdAt:new Date().toISOString(),...plan},null,2));
      console.log(JSON.stringify({mode:'preview',...plan},null,2));return;
    }
    const expected=JSON.parse(fs.readFileSync(planPath,'utf8'));
    if(!expected.fingerprint)throw new Error('PREVIEW_REQUIRED');
    const session=await connection.startSession();let result;
    try{
      await session.withTransaction(async()=>{
        const current=await snapshot(session);
        if(current.fingerprint!==expected.fingerprint)throw new Error('ROSTER_CHANGED_PREVIEW_AGAIN');
        const userIds=current.removeUsers.map(user=>new mongoose.Types.ObjectId(user.id));
        const teamIds=current.removeTeams.map(team=>new mongoose.Types.ObjectId(team.id));
        const users=await db.collection('users').deleteMany({_id:{$in:userIds},username:{$not:/^\s*fifflaren\s*$/i},team:{$not:/^\s*fifflaren\s*$/i}},{session});
        const teams=await db.collection('teams').deleteMany({_id:{$in:teamIds},name:{$not:/^\s*fifflaren\s*$/i}},{session});
        if(users.deletedCount!==userIds.length||teams.deletedCount!==teamIds.length)throw new Error('DELETE_COUNT_MISMATCH');
        const remaining=await snapshot(session);
        if(remaining.removeUsers.length||remaining.removeTeams.length||remaining.keepUsers.length!==current.keepUsers.length)throw new Error('VERIFY_FAILED');
        result={action:'keep-fifflaren-team',at:new Date(),actor:'fifflaren',fingerprint:current.fingerprint,
          deletedUsers:current.removeUsers,deletedTeams:current.removeTeams,preservedUsers:current.keepUsers,
          historyPreserved:true,usersDeleted:users.deletedCount,teamsDeleted:teams.deletedCount};
        await db.collection('maintenanceaudits').insertOne(result,{session});
      });
    }finally{await session.endSession();}
    fs.writeFileSync(planPath.replace(/\.json$/i,'')+'-result.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify({mode:'applied',usersDeleted:result.usersDeleted,teamsDeleted:result.teamsDeleted,preservedUsers:result.preservedUsers,historyPreserved:true},null,2));
  }finally{await connection.close();}
}
module.exports={normalize,protectedUser,planFor};
if(require.main===module)main().catch(error=>{
  // Database errors may contain connection credentials; never print arbitrary error messages.
  const known=/^(OWNER_MISSING|PLAN_PATH_REQUIRED|DATABASE_CONFIG_MISSING|PREVIEW_REQUIRED|ROSTER_CHANGED_PREVIEW_AGAIN|DELETE_COUNT_MISMATCH|VERIFY_FAILED)$/;
  console.error('Maintenance failed:',known.test(error.message)?error.message:error.name||'DatabaseError');process.exitCode=1;
});
