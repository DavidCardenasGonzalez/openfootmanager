import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const formations = new Set(['4-4-2','3-5-2','4-1-4-1','4-3-2-1','4-2-3-1','4-3-3','4-1-3-2','3-4-3','5-3-2','5-4-1','2-3-5','5-2-3']);
function requireValue(value, message) { if (!value) throw new Error(message); }
export function createRequest(snapshot, userSide = snapshot.user_side) {
  requireValue(snapshot.current_minute === 0 && snapshot.home_score === 0 && snapshot.away_score === 0, 'Export before advancing the match');
  requireValue(!snapshot.allows_extra_time, 'Knockout matches are not supported by bridge v1');
  const ids = new Set();
  function convert(team) {
    requireValue(team?.id && team.players?.length === 11, 'Exactly eleven starters required');
    requireValue(formations.has(team.formation), `Unsupported formation: ${team.formation}`);
    requireValue(team.players[0].position === 'Goalkeeper', 'Goalkeeper must occupy the first formation slot');
    const formation = team.formation === '4-2-3-1' ? '_4_2_3_1_A' : '_' + team.formation.replaceAll('-', '_');
    return {id:team.id,name:team.name,formation,players:team.players.map(p=>{
      requireValue(typeof p.id === 'string' && p.id.length && !ids.has(p.id), 'Duplicate or missing player ID'); ids.add(p.id);
      const fields = ['pace','passing','shooting','tackling','dribbling','strength','positioning','agility','reflexes'];
      for (const key of fields) requireValue(Number.isFinite(p[key]) && p[key]>=0 && p[key]<=100, `Invalid ${key}`);
      return Object.fromEntries(['id','name','position','role',...fields].map(key=>[key,p[key]]));
    })};
  }
  const home=convert(snapshot.home_team), away=convert(snapshot.away_team);
  if (userSide != null) {
    requireValue(['Home', 'Away'].includes(userSide), 'Invalid managed side');
    const managed = userSide === 'Home' ? home : away;
    const source = userSide === 'Home' ? snapshot.home_team : snapshot.away_team;
    requireValue(['Balanced', 'Attacking', 'Defensive', 'HighPress', 'Counter', 'Possession'].includes(source.play_style), 'Invalid play style');
    managed.play_style = source.play_style;
  }
  requireValue(home.id!==away.id,'Teams must differ');
  return {version:1,request_id:randomUUID(),home,away};
}
export function validateResult(request,result) {
  requireValue(result.version===1 && result.status==='finished' && result.request_id===request.request_id,'Mismatched or unfinished result');
  requireValue(result.home_id===request.home.id && result.away_id===request.away.id,'Team mismatch');
  for(const score of [result.home_goals,result.away_goals]) requireValue(Number.isInteger(score)&&score>=0&&score<=255,'Invalid score');
  const expected=[...request.home.players,...request.away.players].map(p=>p.id);
  requireValue(Array.isArray(result.player_ids)&&result.player_ids.length===22&&expected.every((id,i)=>result.player_ids[i]===id),'Roster mismatch');
  return result;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [command,input,output]=process.argv.slice(2);
  if(command==='export') writeFileSync(output,JSON.stringify(createRequest(JSON.parse(readFileSync(input,'utf8'))),null,2),{flag:'wx'});
  else if(command==='validate') { validateResult(JSON.parse(readFileSync(input,'utf8')),JSON.parse(readFileSync(output,'utf8'))); console.log('Result validated; no save has been modified.'); }
  else throw new Error('Usage: node scripts/unity-bridge.mjs export snapshot.json request.json | validate request.json result.json');
}
