'use strict';
// The public CS room has one ruleset. Old clients cannot re-enable removed modes.
const TEAM_SIZE=5,MODE='classic',MAPS=Object.freeze(['dust2','inferno']);
function normalize(state){state.mode=TEAM_SIZE;state.gm=MODE;state.army=false;if(!MAPS.includes(state.map))state.map=MAPS[0];}
function count(state,team){return [...state.players.values()].filter(p=>p.team===team).length;}
function fill(state,add){normalize(state);for(const team of ['t','ct'])for(let missing=TEAM_SIZE-count(state,team);missing>0;missing--)add(team);}
function canStart(state){return [...state.players.values()].some(p=>!p.bot&&['t','ct'].includes(p.team));}
function replacementBot(state,team){return [...state.players.entries()].find(([,p])=>p.bot&&p.team===team)?.[0]||null;}
module.exports={TEAM_SIZE,MODE,MAPS,normalize,count,fill,canStart,replacementBot};
