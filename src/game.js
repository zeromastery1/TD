import * as THREE from 'three';
import {
  GRID, ROUTE, GEMS_PER_ROUND, START_LIVES, TOTAL_WAVES, TIERS, TIER_MULT, MAX_TIER,
  PROSPECT_TABLE, prospectCost, CLEAR_STONE_COST, SHARDS, SHARD_KEYS, RELICS,
  RELIC_EMPOWER_MAX, relicEmpowerCost, RELIC_EMPOWER_MULT, waveInfo, waveClearBonus, armorFactor,
} from './config.js';
import { computeRoute, isRouteCell } from './path.js';

// Game state and rules. Positions are in cell units with the board's centre at 0,0;
// the renderer (view.js) reads this state every frame and turns `events` into effects.

const HALF = (GRID - 1) / 2;
export const cellPos = (x, z) => new THREE.Vector3(x - HALF, 0, z - HALF);

let nextId = 1;

export class Game {
  constructor(onChange) {
    this.onChange = onChange; // UI refresh callback
    this.cells = new Array(GRID * GRID).fill(null);
    this.towers = [];
    this.creeps = [];
    this.projectiles = [];
    this.events = [];
    this.candidates = [];
    this.lives = START_LIVES;
    this.gold = 0;
    this.prospect = 0;
    this.wave = 1;
    this.phase = 'build'; // build | choose | wave | over | won
    this.speed = 1;
    this.selected = null;
    this.message = '';
    this.spawn = null;
    this.kills = 0;
    this.time = 0;
    this.eclipses = [];
    this.updateRoute();
  }

  // ---------- Grid helpers ----------
  at(x, z) { return this.cells[z * GRID + x]; }
  set(x, z, t) { this.cells[z * GRID + x] = t; }
  emit(type, data) { this.events.push({ type, ...data }); }

  canPlace(x, z) {
    if (this.phase !== 'build') return { ok: false, why: 'Not the building phase.' };
    if (this.at(x, z)) return { ok: false, why: 'Cell is occupied.' };
    if (isRouteCell(x, z)) return { ok: false, why: 'Cannot build on a waypoint.' };
    const route = computeRoute((cx, cz) => (cx === x && cz === z) || !!this.at(cx, cz));
    if (!route) return { ok: false, why: 'That would seal the path.' };
    return { ok: true };
  }

  updateRoute() {
    this.route = computeRoute((x, z) => !!this.at(x, z));
    this.routeWorld = this.route.map((c) => cellPos(c.x, c.z));
    this.routeLen = this.routeWorld.length - 1;
    this.flyWorld = ROUTE.map((r) => cellPos(r.x, r.z));
    this.flyLen = 0;
    for (let i = 1; i < this.flyWorld.length; i++) this.flyLen += this.flyWorld[i].distanceTo(this.flyWorld[i - 1]);
    this.routeVersion = (this.routeVersion || 0) + 1;
  }

  // ---------- Building ----------
  rollTier() {
    const table = PROSPECT_TABLE[this.prospect];
    let r = Math.random() * 100;
    for (let i = 0; i < table.length; i++) {
      r -= table[i];
      if (r < 0) return i;
    }
    return 0;
  }

  place(x, z) {
    const chk = this.canPlace(x, z);
    if (!chk.ok) { this.flash(chk.why); return false; }
    const type = SHARD_KEYS[(Math.random() * SHARD_KEYS.length) | 0];
    const t = this.addTower('shard', type, this.rollTier(), x, z);
    t.candidate = true;
    this.candidates.push(t);
    this.updateRoute();
    this.emit('place', { t });
    if (this.candidates.length >= GEMS_PER_ROUND) {
      this.phase = 'choose';
      this.flash('Choose one shard to keep. The rest turn to stone.');
    }
    this.select(t);
    return true;
  }

  addTower(kind, type, tier, x, z) {
    const t = {
      id: nextId++, kind, type, tier, x, z, cd: 0, empower: 0, kills: 0, dealt: 0,
      candidate: false, born: this.time, pulse: 0, seed: Math.random(),
    };
    t.pos = cellPos(x, z);
    this.towers.push(t);
    this.set(x, z, t);
    this.recalcAuras();
    return t;
  }

  toStone(t) {
    t.kind = 'stone';
    t.type = null;
    t.tier = 0;
    t.born = this.time;
    this.emit('stone', { t });
  }

  removeTower(t) {
    this.set(t.x, t.z, null);
    this.towers.splice(this.towers.indexOf(t), 1);
    if (this.selected === t) this.select(null);
    this.emit('clear', { t });
    this.recalcAuras();
  }

  // Resolve the round: `keep` stays a tower, every other candidate becomes stone.
  finishRound(keep) {
    for (const c of this.candidates) {
      c.candidate = false;
      if (c !== keep && c.kind === 'shard') this.toStone(c);
    }
    this.candidates = [];
    this.recalcAuras();
    this.startWave();
  }

  sameCandidates(t) {
    return this.candidates.filter((c) => c.kind === 'shard' && c.type === t.type && c.tier === t.tier);
  }

  actionsFor(t) {
    const acts = [];
    if (!t) return acts;
    if (this.phase === 'choose' && t.candidate) {
      acts.push({ id: 'keep', label: 'Keep', hint: 'Keep this shard; the others become stone.', key: 'K' });
      const same = this.sameCandidates(t).length;
      if (t.tier < MAX_TIER && same >= 2) acts.push({ id: 'combine1', label: `Combine → ${TIERS[t.tier + 1]}`, hint: 'Fuse two matching shards into the next quality.', key: 'C', accent: true });
      if (t.tier + 1 < MAX_TIER && same >= 4) acts.push({ id: 'combine2', label: `Combine ×4 → ${TIERS[t.tier + 2]}`, hint: 'Fuse four matching shards, jumping two qualities.', key: 'V', accent: true });
    }
    if (t.kind === 'shard' && (this.phase !== 'build' || !t.candidate)) {
      for (const key of Object.keys(RELICS)) {
        if (this.recipePlan(key, t)) acts.push({ id: 'relic:' + key, label: `Forge ${RELICS[key].name}`, hint: RELICS[key].blurb, accent: true, relic: true });
      }
    }
    if (t.kind === 'relic' && t.empower < RELIC_EMPOWER_MAX) {
      const cost = relicEmpowerCost(t.empower);
      acts.push({ id: 'empower', label: `Empower (${cost}g)`, hint: `Multiply damage by ${RELIC_EMPOWER_MULT}.`, disabled: this.gold < cost });
    }
    if (t.kind === 'stone' && (this.phase === 'build' || this.phase === 'choose')) {
      acts.push({ id: 'clear', label: `Clear stone (${CLEAR_STONE_COST}g)`, hint: 'Remove this stone from the maze.', disabled: this.gold < CLEAR_STONE_COST });
    }
    return acts;
  }

  doAction(id) {
    const t = this.selected;
    if (!t) return;
    if (id === 'keep' && this.phase === 'choose' && t.candidate) {
      this.emit('keep', { t });
      this.finishRound(t);
    } else if ((id === 'combine1' || id === 'combine2') && this.phase === 'choose' && t.candidate) {
      const steps = id === 'combine1' ? 1 : 2;
      if (this.sameCandidates(t).length < steps * 2 || t.tier + steps > MAX_TIER) return;
      t.tier += steps;
      t.born = this.time;
      this.emit('combine', { t });
      this.flash(`Fused into a ${TIERS[t.tier]} ${SHARDS[t.type].name} shard!`);
      this.finishRound(t);
    } else if (id.startsWith('relic:')) {
      this.forgeRelic(id.slice(6), t);
    } else if (id === 'empower' && t.kind === 'relic') {
      const cost = relicEmpowerCost(t.empower);
      if (this.gold < cost || t.empower >= RELIC_EMPOWER_MAX) return;
      this.gold -= cost;
      t.empower++;
      this.emit('empower', { t });
    } else if (id === 'clear' && t.kind === 'stone') {
      if (this.gold < CLEAR_STONE_COST) return;
      this.gold -= CLEAR_STONE_COST;
      this.removeTower(t);
      this.updateRoute();
    }
    this.onChange();
  }

  // Find towers that satisfy a recipe, always including `t`. Returns the list or null.
  recipePlan(key, t) {
    const needs = RELICS[key].needs;
    const pool = this.towers.filter((o) => o.kind === 'shard' && (!o.candidate || this.phase === 'choose'));
    if (!needs.some(([type, tier]) => type === t.type && tier === t.tier)) return null;
    const used = new Set([t]);
    let selfUsed = false;
    for (const [type, tier] of needs) {
      if (!selfUsed && type === t.type && tier === t.tier) { selfUsed = true; continue; }
      // Prefer candidates (they would turn to stone anyway), then kept shards.
      const options = pool.filter((o) => !used.has(o) && o.type === type && o.tier === tier)
        .sort((a, b) => (b.candidate ? 1 : 0) - (a.candidate ? 1 : 0));
      if (!options.length) return null;
      used.add(options[0]);
    }
    return [...used];
  }

  forgeRelic(key, t) {
    const plan = this.recipePlan(key, t);
    if (!plan) return;
    const usedCandidate = plan.some((o) => o.candidate);
    for (const o of plan) if (o !== t) { this.emit('feed', { from: o, to: t }); this.toStone(o); }
    t.kind = 'relic';
    t.type = key;
    t.tier = 0;
    t.empower = 0;
    t.born = this.time;
    this.emit('forge', { t });
    this.flash(`${RELICS[key].name} forged!`);
    if (usedCandidate || t.candidate) this.finishRound(t);
    else this.recalcAuras();
    this.select(t);
  }

  upgradeProspect() {
    if (this.prospect >= PROSPECT_TABLE.length - 1) return;
    const cost = prospectCost(this.prospect);
    if (this.gold < cost) return;
    this.gold -= cost;
    this.prospect++;
    this.onChange();
  }

  select(t) {
    this.selected = t;
    this.onChange();
  }

  colorOf(t) {
    if (t.kind === 'relic') return RELICS[t.type].color;
    if (t.kind === 'shard') return SHARDS[t.type].color;
    return 0xaaaaaa;
  }

  // ---------- Stats ----------
  stats(t) {
    if (t.kind === 'shard') {
      const d = SHARDS[t.type];
      const m = TIER_MULT[t.tier];
      const tier = t.tier;
      return {
        damage: d.damage * m,
        cooldown: d.cooldown,
        range: d.range + tier * 0.2,
        splash: d.splash ? d.splash + tier * 0.1 : 0,
        splashFrac: 0.6,
        slow: d.slow ? Math.min(0.6, d.slow + d.slowPerTier * tier) : 0,
        slowTime: d.slowTime || 0,
        poison: d.poison ? d.poison * m : 0,
        poisonTime: d.poisonTime || 0,
        chains: d.chains ? d.chains + Math.floor(tier / 2) : 0,
        multi: d.multi ? d.multi + Math.floor(tier / 2) : 1,
        shred: d.shred ? d.shred + d.shredPerTier * tier : 0,
        shredTime: d.shredTime || 0,
        crit: d.crit ? d.crit + 0.03 * tier : 0,
        critMult: d.critMult ? d.critMult + 0.25 * tier : 1,
        aura: d.aura ? d.aura + d.auraPerTier * tier : 0,
        auraRange: d.auraRange || 0,
        color: d.color,
        family: t.type,
        power: 1 + tier * 0.25,
      };
    }
    if (t.kind === 'relic') {
      const d = RELICS[t.type];
      const m = Math.pow(RELIC_EMPOWER_MULT, t.empower);
      return {
        damage: d.damage * m,
        cooldown: d.cooldown,
        range: d.range,
        splash: d.splash || 0,
        splashFrac: 1,
        slow: d.slow || 0, slowTime: d.slowTime || 0,
        poison: (d.poison || 0) * m, poisonTime: d.poisonTime || 0,
        burn: (d.burn || 0) * m, burnTime: d.burnTime || 0,
        chains: d.chains || 0,
        multi: d.multi || 1,
        shred: d.shred || 0, shredTime: d.shredTime || 0,
        crit: d.crit || 0, critMult: d.critMult || 1,
        shredAura: d.shredAura || 0,
        color: d.color,
        family: t.type,
        power: 2.2 + t.empower * 0.4,
        splashPoison: t.type === 'plague',
      };
    }
    return null;
  }

  recalcAuras() {
    const halos = this.towers.filter((t) => t.kind === 'shard' && t.type === 'halo');
    for (const t of this.towers) {
      let bonus = 0;
      for (const h of halos) {
        if (h === t) continue;
        const st = this.stats(h);
        if (Math.hypot(h.x - t.x, h.z - t.z) <= st.auraRange) bonus += st.aura;
      }
      t.haste = Math.min(1, bonus);
    }
    this.eclipses = this.towers.filter((t) => t.kind === 'relic' && RELICS[t.type].shredAura);
  }

  // ---------- Waves ----------
  startWave() {
    const info = waveInfo(this.wave);
    this.phase = 'wave';
    this.spawn = { info, left: info.count, timer: 0 };
    this.flash(`Wave ${this.wave}: ${info.count} × ${info.name}${info.def.flying ? ' (flying)' : ''}`);
    this.emit('wave', { info });
    this.onChange();
  }

  spawnCreep(info) {
    const def = info.def;
    const c = {
      id: nextId++, type: info.type, def, hp: info.hp, maxHp: info.hp, armor: info.armor, speed: info.speed,
      bounty: info.bounty, flying: !!def.flying, lives: def.lives || 1, boss: info.type === 'boss',
      model: info.model, name: info.name, wave: this.wave,
      seg: 0, traveled: 0, dots: new Map(), slowUntil: 0, slowAmt: 0, shredUntil: 0, shredAmt: 0, alive: true,
      hitFlash: 0, heading: Math.PI / 2, progress: 0, born: this.time,
    };
    c.pos = (c.flying ? this.flyWorld[0] : this.routeWorld[0]).clone();
    this.creeps.push(c);
  }

  waveDone() {
    const bonus = waveClearBonus(this.wave);
    this.gold += bonus;
    if (this.wave >= TOTAL_WAVES) {
      this.phase = 'won';
      this.flash('Victory! Every wave has been repelled.');
    } else {
      this.wave++;
      this.phase = 'build';
      this.flash(`Wave cleared! +${bonus} gold. Place ${GEMS_PER_ROUND} new shards.`);
    }
    this.onChange();
  }

  // ---------- Simulation ----------
  update(rawDt) {
    const dt = Math.min(rawDt, 0.05) * (this.phase === 'over' || this.phase === 'won' ? 0 : this.speed);
    this.dt = dt;
    if (dt === 0) return;
    this.time += dt;

    if (this.phase === 'wave' && this.spawn) {
      const sp = this.spawn;
      sp.timer -= dt;
      while (sp.left > 0 && sp.timer <= 0) {
        this.spawnCreep(sp.info);
        sp.left--;
        sp.timer += sp.info.interval;
      }
    }

    this.updateCreeps(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);

    if (this.phase === 'wave' && this.spawn && this.spawn.left === 0 && this.creeps.length === 0) {
      this.spawn = null;
      this.waveDone();
    }
  }

  creepArmor(c) {
    let a = c.armor;
    if (this.time < c.shredUntil) a -= c.shredAmt;
    for (const e of this.eclipses) {
      const st = RELICS[e.type];
      if (c.pos.distanceTo(e.pos) <= st.range) { a -= st.shredAura; break; }
    }
    return a;
  }

  updateCreeps(dt) {
    const now = this.time;
    for (const c of this.creeps) {
      if (!c.alive) continue;
      c.hitFlash = Math.max(0, c.hitFlash - dt * 6);
      for (const [k, d] of c.dots) {
        if (now > d.until) { c.dots.delete(k); continue; }
        this.damage(c, d.dps * dt, d.src, true);
        if (!c.alive) break;
      }
      if (!c.alive) continue;
      if (c.def.regen) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * c.def.regen * dt);

      const slow = now < c.slowUntil ? c.slowAmt : 0;
      let move = c.speed * (1 - slow) * dt;
      c.pace = c.speed * (1 - slow);
      const pts = c.flying ? this.flyWorld : this.routeWorld;
      while (move > 0 && c.seg < pts.length - 1) {
        const target = pts[c.seg + 1];
        const dx = target.x - c.pos.x, dz = target.z - c.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-6) { c.seg++; continue; }
        c.heading = Math.atan2(dx, dz);
        if (dist <= move) {
          c.pos.x = target.x; c.pos.z = target.z;
          move -= dist; c.traveled += dist;
          c.seg++;
        } else {
          c.pos.x += (dx / dist) * move; c.pos.z += (dz / dist) * move;
          c.traveled += move;
          move = 0;
        }
      }
      if (c.seg >= pts.length - 1) {
        c.alive = false;
        c.leaked = true;
        this.lives -= c.lives;
        this.emit('leak', { c });
        this.flash(`A ${c.name} slipped through! -${c.lives} ${c.lives > 1 ? 'lives' : 'life'}`);
        if (this.lives <= 0) {
          this.lives = 0;
          this.phase = 'over';
        }
        this.onChange();
      }
      c.progress = c.traveled / (c.flying ? this.flyLen : this.routeLen);
    }
    this.creeps = this.creeps.filter((c) => c.alive);
  }

  damage(c, amount, src, ignoreArmor = false) {
    if (!c.alive) return;
    const dmg = ignoreArmor ? amount : amount * armorFactor(this.creepArmor(c));
    c.hp -= dmg;
    if (!ignoreArmor) c.hitFlash = 1;
    if (src) src.dealt += dmg;
    if (c.hp <= 0) {
      c.alive = false;
      this.gold += c.bounty;
      this.kills++;
      if (src) src.kills++;
      this.emit('death', { c });
      this.onChange();
    }
  }

  updateTowers(dt) {
    for (const t of this.towers) {
      if (t.kind === 'stone') continue;
      t.pulse = Math.max(0, t.pulse - dt * 4);
      t.cd -= dt * (1 + (t.haste || 0));
      if (t.cd > 0) continue;
      const st = this.stats(t);
      const targets = this.findTargets(t.pos, st.range, st.multi);
      if (!targets.length) { t.cd = 0; continue; }
      t.cd = st.cooldown;
      t.pulse = 1;
      t.aim = Math.atan2(targets[0].pos.x - t.pos.x, targets[0].pos.z - t.pos.z);
      if (st.chains) this.chainLightning(t, st, targets[0]);
      else for (const target of targets) this.fire(t, st, target);
    }
  }

  findTargets(pos, range, n) {
    const inRange = [];
    for (const c of this.creeps) {
      if (!c.alive) continue;
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
      if (dx * dx + dz * dz <= range * range) inRange.push(c);
    }
    inRange.sort((a, b) => b.progress - a.progress);
    return inRange.slice(0, n);
  }

  fire(t, st, target) {
    const pos = t.pos.clone();
    pos.y = t.kind === 'relic' ? 1.5 : 1.0;
    this.projectiles.push({ pos, prev: pos.clone(), target, src: t, st, speed: 11, last: target.pos.clone(), age: 0 });
    this.emit('fire', { t, st });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.target.alive) p.last.set(p.target.pos.x, p.target.flying ? 1.0 : 0.5, p.target.pos.z);
      p.prev.copy(p.pos);
      const to = p.last.clone().sub(p.pos);
      const d = to.length();
      const step = p.speed * dt;
      if (d <= step) {
        this.hit(p.src, p.st, p.target.alive ? p.target : null, p.last.clone());
        this.projectiles.splice(i, 1);
      } else {
        p.pos.addScaledVector(to, step / d);
      }
    }
  }

  hit(t, st, target, point) {
    const now = this.time;
    let crit = false;
    if (target) {
      let dmg = st.damage;
      if (st.crit && Math.random() < st.crit) { dmg *= st.critMult; crit = true; }
      this.applyEffects(t, st, target, now);
      this.damage(target, dmg, t);
    }
    this.emit('hit', { t, st, point, target, crit });
    if (st.splash) {
      for (const c of this.creeps) {
        if (!c.alive || c === target) continue;
        if (Math.hypot(c.pos.x - point.x, c.pos.z - point.z) <= st.splash) {
          if (st.splashPoison) this.applyEffects(t, st, c, now);
          this.damage(c, st.damage * st.splashFrac, t);
        }
      }
    }
  }

  applyEffects(t, st, c, now) {
    if (st.slow && st.slow >= (now < c.slowUntil ? c.slowAmt : 0)) {
      c.slowAmt = st.slow;
      c.slowUntil = now + st.slowTime;
    }
    if (st.poison) c.dots.set(t.id + ':p', { dps: st.poison, until: now + st.poisonTime, src: t, kind: 'poison' });
    if (st.burn) c.dots.set(t.id + ':b', { dps: st.burn, until: now + st.burnTime, src: t, kind: 'burn' });
    if (st.shred && (now > c.shredUntil || st.shred >= c.shredAmt)) {
      c.shredAmt = st.shred;
      c.shredUntil = now + st.shredTime;
    }
  }

  chainLightning(t, st, first) {
    const hitSet = new Set();
    const pts = [{ x: t.pos.x, z: t.pos.z, h: t.kind === 'relic' ? 1.5 : 1.0 }];
    let cur = first;
    let dmg = st.damage;
    for (let i = 0; i <= st.chains && cur; i++) {
      hitSet.add(cur);
      pts.push({ x: cur.pos.x, z: cur.pos.z, h: cur.flying ? 1.0 : 0.5 });
      const point = cur.pos.clone();
      point.y = cur.flying ? 1.0 : 0.5;
      this.hit(t, { ...st, damage: dmg, chains: 0, chained: true }, cur, point);
      dmg *= 0.85;
      let best = null, bestD = 2.8;
      for (const c of this.creeps) {
        if (!c.alive || hitSet.has(c)) continue;
        const d = c.pos.distanceTo(cur.pos);
        if (d < bestD) { bestD = d; best = c; }
      }
      cur = best;
    }
    this.emit('chain', { t, st, pts });
  }

  flash(msg) {
    this.message = msg;
    this.messageTime = performance.now();
    this.onChange();
  }
}
