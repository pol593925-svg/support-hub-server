'use strict';
// voxel-structures.js — 5.6.0: генератор деревни «Сакура» с парящими островами.
// Возвращает список [x,y,z,id] абсолютных блоков. Сервис сам диффит и сохраняет.
// Блоки: 1 дёрн, 2 земля, 3 камень, 4 бревно, 5 листва(сакура), 6 доски, 7 кирпичи,
// 8 стекло, 9 песок, 12 вода, 14 верстак, 16 светокамень, 25 сундук,
// 37 синяя черепица, 38 белая штукатурка, 39 сакуровые доски.
function buildVillage(C, cx, cy, cz, seed) {
  const g = cy - 1; // верхний блок земли; ноги игрока на cy
  const edits = new Map(); // 'x,y,z' -> id (последняя запись побеждает)
  const set = (x, y, z, id) => {
    if (y < 1 || y >= C.HEIGHT) return;
    edits.set(x + ',' + y + ',' + z, id);
  };
  const box = (x0, y0, z0, x1, y1, z1, id) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) set(x, y, z, id);
  };

  // ---------- 1. Площадка 53×53: ровная земля, срез холмов и деревьев ----------
  for (let dz = -26; dz <= 26; dz++) for (let dx = -26; dx <= 26; dx++) {
    const x = cx + dx, z = cz + dz;
    const h = C.height(x, z, seed);
    for (let y = g + 1; y <= Math.max(g + 16, h + 7); y++) set(x, y, z, 0);
    set(x, g, z, 1);
    for (let y = Math.min(g - 1, h); y <= g - 1; y++) set(x, y, z, 2);
    if (h > g) for (let y = g + 1; y <= h; y++) set(x, y, z, 0); // срез холма
  }

  // ---------- 2. Дорожки (песок) и центральная площадь ----------
  for (let d = -24; d <= 24; d++) {
    for (const w of [0, 1]) { set(cx + d, g, cz + w - 1, 9); set(cx + w - 1, g, cz + d, 9); }
  }
  // Площадь — сакуровые доски кругом
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++)
    if (dx * dx + dz * dz <= 20) set(cx + dx, g, cz + dz, 39);

  // ---------- 3. Фонтан (смещён от центра, чтобы не накрыть игрока) ----------
  const fx = cx + 8, fz = cz + 8;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const edge = Math.max(Math.abs(dx), Math.abs(dz)) === 2;
    set(fx + dx, g, fz + dz, edge ? 3 : 12);
  }
  set(fx, g + 1, fz, 16); // светящийся центр

  // ---------- 4. Дома с синими крышами ----------
  function house(hx, hz, w, d, tall) {
    const x0 = hx - Math.floor(w / 2), x1 = x0 + w - 1;
    const z0 = hz - Math.floor(d / 2), z1 = z0 + d - 1;
    const wallH = tall ? 5 : 4;
    box(x0, g, z0, x1, g, z1, 6);                       // пол
    for (let y = g + 1; y <= g + wallH; y++) {
      for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) {
        const corner = x === x0 || x === x1;
        set(x, y, z, corner ? 4 : 38);                  // углы — бревно, стены — штукатурка
      }
      for (let z = z0 + 1; z < z1; z++) for (const x of [x0, x1]) set(x, y, z, 38);
    }
    // окна
    for (let x = x0 + 2; x <= x1 - 2; x += 3) { set(x, g + 2, z0, 8); set(x, g + 2, z1, 8); }
    for (let z = z0 + 2; z <= z1 - 2; z += 3) { set(x0, g + 2, z, 8); set(x1, g + 2, z, 8); }
    // дверной проём (1×2) на южной стене
    set(hx, g + 1, z1, 0); set(hx, g + 2, z1, 0);
    set(hx - 1, g + 1, z1, 39); set(hx + 1, g + 1, z1, 39);
    set(hx - 1, g + 2, z1, 39); set(hx + 1, g + 2, z1, 39);
    // крыша — синяя черепица, ступенчатая пирамида
    const layers = Math.ceil((w + 2) / 2);
    for (let l = 0; l < layers; l++) {
      const rx0 = x0 - 1 + l, rx1 = x1 + 1 - l, rz0 = z0 - 1 + l, rz1 = z1 + 1 - l;
      if (rx0 > rx1 || rz0 > rz1) break;
      for (let x = rx0; x <= rx1; x++) for (let z = rz0; z <= rz1; z++)
        if (x === rx0 || x === rx1 || z === rz0 || z === rz1 || l === layers - 1) set(x, g + wallH + 1 + l, z, 37);
    }
    // интерьер: верстак, сундук, светокамень под потолком
    set(x0 + 1, g + 1, z0 + 1, 14);
    set(x1 - 1, g + 1, z0 + 1, 25);
    set(hx, g + wallH, hz, 16);
  }
  house(cx - 15, cz - 15, 9, 9, false);
  house(cx + 15, cz - 15, 9, 9, false);
  house(cx - 15, cz + 15, 9, 9, false);
  house(cx + 15, cz + 15, 9, 9, false);
  house(cx, cz - 19, 13, 9, true); // ратуша высокая

  // ---------- 5. Фонари вдоль дорожек ----------
  for (const d of [-20, -10, 10, 20]) {
    for (const [lx, lz] of [[cx + d, cz + 2], [cx + d, cz - 3], [cx + 2, cz + d], [cx - 3, cz + d]]) {
      set(lx, g + 1, lz, 4); set(lx, g + 2, lz, 4); set(lx, g + 3, lz, 16);
    }
  }

  // ---------- 6. Сакура по углам площадки ----------
  function sakura(tx, tz) {
    const base = g + 1;
    for (let y = base; y <= base + 3; y++) set(tx, y, tz, 4);
    for (let dy = 0; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dz) + dy > 3) continue;
      if (dx === 0 && dz === 0 && dy === 0) continue;
      set(tx + dx, base + 3 + dy, tz + dz, 5);
    }
  }
  for (const [tx, tz] of [[-8, -8], [8, -8], [-8, 20], [20, 0], [-22, 4], [4, -22]]) sakura(cx + tx, cz + tz);

  // ---------- 7. Тории-ворота на северном входе ----------
  const tz = cz - 26;
  for (const px of [cx - 3, cx + 3]) for (let y = g + 1; y <= g + 5; y++) set(px, y, tz, 7);
  for (let x = cx - 4; x <= cx + 4; x++) { set(x, g + 6, tz, 37); set(x, g + 4, tz, 39); }

  // ---------- 8. Три парящих острова ----------
  function island(ix, iy, iz, r) {
    for (let dy = -r; dy <= 0; dy++) {
      const rr = r + dy; // сужение книзу
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist > rr + 0.4) continue;
        set(ix + dx, iy + dy, iz + dz, dy === 0 ? 1 : dy >= -2 ? 2 : 3);
      }
    }
    // сакура на острове
    for (let y = iy + 1; y <= iy + 4; y++) set(ix, y, iz, 4);
    for (let dy = 0; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dz) + dy > 3) continue;
      if (dx === 0 && dz === 0 && dy === 0) continue;
      set(ix + dx, iy + 4 + dy, iz + dz, 5);
    }
    set(ix + 2, iy + 1, iz + 2, 16); // светокамень-маяк
  }
  island(cx - 18, Math.min(C.HEIGHT - 12, g + 24), cz - 4, 5);
  island(cx + 17, Math.min(C.HEIGHT - 12, g + 28), cz + 10, 4);
  island(cx + 2, Math.min(C.HEIGHT - 12, g + 33), cz - 20, 4);

  return [...edits].map(([k, id]) => [...k.split(',').map(Number), id]);
}
module.exports = { buildVillage };
