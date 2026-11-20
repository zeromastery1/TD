import { Rng } from '../core/rng';
import { Ctx, circle, ellipse, poly, radial } from './draw';

const GROUND = 1024;

/** Draw something at a position and at every wrapped copy so the tile is seamless. */
function wrapped(x: number, y: number, reach: number, draw: (x: number, y: number) => void): void {
  for (const ox of [-GROUND, 0, GROUND]) {
    for (const oy of [-GROUND, 0, GROUND]) {
      const px = x + ox;
      const py = y + oy;
      if (px < -reach || py < -reach || px > GROUND + reach || py > GROUND + reach) continue;
      draw(px, py);
    }
  }
}

/** What one zone's ground is made of. Colours with an `A` take their alpha from the painter. */
export interface GroundLook {
  seed: number;
  base: string;
  /** Broad soft patches, as `rgba(r,g,b,A)`. */
  tones: string[];
  /** The light flecks in the mottling, as `r,g,b`. */
  fleck: string;
  /** Flat plates showing through: flagstones, ice, basalt. */
  plates: { count: number; fill: string; shine: string };
  cracks: { count: number; color: string; width: number; glow?: string };
  pebble: { fill: string; shine: string };
  /** Tufts of grass or stubble. */
  tufts: { count: number; colors: string[] };
  /** Small dots: flowers, frost glints, embers. */
  dots: { count: number; colors: string[]; glow?: string; eye: boolean };
}

export const VALE: GroundLook = {
  seed: 7341,
  base: '#1c2824',
  tones: [
    'rgba(58,96,62,A)',
    'rgba(44,80,64,A)',
    'rgba(92,74,56,A)',
    'rgba(60,70,92,A)',
    'rgba(12,16,22,A)',
    'rgba(70,104,58,A)',
    'rgba(48,60,84,A)',
  ],
  fleck: '170,196,170',
  plates: { count: 8, fill: '#3a4654', shine: 'rgba(170,196,190,0.1)' },
  cracks: { count: 7, color: 'rgba(4,6,12,0.4)', width: 2.5 },
  pebble: { fill: '#434e5e', shine: 'rgba(190,206,220,0.25)' },
  tufts: { count: 420, colors: ['rgba(92,146,88,0.8)', 'rgba(70,122,84,0.8)', 'rgba(114,160,84,0.75)', 'rgba(56,104,80,0.8)'] },
  dots: { count: 70, colors: ['#e8e2c0', '#d8a0e0', '#f0c860', '#9fd8f0'], eye: true },
};

/** Paint a seamless ground tile. */
export function groundTile(ctx: Ctx, look: GroundLook): void {
  const rng = new Rng(look.seed);
  ctx.fillStyle = look.base;
  ctx.fillRect(0, 0, GROUND, GROUND);

  // Broad patches.
  const tones = look.tones;
  for (let i = 0; i < 110; i++) {
    const r = rng.range(90, 270);
    const tone = rng.pick(tones);
    const a = rng.range(0.2, 0.46);
    wrapped(rng.range(0, GROUND), rng.range(0, GROUND), r, (x, y) => {
      ctx.fillStyle = radial(ctx, x, y, r, [
        [0, tone.replace('A', a.toFixed(3))],
        [0.6, tone.replace('A', (a * 0.6).toFixed(3))],
        [1, tone.replace('A', '0')],
      ]);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // Soft mottling: small blurry flecks rather than hard noise.
  for (let i = 0; i < 1300; i++) {
    const light = rng.chance(0.5);
    const r = rng.range(3, 10);
    const a = light ? rng.range(0.04, 0.1) : rng.range(0.08, 0.2);
    const col = light ? look.fleck : '0,0,0';
    wrapped(rng.range(0, GROUND), rng.range(0, GROUND), r, (x, y) => {
      ctx.fillStyle = radial(ctx, x, y, r, [
        [0, `rgba(${col},${a.toFixed(3)})`],
        [1, `rgba(${col},0)`],
      ]);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // Worn plates showing through here and there.
  for (let i = 0; i < look.plates.count; i++) {
    const cx = rng.range(0, GROUND);
    const cy = rng.range(0, GROUND);
    const rx = rng.range(20, 38);
    const ry = rx * rng.range(0.55, 0.8);
    const rot = rng.range(0, Math.PI);
    const pts: number[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const m = rng.range(0.8, 1);
      pts.push(Math.cos(a) * rx * m, Math.sin(a) * ry * m);
    }
    wrapped(cx, cy, 60, (x, y) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      poly(ctx, pts);
      ctx.fillStyle = 'rgba(8,10,16,0.5)';
      ctx.translate(2, 4);
      ctx.fill();
      ctx.translate(-2, -4);
      ctx.fillStyle = look.plates.fill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,12,20,0.55)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = look.plates.shine;
      ctx.beginPath();
      ctx.ellipse(-rx * 0.2, -ry * 0.25, rx * 0.5, ry * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // Cracks, which glow where there is fire under the ground.
  ctx.lineCap = 'round';
  for (let i = 0; i < look.cracks.count; i++) {
    let x = rng.range(0, GROUND);
    let y = rng.range(0, GROUND);
    let ang = rng.range(0, Math.PI * 2);
    const pts: number[] = [x, y];
    const n = rng.int(4, 8);
    for (let j = 0; j < n; j++) {
      ang += rng.range(-0.6, 0.6);
      const len = rng.range(18, 40);
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      pts.push(x, y);
    }
    wrapped(0, 0, GROUND, (ox, oy) => {
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0] + ox, pts[1] + oy);
        for (let j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j] + ox, pts[j + 1] + oy);
        ctx.stroke();
      };
      if (look.cracks.glow) {
        ctx.save();
        ctx.shadowColor = look.cracks.glow;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = 'rgba(10,4,6,0.7)';
        ctx.lineWidth = look.cracks.width + 4;
        trace();
        ctx.strokeStyle = look.cracks.glow;
        ctx.lineWidth = look.cracks.width;
        trace();
        ctx.restore();
        ctx.strokeStyle = look.cracks.color;
        ctx.lineWidth = look.cracks.width * 0.4;
        trace();
      } else {
        ctx.strokeStyle = look.cracks.color;
        ctx.lineWidth = look.cracks.width;
        trace();
      }
    });
  }

  // Pebbles.
  for (let i = 0; i < 50; i++) {
    const r = rng.range(3, 8);
    const rot = rng.range(0, Math.PI);
    wrapped(rng.range(0, GROUND), rng.range(0, GROUND), 14, (x, y) => {
      ellipse(ctx, x + 1.5, y + 3, r, r * 0.7, rot);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ellipse(ctx, x, y, r, r * 0.7, rot);
      ctx.fillStyle = look.pebble.fill;
      ctx.fill();
      ellipse(ctx, x - r * 0.2, y - r * 0.2, r * 0.5, r * 0.3, rot);
      ctx.fillStyle = look.pebble.shine;
      ctx.fill();
    });
  }

  // Tufts, thick enough to read as turf where there are many.
  const greens = look.tufts.colors;
  for (let i = 0; i < look.tufts.count; i++) {
    const gx = rng.range(0, GROUND);
    const gy = rng.range(0, GROUND);
    const blades = rng.int(3, 6);
    const col = rng.pick(greens);
    const offs: number[] = [];
    for (let b = 0; b < blades; b++) offs.push(rng.range(-8, 8), rng.range(8, 18));
    wrapped(gx, gy, 24, (x, y) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      for (let b = 0; b < blades; b++) {
        ctx.beginPath();
        ctx.moveTo(x + b * 4 - 6, y);
        ctx.lineTo(x + b * 4 - 6 + offs[b * 2], y - offs[b * 2 + 1]);
        ctx.stroke();
      }
    });
  }

  // Tiny dots: wildflowers, glints of frost, live embers.
  const petals = look.dots.colors;
  for (let i = 0; i < look.dots.count; i++) {
    const col = rng.pick(petals);
    const r = rng.range(2, 3.4);
    wrapped(rng.range(0, GROUND), rng.range(0, GROUND), 8, (x, y) => {
      ctx.save();
      if (look.dots.glow) {
        ctx.shadowColor = look.dots.glow;
        ctx.shadowBlur = 8;
      }
      circle(ctx, x, y, r);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
      if (look.dots.eye) {
        circle(ctx, x, y, r * 0.4);
        ctx.fillStyle = 'rgba(60,40,20,0.7)';
        ctx.fill();
      }
    });
  }
}

export const GROUND_SIZE = GROUND;
