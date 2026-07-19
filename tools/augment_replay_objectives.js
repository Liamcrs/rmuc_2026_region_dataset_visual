const fs = require("fs");

const OBJECTIVES = [
  { id: 10, no: 10, type: "基地", side: "红", x: 1.08, y: 7.5, maxHp: 5000, heading: 0 },
  { id: 11, no: 11, type: "前哨站", side: "红", x: 6.22, y: 7.45, maxHp: 1500, heading: 0 },
  { id: 110, no: 10, type: "基地", side: "蓝", x: 26.92, y: 7.5, maxHp: 5000, heading: 180 },
  { id: 111, no: 11, type: "前哨站", side: "蓝", x: 21.78, y: 7.45, maxHp: 1500, heading: 180 },
];

function objectiveHpAt(events, objective, time) {
  const damage = events
    .filter((event) => event.type === "受击")
    .filter((event) => Number(event.robot_id) === objective.id)
    .filter((event) => Number(event.t) <= time)
    .reduce((total, event) => total + Math.abs(Number(event.value) || 0), 0);
  return Math.max(0, objective.maxHp - damage);
}

function augmentReplay(file) {
  const replay = JSON.parse(fs.readFileSync(file, "utf8"));
  const schools = Object.fromEntries((replay.entities || []).map((entity) => [entity.side, entity.school]));

  for (const objective of OBJECTIVES) {
    if (!replay.entities.some((entity) => entity.side === objective.side && entity.type === objective.type)) {
      replay.entities.push({
        id: objective.id,
        no: objective.no,
        type: objective.type,
        side: objective.side,
        school: schools[objective.side] || "",
      });
    }
  }

  const objectiveIndexes = OBJECTIVES.map((objective) => ({
    ...objective,
    index: replay.entities.findIndex((entity) => entity.side === objective.side && entity.type === objective.type),
  }));

  replay.frames = (replay.frames || []).map((frame) => {
    const mobileStates = (frame.s || []).filter((values) => {
      const entity = replay.entities[values[0]];
      return entity && !["基地", "前哨站"].includes(entity.type);
    });
    const objectiveStates = objectiveIndexes.map((objective) => [
      objective.index,
      objective.x,
      objective.y,
      objectiveHpAt(replay.events || [], objective, Number(frame.t) || 0),
      objective.maxHp,
      0,
      0,
      0,
      0,
      0,
      0,
      objective.heading,
    ]);
    return { ...frame, s: [...mobileStates, ...objectiveStates] };
  });

  fs.writeFileSync(file, `${JSON.stringify(replay)}\n`);
  return {
    file,
    entities: replay.entities.length,
    frames: replay.frames.length,
  };
}

const results = [];
for (let i = 1; i <= 96; i += 1) {
  results.push(augmentReplay(`data/battlescope_replays/match_${String(i).padStart(3, "0")}.json`));
}

const indexPath = "data/battlescope_replay_index.csv";
const rows = fs.readFileSync(indexPath, "utf8").trim().split(/\r?\n/);
const header = rows[0];
const updated = rows.slice(1).map((row, i) => {
  const columns = row.split(",");
  columns[2] = String(results[i].entities);
  return columns.join(",");
});
fs.writeFileSync(indexPath, `${[header, ...updated].join("\n")}\n`);

console.log(`Augmented ${results.length} replay files with objectives`);
