const path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict');
const dependency = (name) =>
  require(process.env.VOXEL_TEST_DEPS ? path.join(process.env.VOXEL_TEST_DEPS, name) : name);
const { Server } = dependency('socket.io'),
  { io: connect } = dependency('socket.io-client');
const Buildings = require('../cs16-buildings'),
  Field = require('../cs16-environment-server');
function next(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('environment event timeout')), 4000);
    socket.once('cs16_environment', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
(async () => {
  const grid = Array.from({ length: 100 }, () => Array(100).fill(0)),
    map = 'dust2',
    house = Buildings.layout(grid, map).buildings[0];
  const web = http.createServer(),
    io = new Server(web),
    state = { map, phase: 'live', players: new Map() },
    clients = [];
  const field = Field.create({ state, grid: () => grid, emit: (name, data) => io.emit(name, data) });
  io.on('connection', (socket) => {
    state.players.set(socket.id, { alive: true, team: 'ct', lx: house.x + 5.5, ly: 0, lz: house.z - 2 });
    field.attach(socket);
    socket.on('cs16_shoot', (shot) => field.shoot(state.players.get(socket.id), shot));
    socket.on('disconnect', () => state.players.delete(socket.id));
  });
  try {
    await new Promise((r) => web.listen(0, '127.0.0.1', r));
    const join = async () => {
      const s = connect('http://127.0.0.1:' + web.address().port, {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: false,
      });
      clients.push(s);
      await new Promise((r, j) => {
        s.once('connect', r);
        s.once('connect_error', j);
        s.connect();
      });
      return s;
    };
    const a = await join(),
      b = await join();
    let messages = Promise.all([next(a), next(b)]);
    a.emit('cs16_door', 'door-0');
    const closed = await messages;
    assert.deepEqual(closed[0], closed[1]);
    assert(closed[0].closed.includes('door-0'));
    const shooter = state.players.get(a.id);
    shooter.lx = house.x + 14;
    shooter.lz = house.z + 2.75;
    messages = Promise.all([next(a), next(b)]);
    a.emit('cs16_shoot', {
      weapon: 'ak47',
      origin: [shooter.lx, 1.55, shooter.lz],
      dir: [-1, 0, 0],
      distance: 2.02,
    });
    const hit = await messages;
    assert.deepEqual(hit[0], hit[1]);
    assert.equal(hit[0].broken.length, 1);
    const late = await join();
    const snapshot = next(late);
    late.emit('cs16_environment_get');
    const received = await snapshot;
    assert.deepEqual(received.closed, hit[0].closed);
    assert.deepEqual(received.broken, hit[0].broken);
    const resets = Promise.all([next(a), next(b), next(late)]);
    field.reset();
    for (const d of await resets) {
      assert.deepEqual(d.closed, []);
      assert.deepEqual(d.broken, []);
    }
    console.log(
      'PASS three real loopback Socket.IO clients: shared doors, shot/glass, late snapshot and round reset',
    );
  } finally {
    clients.forEach((s) => s.disconnect());
    await new Promise((r) => io.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
