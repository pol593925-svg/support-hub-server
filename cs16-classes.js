(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.CS16Classes=api;})(typeof window!=='undefined'?window:null,()=>{
 const profiles=Object.freeze({assault:{name:'Штурмовик',icon:'◆',weapon:'rifle',armor:100,detail:'AK-47 / M4A1 · броня 100'},recon:{name:'Разведчик',icon:'⌖',weapon:'awp',armor:50,detail:'AWP · броня 50'},support:{name:'Поддержка',icon:'▰',weapon:'m249',armor:100,detail:'M249 · броня 100'},antitank:{name:'Противотанковый',icon:'➶',weapon:'rpg',armor:75,detail:'РПГ-7 · 4 ракеты · броня 75'}});
 function valid(id){return typeof id==='string'&&Object.hasOwn(profiles,id);}
 function apply(p){const id=valid(p.nextClass)?p.nextClass:valid(p.classId)?p.classId:'assault',spec=profiles[id];p.classId=id;p.nextClass=id;p.weapon=spec.weapon==='rifle'?(p.team==='t'?'ak47':'m4a1'):spec.weapon;p.armor=spec.armor;p.rpgAmmo=id==='antitank'?4:0;p.rpgLast=0;return p;}
 return {profiles,valid,apply};});
