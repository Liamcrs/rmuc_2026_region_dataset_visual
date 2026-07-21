const fs = require("fs");
const { execFileSync } = require("child_process");

const DATABASE = "/Users/chaoran/Documents/RoboMaster/2026赛季/分区赛数据分析/rmuc_2026_region_dataset.sqlite";
const QUALIFIED_FILE = "data/all_qualified_team_tactical_profile_metrics.csv";
const OUTPUT_FILE = "data/analysis_buff_type_summary.csv";

const headers = [
  "学校名",
  "队伍类别",
  "事件类型",
  "增益类型",
  "机器人类型",
  "触发次数",
  "覆盖局数",
  "覆盖场数",
  "学校触发次数",
  "学校覆盖局数",
  "学校覆盖场数",
  "类型覆盖局数",
  "类型覆盖场数",
  "统计范围局数",
  "统计范围场数",
  "平均首次触发时间",
  "最早触发时间",
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
  const csvHeaders = rows.shift().map((header) => header.replace(/^\uFEFF/, ""));
  return rows.map((values) =>
    Object.fromEntries(csvHeaders.map((header, index) => [header, values[index] ?? ""]))
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(path, rows) {
  const lines = [headers.join(",")];
  rows.forEach((row) => lines.push(headers.map((header) => csvCell(row[header])).join(",")));
  fs.writeFileSync(path, `${lines.join("\n")}\n`);
}

function query(sql) {
  const output = execFileSync("sqlite3", ["-json", DATABASE, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });
  return output.trim() ? JSON.parse(output) : [];
}

function round(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function numberOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

const qualifiedRows = parseCsv(fs.readFileSync(QUALIFIED_FILE, "utf8"));
const qualifiedBySchool = new Map(
  qualifiedRows.map((row) => [row["学校名"], row["手册参赛类别"] || row["队伍类别"] || ""])
);
const regionalScope = query(`
  SELECT
    COUNT(*) AS games,
    COUNT(DISTINCT 赛区 || '|' || 赛程 || '|' || 场次号) AS matches
  FROM matches
`)[0];
const matchSchools = new Set(query(`
  SELECT 红方学校 AS school FROM matches WHERE 红方学校 IS NOT NULL AND 红方学校 != ''
  UNION
  SELECT 蓝方学校 AS school FROM matches WHERE 蓝方学校 IS NOT NULL AND 蓝方学校 != ''
`).map((row) => row.school));

function schoolCategory(school) {
  return qualifiedBySchool.get(school) || "分区赛队伍";
}

function typeKey(eventType, buffType) {
  return `${eventType}|${buffType}`;
}

function armCountOf(note) {
  const match = String(note || "").match(/arm_cnt=([0-9.]+)/);
  return match ? numberOf(match[1]) : 0;
}

function countActivations(events) {
  let count = 0;
  let previousArmCount = 0;
  let sequenceMax = 0;
  let sequenceStart = null;
  const firstTimes = [];
  events.forEach((event) => {
    const armCount = armCountOf(event.note);
    if (!armCount) return;
    if (previousArmCount && armCount <= previousArmCount) {
      if (sequenceMax >= 5) {
        count += 1;
        firstTimes.push(sequenceStart);
      }
      sequenceMax = 0;
      sequenceStart = null;
    }
    if (sequenceStart === null) sequenceStart = numberOf(event.t);
    sequenceMax = Math.max(sequenceMax, armCount);
    previousArmCount = armCount;
  });
  if (sequenceMax >= 5) {
    count += 1;
    firstTimes.push(sequenceStart);
  }
  return { count, firstTimes };
}

const energyEvents = query(`
  SELECT
    game_id,
    阵营 AS side,
    学校名 AS school,
    赛区 AS region,
    赛程 AS schedule,
    场次号 AS match_no,
    CASE
      WHEN 类别 = 'rune_type=1.0' THEN '小能量机关'
      WHEN 类别 = 'rune_type=0.0' THEN '大能量机关'
    END AS buff_type,
    时刻秒 AS t,
    备注 AS note
  FROM events
  WHERE 事件类型 = '能量机关'
    AND 类别 IN ('rune_type=1.0', 'rune_type=0.0')
    AND 学校名 IS NOT NULL
    AND 学校名 != ''
  ORDER BY game_id, side, buff_type, t, note
`);
const groups = new Map();
const energyTypeCoverage = new Map();

const energyByGameSideType = new Map();
energyEvents
  .filter((row) => matchSchools.has(row.school))
  .forEach((row) => {
    const key = `${row.game_id}|${row.side}|${row.buff_type}`;
    if (!energyByGameSideType.has(key)) energyByGameSideType.set(key, []);
    energyByGameSideType.get(key).push(row);
  });

energyByGameSideType.forEach((events) => {
  const first = events[0];
  const activation = countActivations(events);
  if (!activation.count) return;
  const effectKey = typeKey("能量机关", first.buff_type);
  if (!energyTypeCoverage.has(effectKey)) {
    energyTypeCoverage.set(effectKey, { games: new Set(), matches: new Set() });
  }
  energyTypeCoverage.get(effectKey).games.add(first.game_id);
  energyTypeCoverage.get(effectKey).matches.add(`${first.region}|${first.schedule}|${first.match_no}`);
  const key = `${first.school}|${first.buff_type}`;
  if (!groups.has(key)) {
    groups.set(key, {
      school: first.school,
      category: schoolCategory(first.school),
      buffType: first.buff_type,
      activations: 0,
      games: new Set(),
      matches: new Set(),
      firstTimes: [],
    });
  }
  const group = groups.get(key);
  group.activations += activation.count;
  group.games.add(first.game_id);
  group.matches.add(`${first.region}|${first.schedule}|${first.match_no}`);
  group.firstTimes.push(...activation.firstTimes);
});

const nonEnergyRows = query(`
  WITH source AS (
    SELECT
      学校名,
      赛区,
      场次号,
      '增益' AS 事件类型,
      COALESCE(NULLIF(类别, ''), '未标注') AS 增益类型,
      COALESCE(NULLIF(机器人类型, ''), '全队') AS 机器人类型,
      game_id,
      赛程,
      时刻秒
    FROM events
    WHERE 事件类型 = '增益'
      AND COALESCE(NULLIF(类别, ''), '未标注') NOT IN ('小能量机关增益', '大能量机关增益')
      AND 学校名 IS NOT NULL
      AND 学校名 != ''
  ),
  first_times AS (
    SELECT
      学校名,
      事件类型,
      增益类型,
      机器人类型,
      game_id,
      MIN(时刻秒) AS first_t
    FROM source
    GROUP BY 学校名, 事件类型, 增益类型, 机器人类型, game_id
  ),
  first_summary AS (
    SELECT
      学校名,
      事件类型,
      增益类型,
      机器人类型,
      AVG(first_t) AS 平均首次触发时间
    FROM first_times
    GROUP BY 学校名, 事件类型, 增益类型, 机器人类型
  ),
  counts AS (
    SELECT
      学校名,
      事件类型,
      增益类型,
      机器人类型,
      COUNT(*) AS 触发次数,
      COUNT(DISTINCT game_id) AS 覆盖局数,
      COUNT(DISTINCT 赛区 || '|' || 赛程 || '|' || 场次号) AS 覆盖场数,
      MIN(时刻秒) AS 最早触发时间
    FROM source
    GROUP BY 学校名, 事件类型, 增益类型, 机器人类型
  ),
  school_counts AS (
    SELECT
      学校名,
      事件类型,
      增益类型,
      COUNT(*) AS 学校触发次数,
      COUNT(DISTINCT game_id) AS 学校覆盖局数,
      COUNT(DISTINCT 赛区 || '|' || 赛程 || '|' || 场次号) AS 学校覆盖场数
    FROM source
    GROUP BY 学校名, 事件类型, 增益类型
  ),
  type_counts AS (
    SELECT
      事件类型,
      增益类型,
      COUNT(DISTINCT game_id) AS 类型覆盖局数,
      COUNT(DISTINCT 赛区 || '|' || 赛程 || '|' || 场次号) AS 类型覆盖场数
    FROM source
    GROUP BY 事件类型, 增益类型
  )
  SELECT
    counts.学校名 AS 学校名,
    counts.事件类型 AS 事件类型,
    counts.增益类型 AS 增益类型,
    counts.机器人类型 AS 机器人类型,
    counts.触发次数 AS 触发次数,
    counts.覆盖局数 AS 覆盖局数,
    counts.覆盖场数 AS 覆盖场数,
    school_counts.学校触发次数 AS 学校触发次数,
    school_counts.学校覆盖局数 AS 学校覆盖局数,
    school_counts.学校覆盖场数 AS 学校覆盖场数,
    type_counts.类型覆盖局数 AS 类型覆盖局数,
    type_counts.类型覆盖场数 AS 类型覆盖场数,
    first_summary.平均首次触发时间 AS 平均首次触发时间,
    counts.最早触发时间 AS 最早触发时间
  FROM counts
  JOIN first_summary
    ON first_summary.学校名 = counts.学校名
    AND first_summary.事件类型 = counts.事件类型
    AND first_summary.增益类型 = counts.增益类型
    AND first_summary.机器人类型 = counts.机器人类型
  JOIN school_counts
    ON school_counts.学校名 = counts.学校名
    AND school_counts.事件类型 = counts.事件类型
    AND school_counts.增益类型 = counts.增益类型
  JOIN type_counts
    ON type_counts.事件类型 = counts.事件类型
    AND type_counts.增益类型 = counts.增益类型
`);

const outputRows = [...groups.values()]
  .sort((a, b) => b.activations - a.activations || a.school.localeCompare(b.school, "zh-CN") || a.buffType.localeCompare(b.buffType, "zh-CN"))
  .map((row) => {
    const avgFirst = row.firstTimes.length
      ? row.firstTimes.reduce((total, value) => total + value, 0) / row.firstTimes.length
      : "";
    const earliest = row.firstTimes.length ? Math.min(...row.firstTimes) : "";
    const coverage = energyTypeCoverage.get(typeKey("能量机关", row.buffType));
    return {
      "学校名": row.school,
      "队伍类别": row.category,
      "事件类型": "能量机关",
      "增益类型": row.buffType,
      "机器人类型": "全队",
      "触发次数": row.activations,
      "覆盖局数": row.games.size,
      "覆盖场数": row.matches.size,
      "学校触发次数": row.activations,
      "学校覆盖局数": row.games.size,
      "学校覆盖场数": row.matches.size,
      "类型覆盖局数": coverage?.games.size || 0,
      "类型覆盖场数": coverage?.matches.size || 0,
      "统计范围局数": regionalScope.games,
      "统计范围场数": regionalScope.matches,
      "平均首次触发时间": round(avgFirst),
      "最早触发时间": round(earliest),
    };
  })
  .concat(
    nonEnergyRows
      .filter((row) => matchSchools.has(row["学校名"]))
      .map((row) => ({
        "学校名": row["学校名"],
        "队伍类别": schoolCategory(row["学校名"]),
        "事件类型": row["事件类型"],
        "增益类型": row["增益类型"],
        "机器人类型": row["机器人类型"] || "全队",
        "触发次数": row["触发次数"],
        "覆盖局数": row["覆盖局数"],
        "覆盖场数": row["覆盖场数"],
        "学校触发次数": row["学校触发次数"],
        "学校覆盖局数": row["学校覆盖局数"],
        "学校覆盖场数": row["学校覆盖场数"],
        "类型覆盖局数": row["类型覆盖局数"],
        "类型覆盖场数": row["类型覆盖场数"],
        "统计范围局数": regionalScope.games,
        "统计范围场数": regionalScope.matches,
        "平均首次触发时间": round(row["平均首次触发时间"]),
        "最早触发时间": round(row["最早触发时间"]),
      }))
  )
  .sort((a, b) =>
    numberOf(b["学校触发次数"]) - numberOf(a["学校触发次数"]) ||
    String(a["学校名"]).localeCompare(String(b["学校名"]), "zh-CN") ||
    String(a["事件类型"]).localeCompare(String(b["事件类型"]), "zh-CN") ||
    String(a["增益类型"]).localeCompare(String(b["增益类型"]), "zh-CN") ||
    String(a["机器人类型"]).localeCompare(String(b["机器人类型"]), "zh-CN")
  );

writeCsv(OUTPUT_FILE, outputRows);

console.log(`Generated ${outputRows.length} buff type summary rows`);
