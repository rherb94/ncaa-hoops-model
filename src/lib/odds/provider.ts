import type { OddsSlate } from "./types";

export interface OddsProvider {
  name: string;
  getSlate(date: string, forceRefresh?: boolean): Promise<OddsSlate>;
}
