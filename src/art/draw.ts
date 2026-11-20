
// Every image in the game is drawn here in code onto canvas textures at boot.
// Sizes are powers of two where possible so the renderer can build mipmaps.

export type Ctx = CanvasRenderingContext2D;
export type Stop = [number, string];

export const INK = '#0c0a14';


export function radial(ctx: Ctx, cx: number, cy: number, r: number, stops: Stop[], r0 = 0): CanvasGradient {
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: Stop[]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function poly(ctx: Ctx, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

/** Fill the current path with a dark outline drawn outside the shape. */
export function paint(ctx: Ctx, fill: string | CanvasGradient, outline = 4, ink: string = INK): void {
  if (outline > 0) {
    ctx.lineWidth = outline * 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A thick rounded line with an outline, used for limbs, staves and bones. */
export function limb(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: string | CanvasGradient,
  outline = 4,
  ink: string = INK,
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  if (outline > 0) {
    ctx.lineWidth = width + outline * 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** A small glowing dot, used for eyes and runes. */
export function glowDot(ctx: Ctx, x: number, y: number, r: number, core: string, glow: string, blur = 10): void {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = glow;
  circle(ctx, x, y, r);
  ctx.fill();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = core;
  circle(ctx, x, y, r * 0.62);
  ctx.fill();
  ctx.restore();
}

/** Clip to the current path, run the drawing, then restore. */
export function inside(ctx: Ctx, draw: () => void): void {
  ctx.save();
  ctx.clip();
  draw();
  ctx.restore();
}

/** A bent limb: one stroke through several points, outlined as a single shape. */
export function bent(
  ctx: Ctx,
  pts: number[],
  width: number,
  color: string | CanvasGradient,
  outline = 3.5,
  ink: string = INK,
): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (outline > 0) {
    ctx.lineWidth = width + outline * 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Run a drawing inside a translated and rotated frame. */
export function at(ctx: Ctx, x: number, y: number, rot: number, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  draw();
  ctx.restore();
}

/** Draw with a coloured glow behind it. */
export function glowing(ctx: Ctx, color: string, blur: number, draw: () => void): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

/** Mix two "#rrggbb" colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
