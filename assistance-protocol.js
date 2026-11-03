'use strict';
// Shared allowlist: only input events, never executable command strings.
const KEYS={Backspace:8,Tab:9,Enter:13,Escape:27,Space:32,PageUp:33,PageDown:34,End:35,Home:36,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Insert:45,Delete:46,CapsLock:20,NumLock:144,ScrollLock:145,Pause:19,PrintScreen:44,ContextMenu:93,Minus:189,Equal:187,BracketLeft:219,BracketRight:221,Backslash:220,Semicolon:186,Quote:222,Backquote:192,Comma:188,Period:190,Slash:191,NumpadAdd:107,NumpadSubtract:109,NumpadMultiply:106,NumpadDivide:111,NumpadDecimal:110,NumpadEnter:13};
for(let i=0;i<26;i++)KEYS['Key'+String.fromCharCode(65+i)]=65+i;
for(let i=0;i<10;i++){KEYS['Digit'+i]=48+i;KEYS['Numpad'+i]=96+i;}
for(let i=1;i<=12;i++)KEYS['F'+i]=111+i;
function validate(d){
 if(!d||typeof d!=='object')throw Error('Неверная команда');
 const kind=d.kind,mods={ctrl:!!d.ctrl,alt:!!d.alt,shift:!!d.shift,meta:!!d.meta};
 if(kind==='release')return {kind};
 if(kind==='text'||kind==='paste'){
  if(typeof d.text!=='string'||!d.text.length||d.text.length>(kind==='paste'?20000:256)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(d.text))throw Error('Недопустимый текст или превышен лимит 20 000 символов');
  return {kind,text:d.text};
 }
 if(kind==='key'){
  if(!Object.hasOwn(KEYS,d.code)||(d.code==='F12'&&mods.ctrl&&mods.alt))throw Error('Недопустимая клавиша');
  return {kind,code:d.code,...mods};
 }
 if(kind==='url'){
  let u;try{u=new URL(d.url);}catch{}
  if(!u||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2048)throw Error('Нужна ссылка HTTP или HTTPS');
  return {kind,url:u.href};
 }
 if(!['move','down','up','click','right','wheel'].includes(kind)||![d.x,d.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Неверные координаты');
 const c={kind,x:d.x,y:d.y,...mods};
 if(kind==='down'||kind==='up'){if(![0,1,2].includes(d.button))throw Error('Неверная кнопка');c.button=d.button;}
 if(kind==='wheel'){if(!Number.isFinite(d.delta))throw Error('Неверная прокрутка');c.delta=Math.max(-6,Math.min(6,d.delta));}
 return c;
}
module.exports={KEYS,validate,version:2};
