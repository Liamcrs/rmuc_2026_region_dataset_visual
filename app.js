const state = {
  teams: [],
  matches: [],
  opening: [],
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

  document.querySelector("#teamTable tbody").innerHTML = rows
    .map(
      (row) => `
        <tr>
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

  document.querySelector("#matchGrid").innerHTML = rows
    .map(
      (row, index) => `
        <article class="match-card">
          <header>
            <h3>${index + 1}. ${row["红方学校"]} ${row["红胜局"]}:${row["蓝胜局"]} ${row["蓝方学校"]}</h3>
            <div class="meta">${row["赛区"]} 第${row["场次号"]}场 · 胜方 ${row["胜方学校"]} · 场总伤害 ${fmt.format(numberOf(row["场总伤害"]))}</div>
          </header>
          <div class="match-images">
            <img src="./assets/h2h_all/${row["热力图"]}" alt="${row["红方学校"]} 对 ${row["蓝方学校"]} 热力图" loading="lazy" />
            <img src="./assets/h2h_all/${row["轨迹图"]}" alt="${row["红方学校"]} 对 ${row["蓝方学校"]} 轨迹图" loading="lazy" />
          </div>
        </article>
      `
    )
    .join("");
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
  document.querySelectorAll("#profileImageTabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#profileImageTabs button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      document.querySelector("#profileImage").src = button.dataset.src;
    });
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
  ["teamSearch", "teamCategory", "teamSort"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", renderTeamTable);
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
      loadCsv("./data/all_requested_matches_visuals.csv"),
      loadCsv("./data/opening_by_role_summary.csv"),
    ]);
    state.teams = teams;
    state.matches = matches;
    state.opening = opening;
  }
  renderMetrics();
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
