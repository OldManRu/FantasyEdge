import { scoreAmdFflStatRow } from '../shared/scoring/scoring-engine';
import { AMDFFL_SCORING_VERSION } from '../shared/scoring/amdffl-2026';
import { ensureIntelligenceSchema } from './intelligence';

export type FastIntelligenceEnv = { DB: D1Database };
type CsvRow = Record<string, string>;
type RosterPlayer = { name?: string; position?: string; nflTeam?: string; projection?: number|null; averagePoints?: number|null; rosterGroup?: string };
type WeeklySample = { week:number; points:number };
type DevelopmentalContext = { eligible:boolean; yearsExp:number|null; source:string };

const MODEL_VERSION='fe-2026.6';
const NFLVERSE='https://github.com/nflverse/nflverse-data/releases/download';
const POSITION_BASELINES:Record<string,number>={QB:13,RB:7.5,WR:7,TE:6,K:6,DL:8,LB:9,DB:8};

function normalizeName(v=''){return v.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g,'').replace(/[^a-z0-9]/g,'').trim();}
function playerKey(n:string,p=''){return `${normalizeName(n)}:${p.toUpperCase()}`;}
function displayName(r:CsvRow){return r.player_display_name||r.player_name||r.full_name||r.display_name||r.name||r.football_name||'';}
function num(r:CsvRow,...keys:string[]){for(const k of keys){const raw=r[k];if(raw===undefined||raw==='')continue;const v=Number(raw);if(Number.isFinite(v))return v;}return 0;}
function nullableNum(r:CsvRow,...keys:string[]){for(const k of keys){const raw=r[k];if(raw===undefined||raw==='')continue;const v=Number(raw);if(Number.isFinite(v))return v;}return null;}
const avg=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:0;

function parseCsv(text:string):CsvRow[]{
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(ch==='"'&&quoted&&next==='"'){field+='"';i++;}else if(ch==='"')quoted=!quoted;else if(ch===','&&!quoted){row.push(field);field='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(field);field='';if(row.some(v=>v.length))rows.push(row);row=[];}else field+=ch;}
 if(field.length||row.length){row.push(field);if(row.some(v=>v.length))rows.push(row);}if(rows.length<2)return[];
 const h=rows[0].map(x=>x.trim());return rows.slice(1).map(v=>Object.fromEntries(h.map((x,i)=>[x,v[i]??''])));
}
async function fetchCsv(url:string){const r=await fetch(url,{headers:{'user-agent':'FantasyEdge/0.1'}});if(!r.ok)throw new Error(`${r.status} fetching ${url}`);return parseCsv(await r.text());}
async function optionalCsv(url:string){try{return await fetchCsv(url);}catch{return[];}}
async function latestRoster(db:D1Database){const r=await db.prepare(`SELECT roster_json FROM roster_syncs ORDER BY id DESC LIMIT 1`).first<{roster_json:string}>();if(!r?.roster_json)return[];try{return JSON.parse(r.roster_json) as RosterPlayer[];}catch{return[];}}

function indexRows(rows:CsvRow[]){const map=new Map<string,CsvRow[]>();for(const r of rows){if(r.season_type&&r.season_type!=='REG')continue;const key=normalizeName(displayName(r));if(!key)continue;const list=map.get(key);if(list)list.push(r);else map.set(key,[r]);}return map;}
function latestByName(rows:CsvRow[]){const map=new Map<string,CsvRow>();for(const r of rows){const key=normalizeName(displayName(r));if(key)map.set(key,r);}return map;}
function samplesFor(index:Map<string,CsvRow[]>,player:RosterPlayer):WeeklySample[]{const rows=index.get(normalizeName(player.name??''))??[];const pos=(player.position??'').toUpperCase();return rows.map(r=>({week:num(r,'week'),points:scoreAmdFflStatRow(r,pos).points})).filter(x=>Number.isFinite(x.points)).sort((a,b)=>a.week-b.week);}
function trendFor(s:WeeklySample[]){if(s.length<4)return'unknown';const recent=avg(s.slice(-3).map(x=>x.points)),prior=avg(s.slice(-6,-3).map(x=>x.points));if(!prior)return'steady';if(recent>=prior*1.12)return'up';if(recent<=prior*.88)return'down';return'steady';}

function developmentalContext(player:RosterPlayer,rosterIndex:Map<string,CsvRow>):DevelopmentalContext{
 const rr=rosterIndex.get(normalizeName(player.name??''));
 const years=rr?nullableNum(rr,'years_exp','years_experience','experience','exp'):null;
 const rookieYear=rr?nullableNum(rr,'rookie_year','entry_year','draft_year'):null;
 const eligible=(years!==null&&years<=1)||(rookieYear!==null&&rookieYear>=2025);
 return{eligible,yearsExp:years,source:rr?'roster':'none'};
}
function developmentalProjection(player:RosterPlayer,ctx:DevelopmentalContext){
 const pos=(player.position??'').toUpperCase();const base=POSITION_BASELINES[pos];if(!ctx.eligible||!base)return null;
 const role=player.rosterGroup==='starter'?.82:.62;
 return Number((base*role).toFixed(2));
}

export async function refreshIntelligenceFast(env:FastIntelligenceEnv){
 await ensureIntelligenceSchema(env.DB);
 const started=new Date().toISOString();
 const run=await env.DB.prepare(`INSERT INTO intelligence_runs (started_at,status,message) VALUES (?,'running','Fast interactive projection refresh started.')`).bind(started).run();
 const runId=Number(run.meta.last_row_id??0);
 try{
  const roster=await latestRoster(env.DB);if(!roster.length)throw new Error('No synchronized RTSports roster is available yet.');
  const [s25,s26,r26]=await Promise.all([
   fetchCsv(`${NFLVERSE}/stats_player/stats_player_week_2025.csv`),
   optionalCsv(`${NFLVERSE}/stats_player/stats_player_week_2026.csv`),
   optionalCsv(`${NFLVERSE}/rosters/roster_2026.csv`),
  ]);
  const i25=indexRows(s25),i26=indexRows(s26),ri=latestByName(r26),now=new Date().toISOString();
  const stmts:D1PreparedStatement[]=[];let modeled=0,developmentalModeled=0;
  for(const player of roster){
   const name=player.name??'Unknown player',position=(player.position??'').toUpperCase(),team=(player.nflTeam??'').toUpperCase();
   const h=samplesFor(i25,player),c=samplesFor(i26,player),reasons=[`Fantasy scoring uses the AMD FFL ${AMDFFL_SCORING_VERSION} league rules.`];
   let projection:number|null=null,confidence=.25;
   if(position==='HC')reasons.push('Head-coach projection is applied immediately after the fast player refresh.');
   else if(h.length||c.length){
    const recent=h.slice(-6).map(x=>x.points),season=h.map(x=>x.points);let baseline=season.length?avg(season)*.45+avg(recent)*.55:0;
    if(h.length)reasons.push(`2025 baseline uses ${h.length} regular-season games with extra weight on the final six.`);
    if(c.length){const ca=avg(c.map(x=>x.points)),w=Math.min(.8,.15+c.length*.11);baseline=baseline?baseline*(1-w)+ca*w:ca;reasons.push(`${c.length} 2026 game${c.length===1?'':'s'} contribute ${Math.round(w*100)}% of the performance baseline.`);}
    if(baseline>0){projection=Number(baseline.toFixed(2));modeled++;}
    confidence=h.length>=10?.72:h.length>=5?.6:h.length?.48:.35;if(c.length>=3)confidence+=.08;
   }else{
    const fallback=Number(player.projection??player.averagePoints??0);
    if(fallback>0){projection=Number(fallback.toFixed(2));confidence=.3;modeled++;reasons.push('No public weekly sample was found; temporary RTSports projection/average fallback is used until enriched data is available.');}
    else{
      const ctx=developmentalContext(player,ri),dev=developmentalProjection(player,ctx);
      if(dev!==null){projection=dev;confidence=player.rosterGroup==='starter'?.31:.27;modeled++;developmentalModeled++;reasons.push(`Developmental baseline applied because current nflverse roster metadata identifies this player as early-career${ctx.yearsExp!==null?` (${ctx.yearsExp} years experience)`:''}.`);reasons.push(`Interactive-fast mode uses a conservatively discounted ${position} positional baseline; full depth-chart role enrichment is reserved for the scheduled model.`);reasons.push('This is intentionally low-confidence and will yield to real 2026 NFL usage as soon as games are played.');}
      else reasons.push('No usable public weekly sample, RTSports fallback, or verified developmental context was available yet.');
    }
   }
   const key=playerKey(name,position),trend=(trendFor(c.length>=4?c:h) as 'up'|'down'|'steady'|'unknown');
   const conf=Math.min(.95,confidence);
   stmts.push(env.DB.prepare(`INSERT INTO player_intelligence (player_key,display_name,position,nfl_team,projection,confidence,trend,reasons_json,source_games,model_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(player_key) DO UPDATE SET display_name=excluded.display_name,position=excluded.position,nfl_team=excluded.nfl_team,projection=excluded.projection,confidence=excluded.confidence,trend=excluded.trend,reasons_json=excluded.reasons_json,source_games=excluded.source_games,model_version=excluded.model_version,updated_at=excluded.updated_at`).bind(key,name,position,team,projection,conf,trend,JSON.stringify(reasons),h.length+c.length,MODEL_VERSION,now));
   stmts.push(env.DB.prepare(`INSERT INTO projection_snapshots (run_id,player_key,display_name,position,nfl_team,projection,confidence,trend,reasons_json,model_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(runId,key,name,position,team,projection,conf,trend,JSON.stringify(reasons),MODEL_VERSION,now));
  }
  for(let i=0;i<stmts.length;i+=80)await env.DB.batch(stmts.slice(i,i+80));
  const summary={stats2025Rows:s25.length,stats2026Rows:s26.length,roster2026Rows:r26.length,scoringMode:'league',scoringVersion:AMDFFL_SCORING_VERSION,modelVersion:MODEL_VERSION,refreshMode:'interactive-fast',modeledPlayers:modeled,developmentalModeledPlayers:developmentalModeled,depthEnrichment:'scheduled-only'};
  await env.DB.prepare(`UPDATE intelligence_runs SET completed_at=?,status='success',source_summary=?,player_count=?,message=? WHERE id=?`).bind(now,JSON.stringify(summary),roster.length,`Fast projection refresh completed; ${modeled} players have usable projections (${developmentalModeled} developmental).`,runId).run();
  return{ok:true,runId,playerCount:roster.length,modeledPlayers:modeled,developmentalModeledPlayers:developmentalModeled,sourceSummary:summary,updatedAt:now};
 }catch(error){const message=error instanceof Error?error.message:String(error);await env.DB.prepare(`UPDATE intelligence_runs SET completed_at=?,status='failed',message=? WHERE id=?`).bind(new Date().toISOString(),message,runId).run();return{ok:false,runId,error:message};}
}
