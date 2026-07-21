const fs = require("fs");
const { execFileSync } = require("child_process");

const DATABASE = "/Users/chaoran/Documents/RoboMaster/2026赛季/分区赛数据分析/rmuc_2026_region_dataset.sqlite";
const SUMMARY_FILE = "data/analysis_buff_type_summary.csv";
const QUALIFIED_FILE = "data/all_qualified_team_tactical_profile_metrics.csv";
const APP_FILE = "app.js";
const INDEX_FILE = "index.html";
const STYLES_FILE = "styles.css";

const requiredColumns = [
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

const allowedEventTypes = new Set(["增益", "能量机关"]);
const energyBuffTypes = new Set(["小能量机关", "大能量机关"]);
const forbiddenUnitEnergyBuffTypes = new Set(["小能量机关增益", "大能量机关增益"]);

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

function isNumeric(value) {
  return value !== "" && Number.isFinite(Number(value));
}

function numberOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function query(sql) {
  const output = execFileSync("sqlite3", ["-json", DATABASE, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });
  return output.trim() ? JSON.parse(output) : [];
}

function armCountOf(note) {
  const match = String(note || "").match(/arm_cnt=([0-9.]+)/);
  return match ? numberOf(match[1]) : 0;
}

function countActivations(events) {
  let count = 0;
  let previousArmCount = 0;
  let sequenceMax = 0;
  events.forEach((event) => {
    const armCount = armCountOf(event.note);
    if (!armCount) return;
    if (previousArmCount && armCount <= previousArmCount) {
      if (sequenceMax >= 5) count += 1;
      sequenceMax = 0;
    }
    sequenceMax = Math.max(sequenceMax, armCount);
    previousArmCount = armCount;
  });
  if (sequenceMax >= 5) count += 1;
  return count;
}

function expectedEnergyTotals() {
  const events = query(`
    SELECT
      game_id,
      赛区 AS region,
      赛程 AS schedule,
      场次号 AS match_no,
      阵营 AS side,
      学校名 AS school,
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
  const grouped = new Map();
  events.forEach((row) => {
    const key = `${row.game_id}|${row.side}|${row.buff_type}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  const totals = {
    "小能量机关": { count: 0, games: new Set(), matches: new Set() },
    "大能量机关": { count: 0, games: new Set(), matches: new Set() },
  };
  grouped.forEach((rows) => {
    const count = countActivations(rows);
    if (!count) return;
    const first = rows[0];
    totals[first.buff_type].count += count;
    totals[first.buff_type].games.add(first.game_id);
    totals[first.buff_type].matches.add(`${first.region}|${first.schedule}|${first.match_no}`);
  });
  return totals;
}

function expectedNonEnergyTypeCoverage() {
  const rows = query(`
    SELECT
      '增益' AS event_type,
      COALESCE(NULLIF(类别, ''), '未标注') AS buff_type,
      COUNT(*) AS count,
      COUNT(DISTINCT game_id) AS games,
      COUNT(DISTINCT 赛区 || '|' || 赛程 || '|' || 场次号) AS matches
    FROM events
    WHERE 事件类型 = '增益'
      AND COALESCE(NULLIF(类别, ''), '未标注') NOT IN ('小能量机关增益', '大能量机关增益')
      AND 学校名 IS NOT NULL
      AND 学校名 != ''
    GROUP BY event_type, buff_type
  `);
  return new Map(rows.map((row) => [`${row.event_type}|${row.buff_type}`, row]));
}

const problems = [];

if (!fs.existsSync(SUMMARY_FILE)) {
  problems.push(`${SUMMARY_FILE}: missing`);
} else {
  const text = fs.readFileSync(SUMMARY_FILE, "utf8");
  const headerLine = text.split(/\r?\n/, 1)[0].replace(/^\uFEFF/, "");
  const headers = headerLine.split(",");
  for (const column of requiredColumns) {
    if (!headers.includes(column)) problems.push(`${SUMMARY_FILE}: missing column ${column}`);
  }

  const rows = parseCsv(text);
  if (!rows.length) problems.push(`${SUMMARY_FILE}: no rows`);

  const qualifiedRows = parseCsv(fs.readFileSync(QUALIFIED_FILE, "utf8"));
  const qualifiedSchools = new Set(qualifiedRows.map((row) => row["学校名"]));
  const matchSchoolRows = query(`
    SELECT 红方学校 AS school FROM matches WHERE 红方学校 IS NOT NULL AND 红方学校 != ''
    UNION
    SELECT 蓝方学校 AS school FROM matches WHERE 蓝方学校 IS NOT NULL AND 蓝方学校 != ''
  `);
  const matchSchools = new Set(matchSchoolRows.map((row) => row.school));
  let hasNonQualifiedSchool = false;
  rows.forEach((row, index) => {
    if (!matchSchools.has(row["学校名"])) {
      problems.push(`${SUMMARY_FILE}: row ${index + 2} has school not found in regional matches ${row["学校名"]}`);
    }
    if (!qualifiedSchools.has(row["学校名"])) hasNonQualifiedSchool = true;
    for (const column of ["触发次数", "覆盖局数", "覆盖场数", "学校触发次数", "学校覆盖局数", "学校覆盖场数", "类型覆盖局数", "类型覆盖场数", "统计范围局数", "统计范围场数"]) {
      if (!isNumeric(row[column])) problems.push(`${SUMMARY_FILE}: row ${index + 2} invalid numeric ${column}`);
    }
    if (!allowedEventTypes.has(row["事件类型"])) {
      problems.push(`${SUMMARY_FILE}: row ${index + 2} unexpected event type ${row["事件类型"]}`);
    }
    if (forbiddenUnitEnergyBuffTypes.has(row["增益类型"])) {
      problems.push(`${SUMMARY_FILE}: row ${index + 2} should not count unit energy buff ${row["增益类型"]}`);
    }
    if (row["事件类型"] === "能量机关" && !energyBuffTypes.has(row["增益类型"])) {
      problems.push(`${SUMMARY_FILE}: row ${index + 2} unexpected energy type ${row["增益类型"]}`);
    }
    if (row["事件类型"] === "能量机关" && row["机器人类型"] !== "全队") {
      problems.push(`${SUMMARY_FILE}: row ${index + 2} should aggregate energy activation as 全队`);
    }
    if (!row["机器人类型"]) problems.push(`${SUMMARY_FILE}: row ${index + 2} blank robot type`);
    if (!row["队伍类别"]) problems.push(`${SUMMARY_FILE}: row ${index + 2} blank team category`);
  });
  if (!hasNonQualifiedSchool) {
    problems.push(`${SUMMARY_FILE}: should include regional schools outside the handbook-qualified list`);
  }

  for (const buffType of energyBuffTypes) {
    if (!rows.some((row) => row["事件类型"] === "能量机关" && row["增益类型"] === buffType)) {
      problems.push(`${SUMMARY_FILE}: missing ${buffType} rows`);
    }
  }
  if (!rows.some((row) => row["事件类型"] === "增益")) {
    problems.push(`${SUMMARY_FILE}: missing non-energy 增益 rows`);
  }

  const summarySmall = rows
    .filter((row) => row["增益类型"] === "小能量机关")
    .reduce((total, row) => total + Number(row["学校触发次数"]), 0);
  const summaryBig = rows
    .filter((row) => row["增益类型"] === "大能量机关")
    .reduce((total, row) => total + Number(row["学校触发次数"]), 0);
  const expectedEnergy = expectedEnergyTotals();
  const expectedSmall = expectedEnergy["小能量机关"];
  const expectedBig = expectedEnergy["大能量机关"];
  if (summarySmall !== expectedSmall.count) {
    problems.push(`${SUMMARY_FILE}: 小能量机关 total ${summarySmall}, expected activation total ${expectedSmall.count}`);
  }
  if (summaryBig !== expectedBig.count) {
    problems.push(`${SUMMARY_FILE}: 大能量机关 total ${summaryBig}, expected activation total ${expectedBig.count}`);
  }

  const expectedTypeCoverage = expectedNonEnergyTypeCoverage();
  expectedTypeCoverage.set("能量机关|小能量机关", {
    games: expectedSmall.games.size,
    matches: expectedSmall.matches.size,
  });
  expectedTypeCoverage.set("能量机关|大能量机关", {
    games: expectedBig.games.size,
    matches: expectedBig.matches.size,
  });
  for (const [key, expected] of expectedTypeCoverage.entries()) {
    const matchingRows = rows.filter((row) => `${row["事件类型"]}|${row["增益类型"]}` === key);
    if (!matchingRows.length) {
      problems.push(`${SUMMARY_FILE}: missing expected type ${key}`);
      continue;
    }
    const gameValues = new Set(matchingRows.map((row) => Number(row["类型覆盖局数"])));
    const matchValues = new Set(matchingRows.map((row) => Number(row["类型覆盖场数"])));
    if (gameValues.size !== 1 || !gameValues.has(Number(expected.games))) {
      problems.push(`${SUMMARY_FILE}: ${key} 类型覆盖局数 ${[...gameValues].join("/")}, expected ${expected.games}`);
    }
    if (matchValues.size !== 1 || !matchValues.has(Number(expected.matches))) {
      problems.push(`${SUMMARY_FILE}: ${key} 类型覆盖场数 ${[...matchValues].join("/")}, expected ${expected.matches}`);
    }
  }
}

const app = fs.readFileSync(APP_FILE, "utf8");
const index = fs.readFileSync(INDEX_FILE, "utf8");
const styles = fs.readFileSync(STYLES_FILE, "utf8");
const generator = fs.readFileSync("tools/generate_buff_type_summary.js", "utf8");
const requiredApp = [
  "buffTypes: []",
  "selectedBuffEffectType",
  "async function loadCsvWithFallback(",
  "state.buffTypes = await loadCsvWithFallback(\"./data/analysis_buff_type_summary.csv\", window.RMUC_DATA.buffTypes || [])",
  "./data/analysis_buff_type_summary.csv",
  "function buffEffectKey(",
  "function buffEffectOptions(",
  "function buffSchoolRows(",
  "function renderBuffTypeAnalysis(",
  "document.querySelector(\"#buffEffectType\")",
  "\"类型覆盖局数\"",
  "\"统计范围局数\"",
];

for (const needle of requiredApp) {
  if (!app.includes(needle)) problems.push(`${APP_FILE}: missing ${needle}`);
}

if (!index.includes('<option value="buff">增益效果</option>')) {
  problems.push(`${INDEX_FILE}: missing 增益效果 analysis option`);
}

if (!index.includes('id="buffEffectType"')) {
  problems.push(`${INDEX_FILE}: missing buffEffectType selector`);
}

const navOrder = [...index.matchAll(/<button class="tab(?: is-active)?" data-view="([^"]+)">/g)].map((match) => match[1]);
const expectedNavOrder = ["overview", "teams", "replay", "analysis", "matches", "prediction", "shark"];
if (JSON.stringify(navOrder) !== JSON.stringify(expectedNavOrder)) {
  problems.push(`${INDEX_FILE}: nav order ${navOrder.join(", ")}, expected ${expectedNavOrder.join(", ")}`);
}

if (!styles.includes(".analysis-chart.full-list")) {
  problems.push(`${STYLES_FILE}: missing .analysis-chart.full-list`);
}

if (generator.includes("analysis_team_game_metrics.csv")) {
  problems.push("tools/generate_buff_type_summary.js should not depend on H2H-only analysis_team_game_metrics.csv");
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log("Buff type summary data OK");
