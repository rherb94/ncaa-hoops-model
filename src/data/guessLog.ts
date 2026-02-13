// src/data/espnGuessLog.ts
import fs from "node:fs";
import path from "node:path";

export type EspnGuessLog = {
  atISO: string;
  method: "BY_ID" | "BY_NAME" | "BY_ALIAS_NAME" | "MISS";
  teamId: string;
  teamName: string;
  canonicalTeamId?: string;
  canonicalTeamName?: string;
  matchedEspnId?: string;
  matchedEspnName?: string;
  matchedLogo?: string;
  candidates?: Array<{
    id?: string;
    name?: string;
    logo?: string;
    why: string;
  }>;
  notes?: string;
};

let wroteHeader = false;

export function logEspnGuess(entry: EspnGuessLog) {
  // opt-out in prod if you want:
  // if (process.env.NODE_ENV === "production") return;

  const dir = path.join(process.cwd(), "logs");
  const file = path.join(dir, "espn-guess.jsonl");

  fs.mkdirSync(dir, { recursive: true });

  // one-time header line (optional)
  if (!wroteHeader && !fs.existsSync(file)) {
    fs.appendFileSync(file, `# JSONL ESPN guess log\n`);
    wroteHeader = true;
  }

  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
}
