const state = {
  teams: [],
  matches: [],
  opening: [],
  winFactors: [],
  phaseDamage: [],
  dartTeams: [],
  assemblyTeams: [],
  radarVulnerability: [],
  mapZones: [],
  matchSideMetrics: [],
  teamStyles: [],
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

function renderAnalysis() {
  const topic = document.querySelector("#analysisTopic").value;
  const term = document.querySelector("#analysisSearch").value.trim().toLowerCase();

  if (topic === "win") {
    const rows = state.winFactors.slice().sort((a, b) => Math.abs(numberOf(b["胜负差"])) - Math.abs(numberOf(a["胜负差"])));
    renderDetailCards("#analysisSummary", [
      ["指标数", rows.length],
      ["最大差异", rows[0]?.["指标"] || "-"],
      ["方向", rows[0]?.["方向"] || "-"],
      ["差值", fmt.format(numberOf(rows[0]?.["胜负差"]))],
    ]);
    renderRankRows("#analysisChart", rows, {
      label: (row) => row["指标"],
      sub: (row) => `胜方 ${fmt.format(numberOf(row["胜方均值"]))} / 负方 ${fmt.format(numberOf(row["负方均值"]))}`,
      value: (row) => row["胜负差"],
      color: (row, value) => (value < 0 ? "negative" : "green"),
    });
    renderDataTable("#analysisTable", rows, [
      ["指标", (r) => r["指标"]],
      ["胜方均值", (r) => fmt.format(numberOf(r["胜方均值"]))],
      ["负方均值", (r) => fmt.format(numberOf(r["负方均值"]))],
      ["胜负差", (r) => fmt.format(numberOf(r["胜负差"]))],
    ]);
    return;
  }

  if (topic === "phase") {
    const rows = state.phaseDamage.slice();
    renderDetailCards("#analysisSummary", [
      ["阶段数", 3],
      ["对比", "胜方 / 负方"],
      ["指标", "场均造成伤害"],
      ["样本", "234 局"],
    ]);
    renderRankRows("#analysisChart", rows, {
      label: (row) => `${row["阶段"]} · ${row["结果"]}`,
      sub: () => "分阶段输出节奏",
      value: (row) => row["场均造成伤害"],
      color: (row) => (row["结果"] === "胜方" ? "green" : ""),
    });
    renderDataTable("#analysisTable", rows, [
      ["结果", (r) => r["结果"]],
      ["阶段", (r) => r["阶段"]],
      ["场均造成伤害", (r) => fmt.format(numberOf(r["场均造成伤害"]))],
      ["总造成伤害", (r) => fmt.format(numberOf(r["总造成伤害"]))],
    ]);
    return;
  }

  const configs = {
    dart: {
      title: "飞镖收益",
      rows: state.dartTeams,
      metric: "平均飞镖伤害",
      sub: (r) => `命中 ${fmt.format(numberOf(r["飞镖命中数"]))} · 基地 ${fmt.format(numberOf(r["命中基地"]))} · 前哨 ${fmt.format(numberOf(r["命中前哨"]))}`,
    },
    assembly: {
      title: "科技核心/工程",
      rows: state.assemblyTeams,
      metric: "平均装配次数",
      sub: (r) => `总装配 ${fmt.format(numberOf(r["总装配次数"]))} · L3 ${fmt.format(numberOf(r["L3"]))} · 首装 ${fmt.format(numberOf(r["平均首次装配时间"]))}s`,
    },
    radar: {
      title: "雷达与易伤",
      rows: state.radarVulnerability,
      metric: "平均易伤机器人秒",
      asc: true,
      sub: (r) => `平均受伤 ${fmt.format(numberOf(r["平均受伤害"]))} · 胜局率 ${pct(r["胜局率"])}`,
    },
    style: {
      title: "队伍风格聚类",
      rows: state.teamStyles,
      metric: "胜局率",
      sub: (r) => `${r["风格分类"]} · 火力 ${fmt.format(numberOf(r["平均造成伤害_分"]))} / 装配 ${fmt.format(numberOf(r["平均装配次数_分"]))}`,
      format: (v) => pct(v),
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
      color: () => (topic === "radar" ? "green" : ""),
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
    const rows = state.mapZones
      .filter((row) => includesTerm(row, ["学校名", "机器人类型", "区域"], term))
      .sort((a, b) => numberOf(b["占比"]) - numberOf(a["占比"]))
      .slice(0, 25);
    renderDetailCards("#analysisSummary", [
      ["专题", "地图控制区域"],
      ["显示", `${rows.length} 条`],
      ["排序指标", "区域占比"],
      ["筛选", term || "无"],
    ]);
    renderRankRows("#analysisChart", rows, {
      label: (row) => `${row["学校名"]} · ${row["机器人类型"]}`,
      sub: (row) => row["区域"],
      value: (row) => row["占比"],
      format: (v) => pct(v),
    });
    renderDataTable("#analysisTable", rows, [
      ["学校", (r) => r["学校名"]],
      ["兵种", (r) => r["机器人类型"]],
      ["区域", (r) => r["区域"]],
      ["占比", (r) => pct(r["占比"])],
      ["样本数", (r) => fmt.format(numberOf(r["样本数"]))],
    ]);
    return;
  }

  if (topic === "match") {
    const rows = state.matches
      .filter((row) => includesTerm(row, ["赛区", "红方学校", "蓝方学校", "胜方学校"], term))
      .sort((a, b) => numberOf(b["场总伤害"]) - numberOf(a["场总伤害"]))
      .slice(0, 25);
    renderDetailCards("#analysisSummary", [
      ["专题", "对局详情"],
      ["显示", `${rows.length} 场`],
      ["排序指标", "场总伤害"],
      ["筛选", term || "无"],
    ]);
    renderRankRows("#analysisChart", rows, {
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
    renderDataTable("#analysisTable", rows, [
      ["赛区", (r) => r["赛区"]],
      ["场次", (r) => `第${r["场次号"]}场`],
      ["对阵", (r) => `${r["红方学校"]} ${r["红胜局"]}:${r["蓝胜局"]} ${r["蓝方学校"]}`],
      ["胜方", (r) => r["胜方学校"]],
      ["场总伤害", (r) => fmt.format(numberOf(r["场总伤害"]))],
    ]);
  }
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
    state.winFactors = window.RMUC_DATA.winFactors || [];
    state.phaseDamage = window.RMUC_DATA.phaseDamage || [];
    state.dartTeams = window.RMUC_DATA.dartTeams || [];
    state.assemblyTeams = window.RMUC_DATA.assemblyTeams || [];
    state.radarVulnerability = window.RMUC_DATA.radarVulnerability || [];
    state.mapZones = window.RMUC_DATA.mapZones || [];
    state.matchSideMetrics = window.RMUC_DATA.matchSideMetrics || [];
    state.teamStyles = window.RMUC_DATA.teamStyles || [];
  } else {
    const [
      teams,
      matches,
      opening,
      winFactors,
      phaseDamage,
      dartTeams,
      assemblyTeams,
      radarVulnerability,
      mapZones,
      matchSideMetrics,
      teamStyles,
    ] = await Promise.all([
      loadCsv("./data/all_qualified_team_tactical_profile_metrics.csv"),
      loadCsv("./data/all_handbook_h2h_matches_visuals.csv"),
      loadCsv("./data/opening_by_role_summary.csv"),
      loadCsv("./data/analysis_win_factors.csv"),
      loadCsv("./data/analysis_phase_damage.csv"),
      loadCsv("./data/analysis_dart_team_summary.csv"),
      loadCsv("./data/analysis_assembly_team_summary.csv"),
      loadCsv("./data/analysis_radar_vulnerability.csv"),
      loadCsv("./data/analysis_map_control_zones.csv"),
      loadCsv("./data/analysis_match_side_metrics.csv"),
      loadCsv("./data/analysis_team_style_clusters.csv"),
    ]);
    state.teams = teams;
    state.matches = matches;
    state.opening = opening;
    state.winFactors = winFactors;
    state.phaseDamage = phaseDamage;
    state.dartTeams = dartTeams;
    state.assemblyTeams = assemblyTeams;
    state.radarVulnerability = radarVulnerability;
    state.mapZones = mapZones;
    state.matchSideMetrics = matchSideMetrics;
    state.teamStyles = teamStyles;
  }
  renderMetrics();
  renderIntensityChart();
  renderOverviewProfileChart();
  renderProfileChart();
  renderTeamTable();
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
