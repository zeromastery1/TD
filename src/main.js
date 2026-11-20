import * as THREE from 'three';
import { Scene3D, cellToWorld } from './scene.js';
import { Game } from './game.js';
import { UI } from './ui.js';

const scene3d = new Scene3D(document.getElementById('app'));
let ui = null;
let dirty = true;
const game = new Game(scene3d, () => { dirty = true; });
ui = new UI(game);
window.__game = game; // handy for debugging in the console

// ---------- Mouse ----------
const canvas = scene3d.renderer.domElement;
let hoverCell = null;

canvas.addEventListener('pointermove', (e) => {
  hoverCell = scene3d.pickCell(e.clientX, e.clientY);
  updateGhost();
});
canvas.addEventListener('pointerleave', () => { hoverCell = null; updateGhost(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const c = scene3d.pickCell(e.clientX, e.clientY);
  if (!c) { game.select(null); return; }
  const t = game.at(c.x, c.z);
  if (t) game.select(t);
  else if (game.phase === 'build') game.place(c.x, c.z);
  else game.select(null);
  updateGhost();
});

function updateGhost() {
  const g = scene3d.ghost;
  if (!hoverCell || game.phase !== 'build' || game.at(hoverCell.x, hoverCell.z)) {
    g.visible = false;
    if (!game.selected) scene3d.showRange(0, 0, null);
    return;
  }
  const ok = game.canPlace(hoverCell.x, hoverCell.z).ok;
  g.visible = true;
  g.position.copy(cellToWorld(hoverCell.x, hoverCell.z, 0.05));
  g.material.color.setHex(ok ? 0x66ff99 : 0xff4466);
}

// ---------- Keyboard ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (ui.isModalOpen) { if (e.key === 'Escape') ui.closeModal(); return; }
  const k = e.key.toLowerCase();
  keys.add(k);
  const acts = game.actionsFor(game.selected);
  const run = (id) => acts.some((a) => a.id === id && !a.disabled) && game.doAction(id);
  if (k === 'k') run('keep');
  else if (k === 'c') run('combine1');
  else if (k === 'v') run('combine2');
  else if (k === '1') ui.setSpeed(1);
  else if (k === '2') ui.setSpeed(2);
  else if (k === '3') ui.setSpeed(4);
  else if (k === 'escape') game.select(null);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function panCamera(dt) {
  const dir = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) dir.z -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dir.z += 1;
  if (keys.has('a') || keys.has('arrowleft')) dir.x -= 1;
  if (keys.has('d') || keys.has('arrowright')) dir.x += 1;
  if (!dir.lengthSq()) return;
  const cam = scene3d.camera;
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const move = right.multiplyScalar(dir.x).add(fwd.multiplyScalar(-dir.z)).normalize().multiplyScalar(dt * 18);
  const t = scene3d.controls.target;
  const next = t.clone().add(move);
  next.x = THREE.MathUtils.clamp(next.x, -16, 16);
  next.z = THREE.MathUtils.clamp(next.z, -16, 16);
  move.subVectors(next, t);
  t.add(move);
  cam.position.add(move);
}

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  panCamera(Math.min(dt, 0.05));
  game.update(ui.isModalOpen ? 0 : dt);
  if (dirty || game.phase === 'wave') { ui.refresh(); dirty = false; }
  scene3d.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

ui.refresh();
ui.showHelp(true);
