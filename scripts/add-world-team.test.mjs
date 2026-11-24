import assert from "node:assert/strict";
import test from "node:test";
import { addWorldTeam } from "./add-world-team.mjs";

const attributes = Object.fromEntries(
  [
    "pace",
    "stamina",
    "strength",
    "agility",
    "passing",
    "shooting",
    "tackling",
    "dribbling",
    "defending",
    "positioning",
    "vision",
    "decisions",
    "composure",
    "aggression",
    "teamwork",
    "leadership",
    "handling",
    "reflexes",
    "aerial",
  ].map((key) => [key, 70]),
);

const team = {
  id: "sofifa-club-1970",
  name: "Tigres UANL",
  country: "MX",
  city: "San Nicolás de los Garza",
  stadium_name: "Estadio Universitario",
  formation: "4-2-3-1",
  reputation: 35,
  colors: { primary: "#003DA5", secondary: "#FFD100" },
};

const player = (id) => ({
  id,
  match_name: "N. Guzmán",
  full_name: "Nahuel Ignacio Guzmán Palomeque",
  team_id: team.id,
  position: "Goalkeeper",
  natural_position: "Goalkeeper",
  attributes,
  potential: 79,
});

const world = {
  teams: [{ id: "top5-club-243-0", name: "Real Madrid" }],
  players: [{ id: "top5-player-252371" }],
};

test("appends the club and its squad without touching the existing world", () => {
  const updated = addWorldTeam(world, { team, players: [player("p-1"), player("p-2")] });

  assert.deepEqual(updated.teams, [...world.teams, team]);
  assert.equal(updated.players.length, 3);
  assert.deepEqual(updated.players.slice(0, 1), world.players);
  assert.equal(updated.players[1].team_id, team.id);
  // The patch and the source world are inputs, not working copies.
  assert.equal(world.teams.length, 1);
  assert.equal(world.players.length, 1);
});

test("rejects a club id that already exists", () => {
  assert.throws(
    () => addWorldTeam(world, { team: { ...team, id: "top5-club-243-0" }, players: [] }),
    /already exists/,
  );
});

test("rejects duplicate player ids, including ids already in the world", () => {
  assert.throws(
    () => addWorldTeam(world, { team, players: [player("p-1"), player("p-1")] }),
    /already exists/,
  );
  assert.throws(
    () => addWorldTeam(world, { team, players: [player("top5-player-252371")] }),
    /already exists/,
  );
});

test("rejects a squad member that points at another club", () => {
  assert.throws(
    () => addWorldTeam(world, { team, players: [{ ...player("p-1"), team_id: "other" }] }),
    /points at other/,
  );
});

test("rejects unknown positions and incomplete attributes", () => {
  assert.throws(
    () =>
      addWorldTeam(world, {
        team,
        players: [{ ...player("p-1"), position: "Sweeper" }],
      }),
    /unknown position/,
  );
  assert.throws(
    () =>
      addWorldTeam(world, {
        team,
        players: [{ ...player("p-1"), attributes: { ...attributes, pace: 120 } }],
      }),
    /attributes/,
  );
});

test("rejects repeated shirt numbers where the game requires unique ones", () => {
  assert.throws(
    () =>
      addWorldTeam(world, {
        team,
        players: [
          { ...player("p-1"), jersey_number: 26 },
          { ...player("p-2"), jersey_number: 26 },
        ],
      }),
    /repeats shirt number 26/,
  );
  // Null means "no number assigned" and may repeat.
  assert.doesNotThrow(() =>
    addWorldTeam(world, {
      team,
      players: [
        { ...player("p-1"), jersey_number: null },
        { ...player("p-2"), jersey_number: null },
      ],
    }),
  );
});

test("rejects a club with no squad", () => {
  assert.throws(() => addWorldTeam(world, { team, players: [] }), /no players/);
});
