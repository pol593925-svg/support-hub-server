/* Geometry and ballistics shared by the Battle Royale server and renderer. */
(function (root, make) {
  const api = make();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RoyaleCore = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const SIZE = 2000,
    LIMIT = 24,
    clamp = (v, l, h) => Math.max(l, Math.min(h, v)),
    hash = (a, b) => (Math.imul(a + 37, 73856093) ^ Math.imul(b + 71, 19349663)) >>> 0;
  function rng(seed) {
    let n = seed >>> 0;
    return () => (n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296;
  }
  const tiers = ['Серое', 'Зелёное', 'Синее', 'Фиолетовое', 'Золотое'],
    colors = ['#a5aeb2', '#75c78b', '#67abff', '#bc89f0', '#f4c969'];
  const weapons = {
    usp: ['USP', 27, 12, 350, 1.55, 0.024, 0.28],
    mp5: ['MP5', 24, 30, 720, 1.9, 0.029, 0.57],
    mp7: ['MP7', 23, 30, 900, 1.72, 0.024, 0.52],
    vector: ['Vector', 20, 25, 1080, 1.78, 0.039, 0.49],
    bizon: ['ПП-19 Бизон', 22, 64, 650, 2.32, 0.032, 0.68],
    ak47: ['АК-47', 35, 30, 600, 2.32, 0.027, 0.91],
    m4a1: ['M4A1', 32, 30, 670, 2.12, 0.021, 0.85],
    awp: ['AWP', 98, 5, 48, 3.05, 0.028, 1.12],
  };
  const mods = ['Коллиматор', 'Увеличенный магазин', 'Рукоять', 'Глушитель'];
  function profile(id, tier = 0) {
    const w = weapons[id];
    if (!w) return null;
    tier = clamp(tier | 0, 0, 4);
    return {
      id,
      name: w[0],
      damage: w[1],
      cap: w[2] + (tier >= 2 ? Math.ceil(w[2] * 0.4) : 0),
      rpm: w[3],
      reload: w[4],
      spread: w[5] * (tier >= 3 ? 0.64 : 1),
      length: w[6],
      mods: mods.slice(0, tier),
      tier,
    };
  }
  const districts = [
    { x: 360, z: 380, name: 'Северные дворы' },
    { x: 1040, z: 560, name: 'Деловой квартал' },
    { x: 1640, z: 540, name: 'Литейный завод' },
    { x: 480, z: 1350, name: 'Вокзал' },
    { x: 1040, z: 1330, name: 'Старый город' },
    { x: 1640, z: 1540, name: 'Грузовой терминал' },
  ];
  const buildings = [],
    boxes = [],
    index = new Map(),
    lootSites = [],
    props = [];
  function addBox(x, y, z, w, h, d, mat, owner = -1) {
    const b = {
      x,
      y,
      z,
      w,
      h,
      d,
      mat,
      owner,
      min: [x - w / 2, y, z - d / 2],
      max: [x + w / 2, y + h, z + d / 2],
    };
    boxes.push(b);
    for (let zz = Math.floor(b.min[2] / 100); zz <= Math.floor(b.max[2] / 100); zz++)
      for (let xx = Math.floor(b.min[0] / 100); xx <= Math.floor(b.max[0] / 100); xx++) {
        const key = zz * 32 + xx;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(b);
      }
    return b;
  }
  function building(x, z, w, d, kind, h) {
    const id = buildings.length,
      b = { id, x, z, w, d, h, kind, left: x - w / 2, right: x + w / 2, front: z - d / 2, back: z + d / 2 };
    buildings.push(b);
    const add = (xx, yy, zz, ww, hh, dd, mat) => addBox(xx, yy, zz, ww, hh, dd, mat, id);
    // Two opposing street entrances and an open ground floor. All facades have an exterior roof ladder.
    const side = (w - 3.6) / 2;
    for (const zz of [b.front, b.back]) {
      add(b.left + side / 2, 0, zz, side, 3.8, 0.32, 'base');
      add(b.right - side / 2, 0, zz, side, 3.8, 0.32, 'base');
      add(x, 2.9, zz, 3.6, 0.9, 0.32, 'base');
    }
    for (const xx of [b.left, b.right]) add(xx, 0, z, 0.32, 3.8, d, 'base');
    b.hasStairs = kind === 0 || kind === 3;
    if (!b.hasStairs) add(x, 3.8, z, w, h - 3.8, d, 'facade' + kind);
    else {
      // An actual stairwell opens onto a second-storey landing inside the facade.
      for (const xx of [b.left, b.right]) add(xx, 3.8, z, 0.32, 2.86, d, 'facade' + kind);
      for (const zz of [b.front, b.back]) add(x, 3.8, zz, w, 2.86, 0.32, 'facade' + kind);
      add(x, 6.66, z, w, h - 6.66, d, 'facade' + kind);
      const sw = 3.15,
        sx = b.left + sw / 2 + 0.28;
      add(b.left + sw + (w - sw) * 0.5, 3.55, z, w - sw, 0.25, d, 'painted');
      for (const sign of [-1, 1]) add(sx, 3.55, z + sign * (d / 4 + 2), sw, 0.25, d / 2 - 4, 'painted');
      for (let i = 0; i < 20; i++) add(sx, 0, z - 4 + (i + 0.5) * 0.4, sw, (i + 1) * 0.19, 0.4, 'stair');
      b.stairX = sx;
    }
    // Parapets leave a clear landing beside the ladder.
    for (const zz of [b.front, b.back]) add(x, h, zz, w, 0.66, 0.28, 'coping');
    add(b.left, h, z, 0.28, 0.66, d, 'coping');
    for (const dir of [-1, 1]) add(b.right, h, z + dir * (d / 4 + 1.1), 0.28, 0.66, d / 2 - 2.2, 'coping');
    add(x + w * 0.23, h, z - d * 0.22, 2.8, 1.4, 2.1, 'vent');
    add(x - w * 0.21, 0, z + d * 0.18, 2.6, 1.05, 1.4, 'crate');
    // Furnish the two side bays, leaving a clear path between both entrances.
    const sideX = x + w * 0.25;
    if (kind === 2) {
      add(sideX, 0, z, 3.2, 1.35, 2.1, 'crate');
      add(sideX, 1.35, z, 0.95, 0.76, 0.9, 'crate');
    } else {
      add(sideX, 0, z, 1.5, 0.92, d * 0.29, kind === 1 ? 'vent' : 'crate');
      add(sideX, 0, z - d * 0.25, 0.48, 3.8, 0.48, 'coping');
    }
    add(x - w * 0.25, 0, z - 1, 0.35, 2.18, 4.6, 'coping');
    lootSites.push([x - w * 0.2, 0.02, z - d * 0.23], [x + w * 0.24, h + 0.02, z + d * 0.2]);
    b.ladder = { x: b.right + 0.82, z, topX: b.right - 1.15, top: h };
    return b;
  }
  function alpine(x, z) {
    return x >= 0 && z >= 0 && x < 600 && z < 300;
  }
  function riverZ(x) {
    return 143 + 34 * Math.sin(x * 0.0105) + 14 * Math.sin(x * 0.023 + 0.8);
  }
  // Move the northern housing blocks into vacant urban lots, keeping every street door and rooftop.
  const transfers = new Map(),
    empty = [];
  for (let zz = 4; zz < 20; zz++)
    for (let xx = 0; xx < 20; xx++) {
      const id = zz * 20 + xx;
      if (![109, 134, 244, 270, 275].includes(id) && rng(hash(xx, zz))() < 0.13) empty.push(id);
    }
  for (let zz = 0; zz < 3; zz++)
    for (let xx = 0; xx < 6; xx++)
      if (rng(hash(xx, zz))() >= 0.13) {
        const from = zz * 20 + xx,
          to = empty.pop();
        transfers.set(from, to);
        transfers.set(to, from);
      }
  for (let az = 0; az < 20; az++)
    for (let ax = 0; ax < 20; ax++) {
      const r = rng(hash(ax, az)),
        cell = transfers.get(az * 20 + ax) ?? az * 20 + ax,
        x = (cell % 20) * 100 + 50,
        z = Math.floor(cell / 20) * 100 + 50;
      if (r() < 0.13) {
        lootSites.push([x, 0, z]);
        continue;
      }
      const industrial = ax >= 14,
        office = ax >= 7 && ax <= 13 && az < 10,
        kind = industrial ? 2 : office ? 1 : r() < 0.5 ? 0 : 3;
      const height = () =>
        kind === 1
          ? 15 + Math.floor(r() * 12) * 3.5
          : kind === 2
            ? 8 + Math.floor(r() * 3) * 3
            : 8 + Math.floor(r() * 6) * 3.2;
      if (!industrial && r() < 0.32) {
        building(x - 21, z - 6, 23, 32 + r() * 12, kind, height());
        building(x + 20, z + 7, 24, 32 + r() * 14, kind, height());
      } else building(x + (r() - 0.5) * 6, z + (r() - 0.5) * 6, 35 + r() * 22, 32 + r() * 24, kind, height());
    }
  // Each landmark occupies an open block. Solid coordinates also drive the Blender kit.
  const landmarks = [
    {
      key: 'relay',
      name: 'Высота «Маяк»',
      x: 350,
      z: 350,
      solids: [
        [-5, 0, -5, 1.3, 5, 1.3],
        [5, 0, -5, 1.3, 5, 1.3],
        [-5, 0, 5, 1.3, 5, 1.3],
        [5, 0, 5, 1.3, 5, 1.3],
      ],
    },
    {
      key: 'garden',
      name: 'Зимний сад',
      x: 950,
      z: 550,
      solids: [
        [-12, 0, -6, 1, 8, 1],
        [12, 0, -6, 1, 8, 1],
        [-12, 0, 6, 1, 8, 1],
        [12, 0, 6, 1, 8, 1],
        [0, 0, -5, 10, 0.92, 2],
        [0, 0, 5, 10, 0.92, 2],
      ],
    },
    {
      key: 'foundry',
      name: 'Газгольдерная',
      x: 1450,
      z: 650,
      solids: [
        [-11, 0, 0, 7, 12, 7],
        [5, 0, 0, 7, 15, 7],
        [16, 0, -12, 2.2, 20, 2.2],
      ],
    },
    {
      key: 'station',
      name: 'Сортировочная',
      x: 450,
      z: 1250,
      solids: [
        [-14, 0, -4, 0.62, 6, 0.62],
        [-14, 0, 4, 0.62, 6, 0.62],
        [0, 0, -4, 0.62, 6, 0.62],
        [0, 0, 4, 0.62, 6, 0.62],
        [14, 0, -4, 0.62, 6, 0.62],
        [14, 0, 4, 0.62, 6, 0.62],
        [0, 6, 0, 37, 0.32, 11],
        [0, 0, 14, 16, 3.5, 3],
      ],
    },
    {
      key: 'market',
      name: 'Крытый рынок',
      x: 1050,
      z: 1350,
      solids: [
        [-9, 0, -5, 5, 1, 2],
        [0, 0, -5, 5, 1, 2],
        [9, 0, -5, 5, 1, 2],
        [-9, 0, 5, 5, 1, 2],
        [0, 0, 5, 5, 1, 2],
        [9, 0, 5, 5, 1, 2],
      ],
    },
    {
      key: 'port',
      name: 'Контейнерный двор',
      x: 1550,
      z: 1350,
      solids: [
        [-18, 0, -9, 1.3, 19, 1.3],
        [18, 0, -9, 1.3, 19, 1.3],
        [-18, 0, 9, 1.3, 19, 1.3],
        [18, 0, 9, 1.3, 19, 1.3],
        [-8, 0, -4, 12.2, 2.6, 2.45],
        [-8, 2.6, -4, 12.2, 2.6, 2.45],
        [9, 0, 4, 12.2, 2.6, 2.45],
        [8, 0, -12, 6.1, 2.6, 2.45],
      ],
    },
  ];
  const vacant = new Set();
  for (let z = 0; z < 20; z++) for (let x = 0; x < 20; x++) vacant.add(z * 20 + x);
  for (const h of buildings) vacant.delete(Math.floor(h.z / 100) * 20 + Math.floor(h.x / 100));
  const parkGrid = new Map(),
    landmarkBlocks = new Map(landmarks.map((l) => [Math.floor(l.z / 100) * 20 + Math.floor(l.x / 100), l]));
  // A 10 m triangulated height field. Roads, doorways and metro entrances remain on level ground.
  const cabins = [
    [160, riverZ(160) + 28],
    [430, riverZ(430) + 28],
  ];
  for (const id of vacant) {
    const l = landmarkBlocks.get(id),
      r = rng(hash(id, 117)),
      phase = r() * 6.28,
      peak = l ? (l.key === 'relay' ? 12 : 0) : 4 + r() * 9,
      grid = new Float32Array(121);
    for (let j = 0; j <= 10; j++)
      for (let i = 0; i <= 10; i++) {
        const dx = Math.abs(i - 5),
          dz = Math.abs(j - 5),
          edge = clamp((4.5 - Math.max(dx, dz)) / 2, 0, 1);
        const smooth = edge * edge * (3 - 2 * edge),
          shape = 0.79 + 0.21 * Math.sin(i * 0.65 + phase) * Math.cos(j * 0.62 - phase);
        const wx = (id % 20) * 100 + i * 10,
          wz = Math.floor(id / 20) * 100 + j * 10;
        const fade = clamp((600 - wx) / 90, 0, 1) * clamp((300 - wz) / 60, 0, 1),
          bank = Math.max(0, Math.abs(wz - riverZ(wx)) - 13);
        const valley =
          fade *
          (Math.min(52, bank * 0.37) * (0.83 + 0.16 * Math.sin(wx * 0.014 + wz * 0.005)) +
            Math.min(1, bank / 15) * (2.7 + 2.5 * Math.cos(wx * 0.053 + wz * 0.035)));
        const grade = cabins.reduce(
          (v, [cx, cz]) =>
            Math.min(v, clamp((Math.max(Math.abs(wx - cx), Math.abs(wz - cz)) - 23) / 16, 0, 1)),
          1,
        );
        grid[j * 11 + i] =
          id % 20 < 6 && Math.floor(id / 20) < 3 ? valley * grade : smooth * peak * (l ? 1 : shape);
      }
    parkGrid.set(id, grid);
  }
  function terrainHeight(x, z) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return 0;
    const grid = parkGrid.get(Math.floor(z / 100) * 20 + Math.floor(x / 100));
    if (!grid) return 0;
    const u = (x % 100) / 10,
      v = (z % 100) / 10,
      i = Math.floor(u),
      j = Math.floor(v),
      fx = u - i,
      fz = v - j,
      n = j * 11 + i;
    return fx + fz <= 1
      ? grid[n] + fx * (grid[n + 1] - grid[n]) + fz * (grid[n + 11] - grid[n])
      : grid[n + 12] + (1 - fx) * (grid[n + 11] - grid[n + 12]) + (1 - fz) * (grid[n + 1] - grid[n + 12]);
  }
  for (const [x, z] of cabins) {
    const h = building(x, z, 17, 14, 0, 8.6);
    h.cabin = true;
  }
  for (const spot of lootSites) if (spot[1] === 0) spot[1] = terrainHeight(spot[0], spot[2]);
  for (const l of landmarks) {
    const y = terrainHeight(l.x, l.z);
    for (const [x, base, z, w, h, d] of l.solids) addBox(l.x + x, y + base, l.z + z, w, h, d, 'landmark');
    for (const [x, z] of [
      [-20, 18],
      [20, -18],
      [0, 22],
    ])
      lootSites.push([l.x + x, terrainHeight(l.x + x, l.z + z) + 0.04, l.z + z]);
  }
  // Roadside vehicles and trees occupy the same positions used by hit and movement tests.
  for (let cz = 0; cz < 20; cz++)
    for (let cx = 0; cx < 20; cx++) {
      const rand = rng(hash(cx + 187, cz + 49)),
        side = rand() < 0.5 ? -1 : 1;
      const x = cx * 100 + (side < 0 ? 8.3 : 91.7),
        z = cz * 100 + 30 + rand() * 38;
      const kind = rand() < 0.26 ? 'van' : 'car',
        h = kind === 'van' ? 2.05 : 1.44;
      if (!alpine(x, z)) {
        props.push({
          kind,
          x,
          z,
          y: 0,
          angle: rand() < 0.5 ? Math.PI : 0,
          color: Math.floor(rand() * 5),
          block: cz * 20 + cx,
        });
        addBox(x, 0, z, 1.9, 0.77, 4.5, 'vehicleBody');
        addBox(x, 0.77, z, 1.68, h - 0.77, kind === 'van' ? 3.5 : 2.4, 'vehicleCab');
      }
      const treeX = cx * 100 + 50 + (rand() < 0.5 ? -37 : 37),
        treeZ = cz * 100 + 19 + rand() * 61;
      if (
        !alpine(treeX, treeZ) ||
        (Math.abs(treeZ - riverZ(treeX)) > 18 &&
          !cabins.some(([xx, zz]) => Math.abs(xx - treeX) < 13 && Math.abs(zz - treeZ) < 12))
      ) {
        props.push({
          kind: 'tree',
          x: treeX,
          z: treeZ,
          y: 0.1,
          angle: rand() * 6.28,
          color: 0,
          block: cz * 20 + cx,
        });
        props[props.length - 1].y = terrainHeight(treeX, treeZ);
        addBox(treeX, props[props.length - 1].y, treeZ, 0.38, 3.2, 0.38, 'trunk');
      }
      // Wooded slopes and verges leave the buildings, ladders, landmarks and transit routes clear.
      if (vacant.has(cz * 20 + cx)) {
        for (let n = 0; n < 14; n++) {
          const xx = cx * 100 + 13 + rand() * 74,
            zz = cz * 100 + 13 + rand() * 74,
            l = landmarkBlocks.get(cz * 20 + cx);
          if (
            alpine(xx, zz) &&
            (Math.abs(zz - riverZ(xx)) < 18 ||
              cabins.some(([x, z]) => Math.abs(x - xx) < 13 && Math.abs(z - zz) < 12))
          )
            continue;
          if (l && Math.abs(xx - l.x) < 26 && Math.abs(zz - l.z) < 26) continue;
          if (lootSites.some(([lx, ly, lz]) => Math.abs(xx - lx) < 1.8 && Math.abs(zz - lz) < 1.8)) continue;
          const yy = terrainHeight(xx, zz);
          props.push({
            kind: 'tree',
            x: xx,
            z: zz,
            y: yy,
            angle: rand() * 6.28,
            color: n % 3,
            block: cz * 20 + cx,
          });
          addBox(xx, yy, zz, 0.35, 3.3, 0.35, 'trunk');
        }
      }
      if (cx >= 14 && cz % 3 === 0) {
        const px = cx * 100 + 17,
          pz = cz * 100 + 18;
        props.push({ kind: 'stack', x: px, z: pz, y: 0.1, angle: 0, color: 0, block: cz * 20 + cx });
        addBox(px, 0.1, pz, 1.6, 18, 1.6, 'chimney');
      }
    }
  const rockRandom = rng(735191);
  for (let i = 0; i < 90; i++) {
    const x = 20 + rockRandom() * 554,
      z = 20 + rockRandom() * 255;
    if (
      Math.abs(z - riverZ(x)) < 12 ||
      cabins.some(([xx, zz]) => Math.abs(x - xx) < 14 && Math.abs(z - zz) < 13) ||
      lootSites.some(([xx, , zz]) => Math.hypot(xx - x, zz - z) < 5)
    )
      continue;
    const w = 1.8 + rockRandom() * 3.4,
      h = w * (0.37 + 0.18 * rockRandom()),
      d = w * 0.85,
      y = terrainHeight(x, z);
    props.push({ kind: 'rock', x, y, z, w, h, d, angle: rockRandom() * 6.28, block: 0 });
    addBox(x, y, z, w * 0.8, h * 0.86, d * 0.81, 'boulder');
  }
  const metro = [
    { x1: 400, x2: 1600, z1: 994, z2: 1006 },
    { x1: 794, x2: 806, z1: 600, z2: 1400 },
    { x1: 1394, x2: 1406, z1: 600, z2: 1400 },
  ];
  const ramps = [
    { x: 400, z: 1000, dx: -1, dz: 0 },
    { x: 1600, z: 1000, dx: 1, dz: 0 },
    { x: 800, z: 600, dx: 0, dz: -1 },
    { x: 800, z: 1400, dx: 0, dz: 1 },
    { x: 1400, z: 600, dx: 0, dz: -1 },
    { x: 1400, z: 1400, dx: 0, dz: 1 },
  ];
  for (const g of ramps) lootSites.push([g.x, -8, g.z]);
  function rampAt(x, z) {
    for (const g of ramps) {
      const along = (x - g.x) * g.dx + (z - g.z) * g.dz,
        side = (x - g.x) * g.dz - (z - g.z) * g.dx;
      if (along >= 0 && along <= 32 && Math.abs(side) < 5.6) return -8 + along * 0.25;
    }
    return null;
  }
  function underground(x, z) {
    return metro.some((r) => x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2);
  }
  function surface(x, z, prevY) {
    const ramp = rampAt(x, z);
    if (ramp !== null) return ramp;
    if (prevY < -0.25 && underground(x, z)) return -8;
    return terrainHeight(x, z);
  }
  function nearby(x, z) {
    return index.get(Math.floor(z / 100) * 32 + Math.floor(x / 100)) || [];
  }
  function floor(x, z, y) {
    let value = surface(x, z, y);
    for (const b of nearby(x, z))
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && b.max[1] <= y + 0.38)
        value = Math.max(value, b.max[1]);
    return value;
  }
  function clear(x, y, z, r = 0.42) {
    if (x < 1 || z < 1 || x > SIZE - 1 || z > SIZE - 1) return false;
    if (y < -0.5 && !underground(x, z) && rampAt(x, z) === null) return false;
    if (surface(x, z, y) > y + 0.42) return false;
    for (const b of nearby(x, z)) {
      const stepAllowance = b.mat === 'stair' ? 0.4 : 0.35;
      if (b.max[1] <= y + stepAllowance || b.min[1] >= y + 1.7) continue;
      const dx = x - clamp(x, b.min[0], b.max[0]),
        dz = z - clamp(z, b.min[2], b.max[2]);
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }
  const arenaBoxes = [
    { x: 20, z: 16, w: 3, d: 8, h: 2.4 },
    { x: 32, z: 32, w: 4, d: 8, h: 2.4 },
    { x: 26, z: 25, w: 6, d: 2, h: 1 },
  ].map((b) => ({
    ...b,
    y: 0,
    mat: 'base',
    min: [b.x - b.w / 2, 0, b.z - b.d / 2],
    max: [b.x + b.w / 2, b.h, b.z + b.d / 2],
  }));
  function arenaClear(x, y, z) {
    return (
      x > 1 &&
      x < 51 &&
      z > 1 &&
      z < 47 &&
      !arenaBoxes.some(
        (b) =>
          b.max[1] > y + 0.35 &&
          x > b.min[0] - 0.42 &&
          x < b.max[0] + 0.42 &&
          z > b.min[2] - 0.42 &&
          z < b.max[2] + 0.42,
      )
    );
  }
  function slab(o, d, b, limit) {
    let lo = 0,
      hi = limit;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-8) {
        if (o[i] < b.min[i] || o[i] > b.max[i]) return null;
      } else {
        let a = (b.min[i] - o[i]) / d[i],
          c = (b.max[i] - o[i]) / d[i];
        if (a > c) [a, c] = [c, a];
        lo = Math.max(lo, a);
        hi = Math.min(hi, c);
        if (lo > hi) return null;
      }
    }
    return lo;
  }
  function ray(o, d, max = 250, arena = false) {
    let best = max;
    if (arena) {
      for (const b of arenaBoxes) {
        const t = slab(o, d, b, best);
        if (t !== null) best = t;
      }
      return best;
    }
    // Traverse every crossed block, including a short diagonal crossing at an intersection.
    const seen = new Set();
    let cx = Math.floor(o[0] / 100),
      cz = Math.floor(o[2] / 100),
      t = 0;
    const sx = d[0] >= 0 ? 1 : -1,
      sz = d[2] >= 0 ? 1 : -1,
      ax = d[0] ? Math.abs(100 / d[0]) : Infinity,
      az = d[2] ? Math.abs(100 / d[2]) : Infinity;
    let tx = d[0] ? ((cx + (sx > 0 ? 1 : 0)) * 100 - o[0]) / d[0] : Infinity,
      tz = d[2] ? ((cz + (sz > 0 ? 1 : 0)) * 100 - o[2]) / d[2] : Infinity;
    for (let step = 0; step < 128 && t <= best; step++) {
      for (const b of index.get(cz * 32 + cx) || []) {
        if (seen.has(b)) continue;
        seen.add(b);
        const hit = slab(o, d, b, best);
        if (hit !== null) best = hit;
      }
      if (tx < tz) {
        t = tx;
        tx += ax;
        cx += sx;
      } else {
        t = tz;
        tz += az;
        cz += sz;
      }
    }
    if (d[1] !== 0) {
      const plane = d[1] < 0 && o[1] >= 0 ? 0 : d[1] > 0 && o[1] < -0.35 ? -0.35 : null;
      if (plane !== null) {
        const at = (plane - o[1]) / d[1];
        if (at >= 0 && at < best && rampAt(o[0] + d[0] * at, o[2] + d[2] * at) === null) best = at;
      }
    }

    // Surface and tunnel walls / ceiling block hits. Ramps are the only openings.
    for (let t = 0.3; t < best; t += 1) {
      const x = o[0] + d[0] * t,
        y = o[1] + d[1] * t,
        z = o[2] + d[2] * t,
        r = rampAt(x, z);
      if (r !== null) {
        if (y <= r) {
          best = t;
          break;
        }
      } else if (y >= 0 && y < terrainHeight(x, z)) {
        best = t;
        break;
      } else if (y < 0 && (!underground(x, z) || y < -8 || y > -0.35)) {
        best = t;
        break;
      }
    }
    return best;
  }
  function direction(yaw, pitch) {
    const c = Math.cos(pitch);
    return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
  }
  function ladderNear(p) {
    return buildings.find(
      (b) =>
        Math.abs(p.z - b.z) < 2.2 &&
        ((Math.abs(p.x - b.ladder.x) < 2.5 && p.y < 1.3) ||
          (Math.abs(p.x - b.ladder.topX) < 2.8 && Math.abs(p.y - b.h) < 1.2)),
    );
  }
  function route(seed) {
    const r = rng(seed),
      across = r() > 0.5,
      flip = r() > 0.5,
      start = 180 + r() * 750,
      end = SIZE - start;
    const a = across ? [35, start] : [start, 35],
      b = across ? [1965, end] : [end, 1965];
    return flip ? [b, a] : [a, b];
  }
  function planeAt(path, k) {
    return [path[0][0] + (path[1][0] - path[0][0]) * k, 245, path[0][1] + (path[1][1] - path[0][1]) * k];
  }
  function zoneAt(seed, seconds) {
    const r = rng(seed ^ 679),
      endX = 520 + r() * 960,
      endZ = 520 + r() * 960;
    const rings = [1440, 870, 540, 315, 170, 82, 34, 10, 1],
      age = Math.max(0, seconds - 52),
      stage = Math.min(rings.length - 2, Math.floor(age / 80)),
      k = clamp((age - stage * 80 - 28) / 52, 0, 1),
      radius = rings[stage] + (rings[stage + 1] - rings[stage]) * k;
    const f = 1 - radius / 1440;
    return {
      x: 1000 + (endX - 1000) * f,
      z: 1000 + (endZ - 1000) * f,
      r: radius,
      stage,
      nextIn: Math.max(0, 80 - (age - stage * 80)),
      damage: 2 + stage * 1.5,
    };
  }
  function buildingAt(x, z) {
    for (const b of nearby(x, z)) {
      const h = buildings[b.owner];
      if (h && x > h.left && x < h.right && z > h.front && z < h.back) return h;
    }
    return null;
  }
  return {
    landmarks,
    terrainHeight,
    vacant,
    alpine,
    riverZ,
    props,
    buildingAt,
    SIZE,
    LIMIT,
    clamp,
    rng,
    hash,
    tiers,
    colors,
    mods,
    weapons,
    profile,
    buildings,
    boxes,
    lootSites,
    districts,
    metro,
    ramps,
    rampAt,
    underground,
    surface,
    floor,
    clear,
    nearby,
    arenaBoxes,
    arenaClear,
    slab,
    ray,
    direction,
    ladderNear,
    route,
    planeAt,
    zoneAt,
  };
});
