const fs = require("fs");

const index = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const requiredHtml = [
  'data-view="replay"',
  'id="replay"',
  'id="battleReplaySearch"',
  'id="battleReplaySide"',
  'id="battleReplayList"',
  'id="battleReplayCanvas"',
  'id="battleReplayEconomy"',
  'id="battleReplayRedRoster"',
  'id="battleReplayBlueRoster"',
  'id="battleReplayDetail"',
  'id="battleReplaySlider"',
  'id="battleReplayPlay"',
  'id="battleReplaySpeed"',
  'id="battleReplayTrail"',
  'id="battleReplayDamageToggle"',
  'id="battleReplayTrackFilters"',
  'id="battleReplayEventFilters"',
  'id="openReplayFromMatch"',
];

const requiredApp = [
  "function buildReplayModel(",
  "function stateAt(",
  "function renderReplayMatches(",
  "function replayGamesForMatch(",
  "function loadReplayMatch(",
  "function renderReplayFrame(",
  "function renderReplayEventPanel(",
  "function renderReplayEconomy(",
  "function drawReplayCanvas(",
  "function interpolatedReplayState(",
  "function drawReplayObjectiveHud(",
  "function startSmoothReplayPlayback(",
  "function stopReplayPlayback(",
  "function nextReplayTime(",
  "./data/battlescope_replay_index.csv",
];

const requiredStyles = [
  ".replay-layout",
  ".replay-battle-grid",
  ".replay-stage",
  ".replay-roster",
  ".replay-unit-card",
  ".replay-round-list",
  ".replay-event-grid",
];

const problems = [];

for (const needle of requiredHtml) {
  if (!index.includes(needle)) problems.push(`index.html missing ${needle}`);
}

for (const needle of requiredApp) {
  if (!app.includes(needle)) problems.push(`app.js missing ${needle}`);
}

for (const needle of requiredStyles) {
  if (!styles.includes(needle)) problems.push(`styles.css missing ${needle}`);
}

if (index.includes("battlescope-tool")) {
  problems.push("index.html still contains embedded battlescope-tool");
}

if (index.includes("96 场代表局") || app.includes("96 场代表局")) {
  problems.push("stale representative replay copy remains");
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log("Standalone replay module structure OK");
