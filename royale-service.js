'use strict';
const Match = require('./royale-match');
module.exports = function install({ io, authenticate, protocol = 2 }) {
  const geometry = protocol === 1 ? require('./royale-core-v1') : require('./royale-core');
  const ns = io.of(protocol === 1 ? '/royale' : '/royale-v2'),
    rooms = new Map(),
    online = new Map();
  ns.use(async (socket, next) => {
    try {
      const user = await authenticate(socket.handshake.auth?.token);
      if (!user?.username || socket.handshake.auth?.protocol !== protocol)
        return next(Error('Войдите в Support Hub и обновите приложение'));
      socket.data.brName = user.username;
      next();
    } catch {
      next(Error('Не удалось проверить вход'));
    }
  });
  for (const mode of ['solo', 'duo'])
    rooms.set(mode, Match.create(mode, { geometry, event: (n, d) => ns.to(mode).emit(n, d) }));
  function exit(socket, explicit) {
    const room = rooms.get(socket.data.brMode);
    if (!room) return;
    room.leave(socket.data.brName, explicit);
    socket.leave(socket.data.brMode);
    socket.data.brMode = null;
  }
  ns.on('connection', (s) => {
    const id = s.data.brName,
      prior = online.get(id);
    if (prior && prior !== s) {
      prior.disconnect(true);
    }
    online.set(id, s);
    let lastInput = 0,
      lastAction = 0,
      lastSync = 0;
    s.on('join', (mode, reply) => {
      if (typeof reply !== 'function') return;
      const room = rooms.get(mode);
      if (!room) return reply({ error: 'Неизвестный режим' });
      if (s.data.brMode && s.data.brMode !== mode) exit(s, true);
      s.join(mode);
      const result = room.join(id, id);
      if (!result.ok) {
        s.leave(mode);
        return reply(result);
      }
      s.data.brMode = mode;
      reply({ ok: true, lobby: room.lobby(), loot: room.loot(), state: room.snapshot(id) });
    });
    s.on('pair', (target, reply) => {
      const ok = rooms.get(s.data.brMode)?.pair(id, target);
      if (typeof reply === 'function') reply({ ok: !!ok });
    });
    s.on('start', (_, reply) => {
      const ok = rooms.get(s.data.brMode)?.start(id);
      if (typeof reply === 'function') reply({ ok: !!ok });
    });
    s.on('input', (i) => {
      const t = Date.now();
      if (t - lastInput < 24) return;
      lastInput = t;
      rooms.get(s.data.brMode)?.input(id, i);
    });
    s.on('action', (data, reply) => {
      const t = Date.now();
      let ok = false;
      if (t - lastAction >= 90 && data && typeof data.kind === 'string') {
        lastAction = t;
        ok = !!rooms.get(s.data.brMode)?.action(id, data.kind, data.slot);
      }
      if (typeof reply === 'function') reply({ ok });
    });
    s.on('sync', () => {
      const r = rooms.get(s.data.brMode),
        t = Date.now();
      if (!r || t - lastSync < 450) return;
      lastSync = t;
      s.emit('loot', r.loot());
      s.emit('lobby', r.lobby());
    });
    s.on('leave', () => exit(s, true));
    s.on('disconnect', () => {
      if (online.get(id) === s) {
        online.delete(id);
        exit(s, false);
      }
    });
  });
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    for (const [mode, r] of rooms) {
      if (r.phase === 'lobby') continue;
      r.tick();
      if (r.phase !== 'lobby' && tick % 2 === 0)
        for (const socket of ns.sockets.values())
          if (socket.data.brMode === mode) socket.volatile.emit('state', r.snapshot(socket.data.brName));
    }
  }, 50);
  timer.unref?.();
  return {
    rooms,
    dispose() {
      clearInterval(timer);
    },
  };
};
