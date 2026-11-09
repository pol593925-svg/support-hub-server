'use strict';
// The public CS room has one ruleset. Old clients cannot re-enable removed modes.
const TEAM_SIZE=5,MODE='classic',MAPS=Object.freeze(['dust2','inferno']);
function normalize(state){state.mode=TEAM_SIZE;state.gm=MODE;state.army=false;if(!MAPS.includes(state.map))state.map=MAPS[0];}
const retired=new Set(['cs16_army','cs16_army_loader','cs16_army_ready','cs16_army_bomb','cs16_army_claim','cs16_front_charge','cs16_front_board','cs16_front_controls','cs16_seek','cs16_vehicle_rocket','cs16_rpg','cs16_crew','cs16_veh','cs16_vehboom','cs16_vehhit','cs16_vehcrate']);
function guard(socket){let lastNotice=-Infinity;socket.use(([event,item],next)=>{
 if(retired.has(event)||(event==='cs16_buy'&&typeof item==='string'&&/^(veh_|rpg$|mgveh$|tankgun$)/.test(item))){const now=Date.now();if(now-lastNotice>2000){lastNotice=now;socket.emit('cs16_err','Техника и РПГ удалены из боя 5×5');}return;}
 next();
});}
function count(state,team){return [...state.players.values()].filter(p=>p.team===team).length;}
function fill(state,add){normalize(state);if(state.botFill===false)return;for(const team of ['t','ct'])for(let missing=TEAM_SIZE-count(state,team);missing>0;missing--)add(team);}
function canStart(state){return [...state.players.values()].some(p=>!p.bot&&['t','ct'].includes(p.team))&&(state.botFill!==false||count(state,'t')>0&&count(state,'ct')>0);}
function replacementBot(state,team){return [...state.players.entries()].find(([,p])=>p.bot&&p.team===team)?.[0]||null;}
module.exports={TEAM_SIZE,MODE,MAPS,normalize,count,fill,canStart,replacementBot,guard};
