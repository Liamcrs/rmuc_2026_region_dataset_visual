const state = {
  teams: [],
  matches: [],
  opening: [],
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

function renderProfileChart() {
  const search = document.querySelector("#profileSearch").value.trim().toLowerCase();
  const category = document.querySelector("#profileCategory").value;
  const mode = document.querySelector("#profileMetric").value;
  const limit = numberOf(document.querySelector("#profileLimit").value);
  const maxes = {
    fire: Math.max(...state.teams.map((row) => numberOf(row["火力收益_平均造成伤害"]))),
    assembly: Math.max(...state.teams.map((row) => numberOf(row["装配收益指数_显示用"]))),
    dart: Math.max(...state.teams.map((row) => numberOf(row["飞镖收益指数_显示用"]))),
  };
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

  document.querySelector("#profileChart").innerHTML = rows
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

  document.querySelectorAll(".profile-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedTeam = row.dataset.school;
      renderProfileChart();
      renderTeamTable();
    });
  });
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
  } else {
    const [teams, matches, opening] = await Promise.all([
      loadCsv("./data/all_qualified_team_tactical_profile_metrics.csv"),
      loadCsv("./data/all_handbook_h2h_matches_visuals.csv"),
      loadCsv("./data/opening_by_role_summary.csv"),
    ]);
    state.teams = teams;
    state.matches = matches;
    state.opening = opening;
  }
  renderMetrics();
  renderProfileChart();
  renderTeamTable();
  renderMatches();
  renderOpeningTable();
}

init().catch((error) => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div style="padding:12px;background:#fee;border-bottom:1px solid #d88;color:#800">数据加载失败：${error.message}</div>`
  );
});
