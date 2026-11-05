(() => {
'use strict';

/* ================= 参数 ================= */
const CELL = 2;                // 格子边长（世界单位），与 3D迷宫2 的道路粗细一致
const MOVE_SPEED = 2;          // 格/秒
const TURN_SPEED = 1.8;        // 弧度/秒，约103°/秒
const FOV = 66;
const PLAYER_R = 0.25 * CELL;  // 玩家碰撞半径
const EYE = 0.55 * CELL;       // 眼睛高度
const MAP_SHOW_MS = 5000;      // 地图展示时长
const MAP_CD_MS = 20000;       // 地图冷却时长
const WIN_DELAY_MS = 1500;     // 过关横幅停留后自动下一关

/* ================= 关卡地图 ================= */
/* # 墙   . 路   S 出生点   K 钥匙   D 门 */
const LEVELS = [
  { map: [
    '#########',
    '#S#D....#',
    '#.#####.#',
    '#.#...#.#',
    '#.#.#K#.#',
    '#.#.#.#.#',
    '#.#.#.#.#',
    '#...#...#',
    '#########',
  ]},
  { map: [
    '###########',
    '#S#D......#',
    '#.#######.#',
    '#.......#.#',
    '#######.#.#',
    '#.....#.#.#',
    '#.###.#.#.#',
    '#...#...#.#',
    '###.#####.#',
    '#......K..#',
    '###########',
  ]},
  { map: [
    '#############',
    '#S#.#.......#',
    '#.#.#.###.#.#',
    '#.#...#...#.#',
    '#.#.###.###.#',
    '#.#.#...#.#.#',
    '#.###.###.#.#',
    '#...#.#...#.#',
    '###.#.#.###.#',
    '#D#.#.#...#.#',
    '#.#.#.#.#.#K#',
    '#.....#.#...#',
    '#############',
  ]},
  { map: [
    '#################',
    '#S#D....#.......#',
    '#.###.#.###.#.#.#',
    '#.....#...#.#.#.#',
    '#########.#.#.#.#',
    '#.......#.#.#.#.#',
    '#.#######.###.#.#',
    '#...#K..#.....#.#',
    '#.#.#.#.#######.#',
    '#.#...#...#.....#',
    '#####.###.#.#####',
    '#...#.#...#.....#',
    '#.#.###.#.#####.#',
    '#.#.....#...#...#',
    '#.###########.###',
    '#...............#',
    '#################',
  ]},
  { map: [
    '#####################',
    '#S..#...............#',
    '###.#.#############.#',
    '#D#.#.....#.........#',
    '#.#.#.###.###.#######',
    '#.#.#...#...#.......#',
    '#.#.#####.#.#######.#',
    '#.#.....#.#...#.....#',
    '#.#####.###.#.#.#####',
    '#.....#...#.#.#....K#',
    '#.###.###.###.#######',
    '#.#.....#...#.#.....#',
    '###.#######.#.#.###.#',
    '#...#.......#.....#.#',
    '#.###.#############.#',
    '#.....#...#.........#',
    '#.#####.#.#.#######.#',
    '#.......#...#...#...#',
    '#############.#.#.###',
    '#.............#.....#',
    '#####################',
  ]},
];

/* ================= DOM ================= */
const canvas = document.getElementById('game');
const levelBtn = document.getElementById('levelBtn');
const levelPanel = document.getElementById('levelPanel');
const mapBtn = document.getElementById('mapBtn');
const helpBtn = document.getElementById('helpBtn');
const helpPanel = document.getElementById('helpPanel');
const keyStatus = document.getElementById('keyStatus');
const mapOverlay = document.getElementById('mapOverlay');
const mapCanvas = document.getElementById('mapCanvas');
const banner = document.getElementById('banner');
const toast = document.getElementById('toast');
const joyBase = document.getElementById('joyBase');
const joyKnob = document.getElementById('joyKnob');
const loading = document.getElementById('loading');
const mctx = mapCanvas.getContext('2d');

/* ================= 状态 ================= */
let levelIndex = 0;
let grid = [], MW = 0, MH = 0;
let startCell = { x: 1, y: 1 }, keyCell = { x: 1, y: 1 }, doorCell = { x: 1, y: 1 };
let hasKey = false, locked = false;
let px = 0, py = 0, angle = 0;
let mapOpen = false, mapCooldownUntil = 0, mapCloseTimer = 0;
let hintCooldownUntil = 0, toastTimer = 0;
let loadingHidden = false;
const loadStart = performance.now();
const LOADING_MIN_MS = 700; // 加载动画最短展示时长，避免一闪而过
const keysDown = Object.create(null);

/* ================= Three 基础 ================= */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 80);
camera.rotation.order = 'YXZ';
let scene = null;
let keyGroup = null, doorMesh = null;
let doorGreenMat = null;
const particles = [];

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ================= 关卡构建 ================= */
function disposeScene(s) {
  s.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}

function isOpenCell(x, y) {
  if (x < 0 || y < 0 || x >= MW || y >= MH) return false;
  const c = grid[y][x];
  return c !== '#' && c !== 'D';
}

function bestSpawnAngle() {
  // 角度 a 的前进方向（格子坐标）为 (-sin a, -cos a)
  const cand = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let best = 0, bestN = -1;
  for (const a of cand) {
    const dx = Math.round(-Math.sin(a)), dy = Math.round(-Math.cos(a));
    let n = 0, cx = startCell.x + dx, cy = startCell.y + dy;
    while (isOpenCell(cx, cy)) { n++; cx += dx; cy += dy; }
    if (n > bestN) { bestN = n; best = a; }
  }
  return best;
}

function buildKey() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffd24a, emissive: 0x6b5200 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 10, 24), mat);
  ring.position.y = 0.13; g.add(ring);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), mat);
  shaft.position.y = -0.08; g.add(shaft);
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.07), mat);
  t1.position.set(0.05, -0.18, 0); g.add(t1);
  const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.07), mat);
  t2.position.set(0.05, -0.26, 0); g.add(t2);
  return g;
}

let wallMatShared = null;
function brickMaterial() {
  if (wallMatShared) return wallMatShared;
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.extensions = { derivatives: true };
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 g = vec2(vWPos.x + vWPos.z, vWPos.y * 2.0);
          g.x += mod(floor(g.y), 2.0) * 0.5;
          vec2 f = fract(g);
          vec2 d = min(f, 1.0 - f);
          vec2 fw = fwidth(g) * 1.2;
          float lw = 0.06;
          vec2 aa = smoothstep(vec2(lw) - fw, vec2(lw) + fw, d);
          float mortar = 1.0 - min(aa.x, aa.y);
          diffuseColor.rgb = mix(vec3(0.435, 0.498, 0.690), vec3(0.298, 0.345, 0.471), mortar);
        }`);
  };
  wallMatShared = m;
  return m;
}

function buildScene() {
  if (scene) disposeScene(scene);
  particles.length = 0;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151920);
  scene.fog = new THREE.Fog(0x151920, 5 * CELL, 22 * CELL);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, 1.0));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.35);
  dirLight.position.set(3, 6, 2);
  scene.add(dirLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MW * CELL, MH * CELL),
    new THREE.MeshLambertMaterial({ color: 0x39404f })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((MW * CELL) / 2, 0, (MH * CELL) / 2);
  scene.add(floor);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(MW * CELL, MH * CELL),
    new THREE.MeshLambertMaterial({ color: 0x232833 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set((MW * CELL) / 2, CELL, (MH * CELL) / 2);
  scene.add(ceil);

  const wallGeo = new THREE.BoxGeometry(CELL, CELL, CELL);
  const wallMat = brickMaterial();
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      if (grid[y][x] !== '#') continue;
      const w = new THREE.Mesh(wallGeo, wallMat);
      w.position.set(x * CELL + CELL / 2, CELL / 2, y * CELL + CELL / 2);
      scene.add(w);
    }
  }

  const doorRedMat = new THREE.MeshLambertMaterial({ color: 0xd23c3c, emissive: 0x400000 });
  doorGreenMat = new THREE.MeshLambertMaterial({ color: 0x35c24a, emissive: 0x0a3d16 });
  doorMesh = new THREE.Mesh(wallGeo, doorRedMat);
  doorMesh.position.set(doorCell.x * CELL + CELL / 2, CELL / 2, doorCell.y * CELL + CELL / 2);
  scene.add(doorMesh);

  keyGroup = buildKey();
  keyGroup.scale.setScalar(CELL);
  keyGroup.position.set(keyCell.x * CELL + CELL / 2, 0.55 * CELL, keyCell.y * CELL + CELL / 2);
  scene.add(keyGroup);
}

function buildLevel(idx) {
  levelIndex = idx;
  const rows = LEVELS[idx].map;
  MH = rows.length; MW = rows[0].length;
  grid = rows.map(r => r.split(''));
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const c = grid[y][x];
      if (c === 'S') startCell = { x, y };
      else if (c === 'K') keyCell = { x, y };
      else if (c === 'D') doorCell = { x, y };
    }
  }
  hasKey = false; locked = false;
  px = startCell.x * CELL + CELL / 2; py = startCell.y * CELL + CELL / 2;
  angle = bestSpawnAngle();
  buildScene();
  updateKeyUI();
  updateLevelPanel();
  hideBanner();
  camera.position.set(px, EYE, py);
  camera.rotation.y = angle;
}

/* ================= 特效粒子 ================= */
function burst(x, y, z, color) {
  const n = 26;
  const pos = new Float32Array(n * 3);
  const vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
    const sp = (1.2 + Math.random() * 1.2) * CELL;
    vel.push([
      Math.sin(ph) * Math.cos(th) * sp,
      Math.cos(ph) * sp * 0.8 + 0.6 * CELL,
      Math.sin(ph) * Math.sin(th) * sp,
    ]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size: 0.09 * CELL, transparent: true, opacity: 1 });
  const p = new THREE.Points(geo, mat);
  p.userData = { vel, life: 0.7, t: 0 };
  scene.add(p);
  particles.push(p);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.t += dt;
    const arr = p.geometry.attributes.position.array;
    for (let j = 0; j < p.userData.vel.length; j++) {
      arr[j * 3] += p.userData.vel[j][0] * dt;
      arr[j * 3 + 1] += p.userData.vel[j][1] * dt;
      arr[j * 3 + 2] += p.userData.vel[j][2] * dt;
      p.userData.vel[j][1] -= 2.5 * CELL * dt;
    }
    p.geometry.attributes.position.needsUpdate = true;
    p.material.opacity = Math.max(0, 1 - p.userData.t / p.userData.life);
    if (p.userData.t >= p.userData.life) {
      scene.remove(p);
      p.geometry.dispose(); p.material.dispose();
      particles.splice(i, 1);
    }
  }
}

/* ================= 输入与移动 ================= */
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keysDown[e.code] = true;
});
window.addEventListener('keyup', e => { keysDown[e.code] = false; });

/* ================= 触屏控制杆 ================= */
const JOY_R = 48;      // 摇杆头最大拖动半径（像素）
const JOY_DEAD = 0.15; // 死区：小于此幅度视为不动
let joyId = null, joyOX = 0, joyOY = 0, joyX = 0, joyY = 0;

function joyHide() {
  joyId = null; joyX = 0; joyY = 0;
  joyBase.classList.add('hidden');
}

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' || joyId !== null) return;
  joyId = e.pointerId;
  joyOX = e.clientX; joyOY = e.clientY;
  joyBase.style.left = joyOX + 'px';
  joyBase.style.top = joyOY + 'px';
  joyBase.classList.remove('hidden');
  joyKnob.style.transform = 'translate(0px, 0px)';
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});

canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== joyId) return;
  let dx = e.clientX - joyOX, dy = e.clientY - joyOY;
  const d = Math.hypot(dx, dy);
  if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
  joyKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  if (d < JOY_R * JOY_DEAD) { joyX = 0; joyY = 0; }
  else { joyX = dx / JOY_R; joyY = dy / JOY_R; }
});

canvas.addEventListener('pointerup', e => { if (e.pointerId === joyId) joyHide(); });
canvas.addEventListener('pointercancel', e => { if (e.pointerId === joyId) joyHide(); });

function circleHit(x, y) {
  const x1 = Math.floor((x - PLAYER_R) / CELL), x2 = Math.floor((x + PLAYER_R) / CELL);
  const y1 = Math.floor((y - PLAYER_R) / CELL), y2 = Math.floor((y + PLAYER_R) / CELL);
  for (let cy = y1; cy <= y2; cy++) {
    for (let cx = x1; cx <= x2; cx++) {
      if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) return { type: '#' };
      const c = grid[cy][cx];
      if (c === '#') return { type: '#' };
      if (c === 'D') return { type: 'D' };
    }
  }
  return null;
}

function moveAxis(dx, dy) {
  const nx = px + dx, ny = py + dy;
  const hit = circleHit(nx, ny);
  if (!hit) { px = nx; py = ny; return; }
  if (hit.type === 'D') onDoorTouch();
}

function onDoorTouch() {
  if (locked) return;
  if (hasKey) { winLevel(); return; }
  const now = performance.now();
  if (now >= hintCooldownUntil) {
    showToast('需要先找到钥匙');
    hintCooldownUntil = now + 1600;
  }
}

function handleInput(dt) {
  if (locked) return;
  let turn = 0;
  if (keysDown['KeyA'] || keysDown['ArrowLeft']) turn += 1;
  if (keysDown['KeyD'] || keysDown['ArrowRight']) turn -= 1;
  turn -= joyX; // 拖右 = 右转（与键盘 D 一致）
  turn = Math.max(-1, Math.min(1, turn));
  if (turn !== 0) angle += turn * TURN_SPEED * dt;
  let f = 0;
  if (keysDown['KeyW'] || keysDown['ArrowUp']) f += 1;
  if (keysDown['KeyS'] || keysDown['ArrowDown']) f -= 1;
  f -= joyY; // 屏幕向上拖 = 前进
  f = Math.max(-1, Math.min(1, f));
  if (f !== 0) {
    const fx = -Math.sin(angle), fy = -Math.cos(angle);
    moveAxis(fx * MOVE_SPEED * CELL * f * dt, 0);
    moveAxis(0, fy * MOVE_SPEED * CELL * f * dt);
  }
}

/* ================= 钥匙与过关 ================= */
function dist2(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }

function checkPickupAndWin() {
  if (locked) return;
  if (!hasKey && keyGroup) {
    if (dist2(px, py, keyCell.x * CELL + CELL / 2, keyCell.y * CELL + CELL / 2) < (0.6 * CELL) * (0.6 * CELL)) {
      hasKey = true;
      burst(keyCell.x * CELL + CELL / 2, 0.55 * CELL, keyCell.y * CELL + CELL / 2, 0xffd24a);
      scene.remove(keyGroup);
      keyGroup = null;
      doorMesh.material = doorGreenMat;
      updateKeyUI();
      showToast('拿到钥匙了！门变成绿色了');
    }
  }
  if (hasKey) {
    if (dist2(px, py, doorCell.x * CELL + CELL / 2, doorCell.y * CELL + CELL / 2) < (0.8 * CELL) * (0.8 * CELL)) winLevel();
  }
}

function winLevel() {
  if (locked) return;
  locked = true;
  burst(doorCell.x * CELL + CELL / 2, 0.6 * CELL, doorCell.y * CELL + CELL / 2, 0x35c24a);
  if (levelIndex < LEVELS.length - 1) {
    showBanner('第 ' + (levelIndex + 1) + ' 关 · 过关！');
    setTimeout(() => buildLevel(levelIndex + 1), WIN_DELAY_MS);
  } else {
    showBanner('恭喜！全部通关！');
    setTimeout(() => { hideBanner(); locked = false; }, 3000);
  }
}

/* ================= UI ================= */
function updateKeyUI() {
  keyStatus.textContent = hasKey ? '钥匙：已拿到' : '钥匙：未拿到';
  keyStatus.classList.toggle('got', hasKey);
}

function updateLevelPanel() {
  levelPanel.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', +b.dataset.level === levelIndex + 1);
  });
}

function showBanner(text) { banner.textContent = text; banner.classList.remove('hidden'); }
function hideBanner() { banner.classList.add('hidden'); }

function showToast(text) {
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 1400);
}

function hidePanels() {
  levelPanel.classList.add('hidden');
  helpPanel.classList.add('hidden');
}

levelBtn.addEventListener('click', e => {
  e.stopPropagation();
  helpPanel.classList.add('hidden');
  levelPanel.classList.toggle('hidden');
});
levelPanel.addEventListener('click', e => {
  e.stopPropagation();
  const lv = e.target.dataset && e.target.dataset.level;
  if (lv) { buildLevel(+lv - 1); hidePanels(); }
});
helpBtn.addEventListener('click', e => {
  e.stopPropagation();
  levelPanel.classList.add('hidden');
  helpPanel.classList.toggle('hidden');
});
helpPanel.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => hidePanels());

/* ================= 地图（5秒展示 + 20秒冷却） ================= */
mapBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (mapOpen || Date.now() < mapCooldownUntil) return;
  mapOpen = true;
  mapOverlay.classList.remove('hidden');
  drawMap();
  clearTimeout(mapCloseTimer);
  mapCloseTimer = setTimeout(closeMap, MAP_SHOW_MS);
});
function closeMap() {
  if (!mapOpen) return;
  mapOpen = false;
  mapOverlay.classList.add('hidden');
  mapCooldownUntil = Date.now() + MAP_CD_MS;
}

function drawMap() {
  const size = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.72);
  if (mapCanvas.width !== size) { mapCanvas.width = size; mapCanvas.height = size; }
  const pad = 10;
  const cell = (size - pad * 2) / Math.max(MW, MH);
  const offX = (size - cell * MW) / 2;
  const offY = (size - cell * MH) / 2;
  mctx.fillStyle = '#10131a';
  mctx.fillRect(0, 0, size, size);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      mctx.fillStyle = grid[y][x] === '#' ? '#93a7cf' : '#2c3342';
      mctx.fillRect(offX + x * cell, offY + y * cell, cell - 1, cell - 1);
    }
  }
  // 玩家位置与朝向（不显示钥匙和门）
  const cx = offX + (px / CELL) * cell, cy = offY + (py / CELL) * cell;
  mctx.strokeStyle = '#ffd24a';
  mctx.lineWidth = Math.max(2, cell * 0.12);
  mctx.beginPath();
  mctx.moveTo(cx, cy);
  mctx.lineTo(cx - Math.sin(angle) * cell * 1.1, cy - Math.cos(angle) * cell * 1.1);
  mctx.stroke();
  mctx.fillStyle = '#ffd24a';
  mctx.beginPath();
  mctx.arc(cx, cy, Math.max(3, cell * 0.32), 0, Math.PI * 2);
  mctx.fill();
}

function updateMapBtn() {
  if (mapOpen) {
    mapBtn.textContent = '地图';
    mapBtn.classList.add('cooldown');
    return;
  }
  const rem = Math.ceil((mapCooldownUntil - Date.now()) / 1000);
  if (rem > 0) {
    mapBtn.textContent = '地图(' + rem + ')';
    mapBtn.classList.add('cooldown');
  } else {
    mapBtn.textContent = '地图';
    mapBtn.classList.remove('cooldown');
  }
}

/* ================= 主循环 ================= */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;

  handleInput(dt);
  checkPickupAndWin();

  if (keyGroup) {
    keyGroup.rotation.y += dt * 2;
    keyGroup.position.y = 0.55 * CELL + Math.sin(now / 300) * 0.1;
  }
  if (hasKey && doorMesh && doorMesh.material === doorGreenMat) {
    doorGreenMat.emissiveIntensity = 1 + 0.6 * Math.sin(now / 200);
  }
  updateParticles(dt);
  if (mapOpen) drawMap();
  updateMapBtn();

  camera.position.set(px, EYE, py);
  camera.rotation.y = angle;
  renderer.render(scene, camera);

  if (!loadingHidden && loading && performance.now() - loadStart >= LOADING_MIN_MS) {
    loadingHidden = true;
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 500);
  }
}

/* ================= 调试钩子 ================= */
window.__maze = {
  state() {
    return {
      level: levelIndex + 1, px, py, angle, hasKey, locked, mapOpen,
      key: { x: keyCell.x * CELL + CELL / 2, y: keyCell.y * CELL + CELL / 2 },
      door: { x: doorCell.x * CELL + CELL / 2, y: doorCell.y * CELL + CELL / 2 },
      calls: renderer.info.render.calls,
    };
  },
  teleport(x, y, a) { px = x; py = y; if (a !== undefined) angle = a; },
  level(i) { buildLevel(i - 1); },
  step(dt) { handleInput(dt); checkPickupAndWin(); },
};

buildLevel(0);
requestAnimationFrame(loop);
})();
