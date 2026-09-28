import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPatch, buildRequest, calibrateFinances, extractResponse, main, parseArgs, requestOpenAI, validateResult } from "./enrich-world-openai.mjs";

const team = { id: "real", name: "Real Madrid", country: "ES", colors: { primary: "#1f2937", secondary: "#ffffff" }, media: { logo: "local.png" }, manager_id: "m1" };
const result = () => ({ club_id: team.id, matched: true, fields: {
  short_name: null, city: "Madrid", stadium_name: null, stadium_capacity: null,
  founded_year: null, kits: {
    home: { pattern: "Solid", colors: { primary: "#FFFFFF", secondary: "#FEBE10" } },
    away: { pattern: "Diagonal", colors: { primary: "#00205B", secondary: "#FFFFFF" } },
  },
  facilities: null, formation: null, play_style: null,
} });

test("model knowledge applies kit colors without requesting financial guesses", () => {
  const { patch } = validateResult(result(), team, {});
  const updated = applyPatch(team, patch);
  assert.equal(updated.city, "Madrid");
  assert.equal(updated.colors.secondary, "#FEBE10");
  assert.equal(updated.colors.primary, "#FFFFFF");
  assert.equal(updated.kit_pattern, "Solid");
  assert.equal(updated.kits.away.pattern, "Diagonal");
  assert.equal(updated.kits.away.colors.primary, "#00205B");
  assert.deepEqual(updated.media, team.media);
  assert.equal(updated.manager_id, team.manager_id);
  assert.equal(team.colors.primary, "#1f2937");
});

test("null values remain unchanged and facts-only excludes game estimates", () => {
  const response = result();
  const { patch, skipped } = validateResult(response, team, { factsOnly: true });
  assert.deepEqual(patch, { city: "Madrid", kits: response.fields.kits, colors: response.fields.kits.home.colors, kit_pattern: "Solid" });
  assert.equal(skipped.length, 7);
});

test("foreign IDs, invalid colors, negative budgets and unexpected fields are rejected", () => {
  for (const mutation of [
    (r) => { r.club_id = "other"; },
    (r) => { r.fields.kits.home.colors.primary = "red"; },
    (r) => { r.fields.stadium_capacity = -1; },
    (r) => { r.fields.id = "replacement"; },
  ]) {
    const response = result();
    mutation(response);
    assert.throws(() => validateResult(response, team, {}));
  }
});

test("unknown club identity produces no applied changes", () => {
  assert.deepEqual(validateResult({ ...result(), matched: false }, team, {}).patch, {});
});

test("response must include all fields to prevent partial results being checkpointed", () => {
  const response = result();
  delete response.fields.kits;
  assert.throws(() => validateResult(response, team, {}));
});

test("request has a compact schema, bounded output and no tools or web search", () => {
  const request = buildRequest(team, { model: "test-model", asOf: "2026-09-27", factsOnly: true });
  assert.equal(request.model, "test-model");
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal(request.text.format.strict, true);
  assert.equal(request.tools, undefined);
  assert.equal(request.tool_choice, undefined);
  assert.equal(request.include, undefined);
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal(request.max_output_tokens, 512);
  assert.equal(request.text.format.schema.properties.fields.properties.wage_budget, undefined);
  assert.ok(JSON.stringify(request).length < 3500);
  const kits = request.text.format.schema.properties.fields.properties.kits.anyOf[0];
  assert.equal(kits.properties.home.$ref, "#/$defs/kit");
  assert.equal(kits.properties.away.$ref, "#/$defs/kit");
  assert.ok(request.text.format.schema.$defs.kitColor.enum.includes("#FFFFFF"));
  assert.ok(request.text.format.schema.$defs.kit.properties.pattern.enum.includes("Stripes"));
  assert.match(request.input, /Real Madrid/);
  assert.match(request.instructions, /2026-09-27/);
  assert.equal(request.store, false);
});

test("refusals and incomplete responses cannot silently become successful results", () => {
  assert.throws(() => extractResponse({ status: "incomplete", output: [] }));
  assert.throws(() => extractResponse({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Refused" }] }] }));
  assert.deepEqual(extractResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"club_id":"real"}' }] }] }), { club_id: "real" });
});

test("CLI rejects zero limits, unknown flags, invalid dates and output overwrites", () => {
  for (const args of [["--limit", "0"], ["--max-output-tokens", "1"], ["--what"], ["--as-of", "2026-02-30"], ["--output", "data/open-manager/world.json"]]) {
    assert.throws(() => parseArgs(args));
  }
  assert.equal(parseArgs(["--limit", "2", "--facts-only"]).limit, 2);
  assert.equal(parseArgs([]).model, "gpt-5.6-luna");
  assert.match(parseArgs([]).output, /world\.enriched\.mini\.local\.json$/);
});

test("old web reports remain intact and cannot silently resume as mini results", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ofm-old-report-"));
  const input = path.join(dir, "world.json");
  const output = path.join(dir, "enriched.json");
  const oldReport = JSON.stringify({ config: { version: 1, model: "gpt-6-luna" }, clubs: {} });
  fs.writeFileSync(input, JSON.stringify({ teams: [team] }));
  fs.writeFileSync(output, "previous output");
  fs.writeFileSync(`${output}.report.json`, oldReport);
  try {
    await assert.rejects(main(["--input", input, "--output", output], { apiKey: "test-only", fetchImpl: async () => { assert.fail("Must not call API"); } }), /versiones o entradas no compatibles/);
    assert.equal(fs.readFileSync(`${output}.report.json`, "utf8"), oldReport);
    assert.equal(fs.readFileSync(output, "utf8"), "previous output");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("checkpoint resumes the next club, preserves unrelated data, and rejects changed input", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ofm-enrichment-"));
  const input = path.join(dir, "world.json");
  const output = path.join(dir, "enriched.json");
  const original = JSON.stringify({ teams: [team, { ...team, id: "other", name: "Other FC" }], players: [{ id: "p1", team_id: "real", wage: 52_000_000 }], competitions: [{ id: "c1" }] });
  fs.writeFileSync(input, original);
  const calls = [];
  const fetchImpl = async (url, request) => {
    const club = JSON.parse(JSON.parse(request.body).input);
    calls.push(club.club_id);
    return Response.json({ status: "completed", id: "response-test", output: [
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...result(), club_id: club.club_id }) }] },
    ] });
  };
  const args = ["--input", input, "--output", output, "--as-of", "2026-09-27"];
  try {
    await main([...args, "--limit", "1"], { apiKey: "test-only", fetchImpl });
    fs.unlinkSync(output); // Simulate a crash after checkpoint commit but before output commit.
    await main(args, { apiKey: "test-only", fetchImpl });
    await main(args, { apiKey: "test-only", fetchImpl });
    assert.deepEqual(calls, ["real", "other"]);
    assert.equal(fs.readFileSync(input, "utf8"), original);
    const enriched = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(enriched.teams[0].city, "Madrid");
    assert.equal(enriched.teams[1].city, "Madrid");
    const report = JSON.parse(fs.readFileSync(`${output}.report.json`, "utf8"));
    assert.equal(report.config.version, 5);
    assert.equal(report.config.webSearch, false);
    assert.equal(report.config.reasoningEffort, "none");
    assert.equal(report.clubs.real.model, "gpt-5.6-luna");
    assert.equal(report.clubs.real.basis, "model_knowledge");
    assert.ok(report.clubs.real.estimated_fields.includes("finance"));
    assert.equal(enriched.teams[0].wage_budget, 57_200_000);
    assert.equal(enriched.teams[0].finance, 23_400_000);
    assert.equal(enriched.teams[0].transfer_budget, 10_400_000);
    assert.equal(enriched.teams[0].kits.home.pattern, "Solid");
    assert.equal(enriched.teams[0].kits.away.pattern, "Diagonal");
    assert.deepEqual(enriched.teams[0].colors, enriched.teams[0].kits.home.colors);
    assert.deepEqual(enriched.players, JSON.parse(original).players);
    assert.deepEqual(enriched.competitions, JSON.parse(original).competitions);
    fs.writeFileSync(input, `${original}\n`);
    await assert.rejects(main(args, { apiKey: "test-only", fetchImpl }), /cambiaron/);
    assert.equal(calls.length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("finance calibration uses annual player/staff salaries and exact loan shares", () => {
  const world = {
    players: [
      { team_id: "real", wage: 52_000_000 },
      { team_id: "borrower", wage: 10_000_000, active_loan: { parent_team_id: "real", loan_team_id: "borrower", wage_contribution_pct: 40 } },
      { team_id: "real", wage: 20_000_000, active_loan: { parent_team_id: "parent", loan_team_id: "real", wage_contribution_pct: 25 } },
      { team_id: "other", wage: 99_000_000 },
    ],
    staff: [{ team_id: "real", wage: 1_000_000 }, { team_id: "other", wage: 5_000_000 }],
  };
  const calibrated = calibrateFinances(world, "real");
  assert.equal(calibrated.calibration.annual_wage_bill, 64_000_000);
  assert.deepEqual(calibrated.patch, { wage_budget: 70_400_000, transfer_budget: 12_800_000, finance: 28_800_000 });
  assert.equal(calibrated.calibration.wage_unit, "annual");
  assert.deepEqual(calibrateFinances({ players: [] }, "real").patch, {});
  assert.throws(() => calibrateFinances({ players: [{ team_id: "real", wage: -1 }] }, "real"));
});

test("v3 results are recalibrated and resumed without calling OpenAI again", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ofm-finance-upgrade-"));
  const input = path.join(dir, "world.json");
  const output = path.join(dir, "enriched.json");
  fs.writeFileSync(input, JSON.stringify({ teams: [team], players: [{ team_id: team.id, wage: 52_000_000 }] }));
  const args = ["--input", input, "--output", output, "--as-of", "2026-09-27"];
  try {
    await main(args, { apiKey: "test-only", fetchImpl: async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result()) }] }] }) });
    let report = JSON.parse(fs.readFileSync(`${output}.report.json`, "utf8"));
    report.config = { version: 3, input: report.config.input, sha256: report.config.sha256, model: "gpt-4.1-mini", asOf: report.config.asOf, factsOnly: false, webSearch: false };
    delete report.clubs.real.model;
    report.clubs.real.patch.finance = 700_000_000;
    report.clubs.real.patch.wage_budget = 1_300_000;
    fs.writeFileSync(`${output}.report.json`, JSON.stringify(report));
    await main(args, { fetchImpl: async () => { assert.fail("Completed clubs must not call the API again"); } });
    let updated = JSON.parse(fs.readFileSync(`${output}.report.json`, "utf8"));
    assert.equal(updated.config.version, 5);
    assert.equal(updated.clubs.real.patch.wage_budget, 57_200_000);
    assert.equal(updated.clubs.real.patch.finance, 23_400_000);
    assert.equal(updated.clubs.real.model_financial_proposal.finance, 700_000_000);
    assert.equal(updated.clubs.real.model, "gpt-4.1-mini");

    updated.config = { ...updated.config, version: 4, model: "gpt-4.1-mini" };
    updated.migrations = [];
    fs.writeFileSync(`${output}.report.json`, JSON.stringify(updated));
    await main(args, { fetchImpl: async () => { assert.fail("v4 results must not call the API again"); } });
    updated = JSON.parse(fs.readFileSync(`${output}.report.json`, "utf8"));
    assert.equal(updated.config.version, 5);
    assert.equal(updated.migrations.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("both kits require allowed patterns, palette colors and a distinct away primary", () => {
  for (const mutation of [
    (r) => { r.fields.kits.away.pattern = "Dots"; },
    (r) => { r.fields.kits.home.colors.primary = "#123456"; },
    (r) => { delete r.fields.kits.away; },
    (r) => { r.fields.kits.away.colors.primary = "#FFFFFF"; },
    (r) => { r.fields.kits.away.colors.secondary = "#00205B"; },
  ]) {
    const response = result();
    mutation(response);
    assert.throws(() => validateResult(response, team, {}));
  }
  for (const pattern of ["Solid", "Stripes", "Hoops", "HalfAndHalf", "Diagonal"]) {
    const response = result();
    response.fields.kits.home.pattern = pattern;
    assert.equal(applyPatch(team, validateResult(response, team, {}).patch).kit_pattern, pattern);
  }
});

test("unknown kits preserve existing home and away data and legacy club colors", () => {
  const response = result();
  response.fields.kits = null;
  const original = { ...team, kits: result().fields.kits, kit_pattern: "Hoops" };
  const updated = applyPatch(original, validateResult(response, original, {}).patch);
  assert.deepEqual(updated.kits, original.kits);
  assert.deepEqual(updated.colors, original.colors);
  assert.equal(updated.kit_pattern, original.kit_pattern);
});

test("temporary rate limits retry; authentication and exhausted quota stop immediately", async () => {
  let attempts = 0;
  const fetchImpl = async () => ++attempts === 1
    ? Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 })
    : Response.json({ status: "completed" });
  const response = await requestOpenAI({}, "test-only", { fetchImpl, sleep: async () => {} });
  assert.equal(response.status, "completed");
  assert.equal(attempts, 2);
  for (const [status, code] of [[401, "invalid_api_key"], [429, "insufficient_quota"]]) {
    let calls = 0;
    await assert.rejects(requestOpenAI({}, "test-only", {
      fetchImpl: async () => { calls += 1; return Response.json({ error: { code } }, { status }); },
      sleep: async () => {},
    }), (error) => error.fatal === true);
    assert.equal(calls, 1);
  }
});
