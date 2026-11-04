'use strict';
function teamOf(user){
  return String(user?.team||'').trim().toLowerCase()||
    (user?.username?.toLowerCase()==='fifflaren'?'fifflaren':'');
}
function requireTeam(user,res){
  const team=teamOf(user);
  if(!user)res.status(401).json({success:false,message:'Сессия недействительна. Войди в Support Hub заново.'});
  else if(!team)res.status(403).json({success:false,message:'Аккаунту не назначена команда. Попроси администратора назначить её в профиле.'});
  return team;
}
module.exports={teamOf,requireTeam};
