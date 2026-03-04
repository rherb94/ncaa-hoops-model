import { Suspense } from "react";
import ResultsClient from "./resultsClient";

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="text-zinc-400 text-sm">Loading…</div>}>
      <ResultsClient />
    </Suspense>
  );
}
