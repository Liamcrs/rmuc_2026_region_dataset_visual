const fs = require("fs");

const problems = [];

for (let i = 1; i <= 96; i += 1) {
  const file = `data/battlescope_replays/match_${String(i).padStart(3, "0")}.json`;
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
      }
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log("BattleScope replay data OK");
