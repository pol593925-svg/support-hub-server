const test = require('node:test'),
  assert = require('node:assert/strict'),
  C = require('./royale-core'),
  Engine = require('./royale-match');
function fixture(mode = 'solo', names = ['A', 'B']) {
  let time = 100000;
  const events = [],
    r = Engine.create(mode, { now: () => time, random: () => 0.12345, event: (n, d) => events.push([n, d]) });
  names.forEach((n) => r.join(n, n));
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      time += 50;
      r.tick(time);
    }
  };
  return { r, tick, events, now: () => time };
}
function place(p, x, z, y = 0) {
  Object.assign(p, {
    x,
    y,
    z,
    status: 'ground',
    hp: 100,
    armor: 0,
    vy: 0,
    onGround: true,
    input: {},
    lastShot: 0,
  });
}
test('city buildings and valley cabins have traversable street doors and reachable roof ladders; six metro ramps take real shots', () => {
  assert(C.SIZE === 2000 && C.buildings.length > 400);
  for (const b of C.buildings) {
    for (const z of [b.front, b.back])
      for (let offset = -2; offset <= 2; offset += 0.15)
        assert(C.clear(b.x, 0, z + offset), b.id + ' blocked entrance');
    assert.equal(C.ladderNear({ x: b.ladder.x, z: b.z, y: 0 })?.id, b.id);
    for (let z = b.front - 2; z <= b.back + 2; z += 0.25) assert(C.clear(b.x, 0, z), 'blocked aisle ' + b.id);
    for (let y = 0; y <= b.h; y += 0.25) assert(C.clear(b.ladder.x, y, b.z), 'blocked shaft ' + b.id);
    for (let z = b.front - 1; z <= b.z; z += 0.25)
      assert(C.clear(b.ladder.x, 0, z), 'blocked approach ' + b.id);
    assert(C.clear(b.ladder.x, 0, b.z));
    assert.equal(C.ladderNear({ x: b.ladder.topX, z: b.z, y: b.h })?.id, b.id);
    assert(Math.abs(C.floor(b.ladder.topX, b.z, b.h) - b.h) < 1e-6);
    assert(C.clear(b.ladder.topX, b.h, b.z));
    assert(C.ray([b.left - 2, 1.5, b.z], [1, 0, 0], 6) < 3);
  }
  for (const g of C.ramps) {
    let y = 0;
    for (let t = 32; t >= 0; t -= 0.25) {
      const x = g.x + g.dx * t,
        z = g.z + g.dz * t;
      y = C.floor(x, z, y);
      assert(Math.abs(y - (-8 + t * 0.25)) < 0.002);
      assert(C.clear(x, y, z));
    }
    assert.equal(y, -8);
  }
  assert(C.ray([600, 2, 1000], [0, -1, 0], 20) <= 2);
  assert(C.ray([600, -6, 1000], [0, 1, 0], 20) < 6);
});
test('host, capacity, mutual duo, auto pairing and bot fill; jumping and automatic canopy land', () => {
  const f = fixture('duo', ['A', 'B', 'C']);
  const r = f.r;
  assert(r.pair('A', 'B') && r.pair('B', 'A'));
  assert(!r.start('B'));
  assert(r.start('A'));
  assert.equal(r.members.size, 24);
  assert.equal(r.members.get('A').team, r.members.get('B').team);
  const c = r.members.get('C');
  assert([...r.members.values()].some((p) => p !== c && p.team === c.team && p.bot));
  f.tick(20);
  const a = r.members.get('A');
  assert.equal(a.status, 'plane');
  assert(r.action('A', 'jump'));
  assert.equal(a.status, 'fall');
  assert(r.action('A', 'jump'));
  assert.equal(a.status, 'chute');
  f.tick(750);
  assert.equal(a.status, 'ground');
  assert(a.y >= 0);
  assert(!r.start('A'));
  assert.equal(r.join('late', 'late').ok, true);
  assert.equal(r.snapshot('late').self.s, 'watch');
  r.leave('late', true);
  assert.doesNotThrow(() => r.snapshot('A'));
});
test('five loot tiers change attachments without changing damage; opening is atomic and distance checked', () => {
  const f = fixture();
  const { r } = f;
  r.start('A');
  const a = r.members.get('A'),
    b = r.members.get('B'),
    box = r.match.boxes.find((v) => v.tier === 4 && v.y < 1);
  place(a, box.x + 1, box.z, box.y);
  place(b, box.x + 1.2, box.z, box.y);
  assert(r.action('A', 'use'));
  assert.equal(r.match.drops.size, 1);
  assert(box.open);
  assert(r.action('B', 'use'));
  assert.equal(r.match.drops.size, 0);
  assert.equal(b.gear[1].tier, 4);
  assert(!r.action('A', 'use'));
  for (const id of Object.keys(C.weapons)) {
    const plain = C.profile(id, 0),
      gold = C.profile(id, 4);
    assert.equal(plain.damage, gold.damage);
    assert(gold.cap > plain.cap && gold.spread < plain.spread && gold.mods.length === 4);
  }
  const p = r.members.get('A'),
    house = C.buildings[0];
  place(p, house.ladder.x, house.z);
  assert(r.action('A', 'use'));
  f.tick(Math.ceil(house.h / 6 / 0.05) + 3);
  assert(Math.abs(p.y - house.h) < 0.05);
  assert(r.action('A', 'use'));
  f.tick(Math.ceil(house.h / 6 / 0.05) + 5);
  assert(p.y < 0.1);
});
test('duo down, interrupted revive, successful revive, one actual duel and single return', () => {
  const f = fixture('duo', ['A', 'B', 'C', 'D']),
    r = f.r;
  r.pair('A', 'B');
  r.pair('B', 'A');
  r.start('A');
  const a = r.members.get('A'),
    b = r.members.get('B'),
    e = r.members.get('C');
  place(a, 900, 900);
  place(b, 901.3, 900);
  place(e, 900, 908);
  function hit(victim, attacker) {
    victim.hp = 1;
    victim.armor = 0;
    attacker.lastShot = 0;
    attacker.gear[attacker.slot].mag = 10;
    const yaw = Math.atan2(attacker.x - victim.x, attacker.z - victim.z);
    r.input(attacker.id, {
      yaw,
      pitch: Math.atan2(-0.45, Math.hypot(attacker.x - victim.x, attacker.z - victim.z)),
      f: 0,
      s: 0,
      aim: true,
      fire: true,
    });
    f.tick();
    r.input(attacker.id, { yaw, pitch: 0 });
  }
  hit(a, e);
  assert.equal(a.status, 'down');
  r.input('B', { yaw: 0, pitch: 0, use: true });
  assert(r.action('B', 'use'));
  r.input('B', { yaw: 0, pitch: 0, use: false });
  f.tick();
  assert.equal(b.revive, null);
  r.input('B', { yaw: 0, pitch: 0, use: true });
  assert(r.action('B', 'use'));
  for (let i = 0; i < 83; i++) {
    r.input('B', { yaw: 0, pitch: 0, use: true });
    f.tick();
  }
  assert.equal(a.status, 'ground');
  assert(a.hp >= 50);
  hit(a, e);
  assert.equal(a.status, 'down');
  a.hp = 1;
  r.input('C', { yaw: 0, pitch: -0.12, aim: true, fire: true });
  e.lastShot = 0;
  f.tick();
  r.input('C', { yaw: 0, pitch: 0 });
  assert.equal(a.status, 'queue');
  assert(a.usedDuel);
  f.tick(135);
  assert.equal(a.status, 'duel');
  const d = r.match.duels.get(a.arena),
    guard = r.members.get(d.ids.find((id) => id !== a.id));
  a.x = 8;
  a.z = 11;
  guard.x = 8;
  guard.z = 16;
  guard.hp = 1;
  guard.armor = 0;
  guard.input = {};
  r.input('A', { yaw: Math.PI, pitch: -0.08, aim: true, fire: true });
  f.tick();
  assert.equal(a.status, 'chute');
  assert(a.usedDuel);
  place(a, 900, 900);
  b.status = 'out';
  hit(a, e);
  assert.equal(a.status, 'out', 'second death cannot enter another duel');
});
test('shrinking circle, last team standing and round reset', () => {
  assert(C.zoneAt(15, 400).r < C.zoneAt(15, 100).r);
  const f = fixture(),
    r = f.r;
  r.start('A');
  for (const p of r.members.values()) if (p.id !== 'A') p.status = 'out';
  f.tick();
  assert.equal(r.phase, 'over');
  assert.equal(r.match.winner, r.members.get('A').team);
  f.tick(445);
  assert.equal(r.phase, 'lobby');
  assert.equal(r.members.size, 2);
});

test('winter valley is traversable, hills stop bullets, every stairwell joins the upper landing', () => {
  assert.equal(C.buildings.length, 415);
  assert.equal(C.landmarks.length, 6);
  for (const h of C.buildings.filter((h) => h.hasStairs)) {
    let y = 0;
    for (let z = h.z - 4.3; z <= h.z + 4.5; z += 0.09) {
      const floor = C.floor(h.stairX, z, y);
      assert(floor - y < 0.22);
      assert(C.clear(h.stairX, floor, z), 'stair ' + h.id);
      y = floor;
    }
    assert(Math.abs(y - 3.8) < 0.01);
  }
  const x = 250,
    z = C.riverZ(x);
  assert(C.terrainHeight(x, z) < 1.3);
  assert(C.terrainHeight(x, z + 70) > 14);
  assert(C.ray([x, 2, z], [0, 0, 1], 90) < 70);
  for (const l of C.landmarks) assert(C.vacant.has(Math.floor(l.z / 100) * 20 + Math.floor(l.x / 100)));
});
