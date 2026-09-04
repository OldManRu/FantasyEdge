export type LeagueConfigSection = {
  name: string;
  values: Record<string, string | number | boolean | null>;
};

export type LeagueConfigPayload = {
  schemaVersion: 1;
  source: 'rtsports';
  deviceId: string;
  pageUrl: string;
  syncedAt: string;
  leagueName?: string | null;
  season?: number | null;
  pageTitle?: string | null;
  sections: LeagueConfigSection[];
  rawText?: string;
};

export type LeagueConfigReceipt = {
  ok: boolean;
  configId?: number;
  sectionCount: number;
  message: string;
};
