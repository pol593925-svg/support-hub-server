(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CS16Environment = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function setup(data) {
    if (data.environment) return data;
    const doors = [],
      windows = [];
    for (const b of data.buildings) {
      doors.push({ id: 'door-' + b.id, building: b.id, x: b.x + 5.5, y: 1.3, z: b.z, open: true });
      for (const y of [0, 3.6])
        for (const z of [2.3, 7.6])
          windows.push({
            id: 'window-' + b.id + '-' + y + '-' + z,
            min: [b.x + 11.99, y + 1.05, b.z + z],
            max: [b.x + 12.04, y + 2.35, b.z + z + 1.8],
            kind: 'glass',
            building: b.id,
            broken: false,
          });
      for (const x of [1.5, 5, 8.5])
        windows.push({
          id: 'window-front-' + b.id + '-' + x,
          min: [b.x + x, x === 5 ? 3.6 : 4.5, b.z - 0.025],
          max: [b.x + x + 2, 6, b.z + 0.025],
          kind: 'glass',
          building: b.id,
          broken: false,
        });
    }
    data.environment = { doors, windows, revision: 0 };
    return data;
  }
  function boxes(data) {
    const e = setup(data).environment;
    return [
      ...e.doors
        .filter((d) => d.open)
        .flatMap((d) =>
          [-1, 1].map((side) => ({
            min: [d.x + side * 1.5 - 0.05, 0, d.z],
            max: [d.x + side * 1.5 + 0.05, 2.6, d.z + 1.5],
            kind: 'wood',
            id: d.id,
            building: d.building,
          })),
        ),
      ...e.doors
        .filter((d) => !d.open)
        .map((d) => ({
          min: [d.x - 1.5, 0, d.z - 0.12],
          max: [d.x + 1.5, 2.6, d.z + 0.12],
          kind: 'wood',
          id: d.id,
          building: d.building,
        })),
      ...e.windows.filter((w) => !w.broken),
    ];
  }
  function snapshot(data) {
    const e = setup(data).environment;
    return {
      revision: e.revision,
      closed: e.doors.filter((d) => !d.open).map((d) => d.id),
      broken: e.windows.filter((w) => w.broken).map((w) => w.id),
    };
  }
  function apply(data, state) {
    const e = setup(data).environment;
    if (
      !state ||
      !Number.isInteger(state.revision) ||
      (state.session === e.session && state.revision < e.revision) ||
      !Array.isArray(state.closed) ||
      !Array.isArray(state.broken)
    )
      return false;
    data.collisionRevision = null;
    e.session = state.session;
    e.revision = state.revision;
    for (const d of e.doors) d.open = !state.closed.includes(d.id);
    for (const w of e.windows) w.broken = state.broken.includes(w.id);
    return true;
  }
  function reset(data) {
    const e = setup(data).environment;
    for (const d of e.doors) d.open = true;
    for (const w of e.windows) w.broken = false;
    e.revision++;
  }
  function toggle(data, id, player, players) {
    const e = setup(data).environment,
      d = e.doors.find((d) => d.id === id);
    if (
      !d ||
      !player?.alive ||
      !player.team ||
      ![player.lx, player.ly, player.lz].every(Number.isFinite) ||
      Math.hypot(player.lx - d.x, player.ly, player.lz - d.z) > 3.8
    )
      return false;
    if (
      d.open &&
      [...players].some(
        (p) =>
          p.alive &&
          Math.abs((p.bot ? p.bx : p.lx) - d.x) < 1.9 &&
          Math.abs((p.bot ? p.bz : p.lz) - d.z) < 0.7 &&
          Math.abs(p.ly || 0) < 2.5,
      )
    )
      return false;
    d.open = !d.open;
    e.revision++;
    return true;
  }
  function breakWindow(data, id) {
    const e = setup(data).environment,
      w = e.windows.find((w) => w.id === id);
    if (!w || w.broken) return false;
    w.broken = true;
    e.revision++;
    return true;
  }
  function nearest(data, pos) {
    return (
      setup(data)
        .environment.doors.filter((d) => Math.hypot(pos.x - d.x, pos.y, pos.z - d.z) < 3.4)
        .sort((a, b) => Math.hypot(pos.x - a.x, pos.z - a.z) - Math.hypot(pos.x - b.x, pos.z - b.z))[0] ||
      null
    );
  }
  return { setup, boxes, snapshot, apply, reset, toggle, breakWindow, nearest };
});
