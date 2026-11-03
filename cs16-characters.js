(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.CS16Characters=api;})(typeof window!=='undefined'?window:null,()=>{
 'use strict';
 const profiles=Object.freeze({
 ember:{name:'Эйрен',detail:'Алый дуэлянт',color:'#df795c',ability:'flame'},tide:{name:'Мирай',detail:'Страж прилива',color:'#83d8ee',ability:'frost'},jade:{name:'Кай',detail:'Нефритовый следопыт',color:'#8ed0a6',ability:'wind'},aurora:{name:'Люма',detail:'Хранительница рассвета',color:'#d9c0fa',ability:'light'},
 pyra:{name:'Пирра',detail:'Пламя заката',color:'#ff9051',ability:'flame'},neve:{name:'Неве',detail:'Ледяная чародейка',color:'#a6e9ff',ability:'frost'},zephyr:{name:'Зефир',detail:'Вестник ветра',color:'#82e6b3',ability:'wind'},basalt:{name:'Тарок',detail:'Каменный защитник',color:'#e7ba72',ability:'stone'},helio:{name:'Элио',detail:'Носитель солнца',color:'#fff0ad',ability:'light'},classic:{name:'Оператор',detail:'Страж авангарда',color:'#a6b6bb',ability:'stone'}});
 function valid(id){return typeof id==='string'&&Object.hasOwn(profiles,id);}
 function normalize(id){return valid(id)?id:'classic';}
 return {profiles,valid,normalize};
});
