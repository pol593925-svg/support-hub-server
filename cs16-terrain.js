(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CS16Terrain = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const cache = new WeakMap();
  function buildingSites(grid) {
    const sites = [];
    for (let z = 26; z < grid.length - 18; z += 15)
      for (let x = 9; x < grid[0].length - 15; x += 13) {
        if (sites.length >= 6) break;
        let open = true;
        for (let dz = -1; dz <= 4; dz++)
          for (let dx = -1; dx <= 4; dx++) if (grid[z + dz]?.[x + dx] !== 0) open = false;
        if (open) sites.push({ x: x * 4, z: z * 4, id: sites.length });
      }
    return sites;
  }
  function layout(grid) {
    if (cache.has(grid)) return cache.get(grid);
    const sites = buildingSites(grid),
      out = [],
      world = grid.length * 4,
      objectives = [
        [0.28, 0.24],
        [0.72, 0.24],
        [0.5, 0.5],
        [0.28, 0.76],
        [0.72, 0.76],
      ].map(([x, z]) => [world * x, world * z]);
    for (let z = 28; z < grid.length - 24 && out.length < 6; z += 4)
      for (let x = 12; x < grid[0].length - 12 && out.length < 6; x += 4) {
        const wx = x * 4,
          wz = z * 4;
        if (
          Math.abs(wx - world / 2) < 18 ||
          Math.abs(wz - world / 2) < 18 ||
          sites.some((b) => wx > b.x - 20 && wx < b.x + 32 && wz > b.z - 20 && wz < b.z + 32) ||
          objectives.some((p) => Math.hypot(wx - p[0], wz - p[1]) < 38) ||
          out.some((p) => Math.hypot(wx - p.x, wz - p.z) < 55)
        )
          continue;
        let clear = true;
        for (let dz = -4; dz <= 4; dz++)
          for (let dx = -4; dx <= 4; dx++) if (grid[z + dz]?.[x + dx] !== 0) clear = false;
        if (clear)
          out.push({
            id: out.length,
            x: wx,
            z: wz,
            r: 12,
            kind: out.length % 3 === 1 ? 'gully' : 'mound',
            amplitude: out.length % 3 === 1 ? -1.65 : 1.65,
          });
      }
    cache.set(grid, out);
    return out;
  }
  function patch(grid, x, z) {
    return layout(grid).find((p) => Math.abs(x - p.x) <= p.r && Math.abs(z - p.z) <= p.r);
  }
  function height(grid,x,z){return baseHeight(grid,x,z)-(grid.frontDamage?.original.size?Front.depth(grid,x,z):0);}
  const Front=typeof window!=='undefined'?window.CS16Front:require('./cs16-front');
  function baseHeight(grid, x, z) {
    const p = patch(grid, x, z);
    if (!p) return 0;
    const r = Math.hypot((x - p.x) / p.r, (z - p.z) / p.r);
    return r >= 1 ? 0 : p.amplitude * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * r), 1.15);
  }
  function normal(grid, x, z) {
    const a = (height(grid, x - 0.08, z) - height(grid, x + 0.08, z)) / 0.16,
      b = (height(grid, x, z - 0.08) - height(grid, x, z + 0.08)) / 0.16,
      n = Math.hypot(a, 1, b);
    return [a / n, 1 / n, b / n];
  }
  function ray(grid, o, d, maxT) {
    let nearest = null;
    if(grid.frontDamage?.original.size&&d[1]<-.001){
      for(let t=Math.max(0,(o[1]-5)/-d[1]);t<=maxT;t+=.35){
        const x=o[0]+d[0]*t,z=o[2]+d[2]*t;
        if(Front.ruined(grid,x,z)&&o[1]+d[1]*t<=height(grid,x,z)){nearest=t;break;}
        if(o[1]+d[1]*t< -12)break;
      }
    }
    for (const p of layout(grid)) {
      let lo = 0,
        hi = maxT;
      for (const axis of [0, 2]) {
        const c = axis === 0 ? p.x : p.z;
        if (Math.abs(d[axis]) < 1e-9) {
          if (Math.abs(o[axis] - c) > p.r) {
            hi = -1;
            break;
          }
        } else {
          let a = (c - p.r - o[axis]) / d[axis],
            b = (c + p.r - o[axis]) / d[axis];
          if (a > b) [a, b] = [b, a];
          lo = Math.max(lo, a);
          hi = Math.min(hi, b);
        }
      }
      hi = Math.min(hi, nearest ?? maxT);
      if (hi <= lo) continue;
      const gap = (t) => o[1] + d[1] * t - height(grid, o[0] + d[0] * t, o[2] + d[2] * t);
      let last = Math.max(0.03, lo),
        prev = gap(last);
      for (let t = last + 0.25; t <= hi + 0.25; t += 0.25) {
        const end = Math.min(t, hi),
          g = gap(end);
        if (prev > 0 && g <= 0) {
          let a = last,
            b = end;
          for (let i = 0; i < 9; i++) {
            const m = (a + b) / 2;
            if (gap(m) > 0) a = m;
            else b = m;
          }
          nearest = b;
          break;
        }
        last = end;
        prev = g;
        if (end === hi) break;
      }
    }
    return nearest;
  }
  function bridges(grid) {
    return layout(grid)
      .filter((p) => p.kind === 'gully')
      .flatMap((p) => [
        { min: [p.x - 1.45, -0.18, p.z - 12], max: [p.x + 1.45, 0, p.z + 12], kind: 'wood', building: 0 },
        ...[-1, 1].flatMap((s) =>
          Array.from({ length: 7 }, (_, i) => ({
            min: [p.x + s * 1.38 - 0.05, 0, p.z - 11.5 + i * 3.8],
            max: [p.x + s * 1.38 + 0.05, 0.78, p.z - 11.4 + i * 3.8],
            kind: 'wood',
            building: 0,
          })),
        ),
        ...[-1, 1].map((s) => ({
          min: [p.x + s * 1.38 - 0.05, 0.62, p.z - 11.5],
          max: [p.x + s * 1.38 + 0.05, 0.72, p.z + 11.5],
          kind: 'wood',
          building: 0,
        })),
      ]);
  }
  function walkHeight(grid, x, z) {
    const p = patch(grid, x, z);
    return !grid.frontDamage?.original.has(Math.floor(z/4)*grid[0].length+Math.floor(x/4))&&p?.kind === 'gully' && Math.abs(x - p.x) <= 1.45 ? 0 : height(grid, x, z);
  }
  return { layout, buildingSites, height, walkHeight, normal, patch, ray, bridges };
});
