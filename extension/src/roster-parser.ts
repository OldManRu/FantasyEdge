import { LeaguePlayer, RosterGroup } from "../../shared/models/league-player";

interface RTSportsProfile {
  pid?: number;
  name?: string;
  pos?: string;
  nfl_team?: string;
  fantasy_team?: string;
  current_proj?: string;
  current_pts?: string;
  avg_pts?: number;
  season_total?: number;
  roster_pct?: string;
  start_pct?: string;
  opp?: string;
  inj?: string;
  headshot?: string;
  weekly_pts?: Record<string, number>;
}

function parseNumber(value?: string | null): number | null {
  if (!value) return null;

  const cleaned = value
    .replace("%", "")
    .replace("—", "")
    .trim();

  if (!cleaned.length) return null;

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseProfile(row: HTMLElement): RTSportsProfile {
  try {
    return JSON.parse(row.dataset.profile ?? "{}");
  } catch {
    return {};
  }
}

function getByeWeek(row: HTMLElement): number | null {
  const pills = row.querySelectorAll(".player-meta-pill");

  for (const pill of pills) {
    const text = pill.textContent?.trim() ?? "";

    if (text.startsWith("Bye")) {
      const week = Number(text.replace("Bye", "").trim());

      return Number.isFinite(week) ? week : null;
    }
  }

  return null;
}

export function parseRoster(
  root: ParentNode = document
): LeaguePlayer[] {

  const rows = root.querySelectorAll<HTMLElement>(".player-row");

  return Array.from(rows).map(row => {

    const profile = parseProfile(row);

    const weeklyPoints: Record<number, number> = {};

    Object.entries(profile.weekly_pts ?? {}).forEach(([week, value]) => {
      weeklyPoints[Number(week)] = value;
    });

    return {

      id: Number(row.dataset.pid),

      name:
        row.dataset.player ??
        profile.name ??
        "",

      rosterGroup:
        (row.dataset.group as RosterGroup) ??
        "unknown",

      lineupSlot:
        row.querySelector<HTMLElement>(".pos-badge")
          ?.dataset.baseLabel ??
        row.dataset.pos ??
        "",

      position:
        row.dataset.pos ??
        profile.pos ??
        "",

      nflTeam:
        row.dataset.team ??
        profile.nfl_team ??
        "",

      opponent:
        profile.opp ??
        null,

      byeWeek:
        getByeWeek(row),

      injury:
        profile.inj || null,

      projection:
        parseNumber(profile.current_proj),

      averagePoints:
        profile.avg_pts ?? null,

      seasonPoints:
        profile.season_total ?? null,

      fantasyTeam:
        profile.fantasy_team ?? null,

      headshot:
        row.dataset.headshot ??
        null,

      rosterPercent:
        parseNumber(profile.roster_pct),

      startPercent:
        parseNumber(profile.start_pct),

      weeklyPoints
    };

  });

}