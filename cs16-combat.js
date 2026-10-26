/* Shared, original Support Hub balance. Not a claim of exact CS weapon stats. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CS16Combat = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const values = {
    // damage, armor penetration, retained damage per 25m, RPM, standing spread
    knife: [40,1,1,80,0], glock:[28,.47,.85,352,.16], usp:[35,.50,.90,352,.10],
    deagle:[53,.93,.95,266,.08], ak47:[36,.78,.98,600,.07], m4a1:[33,.70,.98,666,.06],
    awp:[115,.97,.99,41,3.2], mp5:[26,.62,.84,750,.14], p90:[26,.69,.86,900,.18],
    ump45:[35,.65,.80,666,.13], galil:[30,.77,.98,675,.10], famas:[30,.70,.96,675,.09],
    scout:[88,.85,.98,48,2.8], sg552:[30,.95,.98,666,.08], aug:[28,.90,.98,666,.07],
    m249:[32,.80,.97,750,.18], fiveseven:[32,.91,.88,400,.12], tec9:[33,.90,.85,500,.15], elite:[38,.57,.85,750,.17]
  };
  const weapons = Object.freeze(Object.assign(Object.create(null),Object.fromEntries(Object.entries(values).map(([id,v]) => [id,Object.freeze({dmg:v[0],penetration:v[1],rangeModifier:v[2],rpm:v[3],spread:v[4]})]))));
  function damage(id, zone, distance, armor, heavy=false) {
    const w=weapons[id];
    armor=Number.isFinite(armor)?Math.max(0,armor):0;
    if (!w || !Number.isFinite(distance) || distance<0) return {damage:0,armorUsed:0};
    const multiplier=zone==='head'?4:zone==='leg'?.75:1;
    const raw=id==='knife'?(heavy?55:40):w.dmg*multiplier*Math.pow(w.rangeModifier,distance/25);
    const protectedHit=id!=='knife'&&zone!=='leg'&&armor>0;
    const absorbed=protectedHit?Math.min(armor*2,raw*(1-w.penetration)):0;
    return {damage:Math.max(1,Math.round(raw-absorbed)),armorUsed:Math.min(armor,Math.ceil(absorbed/2))};
  }
  function spread(w, {scoped=false,moving=false,airborne=false,crouched=false,bloom=0,shots=0}={}) {
    const base=scoped&&w.scope?(w.spreadScoped||.03):w.spread;
    return (base+(airborne?3.5:moving?1.4:0)+bloom*.22+shots*(w.auto?.13:.04))*(crouched?.7:1);
  }
  function direction(yaw,pitch,degrees=0,random=Math.random) {
    const c=Math.cos(pitch),s=Math.sin(pitch),sy=Math.sin(yaw),cy=Math.cos(yaw);
    const forward=[-sy*c,s,-cy*c], right=[cy,0,-sy], up=[sy*s,c,cy*s];
    const radius=Math.sqrt(random())*Math.tan(degrees*Math.PI/180),angle=random()*Math.PI*2;
    const x=radius*Math.cos(angle),y=radius*Math.sin(angle);
    const d=forward.map((v,i)=>v+right[i]*x+up[i]*y),length=Math.hypot(...d);
    return d.map(v=>v/length);
  }
  function sphere(o,d,c,r,maxT) {
    const q=o.map((v,i)=>v-c[i]), b=q.reduce((n,v,i)=>n+v*d[i],0), disc=b*b-q.reduce((n,v)=>n+v*v,0)+r*r;
    if(disc<0)return null;
    const near=-b-Math.sqrt(disc),far=-b+Math.sqrt(disc),t=near>=0?near:far;
    return t>=0&&t<maxT?t:null;
  }
  function playerHit(o,d,player,maxT) {
    const {x,y,z}=player, scale=player.crouched?.72:1;
    const head=sphere(o,d,[x,y+1.72*scale,z],.20,maxT);
    const dx=o[0]-x,dz=o[2]-z,a=d[0]*d[0]+d[2]*d[2],b=dx*d[0]+dz*d[2],c=dx*dx+dz*dz-.34*.34;
    let body=null;
    if(a>1e-9) {
      const disc=b*b-a*c;
      if(disc>=0)for(const t of [(-b-Math.sqrt(disc))/a,(-b+Math.sqrt(disc))/a]) {
        const h=o[1]+d[1]*t-y;
        if(t>=0&&t<maxT&&h>=0&&h<=1.5*scale&&(body===null||t<body))body=t;
      }
    }
    // End caps also register steep shots from bridges and towers.
    if(Math.abs(d[1])>1e-9)for(const h of [0,1.5*scale]) {
      const t=(y+h-o[1])/d[1],rx=dx+d[0]*t,rz=dz+d[2]*t;
      if(t>=0&&t<maxT&&rx*rx+rz*rz<=.34*.34&&(body===null||t<body))body=t;
    }
    if(head!==null&&(body===null||head<=body))return {t:head,head:true,zone:'head'};
    if(body!==null)return {t:body,head:false,zone:o[1]+d[1]*body<y+.8*scale?'leg':'body'};
    return null;
  }
  return Object.freeze({weapons,damage,spread,direction,playerHit,SMOKE_RADIUS:5.5,SMOKE_DURATION:22000});
});
