// Prismfall: all tunable game data lives here.

export const GRID = 27; // cells per side
export const GEMS_PER_ROUND = 5;
export const START_LIVES = 20;
export const TOTAL_WAVES = 30;

// Route: creeps enter at START, visit each waypoint in order, then leave at EXIT.
export const ROUTE = [
  { x: 0, z: 13, label: 'Gate' },
  { x: 6, z: 6, label: '1' },
  { x: 20, z: 6, label: '2' },
  { x: 13, z: 13, label: '3' },
  { x: 6, z: 20, label: '4' },
  { x: 20, z: 20, label: '5' },
  { x: 26, z: 13, label: 'Exit' },
];

export const TIERS = ['Rough', 'Cut', 'Polished', 'Flawless', 'Perfect', 'Exalted'];
export const TIER_MULT = [1, 2.4, 5.5, 12, 26, 55];
export const MAX_TIER = TIERS.length - 1;

// Chance (in %) of each tier when a shard is drawn, by Prospecting level.
export const PROSPECT_TABLE = [
  [100, 0, 0, 0, 0],
  [70, 30, 0, 0, 0],
  [60, 30, 10, 0, 0],
  [50, 30, 20, 0, 0],
  [40, 30, 20, 10, 0],
  [30, 30, 30, 10, 0],
  [20, 30, 30, 20, 0],
  [10, 30, 30, 25, 5],
  [0, 25, 35, 30, 10],
];
export const prospectCost = (level) => 30 + 25 * level;
export const CLEAR_STONE_COST = 5;

// Shard families. Each attack is defined at tier 0 and scaled by TIER_MULT.
export const SHARDS = {
  ember: {
    name: 'Ember', color: 0xff4a2a, shape: 'octa',
    damage: 12, cooldown: 1.0, range: 3.4,
    blurb: 'Bursts on impact, damaging nearby creeps.',
    splash: 1.3,
  },
  frost: {
    name: 'Frost', color: 0x4aa8ff, shape: 'icosa',
    damage: 9, cooldown: 0.9, range: 3.4,
    blurb: 'Chills targets, slowing them.',
    slow: 0.2, slowPerTier: 0.05, slowTime: 2,
  },
  venom: {
    name: 'Venom', color: 0x3ee05a, shape: 'tetra',
    damage: 6, cooldown: 0.8, range: 3.4,
    blurb: 'Poisons targets for damage over time.',
    poison: 8, poisonTime: 3,
  },
  storm: {
    name: 'Storm', color: 0xffd23a, shape: 'octa',
    damage: 10, cooldown: 1.1, range: 3.4,
    blurb: 'Lightning arcs between several creeps.',
    chains: 2,
  },
  void: {
    name: 'Void', color: 0xa24aff, shape: 'dodeca',
    damage: 10, cooldown: 1.0, range: 3.4,
    blurb: 'Tears armor away from targets.',
    shred: 1, shredPerTier: 1, shredTime: 4,
  },
  radiant: {
    name: 'Radiant', color: 0xf4f4ff, shape: 'octa',
    damage: 26, cooldown: 1.6, range: 4.4,
    blurb: 'Long range and heavy critical strikes.',
    crit: 0.2, critMult: 2.5,
  },
  tide: {
    name: 'Tide', color: 0x2ee6d6, shape: 'icosa',
    damage: 8, cooldown: 0.9, range: 3.4,
    blurb: 'Fires at several creeps at once.',
    multi: 2,
  },
  halo: {
    name: 'Halo', color: 0xff6ad5, shape: 'dodeca',
    damage: 6, cooldown: 1.0, range: 3.0,
    blurb: 'Speeds up the attacks of nearby towers.',
    aura: 0.1, auraPerTier: 0.06, auraRange: 2.6,
  },
};
export const SHARD_KEYS = Object.keys(SHARDS);

// Special recipes: place or own all listed shards, then fuse them into a relic.
export const RELICS = {
  sunforge: {
    name: 'Sunforge', color: 0xff8a1e,
    needs: [['ember', 2], ['radiant', 1], ['storm', 0]],
    damage: 70, cooldown: 1.0, range: 4.6,
    splash: 1.8, burn: 25, burnTime: 3,
    blurb: 'Huge fiery bursts that leave creeps burning.',
  },
  glacier: {
    name: 'Glacier Heart', color: 0x9fe8ff,
    needs: [['frost', 2], ['tide', 1], ['halo', 0]],
    damage: 35, cooldown: 0.8, range: 4.6,
    multi: 4, slow: 0.45, slowTime: 2.5,
    blurb: 'Freezes four creeps at a time.',
  },
  plague: {
    name: 'Plague Bloom', color: 0x9bff3a,
    needs: [['venom', 3], ['void', 2], ['ember', 1]],
    damage: 30, cooldown: 0.7, range: 4.4,
    splash: 1.5, poison: 70, poisonTime: 4, shred: 4, shredTime: 4,
    blurb: 'Spreads poison and rot through whole groups.',
  },
  tempest: {
    name: 'Tempest Eye', color: 0xfff27a,
    needs: [['storm', 3], ['tide', 2], ['frost', 1]],
    damage: 90, cooldown: 1.0, range: 5.0,
    chains: 7,
    blurb: 'Lightning that jumps across seven creeps.',
  },
  eclipse: {
    name: 'Eclipse', color: 0x6a2cff,
    needs: [['void', 3], ['radiant', 2], ['halo', 1]],
    damage: 80, cooldown: 1.2, range: 5.0,
    shredAura: 8,
    blurb: 'Creeps inside its range lose 8 armor.',
  },
  prism: {
    name: 'Prism Core', color: 0xffffff,
    needs: [['radiant', 4], ['halo', 3], ['ember', 2], ['frost', 2]],
    damage: 450, cooldown: 0.9, range: 6.0,
    crit: 0.3, critMult: 4, splash: 1.2,
    blurb: 'The pinnacle: crushing, splashing, critical light.',
  },
};
export const RELIC_EMPOWER_MAX = 3;
export const relicEmpowerCost = (level) => 150 * (level + 1);
export const RELIC_EMPOWER_MULT = 1.8;

// Creep families. `model` names a compiled model in src/three/data, `height` its size in cells.
export const CREEPS = {
  normal: { name: 'Ghoul', color: 0xc0a080, hp: 1, speed: 1.7, count: 14, armor: 0, model: 'zombie', height: 0.95 },
  fast: { name: 'Dire Wolf', color: 0x6ad0ff, hp: 0.75, speed: 2.8, count: 14, armor: 0, model: 'wolf', height: 0.7 },
  armored: { name: 'Brute', color: 0x8a8f99, hp: 1.3, speed: 1.4, count: 12, armor: 6, model: 'orc_brute', height: 1.35 },
  swarm: { name: 'Scuttler', color: 0xe0c040, hp: 0.4, speed: 2.0, count: 26, armor: 0, model: 'crab', height: 0.45 },
  regen: { name: 'Ooze', color: 0x60e090, hp: 1.1, speed: 1.6, count: 14, armor: 1, regen: 0.03, model: 'slime_green', height: 0.65 },
  flying: { name: 'Nightwing', color: 0xd090ff, hp: 0.8, speed: 1.7, count: 14, armor: 0, flying: true, model: 'bat', height: 0.8 },
  boss: { name: 'Warlord', color: 0xff5050, hp: 18, speed: 1.2, count: 1, armor: 4, lives: 5, models: ['yeti', 'wyvern', 'demon'], names: ['Frost Yeti', 'Night Wyvern', 'Pit Demon'], height: 2.2 },
};

const WAVE_PATTERN = ['normal', 'fast', 'armored', 'swarm', 'flying', 'normal', 'regen', 'fast', 'armored', 'boss'];

export const HP_BASE = 10;
export const HP_GROWTH = 1.26;

export function waveInfo(wave) {
  const type = WAVE_PATTERN[(wave - 1) % WAVE_PATTERN.length];
  const def = CREEPS[type];
  const baseHp = HP_BASE * Math.pow(HP_GROWTH, wave - 1) + 6 * wave;
  const bossIdx = Math.max(0, Math.min(2, Math.floor(wave / 10) - 1));
  return {
    type,
    def,
    name: type === 'boss' ? def.names[bossIdx] : def.name,
    model: type === 'boss' ? def.models[bossIdx] : def.model,
    count: def.count + (type === 'boss' ? Math.floor(wave / 10) - 1 : Math.floor(wave / 6)),
    hp: Math.round(baseHp * def.hp),
    armor: Math.floor(wave / 4) + def.armor + (type === 'armored' ? Math.floor(wave / 3) : 0),
    speed: def.speed * (1 + wave * 0.006),
    bounty: type === 'boss' ? 40 + 6 * wave : 1 + Math.floor(wave / 3),
    interval: type === 'swarm' ? 0.45 : type === 'boss' ? 1.5 : 0.8,
  };
}
export const waveClearBonus = (wave) => 8 + 2 * wave;

// Armor reduces damage like many classic RTS games; negative armor amplifies it.
export function armorFactor(armor) {
  if (armor >= 0) return 1 - (0.06 * armor) / (1 + 0.06 * armor);
  return 2 - Math.pow(0.94, -armor);
}
