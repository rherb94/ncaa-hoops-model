"use client";

import { useEffect, useState } from "react";
import type { LeagueId } from "@/lib/leagues";
import type { BracketTeam } from "@/lib/bracket";

// ── API response types ──

type MatchupData = {
  matchupId: string;
  topTeam?: BracketTeam;
  bottomTeam?: BracketTeam;
  predictedWinner?: BracketTeam;
  predictedSpread?: number;
  winProbability?: number;
};

type RoundData = {
  round: number;
  name: string;
  matchups: MatchupData[];
};

type RegionData = {
  name: string;
  teams: BracketTeam[];
  rounds: RoundData[];
  winner: BracketTeam;
};

type ChampProb = {
  team: BracketTeam;
  probability: number;
};

type BracketResponse = {
  generatedAtISO: string;
  teamCount: number;
  regionCount: number;
  regions: RegionData[];
  finalFour: MatchupData[];
  championship: MatchupData;
  champProbabilities: ChampProb[];
  error?: string;
};

// ── Components ──

function TeamSlot({
  team,
  isWinner,
  spread,
  winProb,
  compact,
}: {
  team?: BracketTeam;
  isWinner?: boolean;
  spread?: number;
  winProb?: number;
  compact?: boolean;
}) {
  if (!team) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-900/40 rounded border border-white/5 min-w-[180px]">
        <span className="text-xs text-zinc-600">TBD</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded border min-w-[180px] transition-colors ${
        isWinner
          ? "bg-emerald-500/10 border-emerald-500/30 text-zinc-100"
          : "bg-zinc-900/40 border-white/5 text-zinc-400"
      }`}
    >
      <span className="text-[10px] font-bold text-zinc-500 w-4 text-center shrink-0">
        {team.seed}
      </span>
      {team.logo && (
        <img
          src={team.logo}
          alt=""
          className="h-4 w-4 shrink-0 rounded-sm object-contain"
          loading="lazy"
        />
      )}
      <span className={`text-xs font-medium truncate ${isWinner ? "text-zinc-100" : "text-zinc-300"}`}>
        {team.name}
      </span>
      {isWinner && winProb != null && !compact && (
        <span className="ml-auto text-[10px] text-emerald-400 shrink-0">
          {Math.round(winProb * 100)}%
        </span>
      )}
    </div>
  );
}

function MatchupCard({ matchup }: { matchup: MatchupData }) {
  return (
    <div className="flex flex-col gap-px">
      <TeamSlot
        team={matchup.topTeam}
        isWinner={matchup.predictedWinner?.teamId === matchup.topTeam?.teamId}
        winProb={
          matchup.predictedWinner?.teamId === matchup.topTeam?.teamId
            ? matchup.winProbability
            : matchup.winProbability != null ? 1 - matchup.winProbability : undefined
        }
      />
      <TeamSlot
        team={matchup.bottomTeam}
        isWinner={matchup.predictedWinner?.teamId === matchup.bottomTeam?.teamId}
        winProb={
          matchup.predictedWinner?.teamId === matchup.bottomTeam?.teamId
            ? matchup.winProbability
            : matchup.winProbability != null ? 1 - matchup.winProbability : undefined
        }
      />
      {matchup.predictedSpread != null && (
        <div className="text-[9px] text-zinc-600 text-center mt-0.5">
          {matchup.predictedWinner?.name} {matchup.predictedSpread > 0 ? `+${matchup.predictedSpread.toFixed(1)}` : matchup.predictedSpread.toFixed(1)}
        </div>
      )}
    </div>
  );
}

function RegionBracket({ region }: { region: RegionData }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-zinc-200">{region.name} Region</h3>
        {region.winner && (
          <span className="text-xs text-emerald-400">
            Winner: ({region.winner.seed}) {region.winner.name}
          </span>
        )}
      </div>

      {/* Rounds displayed as columns */}
      <div className="overflow-x-auto">
        <div className="flex gap-6 min-w-max">
          {region.rounds.map((round) => (
            <div key={round.round} className="flex flex-col gap-1">
              <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">
                {round.name}
              </div>
              <div
                className="flex flex-col gap-4"
                style={{
                  justifyContent: "space-around",
                  minHeight: round.round === 1 ? undefined : `${round.matchups.length * 80}px`,
                }}
              >
                {round.matchups.map((m) => (
                  <MatchupCard key={m.matchupId} matchup={m} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChampionshipProbTable({ probs }: { probs: ChampProb[] }) {
  if (!probs.length) return null;

  const maxProb = probs[0]?.probability ?? 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
      <h3 className="text-sm font-bold text-zinc-200 mb-3">Championship Probabilities (10,000 sims)</h3>
      <div className="space-y-1.5">
        {probs.map((p, i) => (
          <div key={p.team.teamId} className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 w-4 text-right shrink-0">{i + 1}.</span>
            <span className="text-[10px] font-bold text-zinc-500 w-4 text-center shrink-0">
              {p.team.seed}
            </span>
            {p.team.logo && (
              <img
                src={p.team.logo}
                alt=""
                className="h-4 w-4 shrink-0 rounded-sm object-contain"
                loading="lazy"
              />
            )}
            <span className="text-xs text-zinc-300 w-36 truncate">{p.team.name}</span>
            <div className="flex-1 h-4 bg-zinc-800/60 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-500/40 rounded"
                style={{ width: `${maxProb > 0 ? (p.probability / maxProb) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs font-mono text-zinc-200 w-12 text-right">
              {(p.probability * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinalFourSection({
  finalFour,
  championship,
}: {
  finalFour: MatchupData[];
  championship: MatchupData;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
      <h3 className="text-sm font-bold text-zinc-200 mb-3">Final Four & Championship</h3>
      <div className="flex flex-col items-center gap-6">
        {/* Semi-finals */}
        <div className="flex gap-8 flex-wrap justify-center">
          {finalFour.map((m) => (
            <div key={m.matchupId}>
              <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 text-center">
                Semifinal
              </div>
              <MatchupCard matchup={m} />
            </div>
          ))}
        </div>

        {/* Championship */}
        <div>
          <div className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mb-1 text-center">
            National Championship
          </div>
          <MatchupCard matchup={championship} />
          {championship.predictedWinner && (
            <div className="mt-2 text-center">
              <span className="text-xs font-bold text-amber-400">
                Champion: ({championship.predictedWinner.seed}) {championship.predictedWinner.name}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Client ──

export default function BracketClient({ league }: { league: LeagueId }) {
  const [data, setData] = useState<BracketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"bracket" | "probs">("bracket");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/${league}/bracket`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Bracket API failed (${res.status})`);
      const json = (await res.json()) as BracketResponse;
      if (json.error) setErr(json.error);
      setData(json);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load bracket");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pillBase = "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors";
  const pillActive = "bg-cyan-600/30 text-cyan-300 border border-cyan-500/40";
  const pillInactive = "bg-zinc-800/60 text-zinc-400 border border-white/5 hover:bg-zinc-800";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-400">Tournament Bracket Predictor</div>
          <div className="text-sm font-semibold text-zinc-100">
            {data ? `${data.teamCount} teams, ${data.regionCount} regions` : "Loading..."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button
              className={`${pillBase} ${view === "bracket" ? pillActive : pillInactive}`}
              onClick={() => setView("bracket")}
            >
              Bracket
            </button>
            <button
              className={`${pillBase} ${view === "probs" ? pillActive : pillInactive}`}
              onClick={() => setView("probs")}
            >
              Championship Odds
            </button>
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="rounded-xl border border-white/10 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-950/10 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 text-sm text-zinc-300">
          Loading bracket data...
        </div>
      )}

      {data && view === "bracket" && (
        <div className="space-y-6">
          {/* Final Four and Championship at the top */}
          {data.finalFour.length > 0 && (
            <FinalFourSection finalFour={data.finalFour} championship={data.championship} />
          )}

          {/* Regional brackets */}
          {data.regions.map((region) => (
            <div
              key={region.name}
              className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4"
            >
              <RegionBracket region={region} />
            </div>
          ))}
        </div>
      )}

      {data && view === "probs" && (
        <ChampionshipProbTable probs={data.champProbabilities} />
      )}
    </div>
  );
}
