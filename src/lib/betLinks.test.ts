import { buildBetOptions, draftKingsEventSlipUrl, safeBookUrl } from "./betLinks";

describe("safeBookUrl", () => {
  test("accepts the book's own https domains", () => {
    expect(safeBookUrl("fanduel", "https://sportsbook.fanduel.com/addToBetslip?marketId[0]=1&selectionId[0]=2")).toContain("sportsbook.fanduel.com");
    expect(safeBookUrl("draftkings", "https://sportsbook.draftkings.com/event/123?outcomes=abc")).toContain("draftkings.com");
  });
  test("fills a {state} placeholder", () => {
    expect(safeBookUrl("fanduel", "https://{state}.sportsbook.fanduel.com/x", "MD")).toBe("https://md.sportsbook.fanduel.com/x");
  });
  test("rejects other hosts, http, look-alikes and junk", () => {
    expect(safeBookUrl("fanduel", "https://evil.example.com/addToBetslip")).toBeNull();
    expect(safeBookUrl("fanduel", "http://sportsbook.fanduel.com/x")).toBeNull();
    expect(safeBookUrl("fanduel", "https://fanduel.com.evil.io/x")).toBeNull();
    expect(safeBookUrl("draftkings", "https://sportsbook.fanduel.com/x")).toBeNull();
    expect(safeBookUrl("fanduel", "javascript:alert(1)")).toBeNull();
    expect(safeBookUrl("fanduel", null)).toBeNull();
  });
});

describe("buildBetOptions", () => {
  const books = {
    draftkings: {
      spread: -4.5, spreadOddsHome: -110, spreadOddsAway: -110,
      eventLink: "https://sportsbook.draftkings.com/event/1",
    },
    fanduel: {
      spread: -5.5, spreadOddsHome: -105, spreadOddsAway: -115,
      spreadLinkHome: "https://sportsbook.fanduel.com/addToBetslip?selectionId[0]=H",
      spreadLinkAway: "https://sportsbook.fanduel.com/addToBetslip?selectionId[0]=A",
    },
    betmgm: { spread: -4 },
  };

  test("away pick: line is flipped, away price and away link used, best number flagged", () => {
    const opts = buildBetOptions(books, "AWAY", "md");
    expect(opts.map((o) => o.book)).toEqual(["draftkings", "fanduel"]); // only the two books
    const dk = opts[0], fd = opts[1];
    expect(dk.line).toBe(4.5);
    expect(dk.level).toBe("event");
    expect(fd.line).toBe(5.5);
    expect(fd.price).toBe(-115);
    expect(fd.level).toBe("betslip");
    expect(fd.url).toMatch(/selectionId.*=A$/);
    expect(fd.best).toBe(true); // +5.5 beats +4.5
    expect(dk.best).toBeUndefined();
  });

  test("home pick: best is the smaller number laid", () => {
    const opts = buildBetOptions(books, "HOME", "md");
    expect(opts.find((o) => o.book === "draftkings")?.best).toBe(true); // -4.5 beats -5.5
    expect(opts.find((o) => o.book === "fanduel")?.url).toContain("selectionId");
  });

  test("no link from the API falls back to the sportsbook home page", () => {
    const opts = buildBetOptions({ fanduel: { spread: 3 } }, "HOME", "md");
    expect(opts[0].level).toBe("home");
    expect(opts[0].url).toBe("https://sportsbook.fanduel.com/");
    expect(opts[0].best).toBeUndefined();
  });

  test("a hostile link is ignored, not used", () => {
    const opts = buildBetOptions({ fanduel: { spread: 3, spreadLinkHome: "https://phish.example/x" } }, "HOME", "md");
    expect(opts[0].level).toBe("home");
  });
});

describe("DraftKings event-page bet slip link", () => {
  test("moves the selection from the front page onto the event page", () => {
    expect(
      draftKingsEventSlipUrl(
        "https://sportsbook.draftkings.com/?outcomes=0HC87189132P850_1",
        "https://sportsbook.draftkings.com/event/34998863"
      )
    ).toBe("https://sportsbook.draftkings.com/event/34998863?outcomes=0HC87189132P850_1");
  });
  test("leaves anything unexpected alone", () => {
    expect(draftKingsEventSlipUrl("https://sportsbook.draftkings.com/", "https://sportsbook.draftkings.com/event/1")).toBeNull();
    expect(draftKingsEventSlipUrl("https://sportsbook.draftkings.com/?outcomes=x", "https://sportsbook.draftkings.com/leagues/basketball")).toBeNull();
  });
  test("used by buildBetOptions when both links are present", () => {
    const opts = buildBetOptions(
      { draftkings: { spread: 8.5, spreadLinkHome: "https://sportsbook.draftkings.com/?outcomes=ABC_1", eventLink: "https://sportsbook.draftkings.com/event/42" } },
      "HOME",
      "md"
    );
    expect(opts[0].url).toBe("https://sportsbook.draftkings.com/event/42?outcomes=ABC_1");
    expect(opts[0].level).toBe("betslip");
    expect(opts[0].gameUrl).toBe("https://sportsbook.draftkings.com/event/42");
  });
});
