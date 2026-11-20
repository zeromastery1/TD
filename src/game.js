import * as THREE from 'three';
import {
  GRID, ROUTE, GEMS_PER_ROUND, START_LIVES, TOTAL_WAVES, TIERS, TIER_MULT, MAX_TIER,
  PROSPECT_TABLE, prospectCost, CLEAR_STONE_COST, SHARDS, SHARD_KEYS, RELICS,
  RELIC_EMPOWER_MAX, relicEmpowerCost, RELIC_EMPOWER_MULT, waveInfo, waveClearBonus, armorFactor,
} from './config.js';
import { computeRoute, isRouteCell } from './path.js';
import { cellToWorld } from './scene.js';

let nextId = 1;

export class Game {
  constructor(scene3d, onChange) {
    this.s = scene3d;
    this.onChange = onChange; // UI refresh callback
    this.cells = new Array(GRID * GRID).fill(null);
    this.towers = [];
    this.creeps = [];
    this.projectiles = [];
    this.effects = [];
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
    this.updateRoute();
  }

  // ---------- Grid helpers ----------
  at(x, z) { return this.cells[z * GRID + x]; }
  set(x, z, t) { this.cells[z * GRID + x] = t; }

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
    this.routeWorld = this.route.map((c) => cellToWorld(c.x, c.z));
    this.routeLen = this.routeWorld.length - 1;
    this.flyWorld = ROUTE.map((r) => cellToWorld(r.x, r.z));
    this.flyLen = 0;
    for (let i = 1; i < this.flyWorld.length; i++) this.flyLen += this.flyWorld[i].distanceTo(this.flyWorld[i - 1]);
    this.s.setRoute(this.route);
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
    t.marker = this.s.makeCandidateMarker();
    t.mesh.add(t.marker);
    this.candidates.push(t);
    this.updateRoute();
    if (this.candidates.length >= GEMS_PER_ROUND) {
      this.phase = 'choose';
      this.flash('Choose one shard to keep. The rest turn to stone.');
    }
    this.select(t);
    return true;
  }

  addTower(kind, type, tier, x, z) {
    const t = { id: nextId++, kind, type, tier, x, z, cd: 0, empower: 0, kills: 0, dealt: 0, candidate: false };
    t.pos = cellToWorld(x, z);
    t.mesh = this.makeMesh(t);
    t.mesh.position.copy(t.pos);
    this.s.scene.add(t.mesh);
    this.towers.push(t);
    this.set(x, z, t);
    this.recalcAuras();
    return t;
  }

  makeMesh(t) {
    if (t.kind === 'stone') return this.s.makeStoneMesh();
    if (t.kind === 'relic') return this.s.makeRelicMesh(t.type, t.empower);
    return this.s.makeShardMesh(t.type, t.tier);
  }

  rebuildMesh(t) {
    const wasSelected = this.selected === t;
    this.s.scene.remove(t.mesh);
    disposeTree(t.mesh);
    t.mesh = this.makeMesh(t);
    t.mesh.position.copy(t.pos);
    if (t.candidate && t.marker) {
      t.marker = this.s.makeCandidateMarker();
      t.mesh.add(t.marker);
    }
    this.s.scene.add(t.mesh);
    if (wasSelected) this.select(t);
  }

  toStone(t) {
    t.kind = 'stone';
    t.type = null;
    t.tier = 0;
    this.rebuildMesh(t);
  }

  removeTower(t) {
    this.s.scene.remove(t.mesh);
    disposeTree(t.mesh);
    this.set(t.x, t.z, null);
    this.towers.splice(this.towers.indexOf(t), 1);
    if (this.selected === t) this.select(null);
    this.recalcAuras();
  }

  // Resolve the round: `keep` stays a tower, every other candidate becomes stone.
  finishRound(keep) {
    for (const c of this.candidates) {
      c.candidate = false;
      if (c.marker) { c.mesh.remove(c.marker); c.marker = null; }
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
        const plan = this.recipePlan(key, t);
        if (plan) acts.push({ id: 'relic:' + key, label: `Forge ${RELICS[key].name}`, hint: RELICS[key].blurb, accent: true, relic: true });
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
      this.finishRound(t);
    } else if ((id === 'combine1' || id === 'combine2') && this.phase === 'choose' && t.candidate) {
      const steps = id === 'combine1' ? 1 : 2;
      if (this.sameCandidates(t).length < steps * 2 || t.tier + steps > MAX_TIER) return;
      t.tier += steps;
      this.rebuildMesh(t);
      this.effectBurst(t.pos, SHARDS[t.type].color, 1.4);
      this.flash(`Fused into a ${TIERS[t.tier]} ${SHARDS[t.type].name} shard!`);
      this.finishRound(t);
    } else if (id.startsWith('relic:')) {
      this.forgeRelic(id.slice(6), t);
    } else if (id === 'empower' && t.kind === 'relic') {
      const cost = relicEmpowerCost(t.empower);
      if (this.gold < cost || t.empower >= RELIC_EMPOWER_MAX) return;
      this.gold -= cost;
      t.empower++;
      this.rebuildMesh(t);
      this.effectBurst(t.pos, RELICS[t.type].color, 1.6);
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
    for (const o of plan) if (o !== t) this.toStone(o);
    t.kind = 'relic';
    t.type = key;
    t.tier = 0;
    t.empower = 0;
    this.rebuildMesh(t);
    this.effectBurst(t.pos, RELICS[key].color, 2.5);
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
    const s = this.s;
    if (!t) {
      s.selectRing.visible = false;
      s.showRange(0, 0, null);
    } else {
      s.selectRing.visible = true;
      s.selectRing.position.set(t.pos.x, 0.035, t.pos.z);
      const st = this.stats(t);
      const color = t.kind === 'relic' ? RELICS[t.type].color : t.kind === 'shard' ? SHARDS[t.type].color : 0;
      s.showRange(t.x, t.z, st ? st.range : null, color);
    }
    this.onChange();
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
    this.flash(`Wave ${this.wave}: ${info.count} × ${info.def.name}${info.def.flying ? ' (flying)' : ''}`);
    this.onChange();
  }

  spawnCreep(info) {
    const def = info.def;
    const mesh = this.s.makeCreepMesh(info.type, def.color, def.size);
    const c = {
      type: info.type, def, hp: info.hp, maxHp: info.hp, armor: info.armor, speed: info.speed,
      bounty: info.bounty, flying: !!def.flying, lives: def.lives || 1,
      seg: 0, traveled: 0, mesh, dots: new Map(), slowUntil: 0, slowAmt: 0, shredUntil: 0, shredAmt: 0, alive: true,
    };
    c.pos = (c.flying ? this.flyWorld[0] : this.routeWorld[0]).clone();
    c.pos.y = c.flying ? 1.3 : 0;
    mesh.position.copy(c.pos);
    this.s.scene.add(mesh);
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
    this.time += dt;
    this.animate(rawDt);
    if (dt === 0) return;

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
      // Damage over time
      for (const [k, d] of c.dots) {
        if (now > d.until) { c.dots.delete(k); continue; }
        this.damage(c, d.dps * dt, d.src, true);
        if (!c.alive) break;
      }
      if (!c.alive) continue;
      if (c.def.regen) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * c.def.regen * dt);

      const slow = now < c.slowUntil ? c.slowAmt : 0;
      let move = c.speed * (1 - slow) * dt;
      const pts = c.flying ? this.flyWorld : this.routeWorld;
      while (move > 0 && c.seg < pts.length - 1) {
        const target = pts[c.seg + 1];
        const dx = target.x - c.pos.x, dz = target.z - c.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= move) {
          c.pos.x = target.x; c.pos.z = target.z;
          move -= dist; c.traveled += dist;
          c.seg++;
        } else {
          c.pos.x += (dx / dist) * move; c.pos.z += (dz / dist) * move;
          c.traveled += move;
          c.heading = Math.atan2(dx, dz);
          move = 0;
        }
      }
      if (c.seg >= pts.length - 1) {
        c.alive = false;
        this.lives -= c.lives;
        this.flash(`A ${c.def.name} slipped through! -${c.lives} ${c.lives > 1 ? 'lives' : 'life'}`);
        if (this.lives <= 0) {
          this.lives = 0;
          this.phase = 'over';
        }
        this.onChange();
      }
      c.progress = c.traveled / (c.flying ? this.flyLen : this.routeLen);
    }
    // Remove dead creeps
    for (let i = this.creeps.length - 1; i >= 0; i--) {
      const c = this.creeps[i];
      if (!c.alive) {
        this.s.scene.remove(c.mesh);
        disposeTree(c.mesh);
        this.creeps.splice(i, 1);
      }
    }
  }

  damage(c, amount, src, ignoreArmor = false) {
    if (!c.alive) return;
    const dmg = ignoreArmor ? amount : amount * armorFactor(this.creepArmor(c));
    c.hp -= dmg;
    if (src) src.dealt += dmg;
    if (c.hp <= 0) {
      c.alive = false;
      this.gold += c.bounty;
      this.kills++;
      if (src) src.kills++;
      this.effectParticles(c.pos, c.def.color, c.type === 'boss' ? 24 : 8);
      this.onChange();
    }
  }

  updateTowers(dt) {
    for (const t of this.towers) {
      if (t.kind === 'stone') continue;
      t.cd -= dt * (1 + (t.haste || 0));
      if (t.cd > 0) continue;
      const st = this.stats(t);
      const targets = this.findTargets(t.pos, st.range, st.multi);
      if (!targets.length) { t.cd = 0; continue; }
      t.cd = st.cooldown;
      if (st.chains) {
        this.chainLightning(t, st, targets[0]);
      } else {
        for (const target of targets) this.fire(t, st, target);
      }
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
    const mesh = this.s.makeProjectile(st.color);
    const start = t.pos.clone();
    start.y = t.kind === 'relic' ? 0.95 : 0.6;
    mesh.position.copy(start);
    this.s.scene.add(mesh);
    this.projectiles.push({ mesh, target, src: t, st, speed: 14, last: target.pos.clone() });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.target.alive) p.last.copy(p.target.pos).setY(p.target.pos.y + (p.target.flying ? 0 : 0.35));
      const to = p.last.clone().sub(p.mesh.position);
      const d = to.length();
      const step = p.speed * dt;
      if (d <= step) {
        this.hit(p.src, p.st, p.target.alive ? p.target : null, p.last);
        this.s.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      } else {
        p.mesh.position.addScaledVector(to, step / d);
      }
    }
  }

  hit(t, st, target, point) {
    const now = this.time;
    if (target) {
      let dmg = st.damage;
      if (st.crit && Math.random() < st.crit) dmg *= st.critMult;
      this.applyEffects(t, st, target, now);
      this.damage(target, dmg, t);
    }
    if (st.splash) {
      this.effectBurst(point, st.color, st.splash);
      for (const c of this.creeps) {
        if (!c.alive || c === target) continue;
        if (c.pos.distanceTo(point) <= st.splash) {
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
    if (st.poison) c.dots.set(t.id + ':p', { dps: st.poison, until: now + st.poisonTime, src: t });
    if (st.burn) c.dots.set(t.id + ':b', { dps: st.burn, until: now + st.burnTime, src: t });
    if (st.shred && (now > c.shredUntil || st.shred >= c.shredAmt)) {
      c.shredAmt = st.shred;
      c.shredUntil = now + st.shredTime;
    }
  }

  chainLightning(t, st, first) {
    const hitSet = new Set();
    const start = t.pos.clone();
    start.y = t.kind === 'relic' ? 0.95 : 0.6;
    const pts = [start];
    let cur = first;
    let dmg = st.damage;
    for (let i = 0; i <= st.chains && cur; i++) {
      hitSet.add(cur);
      pts.push(cur.pos.clone().setY(cur.pos.y + 0.35));
      this.hit(t, { ...st, damage: dmg, chains: 0 }, cur, cur.pos.clone());
      dmg *= 0.85;
      let best = null, bestD = 2.8;
      for (const c of this.creeps) {
        if (!c.alive || hitSet.has(c)) continue;
        const d = c.pos.distanceTo(cur.pos);
        if (d < bestD) { bestD = d; best = c; }
      }
      cur = best;
    }
    const line = this.s.makeLightning(pts, st.color);
    this.s.scene.add(line);
    this.effects.push({ mesh: line, life: 0.18, max: 0.18, kind: 'fade' });
  }

  // ---------- Visual effects ----------
  effectBurst(pos, color, radius) {
    const m = this.s.makeBurst(color, radius);
    m.position.set(pos.x, 0.1, pos.z);
    this.s.scene.add(m);
    this.effects.push({ mesh: m, life: 0.35, max: 0.35, kind: 'burst', radius });
  }

  effectParticles(pos, color, n) {
    for (let i = 0; i < n; i++) {
      const m = this.s.makeParticle(color);
      m.position.copy(pos).setY(pos.y + 0.4);
      this.s.scene.add(m);
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4);
      this.effects.push({ mesh: m, life: 0.7, max: 0.7, kind: 'particle', v });
    }
  }

  animate(dt) {
    const t = performance.now() / 1000;
    for (const tw of this.towers) {
      const u = tw.mesh.userData;
      if (u.gem) {
        u.gem.rotation.y += dt * u.spin;
        u.gem.position.y = u.baseY + Math.sin(t * 2 + u.phase) * 0.05;
        u.pips.rotation.y -= dt * 1.5;
        u.pips.position.y = u.gem.position.y;
      }
      if (tw.marker) {
        const s = 1 + Math.sin(t * 5) * 0.08;
        tw.marker.scale.set(s, s, 1);
      }
    }
    for (const c of this.creeps) {
      c.mesh.position.copy(c.pos);
      const u = c.mesh.userData;
      if (c.flying) u.inner.position.y = Math.sin(t * 3 + c.traveled) * 0.15;
      else u.inner.position.y = Math.abs(Math.sin(c.traveled * 4)) * 0.06;
      if (c.heading !== undefined) u.inner.rotation.y = c.heading - Math.PI / 2;
      if (c.type === 'boss' || c.type === 'regen') u.body.rotation.y += dt;
      const frac = Math.max(0, c.hp / c.maxHp);
      u.barFg.scale.x = frac;
      u.barFg.position.x = -(1 - frac) / 2;
      u.barFg.material.color.setHSL(frac * 0.33, 0.9, 0.5);
      u.bar.quaternion.copy(this.s.camera.quaternion);
      const slowed = this.time < c.slowUntil;
      u.mat.emissive.setHex(slowed ? 0x3080ff : c.dots.size ? 0x40ff40 : c.def.color);
      u.mat.emissiveIntensity = slowed || c.dots.size ? 0.6 : c.flying ? 0.9 : 0.15;
    }
    for (const wp of this.s.waypointMeshes) wp.userData.ring.rotation.z += dt * 0.8;
    this.s.routeMesh.material.opacity = this.phase === 'wave' ? 0.18 : 0.4 + Math.sin(t * 3) * 0.15;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      const k = Math.max(0, e.life / e.max);
      if (e.kind === 'burst') {
        const r = e.radius * (1 - k * 0.7);
        e.mesh.scale.set(r, r, 1);
        e.mesh.material.opacity = k * 0.8;
      } else if (e.kind === 'particle') {
        e.v.y -= 9 * dt;
        e.mesh.position.addScaledVector(e.v, dt);
        e.mesh.rotation.x += dt * 8;
        e.mesh.material.opacity = k;
      } else {
        e.mesh.material.opacity = k;
      }
      if (e.life <= 0) {
        this.s.scene.remove(e.mesh);
        e.mesh.geometry !== this.s.geo.burst && e.mesh.geometry !== this.s.geo.particle && e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  flash(msg) {
    this.message = msg;
    this.messageTime = performance.now();
    this.onChange();
  }
}

function disposeTree(obj) {
  obj.traverse((o) => {
    // Geometries are shared (scene.geo); per-instance materials are disposed.
    if (o.material && !o.material.userData.shared) o.material.dispose();
  });
}
