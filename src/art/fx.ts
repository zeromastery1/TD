import { Rng } from '../core/rng';
import { Ctx, at, circle, poly, radial } from './draw';

// Soft white shapes the effect sheet borrows by name (from Emberfall Survivors' art).
const W = (a: number) => `rgba(255,255,255,${a})`;

function canvas(w: number, h: number, draw: (ctx: Ctx) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw(ctx);
  return c;
}

export function effectTextures(): Record<string, HTMLCanvasElement> {
  const out: Record<string, HTMLCanvasElement> = {};
out['aura'] = canvas(256, 256, (ctx) => {
    const rng = new Rng(77);
    ctx.fillStyle = radial(ctx, 128, 128, 126, [
      [0, W(0)],
      [0.55, W(0.05)],
      [0.86, W(0.3)],
      [0.95, W(0.75)],
      [1, W(0)],
    ]);
    ctx.fillRect(0, 0, 256, 256);
    // Licks of flame along the rim.
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const r0 = 118;
      const len = rng.range(16, 34);
      at(ctx, 128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0, a + Math.PI / 2 + 0.5, () => {
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.quadraticCurveTo(-4, -len * 0.6, 4, -len);
        ctx.quadraticCurveTo(8, -len * 0.4, 7, 0);
        ctx.closePath();
        ctx.fillStyle = W(0.55);
        ctx.fill();
      });
    }
  });
out['scorch'] = canvas(256, 256, (ctx) => {
    const rng = new Rng(31);
    ctx.fillStyle = radial(ctx, 128, 128, 120, [
      [0, 'rgba(6,4,6,0.85)'],
      [0.55, 'rgba(10,6,8,0.6)'],
      [1, 'rgba(10,6,8,0)'],
    ]);
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(40, 104);
      const r = rng.range(8, 22);
      ctx.fillStyle = radial(ctx, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r, [
        [0, 'rgba(4,3,4,0.7)'],
        [1, 'rgba(4,3,4,0)'],
      ]);
      ctx.fillRect(0, 0, 256, 256);
    }
    // A few embers still glowing in it.
    for (let i = 0; i < 9; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(10, 70);
      ctx.fillStyle = radial(ctx, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 7, [
        [0, 'rgba(255,150,60,0.75)'],
        [1, 'rgba(255,90,20,0)'],
      ]);
      ctx.fillRect(0, 0, 256, 256);
    }
  });
out['pool'] = canvas(256, 256, (ctx) => {
    const rng = new Rng(404);
    const blob = (r: number, wob: number) => {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const rr = r + Math.sin(a * 5 + 1) * wob + Math.sin(a * 3 + 2) * wob * 0.7;
        const x = 128 + Math.cos(a) * rr;
        const y = 128 + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    blob(112, 7);
    ctx.fillStyle = 'rgba(40,90,24,0.55)';
    ctx.fill();
    blob(98, 8);
    ctx.fillStyle = radial(ctx, 128, 128, 104, [
      [0, 'rgba(170,240,90,0.75)'],
      [0.7, 'rgba(110,190,50,0.7)'],
      [1, 'rgba(60,130,30,0.6)'],
    ]);
    ctx.fill();
    for (let i = 0; i < 16; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, 82);
      const r = rng.range(4, 11);
      circle(ctx, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r);
      ctx.fillStyle = 'rgba(220,255,150,0.5)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,90,24,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      circle(ctx, 128 + Math.cos(a) * d - r * 0.3, 128 + Math.sin(a) * d - r * 0.3, r * 0.3);
      ctx.fillStyle = W(0.8);
      ctx.fill();
    }
  });
out['sigil'] = canvas(256, 256, (ctx) => {
    ctx.fillStyle = radial(ctx, 128, 128, 124, [
      [0, W(0.3)],
      [0.6, W(0.14)],
      [0.92, W(0.2)],
      [1, W(0)],
    ]);
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = W(0.95);
    ctx.lineWidth = 5;
    circle(ctx, 128, 128, 116);
    ctx.stroke();
    ctx.lineWidth = 2;
    circle(ctx, 128, 128, 100);
    ctx.stroke();
    circle(ctx, 128, 128, 56);
    ctx.stroke();
    // Marks between the two outer rings, like the hours on a dial.
    ctx.lineWidth = 3.5;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const long = i % 4 === 0;
      ctx.beginPath();
      ctx.moveTo(128 + Math.cos(a) * (long ? 84 : 100), 128 + Math.sin(a) * (long ? 84 : 100));
      ctx.lineTo(128 + Math.cos(a) * 114, 128 + Math.sin(a) * 114);
      ctx.stroke();
    }
    // An eight-pointed star.
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 18 : i % 4 ? 36 : 54;
      pts.push(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    poly(ctx, pts);
    ctx.fillStyle = W(0.3);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = W(0.9);
    ctx.stroke();
  });
  return out;
}
