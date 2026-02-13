import fs from "node:fs";
import path from "node:path";
import { loadEspnTeamsIndex, norm } from "./espn";

type AliasRow = {
  teamId: string;
  alias: string;
};

function readAliases(): AliasRow[] {
  const p = path.join(process.cwd(), "teamAliases.csv");
  const raw = fs.readFileSync(p, "utf-8").trim();
  const lines = raw.split(/\r?\n/);

  const out: AliasRow[] = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [teamId, alias] = line.split(",");
    if (teamId && alias) {
      out.push({
        teamId: teamId.trim(),
        alias: alias.trim(),
      });
    }
  }

  return out;
}

export function buildEspnMasterMap(): Map<string, string> {
  const { byName, byId } = loadEspnTeamsIndex();
  const aliases = readAliases();

  const master = new Map<string, string>();

  for (const row of aliases) {
    const n = norm(row.alias);
    const hit = byName.get(n);

    if (hit) {
      master.set(row.teamId, hit.id);
    } else {
      console.warn("[MASTER MAP MISS]", row.teamId, "|", row.alias);
    }
  }

  console.log("Master ESPN map built:", master.size, "entries");
  return master;
}
