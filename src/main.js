import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cinzel/latin-900.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import '@fontsource/alegreya-sans/latin-800.css';
import './style.css';
import { loadModels } from './three/models.ts';
import { View } from './view.js';
import { Game } from './game.js';
import { UI } from './ui.js';

async function boot() {
  const loading = document.getElementById('loading');
  await Promise.all([loadModels(), document.fonts.ready]);
  // Make sure the title fonts are ready before anything is drawn with them.
  await Promise.all(['700 20px Cinzel', '900 20px Cinzel', '500 20px "Alegreya Sans"'].map((f) => document.fonts.load(f).catch(() => null)));

  let dirty = true;
  const game = new Game(() => { dirty = true; });
  const view = new View(document.getElementById('app'), game);
  const ui = new UI(game);
  window.__game = game; // handy for debugging in the console
  window.__view = view;
  loading.remove();

  // ---------- Mouse ----------
  const canvas = view.renderer.domElement;
  let hoverCell = null;
  let drag = null;

  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      view.panBy(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
      return;
    }
    hoverCell = view.pickCell(e.clientX, e.clientY);
    updateGhost();
  });
  canvas.addEventListener('pointerleave', () => { hoverCell = null; updateGhost(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || e.button === 2) {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || ui.isModalOpen) return;
    const c = view.pickCell(e.clientX, e.clientY);
    if (!c) { game.select(null); return; }
    const t = game.at(c.x, c.z);
    if (t) game.select(t);
    else if (game.phase === 'build') game.place(c.x, c.z);
    else game.select(null);
    updateGhost();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
  }, { passive: false });

  function updateGhost() {
    if (!hoverCell || game.phase !== 'build' || game.at(hoverCell.x, hoverCell.z)) {
      view.setGhost(null);
      return;
    }
    view.setGhost(hoverCell, game.canPlace(hoverCell.x, hoverCell.z).ok);
  }

  // ---------- Keyboard ----------
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (ui.isModalOpen) {
      if (e.key === 'Escape' || e.key === 'Enter') ui.closeModal();
      return;
    }
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

  function panKeys(dt) {
    let dx = 0, dy = 0;
    if (keys.has('w') || keys.has('arrowup')) dy += 1;
    if (keys.has('s') || keys.has('arrowdown')) dy -= 1;
    if (keys.has('a') || keys.has('arrowleft')) dx += 1;
    if (keys.has('d') || keys.has('arrowright')) dx -= 1;
    if (dx || dy) view.panBy(dx * dt * 700, dy * dt * 700);
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    panKeys(Math.min(dt, 0.05));
    const paused = ui.isModalOpen;
    view.paused = paused;
    game.update(paused ? 0 : dt);
    view.update(dt);
    if (dirty || game.phase === 'wave') { ui.refresh(); dirty = false; }
    view.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  ui.refresh();
  ui.showTitle();
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'Could not start: ' + err.message;
});
