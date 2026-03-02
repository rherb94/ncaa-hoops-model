const API_KEY = process.env.THE_ODDS_API_KEY!;

async function main() {
  const url =
    "https://api.the-odds-api.com/v4/sports/basketball_ncaab/odds" +
    `?apiKey=${API_KEY}` +
    "&regions=us" +
    "&markets=spreads,h2h,totals" +
    "&oddsFormat=american";

  const res = await fetch(url);

  if (!res.ok) {
    console.error("HTTP", res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();

  console.log("Games returned:", data.length);

  if (data.length > 0) {
    console.log("\n=== SAMPLE GAME OBJECT ===\n");
    console.dir(data[0], { depth: null });
  }

  console.log("\nQuota headers:");
  console.log("used:", res.headers.get("x-requests-used"));
  console.log("remaining:", res.headers.get("x-requests-remaining"));
  console.log("cost:", res.headers.get("x-requests-last"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
