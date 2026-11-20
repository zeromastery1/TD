# Prismfall

A 3D maze-building tower defense game for the browser, built with Three.js, in the look of
Emberfall Survivors: a moonlit painted vale seen from a fixed tilt, animated monsters, and
glowing spell effects.

Each round you drop five random crystal **shards** onto an open field. Every shard blocks the
ground path, so you shape the creeps' route into a maze. Keep one shard as a tower and the rest
harden into stone. Fuse identical shards into higher qualities, forge rare **relics** from special
recipes, and survive 30 waves.

## Play

Play online: https://zeromastery1.github.io/TD/ (deployed by GitHub Actions on every push to `main`).

Or run it locally:

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). `npm run build` produces a static
site in `dist/` that can be hosted anywhere.

## How it works

- **Route:** creeps enter at the Gate, visit waypoints 1 to 5 in order, and leave at the Exit.
  They always take the shortest open path, and you can never seal it completely. Flying Nightwings
  ignore the maze.
- **Creeps:** Ghouls, Dire Wolves, Brutes, Scuttlers, Oozes and flying Nightwings, with a
  Frost Yeti, Night Wyvern and Pit Demon as the bosses of waves 10, 20 and 30.
- **Shards:** 8 families (Ember splash, Frost slow, Venom poison, Storm chain lightning,
  Void armor shred, Radiant crits, Tide multi-shot, Halo haste aura) in 6 qualities:
  Rough, Cut, Polished, Flawless, Perfect, Exalted.
- **Each round:** place 5 shards, then choose one: **Keep** it, **Combine** two identical new
  shards (+1 quality) or four (+2), or **Forge** a relic.
- **Relics:** six recipes (Sunforge, Glacier Heart, Plague Bloom, Tempest Eye, Eclipse,
  Prism Core). Open the Recipe book in game to see ingredients. Relics can be Empowered with gold.
- **Gold:** earned from kills and wave clears. Spend it on Prospecting (better shard odds),
  Empowering relics, or clearing stones.

## Controls

| Input | Action |
| --- | --- |
| Left click | Place shard / select |
| Right or middle drag, WASD, arrows | Pan |
| Mouse wheel | Zoom |
| K / C / V | Keep / Combine / Combine ×4 |
| 1 / 2 / 3 | Game speed 1× / 2× / 4× |
| Esc | Deselect |

## Code layout

- `src/config.js` all game data and balance numbers (shards, relics, creeps, waves)
- `src/path.js` grid pathfinding through the waypoints
- `src/game.js` game state, building rules, combat simulation
- `src/view.js` the 3D view: camera, lights, ground, towers, creeps and effects
- `src/three/` the instanced animated crowd, compiled models (`data/`) and effect sheet, from
  Emberfall Survivors (credits in `src/three/CREDITS.md`)
- `src/art/` painted ground and effect textures, from Emberfall Survivors
- `src/ui.js` HUD, selection panel and dialogs
- `src/main.js` input handling and the main loop
