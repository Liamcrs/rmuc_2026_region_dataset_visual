const state = {
  teams: [],
  matches: [],
  opening: [],
  assemblyTeams: [],
  mapZones: [],
  mapTopZones: [],
  matchSideMetrics: [],
  teamStyles: [],
  tournamentSimulation: [],
  selectedMapSchool: "",
  selectedTeam: "",
  selectedMatch: "",
  matchImageKind: "heat",
};

const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((v) => v.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  );
}

async function loadCsv(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return parseCsv(await response.text());
}

function numberOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(value) {
  return `${Math.round(numberOf(value) * 100)}%`;
}

function probPct(value) {
  const percent = numberOf(value) * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${fmt.format(percent)}%`;
}

function includesTerm(row, keys, term) {
  if (!term) return true;
  return keys.map((key) => row[key] || "").join(" ").toLowerCase().includes(term);
}

function renderDetailCards(selector, cards) {
  document.querySelector(selector).innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="detail-item">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `
    )
    .join("");
}

function renderRankRows(selector, rows, config) {
  const max = config.max ?? Math.max(...rows.map((row) => Math.abs(numberOf(config.value(row)))), 1);
  document.querySelector(selector).innerHTML = rows
    .map((row) => {
      const value = numberOf(config.value(row));
      const width = max ? Math.max(2, Math.min(100, (Math.abs(value) / max) * 100)) : 0;
      const classes = ["rank-fill", config.color?.(row, value) || ""].filter(Boolean).join(" ");
      return `
        <div class="rank-row ${config.clickable ? "clickable" : ""}" data-id="${config.id?.(row) || ""}">
          <span class="rank-label">
            <strong>${config.label(row)}</strong>
            <span>${config.sub(row)}</span>
          </span>
          <span class="rank-track"><span class="${classes}" style="width:${width}%"></span></span>
          <span class="rank-value">${config.format ? config.format(value, row) : fmt.format(value)}</span>
        </div>
      `;
    })
    .join("");
  if (config.onClick) {
    document.querySelectorAll(`${selector} .rank-row`).forEach((row) => {
      row.addEventListener("click", () => config.onClick(row.dataset.id));
    });
  }
}

function renderDataTable(selector, rows, columns) {
  document.querySelector(selector).innerHTML = `
    <table>
      <thead><tr>${columns.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows
          .map((row) => `<tr>${columns.map(([, getter]) => `<td>${getter(row)}</td>`).join("")}</tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}

function setView(id) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === id);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === id);
  });
}

function renderMetrics() {
  const national = state.teams.filter((row) => row["手册参赛类别"] === "全国赛").length;
  const revival = state.teams.filter((row) => row["手册参赛类别"] === "复活赛").length;
  const topDamage = Math.max(...state.teams.map((row) => numberOf(row["火力收益_平均造成伤害"])));
  const topTeam = state.teams.find((row) => numberOf(row["火力收益_平均造成伤害"]) === topDamage);
  const metrics = [
    ["已命名队伍", state.teams.length, "总决赛手册白名单"],
    ["全国赛 / 复活赛", `${national} / ${revival}`, "队伍类别"],
    ["已分析对局", state.matches.length, "官方场地图可视化"],
    ["最高平均伤害", fmt.format(topDamage), topTeam ? topTeam["学校名"] : ""],
  ];
  document.querySelector("#metricGrid").innerHTML = metrics
    .map(
      ([label, value, hint]) => `
        <div class="metric">
          <span class="label">${label}</span>
          <span class="value">${value}</span>
          <p>${hint}</p>
        </div>
      `
    )
    .join("");
}

function renderIntensityChart() {
  const search = document.querySelector("#intensitySearch").value.trim().toLowerCase();
  const limit = numberOf(document.querySelector("#intensityLimit").value);
  const rows = state.matches
    .filter((row) => includesTerm(row, ["赛区", "红方学校", "蓝方学校", "胜方学校"], search))
    .sort((a, b) => numberOf(b["场总伤害"]) - numberOf(a["场总伤害"]))
    .slice(0, limit || state.matches.length);
  renderRankRows("#intensityChart", rows, {
    clickable: true,
    id: (row) => row["序号"],
    label: (row) => `${row["红方学校"]} ${row["红胜局"]}:${row["蓝胜局"]} ${row["蓝方学校"]}`,
    sub: (row) => `${row["赛区"]} 第${row["场次号"]}场 · 胜方 ${row["胜方学校"]}`,
    value: (row) => row["场总伤害"],
    onClick: (id) => {
      state.selectedMatch = id;
      setView("matches");
      renderMatches();
    },
  });
}

function renderTeamTable() {
  const search = document.querySelector("#teamSearch").value.trim().toLowerCase();
  const category = document.querySelector("#teamCategory").value;
  const sortKey = document.querySelector("#teamSort").value;
  const rows = state.teams
    .filter((row) => !category || row["手册参赛类别"] === category)
    .filter((row) => {
      const haystack = `${row["学校名"]} ${row["队伍名称"]} ${row["战术画像"]}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => numberOf(b[sortKey]) - numberOf(a[sortKey]));

  if (!rows.some((row) => row["学校名"] === state.selectedTeam)) {
    state.selectedTeam = rows[0]?.["学校名"] || "";
  }
  renderTeamDetail(rows.find((row) => row["学校名"] === state.selectedTeam));

  document.querySelector("#teamTable tbody").innerHTML = rows
    .map(
      (row) => `
        <tr data-school="${row["学校名"]}" class="${row["学校名"] === state.selectedTeam ? "is-active" : ""}">
          <td>${row["学校名"]}</td>
          <td>${row["队伍名称"]}</td>
          <td>${row["手册参赛类别"]}</td>
          <td>${pct(row["区域赛胜局率"])}</td>
          <td>${fmt.format(numberOf(row["火力收益_平均造成伤害"]))}</td>
          <td>${fmt.format(numberOf(row["平均装配次数"]))}</td>
          <td>${fmt.format(numberOf(row["平均飞镖伤害"]))}</td>
          <td>${row["战术画像"]}</td>
        </tr>
      `
    )
    .join("");
  document.querySelectorAll("#teamTable tbody tr").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedTeam = row.dataset.school;
      renderTeamTable();
      renderProfileChart();
      renderOverviewProfileChart();
    });
  });
}

function profileValue(row, mode, maxes) {
  const fire = numberOf(row["火力收益_平均造成伤害"]);
  const assembly = numberOf(row["装配收益指数_显示用"]);
  const dart = numberOf(row["飞镖收益指数_显示用"]);
  if (mode === "fire") return fire;
  if (mode === "assembly") return numberOf(row["平均装配次数"]);
  if (mode === "dart") return numberOf(row["平均飞镖伤害"]);
  if (mode === "win") return numberOf(row["区域赛胜局率"]);
  const fireScore = maxes.fire ? fire / maxes.fire : 0;
  const assemblyScore = maxes.assembly ? assembly / maxes.assembly : 0;
  const dartScore = maxes.dart ? dart / maxes.dart : 0;
  return (fireScore + assemblyScore + dartScore) / 3;
}

function profileMaxes() {
  return {
    fire: Math.max(...state.teams.map((row) => numberOf(row["火力收益_平均造成伤害"]))),
    assembly: Math.max(...state.teams.map((row) => numberOf(row["装配收益指数_显示用"]))),
    dart: Math.max(...state.teams.map((row) => numberOf(row["飞镖收益指数_显示用"]))),
  };
}

function profileRowsMarkup(rows, maxes) {
  return rows
    .map((row) => {
      const fire = numberOf(row["火力收益_平均造成伤害"]);
      const assembly = numberOf(row["装配收益指数_显示用"]);
      const dart = numberOf(row["飞镖收益指数_显示用"]);
      const combined = profileValue(row, "combined", maxes) * 100;
      return `
        <button class="profile-row ${row["学校名"] === state.selectedTeam ? "is-active" : ""}" data-school="${row["学校名"]}">
          <span class="profile-team">
            <strong>${row["学校名"]}</strong>
            <span>${row["队伍名称"]} · ${row["手册参赛类别"]} · 胜局率 ${pct(row["区域赛胜局率"])}</span>
          </span>
          <span class="profile-bars">
            ${profileBar("火力", "fire", fire, maxes.fire)}
            ${profileBar("装配", "assembly", assembly, maxes.assembly, numberOf(row["平均装配次数"]))}
            ${profileBar("飞镖", "dart", dart, maxes.dart, numberOf(row["平均飞镖伤害"]))}
          </span>
          <span class="profile-score"><span>综合</span><strong>${fmt.format(combined)}</strong></span>
        </button>
      `;
    })
    .join("");
}

function bindProfileRows(selector, options = {}) {
  document.querySelectorAll(selector).forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedTeam = row.dataset.school;
      renderProfileChart();
      renderOverviewProfileChart();
      renderTeamTable();
      if (options.openTeams) setView("teams");
    });
  });
}

function renderOverviewProfileChart() {
  const maxes = profileMaxes();
  const rows = state.teams
    .slice()
    .sort((a, b) => profileValue(b, "combined", maxes) - profileValue(a, "combined", maxes))
    .slice(0, 8);
  document.querySelector("#overviewProfileChart").innerHTML = profileRowsMarkup(rows, maxes);
  bindProfileRows("#overviewProfileChart .profile-row", { openTeams: true });
}

function renderProfileChart() {
  const search = document.querySelector("#profileSearch").value.trim().toLowerCase();
  const category = document.querySelector("#profileCategory").value;
  const mode = document.querySelector("#profileMetric").value;
  const limit = numberOf(document.querySelector("#profileLimit").value);
  const maxes = profileMaxes();
  const rows = state.teams
    .filter((row) => !category || row["手册参赛类别"] === category)
    .filter((row) => {
      const haystack = `${row["学校名"]} ${row["队伍名称"]} ${row["战术画像"]}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => profileValue(b, mode, maxes) - profileValue(a, mode, maxes))
    .slice(0, limit || state.teams.length);

  if (!rows.some((row) => row["学校名"] === state.selectedTeam)) {
    state.selectedTeam = rows[0]?.["学校名"] || state.selectedTeam;
  }

  document.querySelector("#profileChart").innerHTML = profileRowsMarkup(rows, maxes);
  bindProfileRows("#profileChart .profile-row");
}

function profileBar(label, className, value, max, rawValue = value) {
  const width = max ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return `
    <span class="profile-bar">
      <span class="profile-bar-label">${label}</span>
      <span class="profile-track"><span class="profile-fill ${className}" style="width:${width}%"></span></span>
      <span class="profile-bar-value">${fmt.format(rawValue)}</span>
    </span>
  `;
}

function renderTeamDetail(row) {
  const el = document.querySelector("#teamDetail");
  if (!row) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="detail-item"><span>学校 / 队名</span><strong>${row["学校名"]} · ${row["队伍名称"]}</strong></div>
    <div class="detail-item"><span>胜局率</span><strong>${pct(row["区域赛胜局率"])}</strong></div>
    <div class="detail-item"><span>平均伤害</span><strong>${fmt.format(numberOf(row["火力收益_平均造成伤害"]))}</strong></div>
    <div class="detail-item"><span>战术画像</span><strong>${row["战术画像"]}</strong></div>
  `;
}

function renderMatches() {
  const search = document.querySelector("#matchSearch").value.trim().toLowerCase();
  const side = document.querySelector("#matchSide").value;
  const rows = state.matches.filter((row) => {
    const haystack = `${row["赛区"]} ${row["场次号"]} ${row["红方学校"]} ${row["蓝方学校"]} ${row["胜方学校"]}`.toLowerCase();
    const winnerSide =
      numberOf(row["红胜局"]) > numberOf(row["蓝胜局"])
        ? "红胜"
        : numberOf(row["蓝胜局"]) > numberOf(row["红胜局"])
          ? "蓝胜"
          : "";
    return haystack.includes(search) && (!side || winnerSide === side);
  });

  if (!rows.some((row) => row["序号"] === state.selectedMatch)) {
    state.selectedMatch = rows[0]?.["序号"] || "";
  }

  document.querySelector("#matchList").innerHTML = rows
    .map(
      (row) => `
        <button class="match-list-item ${row["序号"] === state.selectedMatch ? "is-active" : ""}" data-match="${row["序号"]}">
          <span class="match-list-title">${row["红方学校"]} ${row["红胜局"]}:${row["蓝胜局"]} ${row["蓝方学校"]}</span>
          <span class="match-list-meta">${row["赛区"]} 第${row["场次号"]}场 · ${row["红方类别"]}/${row["蓝方类别"]} · 伤害 ${fmt.format(numberOf(row["场总伤害"]))}</span>
        </button>
      `
    )
    .join("");
  document.querySelectorAll(".match-list-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMatch = button.dataset.match;
      renderMatches();
    });
  });
  renderMatchDetail(rows.find((row) => row["序号"] === state.selectedMatch));
}

function renderMatchDetail(row) {
  const image = document.querySelector("#matchDetailImage");
  if (!row) {
    document.querySelector("#matchTitle").textContent = "没有匹配的对局";
    document.querySelector("#matchMeta").textContent = "";
    document.querySelector("#matchStats").innerHTML = "";
    image.removeAttribute("src");
    return;
  }
  document.querySelector("#matchTitle").textContent = `${row["红方学校"]} ${row["红胜局"]}:${row["蓝胜局"]} ${row["蓝方学校"]}`;
  document.querySelector("#matchMeta").textContent = `${row["赛区"]} 第${row["场次号"]}场 · 胜方 ${row["胜方学校"]}`;
  document.querySelector("#matchStats").innerHTML = `
    <div class="detail-item"><span>场总伤害</span><strong>${fmt.format(numberOf(row["场总伤害"]))}</strong></div>
    <div class="detail-item"><span>局数</span><strong>${row["局数"]}</strong></div>
    <div class="detail-item"><span>代表局</span><strong>第 ${row["代表局号"]} 局</strong></div>
    <div class="detail-item"><span>代表局伤害</span><strong>${fmt.format(numberOf(row["代表局总伤害"]))}</strong></div>
  `;
  const file = state.matchImageKind === "heat" ? row["热力图"] : row["轨迹图"];
  image.src = `./assets/h2h_all/${file}`;
  image.alt = `${row["红方学校"]} 对 ${row["蓝方学校"]}${state.matchImageKind === "heat" ? "热力图" : "轨迹图"}`;
}

function renderOpeningTable() {
  document.querySelector("#openingTable tbody").innerHTML = state.opening
    .map(
      (row) => `
        <tr>
          <td>${row["机器人类型"]}</td>
          <td>${row["结果"]}</td>
          <td>${row["样本数"]}</td>
          <td>${fmt.format(numberOf(row["平均x"]))}</td>
          <td>${fmt.format(numberOf(row["平均y"]))}</td>
        </tr>
      `
    )
    .join("");
}

function predictionRows() {
  const term = document.querySelector("#predictionSearch").value.trim().toLowerCase();
  const category = document.querySelector("#predictionCategory").value;
  const styleBySchool = Object.fromEntries(state.teamStyles.map((row) => [row["学校名"], row]));
  return state.tournamentSimulation
    .map((row) => {
      const style = styleBySchool[row["学校名"]] || {};
      return { ...row, ...style, "预测类别": row["参赛类别"] };
    })
    .filter((row) => !category || row["参赛类别"] === category)
    .filter((row) => includesTerm(row, ["学校名", "队伍名称", "参赛类别", "全国赛种子梯队", "复活赛梯队", "风格分类"], term));
}

function simulationRankList(title, rows, metric, colorClass = "") {
  const max = Math.max(...rows.map((row) => numberOf(row[metric])), 0.001);
  return `
    <section class="simulation-card">
      <h3>${title}</h3>
      <div class="simulation-ranks">
        ${rows
          .slice(0, 10)
          .map((row) => {
            const value = numberOf(row[metric]);
            const width = Math.max(2, Math.min(100, (value / max) * 100));
            return `
              <div class="rank-row compact">
                <span class="rank-label">
                  <strong>${row["学校名"]}</strong>
                  <span>${row["队伍名称"]} · ${row["风格分类"] || "未分类"} · 强度 ${fmt.format(numberOf(row["模型强度分"]))}</span>
                </span>
                <span class="rank-track"><span class="rank-fill ${colorClass}" style="width:${width}%"></span></span>
                <span class="rank-value">${probPct(value)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderPredictionStyleChart(rows) {
  const groups = rows.reduce((acc, row) => {
    const key = row["风格分类"] || "未分类";
    acc[key] ||= [];
    acc[key].push(row);
    return acc;
  }, {});
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  document.querySelector("#predictionStyleChart").innerHTML = sorted
    .map(([style, styleRows]) => {
      const leader = styleRows.slice().sort((a, b) => numberOf(b["全国赛夺冠概率"]) - numberOf(a["全国赛夺冠概率"]))[0];
      const avgTop4 = styleRows.reduce((sum, row) => sum + numberOf(row["全国赛四强概率"]), 0) / styleRows.length;
      return `
        <div class="style-cluster-card">
          <span>
            <strong>${style}</strong>
            <em>${styleRows.length} 支 · 平均四强 ${probPct(avgTop4)}</em>
          </span>
          <span>
            <strong>${leader?.["学校名"] || "-"}</strong>
            <em>组内争冠最高 ${leader ? probPct(leader["全国赛夺冠概率"]) : "-"}</em>
          </span>
        </div>
      `;
    })
    .join("");
}

function renderPrediction() {
  const sortKey = document.querySelector("#predictionSort").value;
  const rows = predictionRows();
  const sortedRows = rows
    .slice()
    .sort((a, b) => numberOf(b[sortKey]) - numberOf(a[sortKey]) || numberOf(b["全国赛夺冠概率"]) - numberOf(a["全国赛夺冠概率"]));
  const topChampion = state.tournamentSimulation.slice().sort((a, b) => numberOf(b["全国赛夺冠概率"]) - numberOf(a["全国赛夺冠概率"]))[0];
  const topRevival = state.tournamentSimulation
    .filter((row) => row["参赛类别"] === "复活赛")
    .sort((a, b) => numberOf(b["复活赛晋级全国赛概率"]) - numberOf(a["复活赛晋级全国赛概率"]))[0];

  renderDetailCards("#predictionSummary", [
    ["筛选队伍", `${rows.length} 支`],
    ["模拟次数", state.tournamentSimulation[0]?.["模拟次数"] || "-"],
    ["争冠最高", topChampion ? `${topChampion["学校名"]} ${probPct(topChampion["全国赛夺冠概率"])}` : "-"],
    ["复活赛最高", topRevival ? `${topRevival["学校名"]} ${probPct(topRevival["复活赛晋级全国赛概率"])}` : "-"],
  ]);
  const revivalRows = rows
    .filter((row) => row["参赛类别"] === "复活赛")
    .sort((a, b) => numberOf(b["复活赛晋级全国赛概率"]) - numberOf(a["复活赛晋级全国赛概率"]));
  document.querySelector("#predictionSimulationChart").innerHTML = `
    <div class="analysis-note">
      按参赛手册抽签盒随机分组，并模拟复活赛 3 轮瑞士轮、复活赛双败名额争夺战、全国赛 5 轮瑞士轮、16 进 8/8 进 4 双败淘汰、半决赛和 BO5 决赛。概率来自区域赛指标模型，不代表官方预测。
    </div>
    <div class="simulation-grid">
      ${simulationRankList("复活赛晋级全国赛概率", revivalRows, "复活赛晋级全国赛概率", "green")}
      ${simulationRankList("全国赛夺冠概率", rows.slice().sort((a, b) => numberOf(b["全国赛夺冠概率"]) - numberOf(a["全国赛夺冠概率"])), "全国赛夺冠概率", "negative")}
      ${simulationRankList("全国赛四强概率", rows.slice().sort((a, b) => numberOf(b["全国赛四强概率"]) - numberOf(a["全国赛四强概率"])), "全国赛四强概率")}
    </div>
  `;
  renderDataTable("#predictionTable", sortedRows, [
    ["学校", (r) => r["学校名"]],
    ["队名", (r) => r["队伍名称"]],
    ["类别", (r) => r["参赛类别"]],
    ["风格", (r) => r["风格分类"] || "-"],
    ["复活赛晋级", (r) => (r["参赛类别"] === "复活赛" ? probPct(r["复活赛晋级全国赛概率"]) : "-")],
    ["十六强", (r) => probPct(r["全国赛十六强概率"])],
    ["八强", (r) => probPct(r["全国赛八强概率"])],
    ["四强", (r) => probPct(r["全国赛四强概率"])],
    ["冠军", (r) => probPct(r["全国赛夺冠概率"])],
  ]);
  renderPredictionStyleChart(rows);
}

function renderAnalysis() {
  const topic = document.querySelector("#analysisTopic").value;
  const term = document.querySelector("#analysisSearch").value.trim().toLowerCase();

  const configs = {
    assembly: {
      title: "科技核心/工程",
      rows: state.assemblyTeams,
      metric: "平均装配次数",
      sub: (r) => `总装配 ${fmt.format(numberOf(r["总装配次数"]))} · L3 ${fmt.format(numberOf(r["L3"]))} · 首装 ${fmt.format(numberOf(r["平均首次装配时间"]))}s`,
    },
  };

  if (configs[topic]) {
    const cfg = configs[topic];
    const rows = cfg.rows
      .filter((row) => includesTerm(row, ["学校名", "队伍类别", "风格分类"], term))
      .sort((a, b) => (cfg.asc ? numberOf(a[cfg.metric]) - numberOf(b[cfg.metric]) : numberOf(b[cfg.metric]) - numberOf(a[cfg.metric])))
      .slice(0, 20);
    renderDetailCards("#analysisSummary", [
      ["专题", cfg.title],
      ["显示", `${rows.length} 支`],
      ["排序指标", cfg.metric],
      ["首位", rows[0]?.["学校名"] || "-"],
    ]);
    renderRankRows("#analysisChart", rows, {
      label: (row) => row["学校名"],
      sub: cfg.sub,
      value: (row) => row[cfg.metric],
      format: cfg.format,
    });
    renderDataTable("#analysisTable", rows, [
      ["学校", (r) => r["学校名"]],
      ["类别", (r) => r["队伍类别"]],
      ["胜局率", (r) => pct(r["胜局率"])],
      [cfg.metric, (r) => fmt.format(numberOf(r[cfg.metric]))],
      ["补充", (r) => r["风格分类"] || cfg.sub(r)],
    ]);
    return;
  }

  if (topic === "map") {
    renderMapControlAnalysis(term);
    return;
  }

}

function renderMapControlAnalysis(term) {
  const schools = [...new Set(state.mapTopZones.map((row) => row["学校名"]))]
    .filter((school) => school.toLowerCase().includes(term) || state.mapTopZones.some((row) => row["学校名"] === school && includesTerm(row, ["机器人类型", "区域"], term)))
    .sort();
  if (!schools.includes(state.selectedMapSchool)) {
    state.selectedMapSchool = schools[0] || "";
  }
  const rows = state.mapTopZones
    .filter((row) => row["学校名"] === state.selectedMapSchool)
    .sort((a, b) => numberOf(b["占比"]) - numberOf(a["占比"]));
  const grouped = rows.reduce((acc, row) => {
    acc[row["区域"]] ||= [];
    acc[row["区域"]].push(row);
    return acc;
  }, {});
  renderDetailCards("#analysisSummary", [
    ["专题", "地图控制区域"],
    ["学校", state.selectedMapSchool || "-"],
    ["兵种数", rows.length],
    ["最高区域", rows[0] ? `${rows[0]["机器人类型"]} · ${rows[0]["区域"]}` : "-"],
  ]);
  document.querySelector("#analysisChart").innerHTML = `
    <div class="map-control-layout">
      <aside class="map-school-list">
        ${schools.map((school) => `<button class="${school === state.selectedMapSchool ? "is-active" : ""}" data-school="${school}">${school}</button>`).join("")}
      </aside>
      <div class="field-map-panel">
        <img src="./assets/field/official_field_map.png" alt="官方场地图" />
        <div class="field-zone-overlay">
          ${Object.entries(grouped).map(([zoneName, zoneRows]) => zoneCell(zoneName, zoneRows)).join("")}
        </div>
      </div>
    </div>
  `;
  document.querySelectorAll(".map-school-list button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMapSchool = button.dataset.school;
      renderAnalysis();
    });
  });
  renderDataTable("#analysisTable", rows, [
    ["兵种", (r) => r["机器人类型"]],
    ["最高活动区域", (r) => r["区域"]],
    ["占比", (r) => pct(r["占比"])],
    ["样本数", (r) => fmt.format(numberOf(r["样本数"]))],
  ]);
}

function zoneCell(zoneName, rows) {
  const [xPart, yPart] = zoneName.split("-");
  const left = { 红侧: 0, 中场: 33.333, 蓝侧: 66.666 }[xPart] ?? 0;
  const top = { 上路: 0, 中路: 33.333, 下路: 66.666 }[yPart] ?? 0;
  const label = rows.map((row) => `${row["机器人类型"]} ${pct(row["占比"])}`).join(" / ");
  return `<div class="field-zone-cell" style="left:${left}%;top:${top}%"><strong>${zoneName}</strong><span>${label}</span></div>`;
}

function bindInteractions() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll("#roleTabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#roleTabs button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      const role = button.dataset.role;
      document.querySelector("#openingImage").src =
        role === "all"
          ? "./assets/opening/opening_rulemap_all_roles_panels.png"
          : `./assets/opening/opening_rulemap_${role}.png`;
    });
  });
  document.querySelectorAll("#matchImageTabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#matchImageTabs button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      state.matchImageKind = button.dataset.kind;
      renderMatches();
    });
  });
  ["teamSearch", "teamCategory", "teamSort"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", renderTeamTable);
  });
  ["profileSearch", "profileCategory", "profileMetric", "profileLimit"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", renderProfileChart);
  });
  ["intensitySearch", "intensityLimit"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", renderIntensityChart);
  });
  ["predictionSearch", "predictionCategory", "predictionSort"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", renderPrediction);
  });
  ["analysisTopic", "analysisSearch"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", renderAnalysis);
  });
  ["matchSearch", "matchSide"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", renderMatches);
  });
}

async function init() {
  bindInteractions();
  if (window.RMUC_DATA) {
    state.teams = window.RMUC_DATA.teams || [];
    state.matches = window.RMUC_DATA.matches || [];
    state.opening = window.RMUC_DATA.opening || [];
    state.assemblyTeams = window.RMUC_DATA.assemblyTeams || [];
    state.mapZones = window.RMUC_DATA.mapZones || [];
    state.mapTopZones = window.RMUC_DATA.mapTopZones || [];
    state.matchSideMetrics = window.RMUC_DATA.matchSideMetrics || [];
    state.teamStyles = window.RMUC_DATA.teamStyles || [];
    state.tournamentSimulation = window.RMUC_DATA.tournamentSimulation || [];
  } else {
    const [
      teams,
      matches,
      opening,
      assemblyTeams,
      mapZones,
      mapTopZones,
      matchSideMetrics,
      teamStyles,
      tournamentSimulation,
    ] = await Promise.all([
      loadCsv("./data/all_qualified_team_tactical_profile_metrics.csv"),
      loadCsv("./data/all_handbook_h2h_matches_visuals.csv"),
      loadCsv("./data/opening_by_role_summary.csv"),
      loadCsv("./data/analysis_assembly_team_summary.csv"),
      loadCsv("./data/analysis_map_control_zones.csv"),
      loadCsv("./data/analysis_map_control_top_zones.csv"),
      loadCsv("./data/analysis_match_side_metrics.csv"),
      loadCsv("./data/analysis_team_style_clusters.csv"),
      loadCsv("./data/simulation_tournament_probabilities.csv"),
    ]);
    state.teams = teams;
    state.matches = matches;
    state.opening = opening;
    state.assemblyTeams = assemblyTeams;
    state.mapZones = mapZones;
    state.mapTopZones = mapTopZones;
    state.matchSideMetrics = matchSideMetrics;
    state.teamStyles = teamStyles;
    state.tournamentSimulation = tournamentSimulation;
  }
  renderMetrics();
  renderIntensityChart();
  renderOverviewProfileChart();
  renderProfileChart();
  renderTeamTable();
  renderPrediction();
  renderMatches();
  renderOpeningTable();
  renderAnalysis();
}

init().catch((error) => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div style="padding:12px;background:#fee;border-bottom:1px solid #d88;color:#800">数据加载失败：${error.message}</div>`
  );
});
