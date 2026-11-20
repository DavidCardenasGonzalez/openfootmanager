import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequest, validateResult } from './unity-bridge.mjs';
const team = id => ({ id, name: id, formation: '4-4-2', players: Array.from({length:11}, (_,i)=>({id:`${id}-${i}`,name:`Player ${i}`,position:i===0?'Goalkeeper':'Defender',pace:60,passing:60,shooting:60,tackling:60,dribbling:60,strength:60,positioning:60,agility:60,reflexes:60})) });
const snapshot = () => ({current_minute:0,home_score:0,away_score:0,home_team:team('home'),away_team:team('away')});
test('preserves player identities across both sides',()=>{ const r=createRequest(snapshot()); assert.equal(new Set([...r.home.players,...r.away.players].map(p=>p.id)).size,22); });
test('rejects an already started match',()=>assert.throws(()=>createRequest({...snapshot(),current_minute:1})));
test('rejects duplicate identities',()=>{const s=snapshot();s.away_team.players[0].id=s.home_team.players[0].id;assert.throws(()=>createRequest(s));});
test('rejects a result for another request',()=>{const r=createRequest(snapshot());assert.throws(()=>validateResult(r,{version:1,request_id:'wrong',home_goals:1,away_goals:0}));});
test('accepts only a final result with exact roster correspondence',()=>{const r=createRequest(snapshot());const result={version:1,request_id:r.request_id,status:'finished',home_id:r.home.id,away_id:r.away.id,home_goals:1,away_goals:0,player_ids:[...r.home.players,...r.away.players].map(p=>p.id)};assert.equal(validateResult(r,result),result);assert.throws(()=>validateResult(r,{...result,home_goals:-1}));});

test('maps the manager 4-2-3-1 formation to the simulator variant', () => {
  const match = snapshot();
  match.home_team.formation = '4-2-3-1';
  assert.equal(createRequest(match).home.formation, '_4_2_3_1_A');
});

test('exports the selected style only for the managed side', () => {
  const match = snapshot();
  match.away_team.play_style = 'HighPress';
  const request = createRequest(match, 'Away');
  assert.equal(request.away.play_style, 'HighPress');
  assert.equal(request.home.play_style, undefined);
});

test('exports a player role alongside the player ID and position', () => {
  const match = snapshot();
  match.home_team.players[1].role = 'AttackingFB';
  const { players } = createRequest(match).home;
  assert.equal(players[1].role, 'AttackingFB');
  assert.equal(players[1].position, 'Defender');
  assert.equal(players[1].id, match.home_team.players[1].id);
});

test('Unity role labels match the manager across its supported languages', () => {
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const { locales } = read('../integrations/unity/Resources/OpenFootRoleLabels.json');
  assert.equal(locales.length, 12);
  for (const locale of locales) {
    const source = read(`../src/i18n/locales/${locale.code}.json`);
    assert.equal(locale.heading, source.match.playerRoles);
    assert.deepEqual(Object.fromEntries(locale.roles.map(({ id, text }) => [id, text])), source.tactics.playerRoles);
    assert.equal(locale.roles.length, 27);
  }
});
