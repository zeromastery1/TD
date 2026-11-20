import {
  GEMS_PER_ROUND, TOTAL_WAVES, START_LIVES, TIERS, SHARDS, RELICS, PROSPECT_TABLE, prospectCost, waveInfo, RELIC_EMPOWER_MAX,
} from './config.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toString());

export class UI {
  constructor(game) {
    this.g = game;
    $('b-prospect').onclick = () => game.upgradeProspect();
    $('b-recipes').onclick = () => this.showRecipes();
    $('b-help').onclick = () => this.showHelp();
    $('m-close').onclick = () => this.closeModal();
    $('modal').onclick = (e) => { if (e.target.id === 'modal') this.closeModal(); };
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.onclick = () => this.setSpeed(+b.dataset.speed);
    });
    this.lastPanelKey = '';
  }

  setSpeed(s) {
    this.g.speed = s;
    document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', +x.dataset.speed === s));
  }

  refresh() {
    const g = this.g;
    $('h-wave').textContent = `Wave ${g.wave} / ${TOTAL_WAVES}`;
    $('h-lives').textContent = `${g.lives} / ${START_LIVES}`;
    $('h-lifefill').style.width = `${(100 * g.lives) / START_LIVES}%`;
    $('h-trackfill').style.width = `${(100 * (g.wave - 1)) / (TOTAL_WAVES - 1)}%`;
    if (!this.marksBuilt) {
      this.marksBuilt = true;
      let html = '';
      for (let w = 5; w <= TOTAL_WAVES; w += 5) {
        const boss = w % 10 === 0;
        html += `<span data-w="${w}" class="${boss ? 'boss' : ''}" style="left:${(100 * (w - 1)) / (TOTAL_WAVES - 1)}%">${boss ? '☠' : '◆'}</span>`;
      }
      $('h-marks').innerHTML = html;
    }
    document.querySelectorAll('#h-marks span').forEach((m) => m.classList.toggle('past', +m.dataset.w < g.wave));
    $('h-gold').textContent = g.gold;
    $('h-kills').textContent = g.kills;
    const maxed = g.prospect >= PROSPECT_TABLE.length - 1;
    const pb = $('b-prospect');
    pb.textContent = maxed ? `Prospecting ${g.prospect} (max)` : `Prospecting ${g.prospect} → ${g.prospect + 1} · ${prospectCost(g.prospect)}g`;
    pb.disabled = maxed || g.gold < prospectCost(g.prospect);
    pb.title = 'Shard quality odds: ' + PROSPECT_TABLE[g.prospect].map((p, i) => p ? `${TIERS[i]} ${p}%` : '').filter(Boolean).join(', ');

    const info = waveInfo(g.wave);
    $('next').innerHTML = g.phase === 'won' || g.phase === 'over' ? '' :
      `${g.phase === 'wave' ? 'Current' : 'Next'}: <b>${info.count} × ${info.name}</b>` +
      ` · ${info.hp} HP · armor ${info.armor}${info.def.flying ? ' · <b>flying</b> (ignores maze)' : ''}${info.type === 'boss' ? ' · <b>boss</b>' : ''}`;

    let ph = '';
    if (g.phase === 'build') {
      const left = GEMS_PER_ROUND - g.candidates.length;
      ph = `Place shards on the field: <b>${left}</b> left. They block the path, so build a maze!`;
    } else if (g.phase === 'choose') {
      ph = 'Select one of the new shards (ringed in gold) and <b>Keep</b>, <b>Combine</b> or <b>Forge</b> it.';
    } else if (g.phase === 'wave') {
      ph = `Wave ${g.wave} in progress… creeps left: <b>${g.creeps.length + (g.spawn ? g.spawn.left : 0)}</b>`;
    } else if (g.phase === 'over') {
      ph = 'Your keep has fallen.';
    } else if (g.phase === 'won') {
      ph = 'Victory!';
    }
    $('phase').innerHTML = ph;

    const toast = $('toast');
    if (g.message !== this.lastMsg || g.messageTime !== this.lastMsgTime) {
      this.lastMsg = g.message; this.lastMsgTime = g.messageTime;
      toast.textContent = g.message;
      toast.style.opacity = g.message ? 1 : 0;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { toast.style.opacity = 0; }, 3200);
    }

    this.renderPanel();

    if ((g.phase === 'over' || g.phase === 'won') && !this.endShown) {
      this.endShown = true;
      setTimeout(() => this.showEnd(), 600);
    }
  }

  renderPanel() {
    const g = this.g;
    const t = g.selected;
    const panel = $('panel');
    if (!t) { panel.classList.add('hidden'); this.lastPanelKey = ''; return; }
    const acts = g.actionsFor(t);
    const key = JSON.stringify([t.id, t.kind, t.type, t.tier, t.empower, t.kills, Math.round(t.dealt / 50), acts.map((a) => a.id + a.disabled), g.phase, t.haste]);
    if (key === this.lastPanelKey) return;
    this.lastPanelKey = key;
    panel.classList.remove('hidden');

    let title, sub, color;
    if (t.kind === 'stone') { title = 'Stone'; sub = 'A dead shard. Blocks the path.'; color = '#aaa'; }
    else if (t.kind === 'relic') {
      const d = RELICS[t.type];
      title = d.name; color = hex(d.color);
      sub = `Relic · Empowered ${t.empower}/${RELIC_EMPOWER_MAX}<br>${d.blurb}`;
    } else {
      const d = SHARDS[t.type];
      title = `${TIERS[t.tier]} ${d.name}`; color = hex(d.color);
      sub = `${t.candidate ? 'New shard · ' : ''}${d.blurb}`;
    }
    $('p-title').innerHTML = `<span class="dot" style="background:${color}"></span> ${title}`;
    $('p-sub').innerHTML = sub;

    const st = g.stats(t);
    const rows = [];
    if (st) {
      rows.push(['Damage', fmt(st.damage)]);
      rows.push(['Attack speed', `${(1 / st.cooldown).toFixed(2)}/s${t.haste ? ` (+${Math.round(t.haste * 100)}%)` : ''}`]);
      rows.push(['Range', st.range.toFixed(1)]);
      if (st.splash) rows.push(['Splash', `${st.splash.toFixed(1)} (${Math.round(st.splashFrac * 100)}%)`]);
      if (st.slow) rows.push(['Slow', `${Math.round(st.slow * 100)}% for ${st.slowTime}s`]);
      if (st.poison) rows.push(['Poison', `${fmt(st.poison)}/s for ${st.poisonTime}s`]);
      if (st.burn) rows.push(['Burn', `${fmt(st.burn)}/s for ${st.burnTime}s`]);
      if (st.chains) rows.push(['Chain', `${st.chains} jumps`]);
      if (st.multi > 1) rows.push(['Targets', st.multi]);
      if (st.shred) rows.push(['Armor shred', `-${st.shred}`]);
      if (st.shredAura) rows.push(['Armor aura', `-${st.shredAura}`]);
      if (st.crit) rows.push(['Crit', `${Math.round(st.crit * 100)}% ×${st.critMult.toFixed(2)}`]);
      if (st.aura) rows.push(['Haste aura', `+${Math.round(st.aura * 100)}% within ${st.auraRange}`]);
      if (!t.candidate) {
        rows.push(['Kills', t.kills]);
        rows.push(['Damage dealt', fmt(t.dealt)]);
      }
    }
    $('p-stats').innerHTML = rows.map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join('');

    const box = $('p-actions');
    box.innerHTML = '';
    for (const a of acts) {
      const b = document.createElement('button');
      b.innerHTML = `${a.key ? `<span class="kbd">${a.key}</span>` : ''}${a.label}<small>${a.hint}</small>`;
      if (a.relic || a.id === 'keep') b.classList.add('relic');
      else if (a.accent) b.classList.add('accent');
      b.disabled = !!a.disabled;
      b.onclick = () => g.doAction(a.id);
      box.appendChild(b);
    }
  }

  openModal(html, cls = '') {
    $('modal').className = cls;
    $('m-body').innerHTML = html;
    $('modal').classList.remove('hidden');
  }

  closeModal() {
    $('modal').classList.add('hidden');
    if (this.onClose) { const f = this.onClose; this.onClose = null; f(); }
  }

  get isModalOpen() { return !$('modal').classList.contains('hidden'); }

  showRecipes() {
    const g = this.g;
    const owned = (type, tier) => g.towers.some((t) => t.kind === 'shard' && t.type === type && t.tier === tier);
    const chip = ([type, tier]) => {
      const d = SHARDS[type];
      return `<span class="chip ${owned(type, tier) ? 'have' : ''}"><span class="dot" style="background:${hex(d.color)}"></span>${TIERS[tier]} ${d.name}</span>`;
    };
    const recipes = Object.values(RELICS).map((r) =>
      `<div class="recipe"><span class="name" style="color:${hex(r.color)}">${r.name}</span>${r.needs.map(chip).join(' + ')}<div style="width:100%;opacity:.7;font-size:12px">${r.blurb}</div></div>`).join('');
    const shards = Object.values(SHARDS).map((d) =>
      `<div><span class="dot" style="background:${hex(d.color)}"></span> <b>${d.name}</b>: ${d.blurb}</div>`).join('');
    this.openModal(`
      <h2>Recipe book</h2>
      <p>Own every listed shard (kept towers, or new shards this round) and select one of them to <b>Forge</b> a relic.
      The selected shard becomes the relic; the other ingredients turn to stone. Outlined chips are ones you own right now.</p>
      ${recipes}
      <h3>Shard families</h3>
      <div class="shardlist">${shards}</div>
      <h3>Quality</h3>
      <p>${TIERS.join(' → ')}. Combine 2 identical new shards for +1 quality, or 4 for +2.</p>`);
  }

  showTitle() {
    this.openModal(`
      <div class="logo">PRISMFALL</div>
      <div class="sublogo">GEM DEFENSE</div>
      <p class="title-blurb">The dead march on the vale tonight. Raise a maze of living crystal in their path,
      keep the finest shards as towers, fuse them into greater gems, and hold for ${TOTAL_WAVES} waves.</p>
      <button class="primary title-start" id="b-start">Begin</button>
      <div class="title-keys">Left click: place / select · Right or middle drag, WASD: pan · Wheel: zoom · K keep · C combine · 1 2 3 speed</div>
      <p style="margin-top:14px"><button class="small" id="b-howto">How to play</button></p>`, 'title');
    $('b-start').onclick = () => this.closeModal();
    $('b-howto').onclick = () => this.showHelp(true);
  }

  showHelp(first = false) {
    this.openModal(`
      <h2>How to play</h2>
      <p>Creeps march from the green <b>Gate</b> through waypoints <b>1 → 5</b> to the red <b>Exit</b>. Stop them before your 20 lives run out, and survive ${TOTAL_WAVES} waves.</p>
      <ol>
        <li><b>Place ${GEMS_PER_ROUND} shards</b> each round by clicking empty cells. Shards are random: 8 families and several qualities. Every placed shard blocks the ground path, so use them to build a long maze (you can never fully seal it).</li>
        <li><b>Choose one</b> to keep as a tower. The other four become <b>stones</b>, which still form your maze.</li>
        <li><b>Combine:</b> if two of the new shards are identical, fuse them into a higher quality (four identical: +2 quality).</li>
        <li><b>Forge relics:</b> special recipes turn sets of shards into powerful unique towers. See the Recipe book.</li>
        <li>Spend gold on <b>Prospecting</b> (better shard quality), <b>Empowering</b> relics, or clearing stones.</li>
      </ol>
      <p><b>Nightwings fly</b> straight between waypoints and ignore your maze. Every 10th wave is a boss.</p>
      <h3>Controls</h3>
      <p>Left click: place / select · Right or middle drag, WASD: pan · Wheel: zoom<br>
      K: keep · C / V: combine · 1, 2, 3: game speed · Esc: deselect</p>`);
  }

  showEnd() {
    const g = this.g;
    const won = g.phase === 'won';
    this.openModal(`
      <p class="big">${won ? 'Victory!' : 'Defeat'}</p>
      <p>${won ? `You held the line through all ${TOTAL_WAVES} waves with ${g.lives} lives to spare.` : `You fell on wave ${g.wave} of ${TOTAL_WAVES}.`}</p>
      <p>Creeps destroyed: <b>${g.kills}</b> · Relics forged: <b>${g.towers.filter((t) => t.kind === 'relic').length}</b></p>
      <p><button id="b-restart">Play again</button></p>`);
    document.getElementById('b-restart').onclick = () => location.reload();
  }
}
