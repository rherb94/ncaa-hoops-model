import type { OddsProvider } from "../provider";
import type { OddsSlate, BookKey } from "../types";
import fs from "node:fs";
import path from "node:path";

export class MockFixtureProvider implements OddsProvider {
  name = "mock-fixture";

  async getSlate(date: string): Promise<OddsSlate> {
    const filePath = path.join(
      process.cwd(),
      "src",
      "fixtures",
      `slate-${date}.json`
    );
    const raw = fs.readFileSync(filePath, "utf-8");
    const fixture = JSON.parse(raw);

    // Convert your existing fixture schema to OddsSlate with a single "consensus" book.
    const games = fixture.games.map((g: any) => {
      const consensusBook: BookKey = "consensus";
      return {
        gameId: g.gameId,
        startTimeISO: g.startTimeISO,
        awayTeamId: g.awayTeamId,
        homeTeamId: g.homeTeamId,
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        books: {
          [consensusBook]: {
            spread: g.consensus?.spread,
            total: g.consensus?.total,
            moneylineHome: g.consensus?.moneylineHome,
            moneylineAway: g.consensus?.moneylineAway,
            updatedAtISO: g.consensus?.updatedAtISO,
          },
        },
      };
    });

    return {
      date: fixture.date,
      lastUpdatedISO: fixture.lastUpdatedISO ?? new Date().toISOString(),
      games,
    };
  }
}
