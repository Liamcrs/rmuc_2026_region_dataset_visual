const fs = require("fs");
const { execFileSync } = require("child_process");

const DATABASE = "/Users/chaoran/Documents/RoboMaster/2026赛季/分区赛数据分析/rmuc_2026_region_dataset.sqlite";
const FIELD_WIDTH = 28;
const FIELD_HEIGHT = 15;
const REPLAY_DIR = "data/battlescope_replays";

const OBJECTIVES = [
  { id: 10, no: 10, type: "基地", side: "红", x: 2.46, y: 7.44, maxHp: 5000, heading: 0 },
  { id: 11, no: 11, type: "前哨站", side: "红", x: 10.87, y: 3.58, maxHp: 1500, heading: 0 },
  { id: 110, no: 10, type: "基地", side: "蓝", x: 25.73, y: 7.44, maxHp: 5000, heading: 180 },
  { id: 111, no: 11, type: "前哨站", side: "蓝", x: 17.12, y: 11.32, maxHp: 1500, heading: 180 },
];

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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(path, rows, headers) {
  const lines = [headers.join(",")];
  rows.forEach((row) => lines.push(headers.map((header) => csvCell(row[header])).join(",")));
  fs.writeFileSync(path, `${lines.join("\n")}\n`);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function query(sql) {
  const output = execFileSync("sqlite3", ["-json", DATABASE, sql], { encoding: "utf8", maxBuffer: 1024 * 1024 * 256 });
  return output.trim() ? JSON.parse(output) : [];
}

function numberOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(numberOf(value) * factor) / factor;
}

function robotNo(robotId) {
  if (!robotId && robotId !== 0) return null;
  const id = Number(robotId);
  return id >= 100 ? id - 100 : id;
}

function entitySort(a, b) {
  const sideOrder = a.side === b.side ? 0 : a.side === "红" ? -1 : 1;
  return sideOrder || numberOf(a.no) - numberOf(b.no);
}

function eventKey(row) {
  return [
    round(row["时刻秒"], 1),
    row["事件类型"] || "",
    row.robot_id ?? "",
    row["机器人类型"] || "",
    row["阵营"] || "",
    row["学校名"] || "",
    row["目标robot_id"] ?? "",
    row["目标类型"] || "",
    row["类别"] || "",
  ].join("|");
}

function buildEvents(gameId) {
  const rows = query(`
    SELECT 时刻秒,事件类型,robot_id,机器人类型,阵营,学校名,目标robot_id,目标类型,类别,数值
    FROM events
    WHERE game_id=${Number(gameId)}
    ORDER BY 时刻秒,事件类型,robot_id
  `);
  const grouped = new Map();
  rows.forEach((row) => {
    const key = eventKey(row);
    if (!grouped.has(key)) {
      grouped.set(key, {
        t: round(row["时刻秒"], 1),
        type: row["事件类型"] || "",
        robot_id: row.robot_id ?? null,
        no: robotNo(row.robot_id),
        robot_type: row["机器人类型"] || "",
        side: row["阵营"] || "",
        school: row["学校名"] || "",
        target_robot_id: row["目标robot_id"] ?? null,
        target_no: robotNo(row["目标robot_id"]),
        target_type: row["目标类型"] || "",
        category: row["类别"] || "",
        count: 0,
        value: 0,
      });
    }
    const event = grouped.get(key);
    event.count += 1;
    event.value += numberOf(row["数值"]);
  });
  return [...grouped.values()].sort((a, b) => a.t - b.t);
}

function objectiveHpAt(events, objective, time) {
  const damage = events
    .filter((event) => event.type === "受击")
    .filter((event) => Number(event.robot_id) === objective.id)
    .filter((event) => Number(event.t) <= time)
    .reduce((total, event) => total + Math.abs(Number(event.value) || 0), 0);
  return Math.max(0, objective.maxHp - damage);
}

function buildReplay(replayId, h2hRow, gameRow) {
  const timeseries = query(`
    SELECT 时刻秒,robot_id,机器人类型,阵营,学校名,当前血量,最大血量,x,y,枪口朝向,小热量,小热量上限,累计17mm发弹,累计42mm发弹,是否易伤
    FROM timeseries
    WHERE game_id=${Number(gameRow.game_id)}
      AND 机器人类型 NOT IN ('基地','前哨站')
    ORDER BY 时刻秒,robot_id
  `);
  const entityMap = new Map();
  timeseries.forEach((row) => {
    if (!entityMap.has(row.robot_id)) {
      entityMap.set(row.robot_id, {
        id: row.robot_id,
        no: robotNo(row.robot_id),
        type: row["机器人类型"] || "",
        side: row["阵营"] || "",
        school: row["学校名"] || "",
      });
    }
  });
  const entities = [...entityMap.values()].sort(entitySort);
  const entityIndex = new Map(entities.map((entity, index) => [entity.id, index]));
  const schools = Object.fromEntries(entities.map((entity) => [entity.side, entity.school]));
  OBJECTIVES.forEach((objective) => {
    entityIndex.set(objective.id, entities.length);
    entities.push({
      id: objective.id,
      no: objective.no,
      type: objective.type,
      side: objective.side,
      school: schools[objective.side] || (objective.side === "红" ? h2hRow["红方学校"] : h2hRow["蓝方学校"]),
    });
  });

  const byTime = new Map();
  timeseries.forEach((row) => {
    const time = round(row["时刻秒"], 1);
    if (time < 1 || Math.round(time) % 2 !== 0) return;
    if (!byTime.has(time)) byTime.set(time, []);
    byTime.get(time).push(row);
  });

  const events = buildEvents(gameRow.game_id);
  const previousShots = new Map();
  const frames = [...byTime.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([time, rows]) => {
      const states = rows
        .sort((a, b) => entityIndex.get(a.robot_id) - entityIndex.get(b.robot_id))
        .map((row) => {
          const index = entityIndex.get(row.robot_id);
          const shots = numberOf(row["累计17mm发弹"]) + numberOf(row["累计42mm发弹"]);
          const shotDelta = Math.max(0, shots - numberOf(previousShots.get(row.robot_id)));
          previousShots.set(row.robot_id, shots);
          return [
            index,
            round(row.x),
            round(row.y),
            round(row["当前血量"], 1),
            round(row["最大血量"], 1),
            round(row["小热量"], 1),
            round(row["小热量上限"], 1),
            round(row["累计17mm发弹"], 1),
            round(row["累计42mm发弹"], 1),
            round(shotDelta, 1),
            numberOf(row["是否易伤"]) ? 1 : 0,
            round(row["枪口朝向"], 1),
          ];
        });
      OBJECTIVES.forEach((objective) => {
        states.push([
          entityIndex.get(objective.id),
          objective.x,
          objective.y,
          objectiveHpAt(events, objective, Number(time)),
          objective.maxHp,
          0,
          0,
          0,
          0,
          0,
          0,
          objective.heading,
        ]);
      });
      return { t: Number(time), s: states };
    });

  const winningSchool = gameRow["胜方"] === "红" ? h2hRow["红方学校"] : h2hRow["蓝方学校"];
  const file = `${REPLAY_DIR}/match_${String(replayId).padStart(3, "0")}.json`;
  const replay = {
    meta: {
      match_id: String(replayId),
      h2h_id: Number(h2hRow["序号"]),
      game_id: Number(gameRow.game_id),
      round_no: Number(gameRow["局号"]),
      title: `${h2hRow["红方学校"]} ${h2hRow["红胜局"]}:${h2hRow["蓝胜局"]} ${h2hRow["蓝方学校"]}`,
      subtitle: `${h2hRow["赛区"]} 第${h2hRow["场次号"]}场 · 第${gameRow["局号"]}局 · 本局胜方 ${winningSchool}`,
      duration: Math.max(...frames.map((frame) => frame.t), Number(gameRow["时长秒"]) || 420),
      field_width: FIELD_WIDTH,
      field_height: FIELD_HEIGHT,
    },
    entities,
    frames,
    events,
  };
  fs.writeFileSync(file, `${JSON.stringify(replay)}\n`);
  return {
    replay_id: replayId,
    match_seq: h2hRow["序号"],
    round_no: gameRow["局号"],
    game_id: gameRow.game_id,
    赛区: h2hRow["赛区"],
    场次号: h2hRow["场次号"],
    红方学校: h2hRow["红方学校"],
    蓝方学校: h2hRow["蓝方学校"],
    红胜局: h2hRow["红胜局"],
    蓝胜局: h2hRow["蓝胜局"],
    胜方学校: h2hRow["胜方学校"],
    本局胜方: gameRow["胜方"],
    本局胜方学校: winningSchool,
    entities: entities.length,
    frames: frames.length,
    events: events.length,
    file,
  };
}

fs.mkdirSync(REPLAY_DIR, { recursive: true });

const h2hRows = parseCsv(fs.readFileSync("data/all_handbook_h2h_matches_visuals.csv", "utf8"));
const indexRows = [];
let replayId = 1;

for (const h2hRow of h2hRows) {
  const games = query(`
    SELECT game_id,局号,胜方,时长秒
    FROM matches
    WHERE 赛区=${sqlString(h2hRow["赛区"])}
      AND 场次号=${Number(h2hRow["场次号"])}
      AND 红方学校=${sqlString(h2hRow["红方学校"])}
      AND 蓝方学校=${sqlString(h2hRow["蓝方学校"])}
    ORDER BY 局号
  `);
  if (games.length !== Number(h2hRow["局数"])) {
    throw new Error(`${h2hRow["赛区"]} 第${h2hRow["场次号"]}场局数不匹配: ${games.length}/${h2hRow["局数"]}`);
  }
  games.forEach((gameRow) => {
    indexRows.push(buildReplay(replayId, h2hRow, gameRow));
    replayId += 1;
  });
}

writeCsv("data/battlescope_replay_index.csv", indexRows, [
  "replay_id",
  "match_seq",
  "round_no",
  "game_id",
  "赛区",
  "场次号",
  "红方学校",
  "蓝方学校",
  "红胜局",
  "蓝胜局",
  "胜方学校",
  "本局胜方",
  "本局胜方学校",
  "entities",
  "frames",
  "events",
  "file",
]);

console.log(`Generated ${indexRows.length} single-game BattleScope replays`);
