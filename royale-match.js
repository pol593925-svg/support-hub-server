'use strict';
const currentGeometry = require('./royale-core'),
  combat = require('./cs16-combat');
const live = new Set(['plane', 'fall', 'chute', 'ground', 'down']),
  dueling = new Set(['queue', 'duel']);
const distance = (p, q) => Math.hypot(p.x - q.x, p.z - q.z, p.y - q.y);
function create(
  mode,
  { now = Date.now, random = Math.random, event = () => {}, geometry = currentGeometry } = {},
) {
  const C = geometry;
  const members = new Map();
  let phase = 'lobby',
    match = null,
    host = null,
    serial = 0,
    clock = now(),
    lastAI = 0;
  const humans = () => [...members.values()].filter((p) => !p.bot && p.connected);
  const player = (id, name, bot = false) => ({
    id,
    name: String(name).slice(0, 28),
    bot,
    connected: !bot,
    choice: null,
    team: 0,
    status: 'lobby',
    kills: 0,
    damage: 0,
    arena: null,
    input: {},
    lastInput: 0,
  });
  function broadcast(kind, data) {
    event(kind, data);
  }
  function lobby() {
    return {
      mode,
      phase,
      host,
      players: [...members.values()]
        .filter((p) => !p.bot)
        .map((p) => ({ id: p.id, name: p.name, choice: p.choice, connected: p.connected })),
      limit: C.LIMIT,
    };
  }
  function join(id, name) {
    let p = members.get(id);
    if (p?.bot) return { error: 'Место занято ботом' };
    if (!p) {
      if (phase === 'lobby' && humans().length >= C.LIMIT) return { error: 'Все 24 места заняты' };
      p = player(id, name);
      if (phase !== 'lobby') p.status = 'watch';
      members.set(id, p);
    }
    p.connected = true;
    p.detachedAt = 0;
    if (!host) host = id;
    broadcast('lobby', lobby());
    return { ok: true };
  }
  function leave(id, explicit = false) {
    const p = members.get(id);
    if (!p) return;
    p.connected = false;
    p.input = {};
    p.detachedAt = now();
    if (phase === 'lobby') {
      members.delete(id);
      for (const m of members.values()) if (m.choice === id) m.choice = null;
    } else if (explicit) forfeit(p);
    if (host === id) host = humans()[0]?.id || null;
    broadcast('lobby', lobby());
  }
  function pair(id, target) {
    const p = members.get(id),
      q = members.get(target);
    if (
      mode !== 'duo' ||
      phase !== 'lobby' ||
      !p ||
      (target !== null && (!q || q.bot || !q.connected || q === p))
    )
      return false;
    p.choice = target;
    broadcast('lobby', lobby());
    return true;
  }
  function kit(id, tier) {
    const w = C.profile(id, tier);
    return { id, tier, mag: w.cap, reserve: w.cap * 3 };
  }
  function resetLife(p) {
    Object.assign(p, {
      hp: 100,
      armor: 25,
      plates: 1,
      gear: [kit('usp', 0), null],
      slot: 0,
      reloadAt: 0,
      plateAt: 0,
      revive: null,
      climb: null,
      vy: 0,
      onGround: false,
      lastShot: 0,
      lastHurt: 0,
      input: {},
      jumpHeld: false,
    });
  }
  function start(id) {
    if (phase !== 'lobby' || id !== host || !humans().length) return false;
    const seed = Math.floor(random() * 2147483646) + 1,
      rand = C.rng(seed),
      path = C.route(seed);
    match = {
      seed,
      rand,
      path,
      started: now(),
      boxes: [],
      drops: new Map(),
      lootRev: 0,
      duels: new Map(),
      finished: 0,
      winner: 0,
      emptySince: 0,
    };
    phase = 'live';
    for (const p of [...members.values()]) if (!p.connected) members.delete(p.id);
    const all = humans().slice(0, C.LIMIT);
    for (const p of humans().slice(C.LIMIT)) {
      p.status = 'watch';
      p.team = 0;
    }
    let botSerial = 0;
    while (all.length < C.LIMIT) {
      const n = ++botSerial,
        id = '~ai:' + n;
      if (!members.has(id)) {
        const bot = player(id, 'Боец ' + String(n).padStart(2, '0'), true);
        members.set(id, bot);
        all.push(bot);
      }
    }
    let team = 0;
    all.forEach((p) => (p.team = 0));
    if (mode === 'duo')
      for (const p of all) {
        const q = members.get(p.choice);
        if (!p.team && q && all.includes(q) && q !== p && !q.team && !q.bot && q.choice === p.id)
          p.team = q.team = ++team;
      }
    const free = all.filter((p) => !p.team);
    for (let i = 0; i < free.length; ) {
      const a = free[i++];
      a.team = ++team;
      if (mode === 'duo' && i < free.length) free[i++].team = team;
    }
    for (const p of all) {
      resetLife(p);
      Object.assign(p, {
        status: 'plane',
        usedDuel: false,
        kills: 0,
        damage: 0,
        arena: null,
        dropAt: 4 + rand() * 34,
        x: path[0][0],
        y: 245,
        z: path[0][1],
        yaw: 0,
        pitch: 0,
        aiAt: 0,
        travelGoal: null,
      });
    }
    const sites = C.lootSites
      .map((v, i) => ({ v, i, roll: rand() }))
      .sort((a, b) => a.roll - b.roll)
      .slice(0, Math.min(360, C.lootSites.length));
    sites.forEach(({ v }, i) => {
      const k = rand(),
        tier = i < 5 ? i : k < 0.44 ? 0 : k < 0.72 ? 1 : k < 0.88 ? 2 : k < 0.97 ? 3 : 4;
      match.boxes.push({ id: i, x: v[0], y: v[1], z: v[2], tier, open: false });
    });
    clock = now();
    broadcast('start', { seed, path, mode });
    broadcast('loot', loot());
    broadcast('lobby', lobby());
    return true;
  }
  function loot() {
    return match
      ? { seed: match.seed, rev: match.lootRev, boxes: match.boxes, drops: [...match.drops.values()] }
      : null;
  }
  function changed(delta) {
    match.lootRev++;
    broadcast('lootChange', { rev: match.lootRev, ...delta });
  }
  function input(id, i) {
    const p = members.get(id);
    if (!p || phase !== 'live' || !i || !Number.isFinite(i.yaw) || !Number.isFinite(i.pitch)) return;
    p.yaw = Math.atan2(Math.sin(i.yaw), Math.cos(i.yaw));
    p.pitch = C.clamp(i.pitch, -1.4, 1.4);
    p.input = {
      f: C.clamp(Number(i.f) || 0, -1, 1),
      s: C.clamp(Number(i.s) || 0, -1, 1),
      sprint: !!i.sprint,
      aim: !!i.aim,
      fire: !!i.fire,
      use: !!i.use,
      jump: !!i.jump,
    };
    p.lastInput = now();
  }
  function deploy(p) {
    if (p.status === 'plane') {
      p.status = 'fall';
      p.vy = -7;
      return true;
    }
    if (p.status === 'fall') {
      p.status = 'chute';
      p.vy = -8;
      return true;
    }
    return false;
  }
  function nearby(p, list, max) {
    let best = null,
      dist = max;
    for (const v of list) {
      const n = distance(p, v);
      if (n < dist) {
        best = v;
        dist = n;
      }
    }
    return best;
  }
  function interact(p) {
    if (p.status !== 'ground') return false;
    const mate = nearby(
      p,
      [...members.values()].filter((q) => q.team === p.team && q.status === 'down'),
      3,
    );
    if (mate && canSee(p, mate)) {
      p.revive = { id: mate.id, at: now() + 4000 };
      p.input.use = true;
      return true;
    }
    const drop = nearby(p, [...match.drops.values()], 3.3);
    if (
      drop &&
      C.ray(
        [p.x, p.y + 1, p.z],
        unit([drop.x - p.x, drop.y + 0.3 - p.y - 1, drop.z - p.z]),
        distance(p, drop) + 1,
      ) >=
        distance(p, drop) - 0.8
    ) {
      const next = p.gear[1] === null ? 1 : p.slot,
        old = p.gear[next];
      match.drops.delete(drop.uid);
      const replacement = old ? placeDrop(old, p.x, p.y, p.z) : null;
      p.gear[next] = drop.gun;
      p.slot = next;
      p.reloadAt = 0;
      changed({ remove: drop.uid, drop: replacement });
      return true;
    }
    const box = nearby(
      p,
      match.boxes.filter((b) => !b.open),
      3.3,
    );
    if (box) {
      const d = [box.x - p.x, box.y + 0.6 - (p.y + 1.4), box.z - p.z],
        len = Math.hypot(...d);
      if (len > 0.05 && C.ray([p.x, p.y + 1.4, p.z], unit(d), len) < len - 0.12) return false;
      box.open = true;
      const ids = Object.keys(C.weapons).filter((k) => k !== 'usp'),
        gun = kit(ids[Math.floor(match.rand() * ids.length)], box.tier);
      const item = placeDrop(gun, box.x, box.y + 0.05, box.z);
      p.plates = Math.min(5, p.plates + 1);
      const held = p.gear[p.slot];
      held.reserve = Math.min(240, held.reserve + Math.ceil(C.profile(held.id, held.tier).cap * 0.75));
      changed({ opened: box.id, drop: item });
      return true;
    }
    const b = C.ladderNear(p);
    if (b) {
      const down = p.y > b.h - 1;
      p.climb = { id: b.id, down };
      p.x = b.ladder.x;
      p.z = b.z;
      p.vy = 0;
      p.y = down ? b.h : 0;
      return true;
    }
    return false;
  }
  function placeDrop(gun, x, y, z) {
    y = C.floor(x, z, y) + 0.04;
    const d = { uid: ++serial, x, y, z, gun: { ...gun } };
    match.drops.set(d.uid, d);
    return d;
  }
  function action(id, kind, arg) {
    const p = members.get(id);
    if (!p || phase !== 'live') return false;
    if (kind === 'jump') return deploy(p);
    if (!['ground', 'duel'].includes(p.status)) return false;
    if (kind === 'use') {
      if (p.climb) {
        p.climb = null;
        return true;
      }
      return interact(p);
    }
    if (kind === 'slot' && Number.isInteger(arg) && p.gear[arg] && arg !== p.slot) {
      p.slot = arg;
      p.reloadAt = 0;
      return true;
    }
    const w = p.gear[p.slot],
      spec = C.profile(w.id, w.tier);
    if (kind === 'reload' && !p.reloadAt && w.mag < spec.cap && w.reserve) {
      p.reloadAt = now() + spec.reload * 1000;
      return true;
    }
    if (kind === 'plate' && p.plates > 0 && p.armor < 100 && !p.plateAt && p.status === 'ground') {
      p.plateAt = now() + 2300;
      return true;
    }
    return false;
  }
  function unit(d) {
    const n = Math.hypot(...d) || 1;
    return d.map((v) => v / n);
  }
  function canSee(a, b) {
    const o = [a.x, a.y + 1.45, a.z],
      d = [b.x - a.x, b.y + (b.status === 'down' ? 0.5 : 1.2) - o[1], b.z - a.z],
      len = Math.hypot(...d);
    return C.ray(o, unit(d), len, a.status === 'duel') >= len - 0.12;
  }
  function shoot(p, t) {
    if (p.climb || p.plateAt || p.revive || p.reloadAt) return;
    const gun = p.gear[p.slot],
      spec = C.profile(gun.id, gun.tier);
    if (t - p.lastShot < 60000 / spec.rpm) return;
    if (!gun.mag) {
      action(p.id, 'reload');
      return;
    }
    p.lastShot = t - p.lastShot <= 60000 / spec.rpm + 55 ? p.lastShot + 60000 / spec.rpm : t;
    gun.mag--;
    const spread = spec.spread * (p.input.aim ? 0.4 : 1) * (p.input.sprint ? 1.45 : 1),
      rand = match.rand;
    const d = C.direction(p.yaw + (rand() - 0.5) * spread, p.pitch + (rand() - 0.5) * spread),
      o = [p.x, p.y + 1.55, p.z],
      duel = p.status === 'duel';
    let len = C.ray(o, d, duel ? 75 : 300, duel),
      target = null,
      zone = 'body';
    for (const q of members.values()) {
      if (q === p) continue;
      if (
        duel
          ? q.status !== 'duel' || q.arena !== p.arena
          : !['ground', 'down', 'chute', 'fall'].includes(q.status) || q.team === p.team
      )
        continue;
      const hit = combat.playerHit(o, d, { x: q.x, y: q.y, z: q.z, crouched: q.status === 'down' }, len);
      if (hit) {
        target = q;
        len = hit.t;
        zone = hit.zone;
      }
    }
    broadcast('shot', {
      by: p.id,
      arena: p.arena,
      weapon: gun.id,
      tier: gun.tier,
      o,
      d,
      len,
      hit: target?.id || null,
    });
    if (target)
      hurt(
        target,
        p,
        Math.round(
          spec.damage * (zone === 'head' ? 1.9 : zone === 'leg' ? 0.78 : 1) * Math.max(0.65, 1 - len / 850),
        ),
        t,
      );
  }
  function hurt(p, attacker, n, t) {
    if (!['ground', 'down', 'fall', 'chute', 'duel'].includes(p.status)) return;
    const armor = Math.min(p.armor, n);
    p.armor -= armor;
    p.hp -= n - armor;
    p.lastHurt = t;
    p.plateAt = 0;
    p.revive = null;
    if (attacker) attacker.damage += n;
    if (p.hp > 0) return;
    if (p.status === 'duel') {
      finishDuel(p.arena, p.id);
      return;
    }
    const canRevive =
      p.status !== 'down' &&
      mode === 'duo' &&
      [...members.values()].some(
        (q) => q !== p && q.team === p.team && ['ground', 'plane', 'fall', 'chute'].includes(q.status),
      );
    if (canRevive) {
      p.status = 'down';
      p.hp = 40;
      p.armor = 0;
      p.bleedAt = t + 22000;
      p.downer = attacker?.id;
      p.climb = null;
      p.revive = null;
      broadcast('notice', { text: p.name + ' ждёт помощи' });
    } else eliminate(p, attacker || members.get(p.downer));
  }
  function eliminate(p, killer) {
    if (!live.has(p.status)) return;
    if (killer && killer !== p) {
      killer.kills++;
      broadcast('notice', { text: killer.name + ' → ' + p.name });
    }
    for (const gun of p.gear || [])
      if (gun) {
        const d = placeDrop(gun, p.x, p.y, p.z);
        changed({ drop: d });
      }
    p.hp = 0;
    p.armor = 0;
    p.revive = null;
    p.climb = null;
    p.gear = [];
    p.downer = null;
    if (!p.usedDuel && (p.connected || p.bot)) {
      p.usedDuel = true;
      p.status = 'queue';
      p.queuedAt = now();
    } else p.status = 'out';
  }
  function forfeit(p) {
    if (p.status === 'duel') {
      finishDuel(p.arena, p.id);
      return;
    }
    p.status = 'out';
    p.hp = 0;
    p.climb = null;
    p.revive = null;
  }
  function beginDuel(a, b) {
    const id = 'duel-' + ++serial,
      t = now();
    match.duels.set(id, { id, ids: [a.id, b.id], until: t + 45000 });
    for (const [i, p] of [a, b].entries()) {
      resetLife(p);
      p.armor = 0;
      p.status = 'duel';
      p.arena = id;
      p.x = i ? 44 : 8;
      p.z = i ? 37 : 11;
      p.y = 0;
      p.yaw = i ? Math.PI * 0.22 : -Math.PI * 0.78;
      p.pitch = 0;
      p.lastInput = t;
    }
    broadcast('notice', { text: 'Дуэль за возвращение: ' + a.name + ' / ' + b.name });
  }
  function finishDuel(id, loser) {
    const d = match.duels.get(id);
    if (!d) return;
    match.duels.delete(id);
    for (const pid of d.ids) {
      const p = members.get(pid);
      if (!p) continue;
      p.arena = null;
      if (p.guard) {
        members.delete(pid);
        continue;
      }
      if (pid === loser || loser === null) {
        p.status = 'out';
        p.hp = 0;
        continue;
      }
      resetLife(p);
      const z = C.zoneAt(match.seed, (now() - match.started) / 1000);
      p.status = 'chute';
      p.x = C.clamp(z.x + (match.rand() - 0.5) * Math.min(80, z.r), 3, 1997);
      p.z = C.clamp(z.z + (match.rand() - 0.5) * Math.min(80, z.r), 3, 1997);
      p.y = 135;
      p.vy = -8;
      broadcast('notice', { text: p.name + ' возвращается с парашютом' });
    }
  }
  function duels(t) {
    const q = [...members.values()]
      .filter((p) => p.status === 'queue')
      .sort((a, b) => a.queuedAt - b.queuedAt);
    while (q.length) {
      const a = q.shift(),
        i = q.findIndex((b) => b.team !== a.team);
      let b = i >= 0 ? q.splice(i, 1)[0] : null;
      if (!b && t - a.queuedAt < 6500) break;
      if (!b) {
        let guardID;
        do {
          guardID = '~guard:' + ++serial;
        } while (members.has(guardID));
        b = player(guardID, 'Дежурный боец', true);
        b.guard = true;
        b.team = -serial;
        members.set(b.id, b);
      }
      beginDuel(a, b);
    }
    for (const d of match.duels.values())
      if (t > d.until) {
        const [a, b] = d.ids.map((id) => members.get(id));
        finishDuel(d.id, a.hp === b.hp ? null : a.hp < b.hp ? a.id : b.id);
      }
  }
  function move(p, dt, t) {
    const i = p.input || {},
      duel = p.status === 'duel',
      air = p.status === 'chute' || p.status === 'fall',
      down = p.status === 'down';
    if (p.climb) {
      const b = C.buildings[p.climb.id];
      p.y += dt * (p.climb.down ? -6 : 6);
      if (p.y >= b.h) {
        p.y = b.h;
        p.x = b.ladder.topX;
        p.climb = null;
      } else if (p.y <= 0) {
        p.y = 0;
        p.x = b.ladder.x + 0.55;
        p.climb = null;
      }
      return;
    }
    const speed = air ? (p.status === 'chute' ? 21 : 12) : down ? 1.1 : i.sprint ? 9 : 6,
      mag = Math.max(1, Math.hypot(i.f || 0, i.s || 0)),
      f = (i.f || 0) / mag,
      s = (i.s || 0) / mag;
    const dx = (-Math.sin(p.yaw) * f + Math.cos(p.yaw) * s) * speed * dt,
      dz = (-Math.cos(p.yaw) * f - Math.sin(p.yaw) * s) * speed * dt,
      clear = duel ? C.arenaClear : C.clear;
    if (clear(p.x + dx, p.y, p.z)) p.x += dx;
    if (clear(p.x, p.y, p.z + dz)) p.z += dz;
    const floor = duel ? 0 : C.floor(p.x, p.z, p.y);
    if (air) {
      if (p.status === 'fall' && p.y - floor < 37) deploy(p);
      p.vy = p.status === 'chute' ? -7.5 : Math.max(-46, p.vy - 18 * dt);
      p.y += p.vy * dt;
      if (p.y <= floor + 0.02) {
        p.y = floor;
        p.vy = 0;
        p.status = 'ground';
        p.onGround = true;
      }
      return;
    }
    if (i.jump && !p.jumpHeld && p.onGround && !down) {
      p.vy = 6.7;
      p.onGround = false;
    }
    p.jumpHeld = !!i.jump;
    p.vy -= 19 * dt;
    const nextY = p.y + p.vy * dt;
    p.onGround = nextY <= floor + 0.02;
    p.y = p.onGround ? floor : nextY;
    if (p.onGround) p.vy = 0;
    if (!duel && p.y < 0 && C.underground(p.x, p.z) && C.rampAt(p.x, p.z) === null && p.y > -0.4 - 1.7) {
      p.y = -2.1;
      p.vy = Math.min(0, p.vy);
    }
    if (p.revive) {
      const m = members.get(p.revive.id);
      if (
        !m ||
        m.status !== 'down' ||
        !i.use ||
        distance(p, m) > 3 ||
        !canSee(p, m) ||
        m.lastHurt > p.revive.at - 4000 ||
        p.lastHurt > p.revive.at - 4000
      )
        p.revive = null;
      else if (p.revive.at <= t) {
        m.status = 'ground';
        m.hp = 55;
        m.downer = null;
        p.revive = null;
        broadcast('notice', { text: p.name + ' поднял ' + m.name });
      }
    }
    if (p.reloadAt && t >= p.reloadAt) {
      const g = p.gear[p.slot],
        n = Math.min(C.profile(g.id, g.tier).cap - g.mag, g.reserve);
      g.mag += n;
      g.reserve -= n;
      p.reloadAt = 0;
    }
    if (p.plateAt && t >= p.plateAt) {
      p.plates--;
      p.armor = Math.min(100, p.armor + 50);
      p.plateAt = 0;
    }
    if (i.fire && !down && p.status !== 'out') shoot(p, t);
  }
  function bot(p, t, z) {
    if (p.status === 'chute' || p.status === 'fall') {
      p.input = { f: 1, s: 0 };
      return;
    }
    if (!['ground', 'duel'].includes(p.status)) return;
    p.input = { f: 0, s: 0, aim: true };
    const duel = p.status === 'duel';
    const targets = [...members.values()]
      .filter(
        (q) =>
          q !== p &&
          (duel
            ? q.arena === p.arena && q.status === 'duel'
            : q.team !== p.team && ['ground', 'down'].includes(q.status)),
      )
      .sort((a, b) => distance(p, a) - distance(p, b));
    let enemy = targets.find((q) => distance(p, q) < (duel ? 75 : 105) && canSee(p, q));
    let goal = duel ? { x: 26, z: 24 } : z;
    if (enemy) {
      const dist = distance(p, enemy);
      p.yaw = Math.atan2(p.x - enemy.x, p.z - enemy.z) + (match.rand() - 0.5) * 0.024;
      p.pitch =
        Math.atan2(enemy.y + 1.15 - (p.y + 1.55), Math.max(1, Math.hypot(p.x - enemy.x, p.z - enemy.z))) +
        (match.rand() - 0.5) * 0.014;
      p.input.fire = true;
      p.input.f = dist > 40 ? 0.75 : 0;
      p.input.s = match.rand() < 0.5 ? -0.65 : 0.65;
      return;
    }
    if (!duel && Math.hypot(p.x - z.x, p.z - z.z) < z.r * 0.88) {
      const mate = nearby(
        p,
        [...members.values()].filter((q) => q.team === p.team && q.status === 'down'),
        23,
      );
      if (mate) {
        goal = mate;
        if (distance(p, mate) < 2.8) {
          p.input.use = true;
          if (!p.revive) interact(p);
          return;
        }
      } else if (p.gear[p.slot].id === 'usp') {
        const drop = nearby(p, [...match.drops.values()], 40),
          box = nearby(
            p,
            match.boxes.filter((b) => !b.open && Math.abs(b.y - p.y) < 2),
            65,
          );
        goal = drop || box || z;
        if (goal !== z && distance(p, goal) < 3) {
          interact(p);
          return;
        }
      } else {
        if (
          !p.travelGoal ||
          Math.hypot(p.x - p.travelGoal.x, p.z - p.travelGoal.z) < 5 ||
          t > p.travelGoal.until
        ) {
          p.travelGoal = {
            x: C.clamp(z.x + (match.rand() - 0.5) * Math.min(z.r, 170), 4, 1996),
            z: C.clamp(z.z + (match.rand() - 0.5) * Math.min(z.r, 170), 4, 1996),
            until: t + 10000,
          };
        }
        goal = p.travelGoal;
      }
    }
    if (!duel) {
      const here = C.buildingAt(p.x, p.z),
        there = C.buildingAt(goal.x, goal.z);
      if (p.y < -0.45) {
        const gates = C.ramps.filter((g) => (g.dx ? Math.abs(p.z - g.z) < 7 : Math.abs(p.x - g.x) < 7));
        const gate = gates.sort(
          (a, b) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z),
        )[0];
        if (gate) goal = { x: gate.x + gate.dx * 34, z: gate.z + gate.dz * 34 };
      } else if (here && p.y >= here.h - 0.4) {
        goal = { x: here.ladder.topX, z: here.z };
        if (C.ladderNear(p)) {
          interact(p);
          return;
        }
      } else if (here && here !== there) {
        goal = {
          x: here.x,
          z: Math.abs(goal.z - here.front) < Math.abs(goal.z - here.back) ? here.front - 2 : here.back + 2,
        };
      } else if (there && here !== there) {
        const outside =
          Math.abs(p.z - there.front) < Math.abs(p.z - there.back) ? there.front - 1.1 : there.back + 1.1;
        if (Math.hypot(p.x - there.x, p.z - outside) > 2.4) goal = { x: there.x, z: outside };
      } else if (Math.hypot(p.x - goal.x, p.z - goal.z) > 110) {
        // Use the open avenues instead of repeatedly walking into the same facade.
        const streetX = Math.round(p.x / 100) * 100,
          streetZ = Math.round(p.z / 100) * 100;
        if (Math.abs(p.x - streetX) < 7 && Math.abs(p.z - goal.z) > 60)
          goal = { x: streetX, z: Math.round(goal.z / 100) * 100 };
        else if (Math.abs(p.z - streetZ) < 7 && Math.abs(p.x - goal.x) > 60)
          goal = { x: Math.round(goal.x / 100) * 100, z: streetZ };
        else
          goal =
            Math.abs(p.x - streetX) < Math.abs(p.z - streetZ)
              ? { x: streetX, z: p.z }
              : { x: p.x, z: streetZ };
      }
    }
    let yaw = Math.atan2(p.x - goal.x, p.z - goal.z);
    const clear = duel ? C.arenaClear : C.clear;
    for (const a of [0, 0.55, -0.55, 1.3, -1.3, 2, -2])
      if (clear(p.x - Math.sin(yaw + a) * 2.5, p.y, p.z - Math.cos(yaw + a) * 2.5)) {
        yaw += a;
        break;
      }
    p.yaw = yaw;
    p.pitch = 0;
    p.input.f = 1;
    p.input.sprint = !duel;
  }
  function finish(winner, t) {
    phase = 'over';
    match.winner = winner;
    match.finished = t;
    broadcast('end', {
      winner,
      results: [...members.values()]
        .filter((p) => !p.guard && p.team)
        .map((p) => ({ name: p.name, team: p.team, kills: p.kills, damage: p.damage })),
    });
    broadcast('lobby', lobby());
  }
  function reset() {
    match = null;
    phase = 'lobby';
    for (const [id, p] of members) {
      if (p.bot || !p.connected) members.delete(id);
      else Object.assign(p, { status: 'lobby', team: 0, arena: null });
    }
    host = humans()[0]?.id || null;
    broadcast('lobby', lobby());
  }
  function tick(t = now()) {
    const dt = C.clamp((t - clock) / 1000, 0.001, 0.12);
    clock = t;
    if (!match) return;
    if (phase === 'over') {
      if (t - match.finished > 22000) reset();
      return;
    }
    if (!humans().length) {
      if (!match.emptySince) match.emptySince = t;
      if (t - match.emptySince > 35000) {
        reset();
        return;
      }
    } else match.emptySince = 0;
    const age = (t - match.started) / 1000,
      z = C.zoneAt(match.seed, age),
      ai = t - lastAI >= 380;
    if (ai) lastAI = t;
    for (const p of members.values()) {
      if (!p.bot && !p.connected && p.detachedAt && t - p.detachedAt > 22000) {
        forfeit(p);
        p.detachedAt = 0;
      }
      if (!p.bot && t - p.lastInput > 600) p.input = {};
      if (p.status === 'plane') {
        const pos = C.planeAt(match.path, C.clamp(age / 44, 0, 1));
        [p.x, p.y, p.z] = pos;
        if (age >= 43 || (p.bot && age >= p.dropAt)) {
          deploy(p);
          p.yaw = match.rand() * 6.28;
        }
        continue;
      }
      if (!['ground', 'down', 'chute', 'fall', 'duel'].includes(p.status)) continue;
      if (p.bot && ai) bot(p, t, z);
      move(p, dt, t);
      if (p.status === 'down' && t > p.bleedAt) eliminate(p, members.get(p.downer));
      if (
        !p.arena &&
        live.has(p.status) &&
        (age > 700 || Math.hypot(p.x - z.x, p.z - z.z) > z.r) &&
        t >= (p.nextGas || 0)
      ) {
        p.nextGas = t + 1000;
        hurt(p, null, age > 700 ? 35 : z.damage, t);
      }
    }
    duels(t);
    const contenders = [...members.values()].filter(
        (p) => !p.guard && (live.has(p.status) || dueling.has(p.status)),
      ),
      teams = new Set(contenders.map((p) => p.team));
    if (teams.size === 0 || (teams.size === 1 && contenders.some((p) => live.has(p.status))))
      finish(teams.values().next().value || 0, t);
  }
  function snapshot(id) {
    if (!match) return null;
    const mine = members.get(id),
      t = now(),
      age = (t - match.started) / 1000;
    const actors = [...members.values()]
      .filter(
        (p) =>
          p.status !== 'watch' &&
          Number.isFinite(p.x + p.y + p.z) &&
          (mine?.arena ? p.arena === mine.arena : !p.arena),
      )
      .map((p) => ({
        id: p.id,
        n: p.name,
        team: p.team,
        s: p.status,
        x: +p.x.toFixed(2),
        y: +p.y.toFixed(2),
        z: +p.z.toFixed(2),
        yaw: +(p.yaw || 0).toFixed(3),
        hp: Math.ceil(p.hp || 0),
        armor: p.armor || 0,
        k: p.kills,
        gun: p.gear?.[p.slot]?.id,
        arena: p.arena,
      }));
    return {
      mode,
      phase,
      age,
      seed: match.seed,
      zone: C.zoneAt(match.seed, age),
      plane: C.planeAt(match.path, C.clamp(age / 44, 0, 1)),
      path: match.path,
      actors,
      lootRev: match.lootRev,
      alive: [...members.values()].filter((p) => !p.guard && live.has(p.status)).length,
      winner: match.winner,
      self: mine
        ? {
            id,
            team: mine.team,
            s: mine.status,
            hp: Math.ceil(mine.hp || 0),
            armor: mine.armor || 0,
            plates: mine.plates || 0,
            slot: mine.slot,
            gear: mine.gear || [],
            reload: Math.max(0, (mine.reloadAt || 0) - t),
            plate: Math.max(0, (mine.plateAt || 0) - t),
            revive: Math.max(0, (mine.revive?.at || 0) - t),
            bleed: Math.max(0, (mine.bleedAt || 0) - t),
            duel: mine.arena,
            duelLeft: mine.arena ? Math.max(0, (match.duels.get(mine.arena)?.until || t) - t) : 0,
            usedDuel: mine.usedDuel,
            climb: !!mine.climb,
            kills: mine.kills,
          }
        : null,
    };
  }
  return {
    members,
    join,
    leave,
    lobby,
    pair,
    start,
    input,
    action,
    tick,
    snapshot,
    loot,
    reset,
    get phase() {
      return phase;
    },
    get match() {
      return match;
    },
  };
}
module.exports = { create };
