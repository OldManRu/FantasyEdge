import { collectPublicSignals } from './collectors';
import { evaluateCompletedProjections, getEvaluationSummary } from './evaluation';
import { ensureIntelligenceSchema, getLatestIntelligence, refreshIntelligence } from './intelligence';
import { getLatestLeagueRules, persistNormalizedLeagueRules } from './league-config';
import { getOptimizedLineup } from './optimizer';
import { applyActiveSignalsToStoredIntelligence, latestSignals } from './signals';
import { applyHeadCoachProjections } from './head-coach-refresh';

export interface Env { ASSETS: Fetcher; DB?: D1Database; }
type SyncPayload = { schemaVersion?:number; source?:string; deviceId?:string; pageUrl?:string; syncedAt?:string; fantasyTeam?:string|null; roster?:unknown[]; optimized?:unknown };
type ConfigPayload = { schemaVersion?:number; source?:string; deviceId?:string; pageUrl?:string; syncedAt?:string; pageTitle?:string|null; leagueName?:string|null; season?:number|null; sections?:Array<{name?:string;values?:Record<string,unknown>}>; rawText?:string };
const json=(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body,null,2),{...init,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(init.headers??{})}});
const EXPECTED_MODEL_VERSION='fe-2026.4';
const EXPECTED_SCORING_VERSION='amdffl-2026.1';
const EXPECTED_HC_MODEL_VERSION='fe-hc-2026.1';
const RUNNING_GRACE_MS=2*60*1000;

async function ensureSchema(db:D1Database){await db.batch([
 db.prepare(`CREATE TABLE IF NOT EXISTS roster_syncs (id INTEGER PRIMARY KEY AUTOINCREMENT,device_id TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'rtsports',page_url TEXT,fantasy_team TEXT,synced_at TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,player_count INTEGER NOT NULL,roster_json TEXT NOT NULL,optimized_json TEXT)`),
 db.prepare(`CREATE INDEX IF NOT EXISTS idx_roster_syncs_received_at ON roster_syncs(received_at DESC)`),
 db.prepare(`CREATE INDEX IF NOT EXISTS idx_roster_syncs_device_id ON roster_syncs(device_id,received_at DESC)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS league_config_syncs (id INTEGER PRIMARY KEY AUTOINCREMENT,device_id TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'rtsports',page_url TEXT,page_title TEXT,league_name TEXT,season INTEGER,synced_at TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,section_count INTEGER NOT NULL,config_json TEXT NOT NULL,raw_text TEXT)`),
 db.prepare(`CREATE INDEX IF NOT EXISTS idx_league_config_received ON league_config_syncs(received_at DESC)`)
]);}

async function intelligenceIsStale(db:D1Database){
 await ensureIntelligenceSchema(db);
 const row=await db.prepare(`SELECT completed_at,source_summary FROM intelligence_runs WHERE status='success' ORDER BY id DESC LIMIT 1`).first<{completed_at:string;source_summary:string|null}>();
 if(!row?.completed_at)return true;
 const age=Date.now()-new Date(row.completed_at).getTime();
 if(!Number.isFinite(age)||age>4*60*60*1000)return true;
 let summary:Record<string,unknown>={};
 try{summary=row.source_summary?JSON.parse(row.source_summary) as Record<string,unknown>:{};}catch{summary={};}
 return summary.modelVersion!==EXPECTED_MODEL_VERSION||summary.scoringVersion!==EXPECTED_SCORING_VERSION||summary.hcModelVersion!==EXPECTED_HC_MODEL_VERSION;
}

async function intelligenceRefreshRunning(db:D1Database){
 await ensureIntelligenceSchema(db);
 const row=await db.prepare(`SELECT id,started_at FROM intelligence_runs WHERE status='running' ORDER BY id DESC LIMIT 1`).first<{id:number;started_at:string}>();
 if(!row?.started_at)return false;
 const age=Date.now()-new Date(row.started_at).getTime();
 if(Number.isFinite(age)&&age<RUNNING_GRACE_MS)return true;
 await db.prepare(`UPDATE intelligence_runs SET completed_at=?,status='failed',message=? WHERE id=? AND status='running'`).bind(new Date().toISOString(),'Refresh abandoned after exceeding the running grace period; a replacement run may start.',row.id).run();
 return false;
}

async function queueRefreshIfNeeded(db:D1Database,ctx:ExecutionContext){
 const stale=await intelligenceIsStale(db);
 if(!stale)return false;
 if(await intelligenceRefreshRunning(db))return true;
 ctx.waitUntil(refreshWithSignals(db));
 return true;
}

async function refreshWithSignals(db:D1Database){const result=await refreshIntelligence({DB:db});if(result.ok){await applyHeadCoachProjections(db,result.runId);await collectPublicSignals(db);await applyActiveSignalsToStoredIntelligence(db);await evaluateCompletedProjections(db);}return result;}

export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{const url=new URL(request.url);
  if(url.pathname==='/api/health')return json({ok:true,service:'fantasy-edge',platform:'cloudflare-workers',storage:env.DB?'d1':'not-configured',intelligence:env.DB?'enabled':'not-configured'});
  if(url.pathname==='/api/sync/roster'&&request.method==='POST'){
   if(!env.DB)return json({ok:false,error:'D1 storage is not configured yet.'},{status:503});const payload=(await request.json().catch(()=>null)) as SyncPayload|null;if(!payload?.deviceId||!payload?.syncedAt||!Array.isArray(payload.roster))return json({ok:false,error:'Invalid sync payload.'},{status:400});await ensureSchema(env.DB);await env.DB.prepare(`INSERT INTO roster_syncs (device_id,source,page_url,fantasy_team,synced_at,player_count,roster_json,optimized_json) VALUES (?,?,?,?,?,?,?,?)`).bind(payload.deviceId,payload.source??'rtsports',payload.pageUrl??null,payload.fantasyTeam??null,payload.syncedAt,payload.roster.length,JSON.stringify(payload.roster),payload.optimized?JSON.stringify(payload.optimized):null).run();await queueRefreshIfNeeded(env.DB,ctx);return json({ok:true,playerCount:payload.roster.length,syncedAt:payload.syncedAt});
  }
  if(url.pathname==='/api/sync/config'&&request.method==='POST'){
   if(!env.DB)return json({ok:false,error:'D1 storage is not configured yet.'},{status:503});const payload=(await request.json().catch(()=>null)) as ConfigPayload|null;if(!payload?.deviceId||!payload?.syncedAt||!Array.isArray(payload.sections)||!payload.sections.length)return json({ok:false,error:'Invalid league configuration payload.'},{status:400});await ensureSchema(env.DB);const result=await env.DB.prepare(`INSERT INTO league_config_syncs (device_id,source,page_url,page_title,league_name,season,synced_at,section_count,config_json,raw_text) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(payload.deviceId,payload.source??'rtsports',payload.pageUrl??null,payload.pageTitle??null,payload.leagueName??null,payload.season??null,payload.syncedAt,payload.sections.length,JSON.stringify(payload.sections),payload.rawText?.slice(0,50000)??null).run();const configId=Number(result.meta.last_row_id??0);const normalized=await persistNormalizedLeagueRules(env.DB,configId,payload.sections);return json({ok:true,configId,sectionCount:payload.sections.length,normalizedRuleCount:normalized.count,categories:normalized.categories,message:'League configuration stored and normalized.'});
  }
  if(url.pathname==='/api/sync/latest'&&request.method==='GET'){
   if(!env.DB)return json({ok:true,sync:null,storage:'not-configured'});await ensureSchema(env.DB);const row=await env.DB.prepare(`SELECT id,device_id,source,page_url,fantasy_team,synced_at,received_at,player_count,roster_json,optimized_json FROM roster_syncs ORDER BY id DESC LIMIT 1`).first<Record<string,unknown>>();if(!row)return json({ok:true,sync:null,storage:'d1'});return json({ok:true,storage:'d1',sync:{id:row.id,deviceId:row.device_id,source:row.source,pageUrl:row.page_url,fantasyTeam:row.fantasy_team,syncedAt:row.synced_at,receivedAt:row.received_at,playerCount:row.player_count,roster:JSON.parse(String(row.roster_json??'[]')),optimized:row.optimized_json?JSON.parse(String(row.optimized_json)):null}});
  }
  if(url.pathname==='/api/config/latest'&&request.method==='GET'){
   if(!env.DB)return json({ok:true,config:null,storage:'not-configured'});await ensureSchema(env.DB);const row=await env.DB.prepare(`SELECT id,page_url,page_title,league_name,season,synced_at,received_at,section_count,config_json FROM league_config_syncs ORDER BY id DESC LIMIT 1`).first<Record<string,unknown>>();return json({ok:true,storage:'d1',config:row?{id:row.id,pageUrl:row.page_url,pageTitle:row.page_title,leagueName:row.league_name,season:row.season,syncedAt:row.synced_at,receivedAt:row.received_at,sectionCount:row.section_count,sections:JSON.parse(String(row.config_json??'[]'))}:null});
  }
  if(url.pathname==='/api/config/rules'&&request.method==='GET'){if(!env.DB)return json({ok:true,configSyncId:null,rules:[]});await ensureSchema(env.DB);return json({ok:true,...(await getLatestLeagueRules(env.DB))});}
  if(url.pathname==='/api/lineup/recommendation'&&request.method==='GET'){if(!env.DB)return json({ok:false,error:'D1 storage is not configured.'},{status:503});await ensureSchema(env.DB);return json({ok:true,...(await getOptimizedLineup(env.DB))});}
  if(url.pathname==='/api/intelligence/latest'&&request.method==='GET'){
   if(!env.DB)return json({ok:false,error:'D1 storage is not configured.'},{status:503});
   const refreshing=await queueRefreshIfNeeded(env.DB,ctx);
   return json({ok:true,refreshing,...(await getLatestIntelligence(env.DB))});
  }
  if(url.pathname==='/api/signals/latest'&&request.method==='GET'){if(!env.DB)return json({ok:false,error:'D1 storage is not configured.'},{status:503});const limit=Math.max(1,Math.min(250,Number(url.searchParams.get('limit')??100)));return json({ok:true,signals:await latestSignals(env.DB,limit)});}
  if(url.pathname==='/api/evaluation/summary'&&request.method==='GET'){if(!env.DB)return json({ok:false,error:'D1 storage is not configured.'},{status:503});return json({ok:true,...(await getEvaluationSummary(env.DB))});}
  if(url.pathname.startsWith('/api/'))return json({ok:false,error:'Not found'},{status:404});return env.ASSETS.fetch(request);
 },
 async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext):Promise<void>{if(!env.DB)return;if(!(await intelligenceRefreshRunning(env.DB)))ctx.waitUntil(refreshWithSignals(env.DB));}
} satisfies ExportedHandler<Env>;
