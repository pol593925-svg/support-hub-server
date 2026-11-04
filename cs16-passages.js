/* Shared Dust2 architecture. The Blender export and physics consume the same plan. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CS16Passages = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const cache = new WeakMap(),
    EMPTY = { cells: [], doors: [], boxes: [], routes: [] };
  const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ],
    SIZE = 126;
  const index = (x, z) => z * SIZE + x,
    coord = (i) => [i % SIZE, Math.floor(i / SIZE)];
  const edge = (a, b) => Math.min(a, b) * SIZE * SIZE + Math.max(a, b);
  function plan(grid) {
    if (cache.has(grid)) return cache.get(grid);
    if (grid.length !== SIZE || grid[18]?.[30] !== 4 || grid[66]?.[30] !== 4) return EMPTY;
    const cell = (x, z) => grid[z]?.[x],
      solid = (x, z) => cell(x, z) === 1 || cell(x, z) === 12;
    const neighbors = (i) => {
      const [x, z] = coord(i);
      return directions.filter(([dx, dz]) => solid(x + dx, z + dz)).map(([dx, dz]) => index(x + dx, z + dz));
    };
    const cells = new Set(),
      links = new Set(),
      doors = [],
      routes = [],
      faces = new Set(),
      blocked = [];
    const faceKey = (i, dx, dz) => i + '/' + dx + '/' + dz;
    function connect(a, b) {
      cells.add(a);
      cells.add(b);
      links.add(edge(a, b));
    }
    function addDoor(i, dx, dz, original = i) {
      const [cx, cz] = coord(i);
      faces.add(faceKey(i, dx, dz));
      cells.add(i);
      doors.push({
        id: 'street-' + original + '-' + dx + '-' + dz + '-' + i,
        kind: 'street',
        defaultClosed: true,
        x: cx * 4 + 2 + dx * 2,
        z: cz * 4 + 2 + dz * 2,
        y: 1.32,
        nx: dx,
        nz: dz,
        width: 2.18,
        height: 2.68,
        cell: i,
        original,
      });
    }
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++)
        if (solid(x, z)) {
          for (const [dx, dz] of directions) {
            const n = cell(x + dx, z + dz);
            if (n === undefined || solid(x + dx, z + dz) || (x * 7 + z * 11 + dx + dz) % 4 !== 2) continue;
            const i = index(x, z);
            if (n === 2 || n === 3 || n === 11) blocked.push({ i, dx, dz });
            else addDoor(i, dx, dz);
          }
        }
    function search(start, limit) {
      const queue = [start],
        parents = new Map([[start, -1]]),
        dist = new Map([[start, 0]]);
      for (let k = 0; k < queue.length; k++) {
        const i = queue[k],
          d = dist.get(i);
        if (d >= limit) continue;
        for (const j of neighbors(i))
          if (!parents.has(j)) {
            parents.set(j, i);
            dist.set(j, d + 1);
            queue.push(j);
          }
      }
      return {
        queue,
        dist,
        path(end) {
          const out = [end];
          while (out[0] !== start) out.unshift(parents.get(out[0]));
          return out;
        },
      };
    }
    // A few old panels faced directly into a solid crate/tower. Keep their room and
    // move the entrance to an unused, reachable face of the same brick mass.
    for (const original of blocked) {
      const walk = search(original.i, 40);
      let moved = false;
      for (const i of walk.queue) {
        const [x, z] = coord(i);
        for (const [dx, dz] of directions)
          if (cell(x + dx, z + dz) === 0 && !faces.has(faceKey(i, dx, dz))) {
            addDoor(i, dx, dz, original.i);
            const path = walk.path(i);
            for (let k = 1; k < path.length; k++) connect(path[k - 1], path[k]);
            moved = true;
            break;
          }
        if (moved) break;
      }
      if (!moved) throw Error('No accessible facade for ' + original.i);
    }
    for (const door of doors) {
      const [x, z] = coord(door.cell),
        dx = door.nx,
        dz = door.nz;
      // A two-bay room behind the facade, bounded even along the outside rim.
      const side = door.cell % 2 ? 1 : -1,
        sx = -dz * side,
        sz = dx * side;
      for (let depth = 0; depth < 2; depth++) {
        const xx = x - dx * depth,
          zz = z - dz * depth;
        if (!solid(xx, zz)) break;
        const a = index(xx, zz);
        if (depth) connect(door.cell, a);
        if (solid(xx + sx, zz + sz)) connect(a, index(xx + sx, zz + sz));
      }
    }
    const streets = doors.slice(),
      used = [],
      gates = new Map();
    // Links must join different facades, reserve a new interior edge for the
    // disguised panel, and be distributed around the arena.
    const candidates = [];
    for (const start of streets) {
      const walk = search(start.cell, 34);
      for (const end of streets) {
        const len = walk.dist.get(end.cell);
        if (start.cell >= end.cell || !len || len < 4 || start.nx * end.nx + start.nz * end.nz > 0) continue;
        const path = walk.path(end.cell),
          free = path.slice(1).map((j, k) => !links.has(edge(path[k], j)));
        if (!free.some(Boolean)) continue;
        candidates.push({ start, end, path, turn: start.nx * end.nx + start.nz * end.nz + 1 });
      }
    }
    // First reserve a longer crossing of the middle lanes, then serve the
    // perimeter and both halves of the map instead of repeating one west alley.
    const stops = [
      [0.65, 0.45, 30],
      [0.9, 0.5, 18],
      [0.13, 0.65, 11],
      [0.15, 0.18, 8],
      [0.45, 0.18, 9],
      [0.82, 0.12, 8],
      [0.88, 0.82, 12],
      [0.45, 0.86, 10],
      [0.24, 0.55, 9],
      [0.65, 0.78, 12],
      [0.07, 0.4, 10],
      [0.65, 0.25, 10],
      [0.3, 0.82, 12],
      [0.52, 0.56, 8],
    ];
    for (const [sx, sz, want] of stops) {
      const rank = (c) =>
        Math.hypot((c.start.x + c.end.x) / 2 - sx * 504, (c.start.z + c.end.z) / 2 - sz * 504) / 10 +
        Math.abs(c.path.length - 1 - want) +
        c.turn * 2;
      for (const candidate of candidates) candidate.score = rank(candidate);
      candidates.sort((a, b) => a.score - b.score || a.start.cell - b.start.cell || a.end.cell - b.end.cell);
      for (const candidate of candidates) {
        const { start, end, path } = candidate;
        if (
          used.some(
            (p) => Math.hypot(start.x - p.x, start.z - p.z) < 32 || Math.hypot(end.x - p.x, end.z - p.z) < 32,
          )
        )
          continue;
        // Keep each concealed link independent of prior routes.
        if (path.some((v, k) => k > 0 && gates.has(edge(v, path[k - 1])))) continue;
        const gaps = path
          .slice(1)
          .map((j, k) => ({ a: path[k], b: j, k }))
          .filter((g) => !links.has(edge(g.a, g.b)))
          .sort((a, b) => Math.abs(a.k - path.length / 2) - Math.abs(b.k - path.length / 2));
        if (!gaps.length) continue;
        const cut = gaps[0],
          [ax, az] = coord(cut.a),
          [bx, bz] = coord(cut.b);
        const gate = {
          id: 'secret-' + cut.a + '-' + cut.b,
          kind: 'secret',
          defaultClosed: true,
          width: 2.12,
          height: 2.62,
          x: (ax + bx) * 2 + 2,
          z: (az + bz) * 2 + 2,
          y: 1.3,
          nx: bx - ax,
          nz: bz - az,
          cell: cut.a,
        };
        for (let k = 1; k < path.length; k++) connect(path[k - 1], path[k]);
        gates.set(edge(cut.a, cut.b), gate);
        doors.push(gate);
        used.push(start, end);
        routes.push({ from: start.id, to: end.id, gate: gate.id, path });
        break;
      }
    }
    const portalByFace = new Map(streets.map((d) => [faceKey(d.cell, d.nx, d.nz), d]));
    const boxes = [];
    function box(x, y, z, w, h, d, kind, part) {
      boxes.push({
        min: [x - w / 2, y, z - d / 2],
        max: [x + w / 2, y + h, z + d / 2],
        kind,
        part,
        dust: true,
        building: 0,
      });
    }
    for (const i of cells) {
      const [x, z] = coord(i),
        wx = x * 4 + 2,
        wz = z * 4 + 2;
      box(wx, 0, wz, 4, 0.025, 4, 'floor', 'floor');
      box(wx, 3.58, wz, 4, 0.42, 4, 'roof', 'ceiling');
      for (const [dx, dz] of directions) {
        const xx = x + dx,
          zz = z + dz,
          inMap = xx >= 0 && zz >= 0 && xx < SIZE && zz < SIZE,
          j = inMap ? index(xx, zz) : -1;
        if (cells.has(j) && j < i) continue;
        const gate = portalByFace.get(faceKey(i, dx, dz)) || (cells.has(j) && gates.get(edge(i, j)));
        if (cells.has(j) && links.has(edge(i, j)) && !gate) continue;
        const inset = cells.has(j) ? 0 : 0.115; // keep the old street-facing plaster and windows unobstructed
        const cx = wx + dx * (2 - inset),
          cz = wz + dz * (2 - inset);
        function segment(offset, width, y, h) {
          box(
            cx - dz * offset,
            y,
            cz + dx * offset,
            dx ? 0.19 : width,
            h,
            dx ? width : 0.19,
            'wall',
            gate ? 'jamb' : 'wall',
          );
        }
        if (!gate) {
          segment(0, 4, 0, 3.6);
          continue;
        }
        const side = (4 - gate.width) / 2;
        segment(-(gate.width + side) / 2, side, 0, 3.6);
        segment((gate.width + side) / 2, side, 0, 3.6);
        segment(0, gate.width, gate.height, 3.6 - gate.height);
        const adjacent = cell(xx, zz),
          depth = { 5: 1.6, 6: 0.8, 7: 2.4 }[adjacent];
        if (gate.kind === 'street' && depth) {
          const steps = Math.ceil(depth / 0.17);
          for (let n = 0; n < steps; n++) {
            const along = ((n + 0.5) * 3.6) / steps,
              top = -(n / steps) * depth;
            box(
              cx + dx * along,
              -depth - 0.03,
              cz + dz * along,
              dx ? 3.6 / steps : gate.width,
              top + depth + 0.03,
              dx ? gate.width : 3.6 / steps,
              'step',
              'approach',
            );
          }
        }
      }
    }
    const result = { cells: [...cells].sort((a, b) => a - b), doors, boxes, routes };
    cache.set(grid, result);
    return result;
  }
  function install(grid) {
    const result = plan(grid);
    for (const i of result.cells) {
      const [x, z] = coord(i);
      grid[z][x] = 12;
    }
    return result;
  }
  function pose(d, side, angle) {
    const tx = -d.nz,
      tz = d.nx,
      w = d.width / 2;
    const dx = -side * tx * Math.cos(angle) - d.nx * Math.sin(angle),
      dz = -side * tz * Math.cos(angle) - d.nz * Math.sin(angle);
    return { dx, dz, w, x: d.x + side * tx * w + (dx * w) / 2, z: d.z + side * tz * w + (dz * w) / 2 };
  }
  function leaves(d) {
    if (!d.open) {
      const hx = (Math.abs(d.nz) * d.width + Math.abs(d.nx) * 0.12) / 2,
        hz = (Math.abs(d.nx) * d.width + Math.abs(d.nz) * 0.12) / 2;
      return [
        {
          min: [d.x - hx, 0, d.z - hz],
          max: [d.x + hx, d.height, d.z + hz],
          kind: d.kind === 'secret' ? 'stone' : 'wood',
          id: d.id,
          building: 0,
        },
      ];
    }
    return [-1, 1].map((side) => {
      const p = pose(d, side, d.open ? Math.PI / 2 : 0);
      const hx = (Math.abs(p.dx) * p.w + Math.abs(p.dz) * 0.12) / 2,
        hz = (Math.abs(p.dz) * p.w + Math.abs(p.dx) * 0.12) / 2;
      return {
        min: [p.x - hx, 0, p.z - hz],
        max: [p.x + hx, d.height, p.z + hz],
        kind: d.kind === 'secret' ? 'stone' : 'wood',
        id: d.id,
        building: 0,
      };
    });
  }
  return { plan, install, pose, leaves };
});
