// src/app/api/cron/[job]/route.ts
// Starts the data workflows on time.
//
// GitHub's own cron has been starting this repo's scheduled workflows hours
// late or not at all (Nov 2026: the 7am ratings update didn't run on Nov 12
// or 13; the 11am odds snapshot started after 5pm), while workflows started
// on demand run within seconds. So Vercel Cron (vercel.json) calls this
// route, and the route asks GitHub to start the workflows right away.
//
// The workflows' own GitHub schedules stay as a backup; every workflow is
// safe to run twice (snapshots skip or merge, ratings and results rewrite).
//
// Needs two environment variables in Vercel:
//   CRON_SECRET            any long random string. Vercel sends it on cron
//                          calls; anyone else gets a 401.
//   GITHUB_DISPATCH_TOKEN  fine-grained GitHub token for this repository
//                          only, with "Actions: Read and write" permission.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const REPO = "rherb94/ncaa-hoops-model";

// Each job is one daily Vercel cron entry (see vercel.json for the times).
const JOBS: Record<string, string[]> = {
  ratings: ["daily-torvik-update.yml", "daily-ncaaw-torvik-update.yml", "daily-cfb-ratings-update.yml"],
  results: ["daily-results-fetch.yml", "daily-ncaaw-results-fetch.yml", "daily-cfb-results-fetch.yml"],
  openers: ["daily-odds-opener.yml", "daily-ncaaw-odds-opener.yml", "daily-cfb-odds-opener.yml"],
  closing: ["daily-closing-lines.yml", "daily-ncaaw-closing-lines.yml", "daily-cfb-closing-lines.yml"],
  intraday: ["intraday-picks.yml"],
};

async function dispatch(workflow: string, token: string): Promise<{ workflow: string; ok: boolean; status: number }> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "ncaa-hoops-model-cron",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );
  return { workflow, ok: res.status === 204, status: res.status };
}

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await params;
  const workflows = JOBS[job];
  if (!workflows) {
    return NextResponse.json({ error: `Unknown job "${job}"`, jobs: Object.keys(JOBS) }, { status: 404 });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "GITHUB_DISPATCH_TOKEN is not set" }, { status: 500 });
  }

  const results = await Promise.all(workflows.map((w) => dispatch(w, token)));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.error("[cron] dispatch failed", job, failed);
  return NextResponse.json({ job, results }, { status: failed.length ? 502 : 200 });
}
