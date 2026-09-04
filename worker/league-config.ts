type ConfigSection = { name?: string; values?: Record<string, unknown> };

type NormalizedRule = {
  category: 'scoring' | 'lineup' | 'roster' | 'waiver' | 'playoff' | 'other';
  key: string;
  label: string;
  value: string | number | boolean | null;
  sourceSection: string;
};

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const text = (value: unknown) => String(value ?? '').trim();

function classify(section: string, label: string): NormalizedRule['category'] {
  const haystack = `${section} ${label}`.toLowerCase();
  if (/(scor|touchdown|td\b|passing|rushing|receiv|reception|tackle|sack|interception|field goal|extra point|fumble|return yard|defensive|coach)/.test(haystack)) return 'scoring';
  if (/(lineup|starter|starting|flex|quarterback|running back|wide receiver|tight end|kicker|linebacker|defensive back|defensive line|head coach)/.test(haystack)) return 'lineup';
  if (/(roster|bench|reserve|taxi|injured reserve|\bir\b|max players|min players)/.test(haystack)) return 'roster';
  if (/(waiver|free agent|blind bid|faab|claim)/.test(haystack)) return 'waiver';
  if (/(playoff|postseason|seed|tiebreak|championship)/.test(haystack)) return 'playoff';
  return 'other';
}

function canonicalScoringKey(label: string) {
  const l = label.toLowerCase();
  const patterns: Array<[RegExp, string]> = [
    [/passing.*touchdown|pass.*td/, 'passing_td'],
    [/passing.*yard|pass.*yard/, 'passing_yards'],
    [/passing.*interception|pass.*interception|interceptions thrown/, 'passing_interception'],
    [/rushing.*touchdown|rush.*td/, 'rushing_td'],
    [/rushing.*yard|rush.*yard/, 'rushing_yards'],
    [/receiving.*touchdown|receiv.*td/, 'receiving_td'],
    [/receiving.*yard|receiv.*yard/, 'receiving_yards'],
    [/reception|catch/, 'reception'],
    [/fumble.*lost/, 'fumble_lost'],
    [/solo.*tackle/, 'solo_tackle'],
    [/assist.*tackle/, 'assisted_tackle'],
    [/tackle.*loss|tfl/, 'tackle_for_loss'],
    [/\bsack/, 'sack'],
    [/defensive.*interception|interception.*defen/, 'defensive_interception'],
    [/pass.*defen|pass breakup|pd\b/, 'pass_defended'],
    [/forced.*fumble/, 'forced_fumble'],
    [/fumble.*recover/, 'fumble_recovery'],
    [/defensive.*touchdown|def.*td/, 'defensive_td'],
    [/field goal/, 'field_goal'],
    [/extra point|pat\b/, 'extra_point'],
    [/head coach|coach.*win/, 'head_coach'],
  ];
  for (const [pattern, key] of patterns) if (pattern.test(l)) return key;
  return normalizeKey(label);
}

export function normalizeLeagueConfig(sections: ConfigSection[]): NormalizedRule[] {
  const rules: NormalizedRule[] = [];
  for (const section of sections) {
    const sectionName = text(section.name) || 'Imported settings';
    for (const [label, value] of Object.entries(section.values ?? {})) {
      const category = classify(sectionName, label);
      const key = category === 'scoring' ? canonicalScoringKey(label) : normalizeKey(label);
      rules.push({ category, key, label, value: value as NormalizedRule['value'], sourceSection: sectionName });
    }
  }
  return rules;
}

export async function ensureLeagueRuleSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS league_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_sync_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      rule_key TEXT NOT NULL,
      label TEXT NOT NULL,
      value_json TEXT,
      source_section TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_league_rules_config ON league_rules(config_sync_id, category)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_league_rules_key ON league_rules(category, rule_key)`),
  ]);
}

export async function persistNormalizedLeagueRules(db: D1Database, configSyncId: number, sections: ConfigSection[]) {
  await ensureLeagueRuleSchema(db);
  const rules = normalizeLeagueConfig(sections);
  if (!rules.length) return { count: 0, categories: {} as Record<string, number> };
  const statements = rules.map(rule => db.prepare(`INSERT INTO league_rules
    (config_sync_id, category, rule_key, label, value_json, source_section)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(configSyncId, rule.category, rule.key, rule.label, JSON.stringify(rule.value), rule.sourceSection));
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
  const categories: Record<string, number> = {};
  for (const rule of rules) categories[rule.category] = (categories[rule.category] ?? 0) + 1;
  return { count: rules.length, categories };
}

export async function getLatestLeagueRules(db: D1Database) {
  await ensureLeagueRuleSchema(db);
  const latest = await db.prepare(`SELECT id FROM league_config_syncs ORDER BY id DESC LIMIT 1`).first<{ id: number }>();
  if (!latest?.id) return { configSyncId: null, rules: [] };
  const rows = await db.prepare(`SELECT category, rule_key, label, value_json, source_section
    FROM league_rules WHERE config_sync_id=? ORDER BY category, id`).bind(latest.id).all<Record<string, unknown>>();
  return {
    configSyncId: latest.id,
    rules: rows.results.map(row => ({
      category: row.category,
      key: row.rule_key,
      label: row.label,
      value: row.value_json ? JSON.parse(String(row.value_json)) : null,
      sourceSection: row.source_section,
    })),
  };
}
