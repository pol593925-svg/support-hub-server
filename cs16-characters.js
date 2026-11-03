(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.CS16Characters=api;})(typeof window!=='undefined'?window:null,()=>{
 'use strict';
 const profiles=Object.freeze({ember:{name:'Эйрен',detail:'Алый дуэлянт',color:'#df795c'},tide:{name:'Мирай',detail:'Страж прилива',color:'#83d8ee'},jade:{name:'Кай',detail:'Нефритовый следопыт',color:'#8ed0a6'},aurora:{name:'Люма',detail:'Хранительница рассвета',color:'#d9c0fa'},classic:{name:'Оператор',detail:'Тактическая форма команды',color:'#a6b6bb'}});
 function valid(id){return typeof id==='string'&&Object.hasOwn(profiles,id);}
 function normalize(id){return valid(id)?id:'classic';}
 return {profiles,valid,normalize};
});
