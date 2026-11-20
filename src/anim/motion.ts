import type { Clip } from '../three/models';

// How a body is posed, for every renderer. Each body reaches the GPU as two rows of
// its model's animation table and one blend between them, so a pose can spend that
// blend on one thing only: adjacent frames of a clip, two clips each held on one
// frame, or the upper body. The constructors below are the only ways to make one.
// Nothing here may import a value: tests/motion.mjs runs this file under plain Node.

declare const brand: unique symbol;

export type Seconds = number;

/** A row of a model's animation table. */
export type Row = number & { readonly [brand]: 'Row' };

/** Proof that a rig's chest and arms can move apart from its legs. Only `parseMask` makes one. */
export type Mask = { readonly [brand]: 'Mask' };

/** A point in one clip: cycles for a clip that loops, 0..1 (clamped) for one that does not. */
export interface Sample {
  readonly clip: Clip;
  readonly t: number;
}

/** The four floats of one instance's aAnim. */
export interface Pose {
  readonly a: Row;
  readonly b: Row;
  readonly blend: number;
  /** Row b moves only the upper body. */
  readonly upper: boolean;
  readonly [brand]: 'Pose';
}

const MASK = {} as Mask;

/**
 * `upper` is the model's aUpper bytes. A rig whose chest and arms carry under half the weight would swing little
 * more than a hand over running legs, so it gets no mask and swings with its whole body.
 */
export function parseMask(upper: ArrayLike<number>): Mask | null {
  let sum = 0;
  for (let i = 0; i < upper.length; i++) sum += upper[i];
  return upper.length > 0 && sum / (255 * upper.length) >= 0.5 ? MASK : null;
}

function pose(a: number, b: number, blend: number, upper: boolean): Pose {
  return { a, b, blend, upper } as Pose;
}

function frame(s: Sample): number {
  const c = s.clip;
  return c.loop ? (s.t - Math.floor(s.t)) * c.frames : Math.min(1, Math.max(0, s.t)) * (c.frames - 1);
}

/** The one row nearest a sample: a single bone fetch. */
export function nearest(s: Sample): Row {
  const c = s.clip;
  const f = Math.round(frame(s));
  return (c.row + (c.loop ? f % c.frames : f)) as Row;
}

/** Adjacent frames of one clip. */
export function tween(s: Sample): Pose {
  const c = s.clip;
  const f = frame(s);
  const a = Math.min(c.frames - 1, Math.floor(f));
  const b = c.loop ? (a + 1) % c.frames : Math.min(c.frames - 1, a + 1);
  return pose(c.row + a, c.row + b, f - a, false);
}

/** Two clips, each held on its nearest frame. `w` 0 shows `from`. */
export function fade(from: Sample, to: Sample, w: number): Pose {
  return pose(nearest(from), nearest(to), w, false);
}

/** Legs on `base`; chest and arms go `w` of the way to `top`. */
export function overlay(_mask: Mask, base: Sample, top: Sample, w: number): Pose {
  return pose(nearest(base), nearest(top), w, true);
}

/** Turn an angle toward another by the short way round, covering the fraction `k` of what is left. */
export function turn(from: number, to: number, k: number): number {
  return from + gap(from, to) * Math.min(1, k);
}

function gap(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function smooth(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
}

// ---- the hero ---------------------------------------------------------------

/** Two clips held on one frame each look sheared if the slot lingers between them, so a cross is over this fast. */
const CROSS = 0.08;
/** Seconds a 3D swing takes. Long enough that a 15fps film catches the crouch and the blow. */
export const SWING = 0.58;
/**
 * Attack windup height. A dip, not a squash: on the tipped camera a body facing the viewer that is squashed
 * much further reads as a big helmet on the ground rather than a knight gathering for a blow.
 */
const CROUCH = 0.86;
/** Share of a swing spent turning to its aim, while the arm comes up. */
const AIM_IN = 0.15;
/** Seconds the body takes to turn back to its heading once the weapon is down. */
const AIM_BACK = 0.2;
/** Lean into a swing, in radians. 15 degrees, toward the way the swing goes. */
const ATTACK_LEAN = (15 * Math.PI) / 180;
/** The body is at full speed on its first step, so the legs come up to pace fast and slow down a little slower. */
const GAIT_UP = 0.06;
const GAIT_DOWN = 0.11;
const SNAP = 0.02;
/** A stopping body runs on until its gait falls this low, then crosses to idle. */
const SETTLE = 0.25;
/** Past this many radians the body pivots over a fixed time; the steady ease would spin it on the spot. */
const TURN_MIN = 2;
const TURN_LEN = 0.14;
/** The legs slow through a pivot so the feet read as planted rather than skating round. */
const TURN_DIP = 0.55;

/** A dodge clip after the dash ends: the get-up plays at most this long, sped up if need be. */
const RISE = 0.18;
/** Seconds the rush's clip takes to play out its recovery after the dash clock ends. */
const RUSH_SETTLE = 0.24;
/** How long a hit shows on the body. The red flash is a separate timer and stays where it is. */
const HURT = 0.14;
/** Where in the strike the arm is out, which a cast holds instead of chopping through. */
const APEX = 0.45;

/** Clip fractions read off one model. */
export interface Marks {
  /** Run phase of the run frame nearest the idle pose, where a start crosses in. */
  readonly plant?: number;
  /** The tuck of a roll clip, which fills the dash; the get-up after `land` plays once it ends. */
  readonly roll?: { readonly from: number; readonly land: number };
  /** Walk phase where the body sits lowest on a footfall; the other foot lands half a cycle later. */
  readonly step?: number;
}

/** How long the hero's acts last where gameplay does not say. The stage reads them off the clips. */
export interface HeroTimes {
  readonly fall: Seconds;
  /** The rush's dodge clip, which runs on past the rush. */
  readonly dodge: Seconds;
  /** The roll's get-up, after the dash. */
  readonly rise: Seconds;
}

/** The flat game has no clips: it falls as the defeat screen fades it, and its dashes end with the dash. */
export const FLAT_TIMES: HeroTimes = { fall: 0.9, dodge: 0, rise: 0 };

export interface HeroRig {
  readonly idle: Clip;
  readonly run: Clip;
  readonly strike: Clip;
  readonly dash: Clip;
  readonly die: Clip;
  readonly mask: Mask | null;
  readonly plant: number;
  readonly roll: { readonly from: number; readonly land: number };
  readonly times: HeroTimes;
}

/** Parse a hero model once. A missing clip throws here instead of standing in for another. */
export function heroRig(model: { readonly clips: Readonly<Record<string, Clip>>; readonly mask: Mask | null }, marks?: Marks): HeroRig {
  const clip = (name: string): Clip => {
    const c = model.clips[name];
    if (!c) throw new Error(`hero model has no ${name} clip`);
    return c;
  };
  const die = clip('die');
  const dash = clip('dash');
  const roll = marks?.roll ?? { from: 0, land: 1 };
  return {
    idle: clip('idle'),
    run: clip('run'),
    strike: clip('strike'),
    dash,
    die,
    mask: model.mask,
    plant: marks?.plant ?? 0,
    roll,
    times: { fall: Math.max(0.3, die.dur), dodge: dash.dur, rise: Math.min(RISE, (1 - roll.land) * dash.dur) },
  };
}

export type DashStyle = 'rush' | 'roll';
export type HeroCue = 'strike' | 'cast' | 'hurt';

/** What gameplay tells the hero's motion each step. */
export interface HeroFrame {
  readonly alive: boolean;
  /** The way the hero means to go while the stick is held; null once it is let go, even mid-dash. */
  readonly heading: { readonly x: number; readonly y: number } | null;
  /** How fast the legs turn over at full gait. */
  readonly pace: number;
  readonly dash: { readonly style: DashStyle; readonly left: Seconds; readonly len: Seconds } | null;
}

/** The hero's animation memory. Gameplay never reads it. Cues are times, so nothing here needs counting down. */
export interface HeroMotion {
  readonly now: Seconds;
  readonly yaw: number;
  /** Run cycles since the last start. Footfalls land on whole and half cycles. */
  readonly stride: number;
  /** 0 standing to 1 running: how fast the legs turn over. */
  readonly gait: number;
  /** The locomotion clip holding the slot. */
  readonly clip: 'idle' | 'run';
  /** The stick is held. */
  readonly going: boolean;
  /** When the slot last changed clip, and the stride the run was on then. */
  readonly cross: { readonly at: Seconds; readonly stride: number } | null;
  readonly turn: { readonly at: Seconds; readonly from: number; readonly to: number } | null;
  /** The last dash, kept after it ends so its clip can finish. */
  readonly dash: { readonly style: DashStyle; readonly at: Seconds; readonly len: Seconds } | null;
  readonly strikeAt: Seconds;
  readonly castAt: Seconds;
  /** The yaw the last strike or cast was aimed at. The body turns to it for the swing, then back to its heading. */
  readonly aim: number;
  readonly hurtAt: Seconds;
  readonly diedAt: Seconds | null;
}

export function heroMotion(yaw: number): HeroMotion {
  return { now: 0, yaw, stride: 0, gait: 0, clip: 'idle', going: false, cross: null, turn: null, dash: null, strikeAt: -Infinity, castAt: -Infinity, aim: yaw, hurtAt: -Infinity, diedAt: null };
}

/** `aim` is the yaw a strike or cast goes toward; without one the body swings the way it faces. */
export function cueHero(m: HeroMotion, cue: HeroCue, aim?: number): HeroMotion {
  switch (cue) {
    case 'strike':
      return { ...m, strikeAt: m.now, aim: aim ?? m.yaw };
    case 'cast':
      return { ...m, castAt: m.now, aim: aim ?? m.yaw };
    case 'hurt':
      return { ...m, hurtAt: m.now };
  }
}

export function stepHero(m: HeroMotion, f: HeroFrame, dt: Seconds): HeroMotion {
  const now = m.now + dt;
  if (!f.alive) return { ...m, now, diedAt: m.diedAt ?? m.now };
  const going = f.heading !== null;
  const aim = f.heading ? Math.atan2(f.heading.x, f.heading.y) : m.yaw;

  let hard = m.turn && m.now - m.turn.at < TURN_LEN ? { ...m.turn, to: f.heading ? aim : m.turn.to } : null;
  if (!hard && going && !f.dash && m.gait > 0.5 && Math.abs(gap(m.yaw, aim)) > TURN_MIN) hard = { at: now, from: m.yaw, to: aim };
  const k = hard ? (now - hard.at) / TURN_LEN : 0;
  const yaw = hard ? turn(hard.from, hard.to, smooth(k)) : f.heading ? turn(m.yaw, aim, dt * 16) : m.yaw;

  // A dash keeps the gait the stick asks for, so the body lands back in the clip it will stay in.
  const target = going ? 1 - (hard ? TURN_DIP * Math.sin(Math.PI * Math.min(1, k)) : 0) : 0;
  let gait = target + (m.gait - target) * Math.exp(-dt / (target > m.gait ? GAIT_UP : GAIT_DOWN));
  if (Math.abs(gait - target) < SNAP) gait = target;

  let clip = m.clip;
  let cross = m.cross;
  let stride = m.stride;
  if (clip === 'idle' && going) {
    clip = 'run';
    cross = { at: now, stride };
    stride = 0;
  } else if (clip === 'run' && !going && gait < SETTLE) {
    clip = 'idle';
    cross = { at: now, stride };
  }
  stride += dt * (f.dash ? (f.dash.style === 'rush' ? 3.4 : 0) : 1.5 * f.pace * gait);

  const dash = f.dash && !(m.dash && now - m.dash.at < m.dash.len) ? { style: f.dash.style, at: now - (f.dash.len - f.dash.left), len: f.dash.len } : m.dash;
  return { now, yaw, stride, gait, clip, going, cross, turn: hard, dash, strikeAt: m.strikeAt, castAt: m.castAt, aim: m.aim, hurtAt: m.hurtAt, diedAt: null };
}

/** True when a step put a foot down. `plant` is the run phase the stride starts from. */
export function footfall(plant: number, before: HeroMotion, after: HeroMotion): boolean {
  const half = (m: HeroMotion) => Math.floor((m.stride + plant) * 2);
  return after.clip === 'run' && after.stride > before.stride && half(before) !== half(after);
}

/** What the hero is doing this step: the one thing that gets the slot, for every renderer. */
type HeroAct =
  | { readonly kind: 'dead'; readonly k: number }
  /** `since` runs from the dash's start past its end while the clip finishes. */
  | { readonly kind: 'dash'; readonly style: DashStyle; readonly since: Seconds; readonly len: Seconds }
  /** The dodge has played out and crosses back into locomotion. */
  | { readonly kind: 'land'; readonly style: DashStyle; readonly w: number }
  /** A hit. `k` runs 0..1 across the flinch. The red flash is not this act. */
  | { readonly kind: 'hurt'; readonly k: number }
  /** A spell. `k` runs 0..1 while the arm stays out. */
  | { readonly kind: 'cast'; readonly k: number; readonly w: number }
  | { readonly kind: 'strike'; readonly k: number; readonly w: number }
  | { readonly kind: 'cross'; readonly w: number; readonly at: Seconds; readonly stride: number }
  | { readonly kind: 'gait' };

type DashRun = NonNullable<HeroMotion['dash']>;

/** Seconds from a dash's start until its clip has played out. */
function dashSpan(times: HeroTimes, d: DashRun): Seconds {
  // The dash clock is unchanged. This extra time is only the settle after it.
  // The extra time is the dive held after the dash clock, then the settle. The clock itself is unchanged.
  return d.style === 'rush' ? d.len + RUSH_SETTLE : d.len + times.rise;
}

function dashAct(times: HeroTimes, d: DashRun, now: Seconds): HeroAct | null {
  const since = now - d.at;
  const end = dashSpan(times, d);
  if (since < end) return { kind: 'dash', style: d.style, since, len: d.len };
  return since < end + CROSS ? { kind: 'land', style: d.style, w: smooth((since - end) / CROSS) } : null;
}

function heroAct(times: HeroTimes, m: HeroMotion): HeroAct {
  if (m.diedAt !== null) return { kind: 'dead', k: (m.now - m.diedAt) / times.fall };
  const dash = m.dash && dashAct(times, m.dash, m.now);
  if (dash) return dash;
  const hurt = (m.now - m.hurtAt) / HURT;
  if (hurt >= 0 && hurt < 1) return { kind: 'hurt', k: hurt };
  const cast = (m.now - m.castAt) / SWING;
  if (cast >= 0 && cast < 1) return { kind: 'cast', k: cast, w: Math.sin(Math.PI * cast) };
  const s = (m.now - m.strikeAt) / SWING;
  if (s < 1) return { kind: 'strike', k: s, w: Math.min(1, s / 0.12, (1 - s) / 0.3) };
  const c = m.cross;
  // A clip change hidden under a dash already landed into the new clip.
  const seen = c && (!m.dash || c.at >= m.dash.at + dashSpan(times, m.dash) + CROSS);
  if (c && seen && m.now - c.at < CROSS) return { kind: 'cross', w: smooth((m.now - c.at) / CROSS), at: c.at, stride: c.stride };
  return { kind: 'gait' };
}

/** What the stage may change about the hero: rows, facing, and a lift that is drawn and never stored. */
export interface HeroStance {
  readonly pose: Pose;
  readonly yaw: number;
  readonly lift: number;
  /** Height scale. 1 is the model as compiled. A crouch is shorter. */
  readonly stretch: number;
  /** Drawn offset. It is not the hit position. */
  readonly ox: number;
  readonly oy: number;
  /** Tip toward the ground, in radians. 0 stands up. */
  readonly pitch: number;
  /** Width relative to the compiled body. 1 is unchanged. */
  readonly wide: number;
}

export function heroStance(rig: HeroRig, m: HeroMotion): HeroStance {
  const a = heroAct(rig.times, m);
  const run = (stride: number): Sample => ({ clip: rig.run, t: stride + rig.plant });
  const idle = (at: Seconds): Sample => ({ clip: rig.idle, t: at / rig.idle.dur });
  const walk = m.clip === 'run' ? run(m.stride) : idle(m.now);
  let pose: Pose;
  let lift = 0;
  let stretch = 1;
  let pitch = 0;
  let wide = 1;
  switch (a.kind) {
    case 'dead':
      pose = tween({ clip: rig.die, t: a.k });
      break;
    case 'dash': {
      // The dash moves the hero for real, so the body is never shoved off its own position here: a drawn offset
      // runs ahead of the hitbox and the shadow, then snaps back when the dash ends. Height and lean ease, so no
      // frame jumps between a squashed and a stretched body.
      const { since, len } = a;
      if (a.style === 'rush') {
        const COIL = 0.12;
        if (since < COIL) {
          // Gather behind the shield: a small dip and a lean into the charge.
          const u = smooth(since / COIL);
          pose = tween({ clip: rig.dash, t: 0.08 * u });
          stretch = 1 - 0.1 * u;
          lift = -4 * u;
          pitch = 0.3 * u;
        } else if (since < len) {
          // Drive forward low behind the shield, rising out of the dip.
          const u = smooth(Math.min(1, (since - COIL) / 0.1));
          pose = tween({ clip: rig.dash, t: 0.08 + 0.5 * u });
          stretch = 0.9 + 0.1 * u;
          lift = -4 * (1 - u);
          pitch = 0.3 + 0.08 * u;
        } else {
          // The charge is over: the clip plays out its recovery as the lean comes off.
          const u = Math.min(1, (since - len) / RUSH_SETTLE);
          pose = tween({ clip: rig.dash, t: 0.58 + 0.42 * u });
          pitch = 0.38 * (1 - smooth(u));
        }
        break;
      }
      const { from, land } = rig.roll;
      const TUCK = 0.09;
      if (since < TUCK) {
        const u = smooth(since / TUCK);
        pose = tween({ clip: rig.dash, t: from });
        stretch = 1 - 0.12 * u;
        lift = -4 * u;
      } else if (since < len) {
        // The clip is the roll. A small hop keeps it off the ground; it lands where the hero is.
        const u = (since - TUCK) / Math.max(0.05, len - TUCK);
        pose = tween({ clip: rig.dash, t: from + (land - from) * u });
        lift = Math.sin(Math.min(1, u) * Math.PI) * 10;
        stretch = 0.88 + 0.12 * smooth(Math.min(1, u * 4));
      } else {
        const u = Math.min(1, (since - len) / Math.max(0.05, rig.times.rise));
        pose = tween({ clip: rig.dash, t: land + (1 - land) * u });
      }
      break;
    }
    case 'land':
      pose = fade({ clip: rig.dash, t: 1 }, walk, a.w);
      break;
    case 'hurt': {
      // A jolt, not a fall: the body stays itself, on its feet, rocks back a little and twists away. The red
      // flash carries the hit. Folding into the death pose at half height read as the hero dying for a frame.
      const k = Math.sin(a.k * Math.PI);
      pose = fade(walk, { clip: rig.die, t: 0.12 }, 0.3 * k);
      stretch = 1 - 0.08 * k;
      pitch = -0.18 * k;
      break;
    }
    case 'cast':
    case 'strike': {
      const k = a.k;
      // The clip swings the weapon. The body stays on its feet: a crouch and a lean are the
      // windup, and nothing here may shove the model. ox and oy stay 0, so the hitbox and the
      // camera, which follow the gameplay position, do not move because the hero attacked.
      // The dip eases in and out, so the body never jumps between heights from one frame to the next.
      let dip: number;
      if (k < 0.31) {
        const u = k / 0.31;
        dip = smooth(u);
        const wind = a.kind === 'cast' ? APEX * 0.4 : 0.12;
        pose = fade(walk, { clip: rig.strike, t: wind }, u);
      } else if (k < 0.78) {
        const u = (k - 0.31) / 0.47;
        dip = 1 - smooth(u);
        if (a.kind === 'cast') pose = tween({ clip: rig.strike, t: APEX });
        else pose = tween({ clip: rig.strike, t: 0.2 + 0.62 * u });
      } else {
        const u = (k - 0.78) / 0.22;
        dip = 0;
        const held = a.kind === 'cast' ? APEX : 0.86;
        pose = fade({ clip: rig.strike, t: held }, walk, u);
      }
      stretch = 1 - (1 - CROUCH) * dip;
      lift = -6 * dip;
      pitch = ATTACK_LEAN * dip;
      wide = 1 + 0.06 * dip;
      break;
    }
    case 'cross':
      pose = fade(m.clip === 'run' ? idle(a.at) : run(a.stride), walk, a.w);
      break;
    case 'gait':
      pose = tween(walk);
      break;
  }
  const flinch = a.kind === 'hurt' ? Math.sin(a.k * Math.PI) * 0.25 : 0;
  // The body is always drawn on the hero's own position: ox and oy are kept for the stage's signature only.
  // Face the swing: the blade goes where the weapon aimed, which need not be where the hero walks. The body turns
  // to the aim while the arm is still coming up, holds it through the blow and the let-go, and turns back only once
  // the weapon is down. Turning back with the blade still out swept it across the body and read as a second swing.
  const since = (m.now - Math.max(m.strikeAt, m.castAt)) / SWING;
  const back = (since - 1) * (SWING / AIM_BACK);
  const facing = a.kind === 'dash' || a.kind === 'land' || a.kind === 'dead' ? 0 : since < 0 ? 0 : since < AIM_IN ? smooth(since / AIM_IN) : since < 1 ? 1 : back < 1 ? 1 - smooth(back) : 0;
  return { pose, yaw: turn(m.yaw, m.aim, facing) + flinch, lift, stretch, ox: 0, oy: 0, pitch, wide };
}

/** Frames in each of the flat hero's sheet animations. Strike frames share their leg poses with idle and run. */
export interface HeroSheet {
  readonly idle: number;
  readonly run: number;
  readonly strike: number;
  readonly runStrike: number;
}

/** What the flat sprite may change: which frame, how it leans, and where it sits. There is no scale to squash. */
export interface HeroSprite {
  readonly anim: keyof HeroSheet;
  readonly index: number;
  readonly rotation: number;
  readonly dx: number;
  readonly dy: number;
}

/** Seconds per idle cycle on the sheet. */
const FLAT_IDLE = 6 / 7;
/** The strongest lean into a start or back from a stop. */
const LEAN = 0.1;
/** A rush leans into the dash. */
const RUSH_LEAN = 0.22;

/**
 * The flat hero, from the same act as the stage. `facing` is the sprite's side, `height` its drawn height, which
 * places the middle of the body a roll turns about.
 */
export function heroSprite(times: HeroTimes, sheet: HeroSheet, m: HeroMotion, facing: 1 | -1, height: number): HeroSprite {
  const a = heroAct(times, m);
  const at = (frames: number, cycles: number) => Math.floor((cycles - Math.floor(cycles)) * frames) % frames;
  const walk: keyof HeroSheet = m.clip === 'run' ? 'run' : 'idle';
  const index = m.clip === 'run' ? at(sheet.run, m.stride) : at(sheet.idle, m.now / FLAT_IDLE);
  const still = { anim: walk, index, rotation: 0, dx: 0, dy: 0 };
  switch (a.kind) {
    case 'dead':
      // The body topples about its feet, slowly at first, as the old defeat tween did.
      return { ...still, rotation: facing * (Math.PI / 2) * Math.min(1, a.k) ** 2 };
    case 'dash': {
      if (a.style === 'rush') {
        const k = a.since / a.len;
        if (a.since >= a.len) return { anim: 'run', index, rotation: RUSH_LEAN * 0.4 * facing, dx: 8 * facing, dy: 4 };
        if (k < 0.34) return { anim: 'run', index: 2 % sheet.run, rotation: 0.7 * facing, dx: -6 * facing, dy: 18 };
        return { anim: 'run', index: 8 % sheet.run, rotation: -0.15 * facing, dx: 16 * facing, dy: -22 };
      }
      if (a.since < 0.09) return { anim: 'run', index: 1 % sheet.run, rotation: 0.45 * facing, dx: -4 * facing, dy: 16 };
      if (a.since >= a.len) return still;
      // Legs gathered, one full turn about the middle of the body, a little off the ground.
      const k = a.since / a.len;
      const turn = facing * Math.PI * 2 * smooth(k);
      const middle = height * 0.29;
      return {
        anim: 'run',
        index: Math.round(sheet.run / 4) % sheet.run,
        rotation: turn,
        dx: -middle * Math.sin(turn),
        dy: middle * (Math.cos(turn) - 1) - Math.sin(Math.PI * k) * 12,
      };
    }
    case 'land':
      return { ...still, rotation: a.style === 'rush' ? RUSH_LEAN * facing * (1 - a.w) : 0 };
    case 'hurt':
      return { ...still, rotation: facing * 0.3 * Math.sin(a.k * Math.PI), dy: 4 * Math.sin(a.k * Math.PI), dx: -6 * facing * Math.sin(a.k * Math.PI) };
    case 'strike':
    case 'cast': {
      const k = a.k;
      const swung = m.clip === 'run' ? 'runStrike' : 'strike';
      const n = swung === 'runStrike' ? sheet.runStrike : sheet.strike;
      // The lean and the crouch are the swing. dx stays 0 so the sprite is not slid off its feet.
      if (k < 0.28) return { anim: walk, index, rotation: -1.05 * facing, dx: 0, dy: 26 };
      if (k < 0.7) return { anim: swung, index: at(n, m.clip === 'run' ? m.stride : 0.5), rotation: 0.55 * facing, dx: 0, dy: 0 };
      return { ...still, rotation: 0.2 * facing * (1 - k) };
    }
    case 'cross':
    case 'gait': {
      // Into a start the body leans the way it goes; out of a stop it rocks back. Both are gone once the gait settles.
      const lean = 4 * LEAN * m.gait * (1 - m.gait) * (m.going ? 1 : -1);
      return { ...still, rotation: lean * facing };
    }
  }
}

// ---- enemies ----------------------------------------------------------------

export type Tier = 'horde' | 'elite' | 'boss';

/** A fixed 0..1 from a body's uid, so each body keeps its own quirks for life. */
function hash(uid: number, salt: number): number {
  let h = Math.imul(uid ^ Math.imul(salt, 0x27d4eb2d), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** A body's walk, fixed at spawn. */
export interface Walk {
  /** Cycles a second at the def's own speed: its sheet's move frames at def.fps. */
  readonly base: number;
  /** Ground one cycle covers at that speed. A bigger body strides longer. */
  readonly stride: number;
  /** This body's own rate, 0.88..1.12. */
  readonly tempo: number;
  readonly flying: boolean;
}

export function walkOf(def: { readonly speed: number; readonly fps: number; readonly flying?: boolean }, moveFrames: number, size: number, uid: number): Walk {
  const base = def.fps / Math.max(1, moveFrames);
  return { base, stride: (def.speed / base) * size, tempo: 0.88 + 0.24 * hash(uid, 1), flying: !!def.flying };
}

/** Where a fresh body starts its walk cycle. */
export function gaitSeed(uid: number): number {
  return hash(uid, 2);
}

/**
 * Advance a walk cycle. `speed` is how fast the body goes under its own legs: after the crowd's push, before
 * knockback, so a pushed or slowed body falls out of step with its neighbours.
 */
export function stepGait(gait: number, walk: Walk, speed: number, slow: number, dt: Seconds): number {
  // Wings beat whether or not the body gains ground. A pinned body still shuffles; past about three times its
  // walk, a lunge or a shove is no longer legs.
  const rate = walk.flying ? walk.base * (1 - slow * 0.6) : Math.min(3.2 * walk.base, Math.max(0.35 * walk.base, speed / walk.stride));
  return gait + rate * walk.tempo * dt;
}

/** How one AI animation plays on a body where it is not simply the sheet frames and clip of that name. */
export interface Act {
  /** The animation shown instead, on the sheet and the model alike. */
  readonly anim: string;
  /** The AI's window shows the part before the split (a tell) or from it on (the blow). */
  readonly part: 'tell' | 'release';
  /** The split as a fraction of the model clip... */
  readonly model: number;
  /** ...and of the sheet's frames. */
  readonly sheet: number;
}

function span(frames: number, act: Act | null): { readonly first: number; readonly count: number } {
  if (!act) return { first: 0, count: frames };
  const cut = Math.round(frames * act.sheet);
  return act.part === 'tell' ? { first: 0, count: cut } : { first: cut, count: frames - cut };
}

/**
 * How far through a one-shot, 0..1: its own sheet frames at the AI's rate. Both renderers read this one number, so a
 * tell's last sheet frame and its model split land together, and a boss tell ends on its last frame as the hit starts.
 */
export function onceProgress(animT: Seconds, fps: number, frames: number, act: Act | null): number {
  return Math.min(1, (animT * fps) / Math.max(1, span(frames, act).count));
}

/** The model clip point of a one-shot. */
export function onceT(act: Act | null, p: number): number {
  if (!act) return p;
  return act.part === 'tell' ? act.model * p : act.model + (1 - act.model) * p;
}

/** The sheet frame of a one-shot, as an index into its frames. */
export function onceFrame(frames: number, act: Act | null, p: number): number {
  const { first, count } = span(frames, act);
  return first + Math.max(0, Math.min(count - 1, Math.floor(p * count)));
}

/** Seconds a contact swing takes to let go once its blow has played. */
const LET_GO = 0.14;

export interface Swing {
  /** How far through the blow, 0..1. */
  readonly p: number;
  readonly w: number;
}

/** Seconds an act's part of a clip takes at the clip's own speed. */
export function clipBlow(act: Act, clip: Clip): Seconds {
  return (act.part === 'tell' ? act.model : 1 - act.model) * clip.dur;
}

/** Seconds an act's part of the sheet takes at the sheet's own rate. */
export function sheetBlow(act: Act, frames: number, fps: number): Seconds {
  return span(frames, act).count / fps;
}

/**
 * A blow on contact, timed by the contact cooldown gameplay already keeps: the blow plays `blow` seconds from the
 * moment of contact, then lets go as the cooldown runs out.
 */
export function contactSwing(blow: Seconds, since: Seconds, left: Seconds): Swing | null {
  if (left <= 0) return null;
  return { p: Math.min(1, since / Math.max(1e-3, blow)), w: Math.min(1, left / LET_GO) };
}

/** A clip laid over the walk at a weight. */
export interface Layer {
  readonly s: Sample;
  readonly w: number;
}

/** Footfall weight for big bodies, as a share of drawn height. */
const BOB: Readonly<Record<Exclude<Tier, 'horde'>, number>> = { elite: 0.015, boss: 0.025 };

/** What enemyLook needs from a body's model. */
export interface EnemyBody {
  readonly mask: Mask | null;
  /** The walk clip's first footfall. A big body sinks onto each one; a body without one does not bob. */
  readonly step: number | undefined;
  readonly height: number;
}

export interface EnemyLook {
  readonly anim: Pose | Row;
  /** Drawn only. Never written to the body's own lift, which gameplay reads. */
  readonly lift: number;
}

/** How an enemy is drawn. A horde body is one row, so a crowd never costs a second bone fetch. */
export function enemyLook(tier: Tier, s: Sample, top: Layer | null, walking: boolean, body: EnemyBody): EnemyLook {
  if (tier === 'horde') return { anim: nearest(top && top.w >= 0.5 ? top.s : s), lift: 0 };
  const bob = walking && body.step !== undefined ? BOB[tier] * body.height * Math.sin(2 * Math.PI * (s.t - body.step)) ** 2 : 0;
  const anim = top ? (body.mask ? overlay(body.mask, s, top.s, top.w) : fade(s, top.s, top.w)) : tween(s);
  return { anim, lift: bob };
}

const YAW_RATE: Readonly<Record<Tier, number>> = { horde: 9, elite: 6, boss: 4 };

/**
 * One step of an enemy's facing. An aimed tell turns at the horde's rate so it points where it will strike.
 * Walking, a big body comes round slower, and a horde body keeps a small offset of its own so a ring of them
 * does not face the hero in lockstep.
 */
export function yawStep(yaw: number, aim: number, tier: Tier, aiming: boolean, uid: number, dt: Seconds): number {
  if (aiming) return turn(yaw, aim, dt * 9);
  const bias = tier === 'horde' ? (hash(uid, 3) - 0.5) * 0.24 : 0;
  return turn(yaw, aim + bias, dt * YAW_RATE[tier]);
}

// ---- bodies left behind -----------------------------------------------------

/** Seconds a fallen body lies still, then seconds it takes to go. A bigger foe stays to be seen. */
const LIE: Readonly<Record<Tier, Seconds>> = { horde: 1.6, elite: 1.9, boss: 2.2 };
const FADE: Readonly<Record<Tier, Seconds>> = { horde: 0.3, elite: 0.45, boss: 0.7 };

export interface Corpse {
  readonly anim: Pose | Row;
  /** How far through the die clip, 0..1. */
  readonly phase: number;
  readonly alpha: number;
  readonly yaw: number;
  readonly lift: number;
  readonly stretch: number;
  /** Drawn offset along the ground. It is not where the body died. */
  readonly ox: number;
  readonly oy: number;
  /** Tip toward the ground, in radians. A corpse past about 1.05 lies flat. */
  readonly pitch: number;
}

/** A fall that takes `fall` seconds, a short lie, then the fade. Null once gone. */
function laid(fall: Seconds, age: Seconds, tier: Tier): { readonly phase: number; readonly alpha: number } | null {
  const going = (age - fall - LIE[tier]) / FADE[tier];
  if (going >= 1) return null;
  return { phase: Math.min(1, age / fall), alpha: 1 - Math.max(0, going) };
}

/**
 * A body `age` seconds after it died. It plays its own die clip through, where it is, and lies in the clip's last
 * pose: the clips already fall to the ground, so nothing here tips, slides or throws the mesh. Seed 0 is the plain
 * fall; any other seed falls at its own pace and lands a little turned, so a pack does not drop in step.
 */
export function corpse(die: Clip, age: Seconds, tier: Tier, seed = 0): Corpse | null {
  const tempo = seed ? 0.88 + 0.24 * hash(seed, 6) : 1;
  const left = laid(die.dur / tempo, age, tier);
  if (!left) return null;
  const s = { clip: die, t: left.phase };
  const twist = seed ? (hash(seed, 5) - 0.5) * 0.5 * smooth(left.phase) : 0;
  return { anim: tier === 'horde' ? nearest(s) : tween(s), phase: left.phase, alpha: left.alpha, yaw: twist, lift: 0, stretch: 1, ox: 0, oy: 0, pitch: 0 };
}

/** Seconds a flat body takes to go over. The sheets have no fall, so the sprite turns about its feet. */
const TOPPLE: Seconds = 0.3;

export interface Topple {
  /** 0 standing to 1 on the ground, gathering speed as it goes. */
  readonly turn: number;
  readonly alpha: number;
}

/** A flat body `age` seconds after it died, on the same lie and fade as a corpse on the stage. */
export function topple(age: Seconds, tier: Tier, seed = 0): Topple | null {
  const span = seed ? TOPPLE * (0.75 + hash(seed, 8) * 0.5) : TOPPLE;
  const left = laid(span, age, tier);
  return left && { turn: left.phase * left.phase, alpha: left.alpha };
}
