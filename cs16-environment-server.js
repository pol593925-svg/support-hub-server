'use strict';
const B = require('./cs16-buildings'),
  E = require('./cs16-environment'),
  Combat = require('./cs16-combat');
function create({ state, grid, emit, now = Date.now }) {
  const session = Date.now().toString(36);
  const data = () => B.layout(grid(), state.map),
    snapshot = () => ({ map: state.map, session, ...E.snapshot(data()) });
  function reset() {
    E.reset(data());
    emit('cs16_environment', snapshot());
  }
  function door(player, id) {
    if (state.phase !== 'live' || now() < (player?.doorAt || 0) + 400) return false;
    const d = data().environment.doors.find((v) => v.id === id);
    if (!d || !player) return false;
    const o = [player.lx, player.ly + 1.3, player.lz],
      delta = [d.x - o[0], 1.3 - o[1], d.z - o[2]],
      dist = Math.hypot(...delta);
    if (!Number.isFinite(dist) || dist > 4) return false;
    const hit =
      dist > 0.01
        ? B.hit(
            grid(),
            state.map,
            o,
            delta.map((v) => v / dist),
            dist,
          )
        : null;
    if (hit && hit.id !== id && hit.t < dist - 0.25) return false;
    if (!E.toggle(data(), id, player, state.players.values())) return false;
    player.doorAt = now();
    emit('cs16_environment', snapshot());
    return true;
  }
  function shoot(player, shot) {
    const profile = Combat.weapons[shot?.weapon];
    if (
      !player?.alive ||
      !player.team ||
      state.phase !== 'live' ||
      !profile ||
      !Array.isArray(shot.origin) ||
      !Array.isArray(shot.dir) ||
      shot.origin.length !== 3 ||
      shot.dir.length !== 3 ||
      ![...shot.origin, ...shot.dir, player.lx, player.ly, player.lz].every(Number.isFinite)
    )
      return false;
    if (
      Math.abs(Math.hypot(...shot.dir) - 1) > 0.05 ||
      Math.hypot(shot.origin[0] - player.lx, shot.origin[2] - player.lz) > 2 ||
      Math.abs(shot.origin[1] - player.ly) > 2.4 ||
      now() < (player.glassShotAt || 0) + Math.max(55, (60000 / profile.rpm) * 0.7)
    )
      return false;
    player.glassShotAt = now();
    const hit = B.hit(
      grid(),
      state.map,
      shot.origin,
      shot.dir,
      Math.min(
        shot.weapon === 'knife' ? 2.8 : 200,
        Number.isFinite(shot.distance) ? Math.max(0, shot.distance) + 0.08 : 200,
      ),
    );
    if (
      hit?.kind !== 'glass' ||
      B.trace(grid(), state.map, shot.origin, shot.dir, hit.t) < hit.t - 0.08 ||
      !E.breakWindow(data(), hit.id)
    )
      return false;
    emit('cs16_environment', { ...snapshot(), shatter: shot.origin.map((v, i) => v + shot.dir[i] * hit.t) });
    return true;
  }
  function attach(socket) {
    let lastSnapshot = -Infinity;
    socket.on('cs16_environment_get', () => {
      if (!state.players.has(socket.id) || now() - lastSnapshot < 250) return;
      lastSnapshot = now();
      socket.emit('cs16_environment', snapshot());
    });
    socket.on('cs16_door', (id) => door(state.players.get(socket.id), id));
  }
  return { snapshot, reset, door, shoot, attach };
}
module.exports = { create };
