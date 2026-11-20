import { GRID, ROUTE } from './config.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Breadth-first search on the grid. `blocked(x, z)` returns true for impassable cells.
function bfs(from, to, blocked) {
  const size = GRID * GRID;
  const prev = new Int32Array(size).fill(-1);
  const start = from.z * GRID + from.x;
  const goal = to.z * GRID + to.x;
  prev[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === goal) break;
    const cx = cur % GRID, cz = (cur / GRID) | 0;
    for (const [dx, dz] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      const n = nz * GRID + nx;
      if (prev[n] !== -1 || blocked(nx, nz)) continue;
      prev[n] = cur;
      queue.push(n);
    }
  }
  if (prev[goal] === -1) return null;
  const out = [];
  for (let c = goal; c !== start; c = prev[c]) out.push({ x: c % GRID, z: (c / GRID) | 0 });
  out.push({ x: from.x, z: from.z });
  return out.reverse();
}

// Full route through every waypoint, or null if the maze is sealed.
export function computeRoute(blocked) {
  const cells = [];
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const seg = bfs(ROUTE[i], ROUTE[i + 1], blocked);
    if (!seg) return null;
    if (i > 0) seg.shift();
    cells.push(...seg);
  }
  return cells;
}

export const isRouteCell = (x, z) => ROUTE.some((r) => r.x === x && r.z === z);
