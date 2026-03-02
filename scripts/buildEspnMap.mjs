// scripts/buildEspnMap.mjs - run with: node scripts/buildEspnMap.mjs
import fs from 'fs';

const raw = JSON.parse(fs.readFileSync('./src/data/espnTeams.json', 'utf8'));
const teams = raw.teams;

function norm(s) {
  return String(s ?? '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

const byLocation = new Map();
const byDisplayName = new Map();
const byAbbr = new Map();
const byShortDisplay = new Map();

for (const t of teams) {
  if (t.location) byLocation.set(norm(t.location), t);
  if (t.displayName) byDisplayName.set(norm(t.displayName), t);
  if (t.abbreviation) byAbbr.set(norm(t.abbreviation), t);
  if (t.shortDisplayName) byShortDisplay.set(norm(t.shortDisplayName), t);
}

// Load current espnMasterMap keys
const mapContent = fs.readFileSync('./src/data/espnMasterMap.ts', 'utf8');
const currentMap = {};
for (const m of mapContent.matchAll(/"(team-[^"]+)":\s*(\d+)/g)) {
  currentMap[m[1]] = Number(m[2]);
}

// Load teams.csv
const csvContent = fs.readFileSync('./src/data/teams.csv', 'utf8');
const csvLines = csvContent.trim().split('\n');
const header = csvLines[0].split(',');
const idIdx = header.indexOf('teamId');
const nameIdx = header.indexOf('teamName');
const teamsData = csvLines.slice(1).map(l => {
  const cols = l.split(',');
  return { id: cols[idIdx]?.trim(), name: cols[nameIdx]?.trim() };
}).filter(t => t.id);

const missing = teamsData.filter(t => !currentMap[t.id]);

function findEspn(teamId, teamName) {
  const n = norm(teamName);

  let hit = byLocation.get(n);
  if (hit) return { id: hit.id, method: 'location', espnName: hit.location };

  hit = byDisplayName.get(n);
  if (hit) return { id: hit.id, method: 'displayName', espnName: hit.displayName };

  hit = byShortDisplay.get(n);
  if (hit) return { id: hit.id, method: 'shortDisplay', espnName: hit.shortDisplayName };

  // St -> State
  const stateV = norm(teamName.replace(/\bSt\.?\b/g, 'State').trim());
  hit = byLocation.get(stateV);
  if (hit) return { id: hit.id, method: 'location+state', espnName: hit.location };
  hit = byDisplayName.get(stateV);
  if (hit) return { id: hit.id, method: 'displayName+state', espnName: hit.displayName };
  hit = byShortDisplay.get(stateV);
  if (hit) return { id: hit.id, method: 'shortDisplay+state', espnName: hit.shortDisplayName };

  // A&M / aandm variants
  const aandmV = norm(teamName.replace(/aandm/gi, 'a m').replace(/a&m/gi, 'a m'));
  hit = byLocation.get(aandmV);
  if (hit) return { id: hit.id, method: 'location+aandm', espnName: hit.location };

  // Cal St -> Cal State
  const calV = norm(teamName.replace(/^Cal St\.?\s+/i, 'Cal State '));
  hit = byLocation.get(calV);
  if (hit) return { id: hit.id, method: 'location+cal', espnName: hit.location };
  hit = byShortDisplay.get(calV);
  if (hit) return { id: hit.id, method: 'shortDisplay+cal', espnName: hit.shortDisplayName };

  // UC prefix -> add California before city
  if (teamName.startsWith('UC ')) {
    const ucCity = norm(teamName.slice(3));
    for (const [k, v] of byLocation) {
      if (k.includes(ucCity) && k.includes('california')) {
        return { id: v.id, method: 'location+uc', espnName: v.location };
      }
    }
    // Try shortDisplay with "UC " prefix
    hit = byShortDisplay.get(n);
    if (hit) return { id: hit.id, method: 'shortDisplay+uc', espnName: hit.shortDisplayName };
  }

  // N.C. State / NC State
  if (/n\.?c\.?\s*state/i.test(teamName)) {
    hit = byLocation.get('nc state') || byShortDisplay.get('nc state');
    if (hit) return { id: hit.id, method: 'nc-state', espnName: hit.location };
  }

  // UNC prefix
  if (teamName.startsWith('UNC ')) {
    const uncCity = norm('North Carolina ' + teamName.slice(4));
    hit = byLocation.get(uncCity) || byDisplayName.get(uncCity);
    if (hit) return { id: hit.id, method: 'unc+city', espnName: hit.location };
  }

  // SIU prefix
  if (teamName.startsWith('SIU ') || teamName.includes('SIU-')) {
    const siuV = norm(teamName.replace(/^SIU[-\s]+/i, 'Southern Illinois '));
    hit = byLocation.get(siuV) || byDisplayName.get(siuV);
    if (hit) return { id: hit.id, method: 'siu', espnName: hit.location };
  }

  // Abbreviation last resort (only multi-char)
  if (teamName.length > 2 && !/\s/.test(teamName)) {
    hit = byAbbr.get(n);
    if (hit) return { id: hit.id, method: 'abbr', espnName: hit.abbreviation };
  }

  return null;
}

const resolved = [];
const unresolved = [];

for (const team of missing) {
  const result = findEspn(team.id, team.name);
  if (result) {
    resolved.push({ id: team.id, name: team.name, espnId: result.id, espnName: result.espnName, method: result.method });
  } else {
    unresolved.push(team);
  }
}

console.log('Resolved:', resolved.length, '/ Unresolved:', unresolved.length);
console.log('\nRESOLVED (add to espnMasterMap.ts):');
resolved.sort((a,b)=>a.id.localeCompare(b.id)).forEach(r =>
  console.log(`  "${r.id}": ${r.espnId}, // ${r.name} -> ${r.espnName}`)
);
console.log('\nUNRESOLVED (need manual lookup):');
unresolved.forEach(u => console.log(`  // "${u.id}": ???, // ${u.name}`));
