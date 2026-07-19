const fs = require("fs");

const problems = [];
const OBJECTIVE_POSITIONS = {
  "红-基地": [2.46, 7.44],
  "红-前哨站": [10.87, 3.58],
  "蓝-前哨站": [17.12, 11.32],
  "蓝-基地": [25.73, 7.44],
};

function closeEnough(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, ""));
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  );
}

const h2hRows = parseCsv(fs.readFileSync("data/all_handbook_h2h_matches_visuals.csv", "utf8"));
const expectedReplayCount = h2hRows.reduce((total, row) => total + Number(row["局数"] || 0), 0);
const indexRows = parseCsv(fs.readFileSync("data/battlescope_replay_index.csv", "utf8"));

if (indexRows.length !== expectedReplayCount) {
  problems.push(`replay index has ${indexRows.length} rows, expected ${expectedReplayCount} single games`);
}

for (const row of indexRows) {
  const file = row.file;
  if (!fs.existsSync(file)) {
    problems.push(`${file}: missing`);
    continue;
  }

  const replay = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    !replay.meta ||
    !Array.isArray(replay.entities) ||
    !Array.isArray(replay.frames) ||
    !Array.isArray(replay.events)
  ) {
    problems.push(`${file}: invalid top-level shape`);
  }
  if (!replay.frames.some((frame) => Array.isArray(frame.s) && frame.s.length > 0)) {
    problems.push(`${file}: no populated frames`);
  }
  for (const side of ["红", "蓝"]) {
    for (const type of ["基地", "前哨站"]) {
      const entity = replay.entities.find((item) => item.side === side && item.type === type);
      if (!entity) {
        problems.push(`${file}: missing ${side}${type}`);
        continue;
      }
      const entityIndex = replay.entities.indexOf(entity);
      const expected = OBJECTIVE_POSITIONS[`${side}-${type}`];
      const badFrame = replay.frames.find((frame) => {
        const state = (frame.s || []).find((values) => values[0] === entityIndex);
        return !state || !closeEnough(state[1], expected[0]) || !closeEnough(state[2], expected[1]);
      });
      if (badFrame) {
        problems.push(`${file}: ${side}${type} coordinate mismatch at ${badFrame.t}s`);
      }
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log("BattleScope replay data OK");
