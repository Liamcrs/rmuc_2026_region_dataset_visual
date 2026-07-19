const state = {
  teams: [],
  matches: [],
  assemblyTeams: [],
  mapZones: [],
  mapTopZones: [],
  matchSideMetrics: [],
  teamStyles: [],
  tournamentSimulation: [],
  teamGameMetrics: [],
  damageSources: [],
  replayGames: [],
  selectedMapSchool: "",
  selectedTeam: "",
  selectedMatch: "",
  matchImageKind: "heat",
  selectedDamagePoint: null,
  selectedReplayMatch: "",
  selectedReplayGame: "",
  replayCache: {},
  replayModel: null,
  replayTime: 0,
  replayTimer: null,
  replayAnimationFrame: null,
  replaySpeed: 1,
  replayTrail: 20,
  replayVisibleEntities: new Set(),
  replayVisibleEvents: new Set(),
  replayDamageEnabled: true,
  replaySelectedEntity: "",
};

const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const SHARK_SCHOOL = "哈尔滨工业大学（深圳）";
const FIELD_WIDTH = 28;
const FIELD_HEIGHT = 15;
const replayFieldImage = new Image();
replayFieldImage.src = "./assets/field/official_field_map.png";

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
  if (id !== "replay") stopReplayPlayback();
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === id);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === id);
  });
  if (id === "replay") window.requestAnimationFrame(renderReplayFrame);
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
  const previousSelectedMatch = state.selectedMatch;
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
  if (state.selectedMatch !== previousSelectedMatch) {
    state.selectedDamagePoint = null;
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
      if (state.selectedMatch !== button.dataset.match) {
        state.selectedDamagePoint = null;
      }
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
    const replayButton = document.querySelector("#openReplayFromMatch");
    if (replayButton) replayButton.disabled = true;
    renderDamageSourceMap(null);
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
  const replayButton = document.querySelector("#openReplayFromMatch");
  if (replayButton) replayButton.disabled = false;
  renderDamageSourceMap(row);
}

function replayFile(row) {
  if (row?.file) return `./${row.file}`;
  return `./data/battlescope_replays/match_${String(numberOf(row?.["序号"])).padStart(3, "0")}.json`;
}

function unpackReplayState(replay, compact) {
  const entity = replay.entities[compact[0]] || {};
  return {
    key: `${entity.side}-${entity.no}`,
    entity,
    x: numberOf(compact[1]),
    y: numberOf(compact[2]),
    hp: numberOf(compact[3]),
    maxHp: numberOf(compact[4]),
    heat: numberOf(compact[5]),
    heatLimit: numberOf(compact[6]),
    shots17: numberOf(compact[7]),
    shots42: numberOf(compact[8]),
    shotDelta: numberOf(compact[9]),
    vulnerable: Boolean(numberOf(compact[10])),
    heading: numberOf(compact[11]),
  };
}

function buildReplayModel(replay) {
  const frames = (replay.frames || []).map((frame) => ({
    t: numberOf(frame.t),
    states: (frame.s || []).map((compact) => unpackReplayState(replay, compact)),
  }));
  const tracks = {};
  frames.forEach((frame) => {
    frame.states.forEach((item) => {
      tracks[item.key] ||= { entity: item.entity, points: [] };
      tracks[item.key].points.push({
        t: frame.t,
        x: item.x,
        y: item.y,
        hp: item.hp,
        maxHp: item.maxHp,
        heat: item.heat,
        heatLimit: item.heatLimit,
        heading: item.heading,
      });
    });
  });
  return {
    meta: replay.meta || {},
    entities: replay.entities || [],
    frames,
    tracks,
    events: replay.events || [],
    eventTypes: [...new Set((replay.events || []).map((event) => event.type).filter(Boolean))],
    duration: numberOf(replay.meta?.duration),
  };
}

function nearestReplayFrame(model, time) {
  if (!model?.frames?.length) return null;
  return model.frames.reduce((best, frame) => (Math.abs(frame.t - time) < Math.abs(best.t - time) ? frame : best), model.frames[0]);
}

function replayFrameBounds(model, time) {
  if (!model?.frames?.length) return { before: null, after: null, ratio: 0 };
  const clamped = Math.max(model.frames[0].t, Math.min(model.duration, numberOf(time)));
  let before = model.frames[0];
  let after = model.frames[model.frames.length - 1];
  for (let i = 0; i < model.frames.length; i += 1) {
    if (model.frames[i].t <= clamped) before = model.frames[i];
    if (model.frames[i].t >= clamped) {
      after = model.frames[i];
      break;
    }
  }
  const span = Math.max(0.001, after.t - before.t);
  return { before, after, ratio: Math.max(0, Math.min(1, (clamped - before.t) / span)) };
}

function lerp(a, b, ratio) {
  return numberOf(a) + (numberOf(b) - numberOf(a)) * ratio;
}

function interpolatedReplayState(model, time) {
  const { before, after, ratio } = replayFrameBounds(model, time);
  if (!before || !after) return { frame: null, byEntity: {} };
  const afterByKey = Object.fromEntries(after.states.map((item) => [item.key, item]));
  const states = before.states.map((item) => {
    const next = afterByKey[item.key] || item;
    return {
      ...item,
      x: lerp(item.x, next.x, ratio),
      y: lerp(item.y, next.y, ratio),
      hp: lerp(item.hp, next.hp, ratio),
      maxHp: lerp(item.maxHp, next.maxHp, ratio),
      heat: lerp(item.heat, next.heat, ratio),
      heatLimit: lerp(item.heatLimit, next.heatLimit, ratio),
      shots17: ratio < 0.5 ? item.shots17 : next.shots17,
      shots42: ratio < 0.5 ? item.shots42 : next.shots42,
      shotDelta: ratio < 0.5 ? item.shotDelta : next.shotDelta,
      vulnerable: ratio < 0.5 ? item.vulnerable : next.vulnerable,
      heading: lerp(item.heading, next.heading, ratio),
    };
  });
  return {
    frame: { t: numberOf(time), states },
    byEntity: Object.fromEntries(states.map((item) => [item.key, item])),
  };
}

function nextReplayTime(model, currentTime, speed) {
  if (!model?.frames?.length) return 0;
  const times = model.frames.map((frame) => frame.t);
  const currentIndex = Math.max(
    0,
    times.findIndex((time) => time >= currentTime)
  );
  const frameStep = Math.max(1, Math.round(numberOf(speed) || 1));
  const nextIndex = currentIndex + frameStep;
  return times[nextIndex] ?? times[0];
}

function stateAt(model, time) {
  return interpolatedReplayState(model, time);
}

function stopReplayPlayback() {
  if (state.replayTimer) {
    clearInterval(state.replayTimer);
    state.replayTimer = null;
  }
  if (state.replayAnimationFrame) {
    window.cancelAnimationFrame(state.replayAnimationFrame);
    state.replayAnimationFrame = null;
  }
  const play = document.querySelector("#battleReplayPlay");
  if (play) play.textContent = "播放";
}

function startSmoothReplayPlayback() {
  if (!state.replayModel) return;
  stopReplayPlayback();
  const play = document.querySelector("#battleReplayPlay");
  if (play) play.textContent = "暂停";
  let previous = performance.now();
  const tick = (now) => {
    const elapsed = Math.max(0, (now - previous) / 1000);
    previous = now;
    const minTime = state.replayModel.frames[0]?.t || 0;
    const duration = Math.max(1, state.replayModel.duration - minTime);
    const next = state.replayTime + elapsed * Math.max(0.1, state.replaySpeed);
    state.replayTime = next > state.replayModel.duration ? minTime + ((next - minTime) % duration) : next;
    renderReplayFrame();
    state.replayAnimationFrame = window.requestAnimationFrame(tick);
  };
  state.replayAnimationFrame = window.requestAnimationFrame(tick);
}

function replayCanvasPoint(canvas, x, y) {
  return [(numberOf(x) / FIELD_WIDTH) * canvas.width, (1 - numberOf(y) / FIELD_HEIGHT) * canvas.height];
}

function replayEntityColor(entity) {
  return entity.side === "红" ? "#ff4c5d" : "#3f8cff";
}

function replayEntitySort(a, b) {
  const order = ["英雄", "工程", "步兵3", "步兵4", "空中", "哨兵", "基地", "前哨站"];
  return order.indexOf(a.type) - order.indexOf(b.type) || numberOf(a.no) - numberOf(b.no);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replayEventGroup(type) {
  if (type === "受击") return "受击伤害";
  if (type === "发弹") return "发弹";
  if (["装配成功", "增益"].includes(type)) return "经济与增益";
  if (["飞镖闸门开", "飞镖命中", "能量机关"].includes(type)) return "飞镖与机关";
  return "其他";
}

function replayEventSubject(event) {
  const side = event.side ? `${event.side}方` : "";
  const unit = event.no ? `${event.no}号${event.robot_type || ""}` : event.robot_type || "";
  const school = event.school ? ` ${event.school}` : "";
  return `${side}${unit || event.type}${school}`.trim();
}

function replayEventText(event) {
  const subject = replayEventSubject(event);
  const target = event.target_no || event.target_type ? ` -> ${event.target_no ? `${event.target_no}号` : ""}${event.target_type || ""}` : "";
  const count = numberOf(event.count) > 1 ? ` x${event.count}` : "";
  const value = event.value ? ` · ${event.type === "受击" ? "伤害" : "数值"} ${fmt.format(Math.abs(numberOf(event.value)))}` : "";
  const category = event.category ? ` · ${event.category}` : "";
  return `${numberOf(event.t).toFixed(1)}s ${subject}${target} · ${event.type}${category}${value}${count}`;
}

function replayEventCard(event) {
  const value = event.value ? `<strong>${fmt.format(Math.abs(numberOf(event.value)))}</strong>` : "";
  return `
    <li class="replay-event-card ${event.side === "红" ? "red" : event.side === "蓝" ? "blue" : ""}">
      <span class="replay-event-time">${numberOf(event.t).toFixed(1)}s</span>
      <span class="replay-event-main">${escapeHtml(replayEventSubject(event))}</span>
      <span class="replay-event-sub">${escapeHtml([
        event.target_no || event.target_type ? `目标 ${event.target_no ? `${event.target_no}号` : ""}${event.target_type || ""}` : "",
        event.category || "",
        numberOf(event.count) > 1 ? `${event.count}次` : "",
      ].filter(Boolean).join(" · "))}</span>
      ${value ? `<span class="replay-event-value">${event.type === "受击" ? "-" : ""}${value}</span>` : ""}
    </li>
  `;
}

function renderReplayEventPanel(model, events, time) {
  if (!events.length) {
    return `<div class="replay-event-empty">${escapeHtml(model.meta.title || "单局回放")} · ${time.toFixed(1)}s 暂无已选事件</div>`;
  }
  const groups = ["受击伤害", "发弹", "经济与增益", "飞镖与机关", "其他"];
  const byGroup = Object.fromEntries(groups.map((group) => [group, []]));
  events.forEach((event) => byGroup[replayEventGroup(event.type)].push(event));
  return `
    <div class="replay-event-grid">
      ${groups
        .filter((group) => byGroup[group].length)
        .map(
          (group) => `
            <section class="replay-event-column">
              <h3>${group}</h3>
              <ul>${byGroup[group].slice(0, 6).map(replayEventCard).join("")}</ul>
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function recentReplayEvents(model, time, windowSeconds = 1.5) {
  return (model?.events || []).filter((event) => {
    if (!state.replayVisibleEvents.has(event.type)) return false;
    const age = time - numberOf(event.t);
    return age >= 0 && age <= windowSeconds;
  });
}

function inferReplayAttack(model, hitEvent, frameState) {
  if (hitEvent.type !== "受击" || !hitEvent.robot_id) return null;
  const victim = Object.values(frameState.byEntity).find(
    (item) => item.entity.side === hitEvent.side && numberOf(item.entity.id) === numberOf(hitEvent.robot_id)
  );
  if (!victim) return null;
  const opponents = Object.values(frameState.byEntity)
    .filter((item) => item.entity.side && item.entity.side !== hitEvent.side)
    .filter((item) => state.replayVisibleEntities.has(item.key));
  if (!opponents.length) return null;
  const source = opponents
    .map((item) => ({ item, distance: Math.hypot(item.x - victim.x, item.y - victim.y) }))
    .sort((a, b) => a.distance - b.distance)[0]?.item;
  if (!source) return null;
  return { source, victim, event: hitEvent };
}

function resizeReplayCanvas() {
  const canvas = document.querySelector("#battleReplayCanvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width * dpr));
  const height = Math.max(170, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawReplayRobot(ctx, canvas, item, recentHits) {
  if (!state.replayVisibleEntities.has(item.key)) return;
  const [x, y] = replayCanvasPoint(canvas, item.x, item.y);
  const dpr = window.devicePixelRatio || 1;
  const color = replayEntityColor(item.entity);
  const radius = 12 * dpr;
  const hpRatio = item.maxHp ? Math.max(0, Math.min(1, item.hp / item.maxHp)) : 0;
  const heatRatio = item.heatLimit ? Math.max(0, Math.min(1, item.heat / item.heatLimit)) : 0;
  const isHit = recentHits.some((event) => event.side === item.entity.side && numberOf(event.robot_id) === numberOf(item.entity.id));

  ctx.save();
  if (item.vulnerable || isHit || state.replaySelectedEntity === item.key) {
    ctx.shadowColor = item.vulnerable || isHit ? "#ff5268" : "#ffffff";
    ctx.shadowBlur = (item.vulnerable ? 18 : 12) * dpr;
  }
  ctx.fillStyle = "rgba(12, 15, 21, .92)";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius - 1 * dpr, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.86;
  ctx.fillRect(x - radius, y + radius - radius * 2 * hpRatio, radius * 2, radius * 2 * hpRatio);
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, .24)";
  ctx.lineWidth = 2.3 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, radius + 5 * dpr, 0, Math.PI * 2);
  ctx.stroke();
  if (heatRatio > 0) {
    ctx.strokeStyle = heatRatio > 0.85 ? "#ffcf5a" : "#78f0c1";
    ctx.lineWidth = 3 * dpr;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y, radius + 5 * dpr, -Math.PI / 2, -Math.PI / 2 - Math.PI * 2 * heatRatio, true);
    ctx.stroke();
  }
  if (Number.isFinite(item.heading)) {
    const rad = (-item.heading * Math.PI) / 180;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(rad) * radius * 0.45, y + Math.sin(rad) * radius * 0.45);
    ctx.lineTo(x + Math.cos(rad) * radius * 1.65, y + Math.sin(rad) * radius * 1.65);
    ctx.stroke();
  }
  ctx.font = `700 ${12 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = "rgba(0, 0, 0, .82)";
  ctx.strokeText(String(item.entity.no), x, y);
  ctx.fillStyle = "#fff";
  ctx.fillText(String(item.entity.no), x, y);
  ctx.restore();
}

function drawReplayObjectiveHud(ctx, canvas, item) {
  if (!["基地", "前哨站"].includes(item.entity.type) || !state.replayVisibleEntities.has(item.key)) return;
  const [x, y] = replayCanvasPoint(canvas, item.x, item.y);
  const dpr = window.devicePixelRatio || 1;
  const color = replayEntityColor(item.entity);
  const ratio = item.maxHp ? Math.max(0, Math.min(1, item.hp / item.maxHp)) : 0;
  const width = (item.entity.type === "基地" ? 76 : 62) * dpr;
  const height = 8 * dpr;
  const top = y - (item.entity.type === "基地" ? 36 : 30) * dpr;
  const left = x - width / 2;
  const label = `${item.entity.side}${item.entity.type} ${Math.round(item.hp)}/${Math.round(item.maxHp)}`;

  ctx.save();
  ctx.globalAlpha = 0.98;
  ctx.fillStyle = "rgba(10, 13, 18, .88)";
  ctx.fillRect(left - 3 * dpr, top - 17 * dpr, width + 6 * dpr, height + 22 * dpr);
  ctx.fillStyle = "rgba(255, 255, 255, .22)";
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(left, top, width * ratio, height);
  ctx.strokeStyle = "rgba(255, 255, 255, .9)";
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(left, top, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = `700 ${10 * dpr}px system-ui, sans-serif`;
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = "rgba(0, 0, 0, .92)";
  ctx.strokeText(label, x, top - 3 * dpr);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, x, top - 3 * dpr);
  ctx.restore();
}

function drawReplayCanvas(model, time) {
  const canvas = document.querySelector("#battleReplayCanvas");
  if (!canvas) return;
  resizeReplayCanvas();
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!model) {
    ctx.fillStyle = "#10131a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (replayFieldImage.complete) {
    ctx.globalAlpha = 0.92;
    ctx.drawImage(replayFieldImage, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  Object.values(model.tracks).forEach((track) => {
    const key = `${track.entity.side}-${track.entity.no}`;
    if (!state.replayVisibleEntities.has(key)) return;
    const points = track.points.filter((point) => point.t <= time && point.t >= time - state.replayTrail);
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = replayEntityColor(track.entity);
    ctx.globalAlpha = 0.78;
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((point, index) => {
      const [x, y] = replayCanvasPoint(canvas, point.x, point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  });

  const frameState = stateAt(model, time);
  const currentEvents = recentReplayEvents(model, time, 1.5);
  const hitEvents = currentEvents.filter((event) => event.type === "受击");

  if (state.replayDamageEnabled) {
    hitEvents.forEach((event) => {
      const inferred = inferReplayAttack(model, event, frameState);
      if (!inferred) return;
      const [sx, sy] = replayCanvasPoint(canvas, inferred.source.x, inferred.source.y);
      const [vx, vy] = replayCanvasPoint(canvas, inferred.victim.x, inferred.victim.y);
      const age = Math.max(0, time - numberOf(event.t));
      const alpha = Math.max(0.18, 1 - age / 1.5);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = event.category === "42mm" ? "#ffcf5a" : "#78f0c1";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = (event.category === "42mm" ? 3.4 : 2.4) * dpr;
      ctx.setLineDash(event.category === "42mm" ? [] : [7 * dpr, 5 * dpr]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(vx, vy);
      ctx.stroke();
      const angle = Math.atan2(vy - sy, vx - sx);
      const head = 9 * dpr;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx - Math.cos(angle - Math.PI / 6) * head, vy - Math.sin(angle - Math.PI / 6) * head);
      ctx.lineTo(vx - Math.cos(angle + Math.PI / 6) * head, vy - Math.sin(angle + Math.PI / 6) * head);
      ctx.closePath();
      ctx.fill();
      const value = Math.abs(numberOf(event.value));
      if (value) {
        ctx.font = `800 ${16 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 4 * dpr;
        ctx.strokeStyle = "rgba(20, 0, 0, .9)";
        ctx.strokeText(`-${fmt.format(value)}`, vx, vy - (24 + age * 16) * dpr);
        ctx.fillStyle = event.category === "42mm" ? "#ffcf5a" : "#ff5268";
        ctx.fillText(`-${fmt.format(value)}`, vx, vy - (24 + age * 16) * dpr);
      }
      ctx.restore();
    });
  }

  currentEvents
    .filter((event) => event.type !== "受击")
    .slice(0, 16)
    .forEach((event, index) => {
      const item = Object.values(frameState.byEntity).find(
        (candidate) => candidate.entity.side === event.side && numberOf(candidate.entity.id) === numberOf(event.robot_id)
      );
      if (!item || !state.replayVisibleEntities.has(item.key)) return;
      const [x, y] = replayCanvasPoint(canvas, item.x, item.y);
      const radius = (16 + (index % 4) * 4) * dpr;
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = event.type === "发弹" ? "#78f0c1" : "#b891ff";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

  (frameState.frame?.states || []).forEach((item) => drawReplayRobot(ctx, canvas, item, hitEvents));
  (frameState.frame?.states || []).forEach((item) => drawReplayObjectiveHud(ctx, canvas, item));
}

function replayRows() {
  const search = document.querySelector("#battleReplaySearch")?.value.trim().toLowerCase() || "";
  const side = document.querySelector("#battleReplaySide")?.value || "";
  return state.matches.filter((row) => {
    const haystack = `${row["赛区"]} ${row["场次号"]} ${row["红方学校"]} ${row["蓝方学校"]} ${row["胜方学校"]}`.toLowerCase();
    const winnerSide =
      numberOf(row["红胜局"]) > numberOf(row["蓝胜局"])
        ? "红胜"
        : numberOf(row["蓝胜局"]) > numberOf(row["红胜局"])
          ? "蓝胜"
          : "";
    return haystack.includes(search) && (!side || winnerSide === side);
  });
}

function replayGamesForMatch(row) {
  if (!row) return [];
  return state.replayGames
    .filter((game) => String(game["match_seq"]) === String(row["序号"]))
    .sort((a, b) => numberOf(a["round_no"]) - numberOf(b["round_no"]));
}

function selectedGameForMatch(row) {
  const games = replayGamesForMatch(row);
  if (!games.length) return null;
  const selected = games.find((game) => String(game["replay_id"]) === String(state.selectedReplayGame));
  if (selected) return selected;
  const representative = games.find((game) => String(game["round_no"]) === String(row["代表局号"]));
  return representative || games[0];
}

function renderReplayMatches() {
  const list = document.querySelector("#battleReplayList");
  if (!list) return;
  const rows = replayRows();
  if (!rows.some((row) => row["序号"] === state.selectedReplayMatch)) {
    state.selectedReplayMatch = rows[0]?.["序号"] || "";
  }
  const selectedRow = rows.find((row) => row["序号"] === state.selectedReplayMatch);
  const selectedGame = selectedGameForMatch(selectedRow);
  state.selectedReplayGame = selectedGame?.["replay_id"] || "";
  list.innerHTML = rows.length
    ? rows
        .map(
          (row) => {
            const games = replayGamesForMatch(row);
            return `
              <article class="replay-match-item ${row["序号"] === state.selectedReplayMatch ? "is-active" : ""}" data-match="${row["序号"]}">
                <button class="replay-match-main" type="button" data-match="${row["序号"]}">
                  <span class="replay-match-title">${row["红方学校"]} ${row["红胜局"]}:${row["蓝胜局"]} ${row["蓝方学校"]}</span>
                  <span class="replay-match-meta">${row["赛区"]} 第${row["场次号"]}场 · 共${row["局数"]}局 · 场胜方 ${row["胜方学校"]}</span>
                </button>
                <div class="replay-round-list" aria-label="选择局号">
                  ${games
                    .map(
                      (game) => `
                        <button type="button" class="${String(game["replay_id"]) === String(state.selectedReplayGame) ? "is-active" : ""}" data-match="${row["序号"]}" data-game="${game["replay_id"]}">
                          第${game["round_no"]}局
                        </button>
                      `
                    )
                    .join("")}
                </div>
              </article>
            `;
          }
        )
        .join("")
    : '<div class="empty">没有匹配的回放</div>';
  list.querySelectorAll(".replay-match-main").forEach((button) => {
    button.addEventListener("click", () => {
      stopReplayPlayback();
      state.selectedReplayMatch = button.dataset.match;
      state.selectedReplayGame = "";
      renderReplayMatches();
    });
  });
  list.querySelectorAll(".replay-round-list button").forEach((button) => {
    button.addEventListener("click", () => {
      stopReplayPlayback();
      state.selectedReplayMatch = button.dataset.match;
      state.selectedReplayGame = button.dataset.game;
      renderReplayMatches();
    });
  });
  loadReplayMatch(selectedRow, selectedGame);
}

async function loadReplayMatch(row, gameRow = selectedGameForMatch(row)) {
  const detail = document.querySelector("#battleReplayDetail");
  if (!detail) return;
  if (!row || !gameRow) {
    state.replayModel = null;
    detail.textContent = "没有匹配的回放";
    renderReplayRosters();
    drawReplayCanvas(null, 0);
    return;
  }
  const matchId = gameRow["replay_id"];
  if (state.replayCache[matchId]) {
    const model = state.replayCache[matchId];
    if (state.replayModel !== model) state.replayTime = model.frames[0]?.t || 0;
    state.replayModel = model;
    renderReplayFilters();
    renderReplayFrame();
    return;
  }
  detail.textContent = "正在读取回放数据";
  try {
    const response = await fetch(replayFile(gameRow));
    if (!response.ok) throw new Error("该场暂无回放数据");
    const model = buildReplayModel(await response.json());
    state.replayCache[matchId] = model;
    state.replayModel = model;
    state.replayTime = model.frames[0]?.t || 0;
    state.replayVisibleEntities = new Set(model.entities.map((entity) => `${entity.side}-${entity.no}`));
    state.replayVisibleEvents = new Set(model.eventTypes);
    state.replaySelectedEntity = "";
    renderReplayFilters();
    renderReplayFrame();
  } catch (error) {
    state.replayModel = null;
    detail.textContent = error.message;
    renderReplayRosters();
  }
}

function renderReplayFilters() {
  const model = state.replayModel;
  const trackFilters = document.querySelector("#battleReplayTrackFilters");
  const eventFilters = document.querySelector("#battleReplayEventFilters");
  if (!trackFilters || !eventFilters || !model) return;
  const roles = [...new Set(model.entities.map((entity) => entity.type).filter(Boolean))].sort(
    (a, b) => replayEntitySort({ type: a, no: 0 }, { type: b, no: 0 })
  );
  trackFilters.innerHTML = `
    <span>机器人</span>
    ${roles
      .map((role) => {
        const roleKeys = model.entities.filter((entity) => entity.type === role).map((entity) => `${entity.side}-${entity.no}`);
        const checked = roleKeys.some((key) => state.replayVisibleEntities.has(key));
        return `<label><input type="checkbox" data-role="${role}" ${checked ? "checked" : ""} /> ${role}</label>`;
      })
      .join("")}
  `;
  eventFilters.innerHTML = `
    <span>事件</span>
    ${model.eventTypes
      .map((type) => `<label><input type="checkbox" data-event="${type}" ${state.replayVisibleEvents.has(type) ? "checked" : ""} /> ${type}</label>`)
      .join("")}
  `;
  trackFilters.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      model.entities
        .filter((entity) => entity.type === input.dataset.role)
        .forEach((entity) => {
          const key = `${entity.side}-${entity.no}`;
          if (input.checked) state.replayVisibleEntities.add(key);
          else state.replayVisibleEntities.delete(key);
        });
      renderReplayFrame();
    });
  });
  eventFilters.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.replayVisibleEvents.add(input.dataset.event);
      else state.replayVisibleEvents.delete(input.dataset.event);
      renderReplayFrame();
    });
  });
}

function renderReplayRosters() {
  const red = document.querySelector("#battleReplayRedRoster");
  const blue = document.querySelector("#battleReplayBlueRoster");
  if (!red || !blue) return;
  const model = state.replayModel;
  if (!model) {
    red.innerHTML = "";
    blue.innerHTML = "";
    return;
  }
  const frameState = stateAt(model, state.replayTime);
  const currentEvents = recentReplayEvents(model, state.replayTime, 3);
  const markup = (side) => {
    const states = Object.values(frameState.byEntity)
      .filter((item) => item.entity.side === side)
      .sort((a, b) => replayEntitySort(a.entity, b.entity));
    return `
      <div class="replay-roster-title"><strong>${side}方</strong><span>${states[0]?.entity.school || ""}</span></div>
      ${states
        .map((item) => {
          const hpRatio = item.maxHp ? Math.max(0, Math.min(1, item.hp / item.maxHp)) : 0;
          const heatRatio = item.heatLimit ? Math.max(0, Math.min(1, item.heat / item.heatLimit)) : 0;
          const key = item.key;
          const recent = currentEvents
            .filter((event) => event.side === side && numberOf(event.robot_id) === numberOf(item.entity.id))
            .map((event) => event.type)
            .slice(0, 2);
          return `
            <article class="replay-unit-card ${state.replayVisibleEntities.has(key) ? "" : "is-hidden"} ${state.replaySelectedEntity === key ? "is-selected" : ""}" data-entity="${key}">
              <div class="replay-unit-head"><span><i>${item.entity.no}</i>${item.entity.type}</span><strong>${fmt.format(item.hp)} / ${fmt.format(item.maxHp)}</strong></div>
              <div class="replay-hp"><span style="width:${hpRatio * 100}%"></span></div>
              <div class="replay-unit-stats"><span>热量 ${fmt.format(item.heat)}/${fmt.format(item.heatLimit)}</span><span>发弹 ${numberOf(item.shots17) + numberOf(item.shots42)}${item.shotDelta ? ` +${item.shotDelta}` : ""}</span></div>
              <div class="replay-heat"><span style="width:${heatRatio * 100}%"></span></div>
              <small>${[item.vulnerable ? "易伤" : "", ...recent].filter(Boolean).join(" · ") || "稳定"}</small>
            </article>
          `;
        })
        .join("")}
    `;
  };
  red.innerHTML = markup("红");
  blue.innerHTML = markup("蓝");
  document.querySelectorAll(".replay-unit-card").forEach((card) => {
    card.addEventListener("click", () => {
      const key = card.dataset.entity;
      state.replaySelectedEntity = state.replaySelectedEntity === key ? "" : key;
      renderReplayFrame();
    });
  });
}

function renderReplayFrame() {
  const model = state.replayModel;
  const slider = document.querySelector("#battleReplaySlider");
  const time = document.querySelector("#battleReplayTime");
  const detail = document.querySelector("#battleReplayDetail");
  if (!model || !slider || !time || !detail) return;
  const frameState = stateAt(model, state.replayTime);
  if (!frameState.frame) return;
  slider.max = model.duration;
  slider.value = state.replayTime;
  time.textContent = `${state.replayTime.toFixed(1)}s / 倒计时 ${Math.max(0, Math.ceil(420 - state.replayTime)).toString().padStart(3, "0")}s`;
  drawReplayCanvas(model, state.replayTime);
  renderReplayRosters();
  const details = recentReplayEvents(model, state.replayTime, 2.5)
    .sort((a, b) => (a.type === "受击" ? 0 : 1) - (b.type === "受击" ? 0 : 1) || numberOf(b.t) - numberOf(a.t))
    .slice(0, 28);
  detail.innerHTML = renderReplayEventPanel(model, details, state.replayTime);
}

function fieldLeft(x) {
  return Math.max(0, Math.min(100, (numberOf(x) / FIELD_WIDTH) * 100));
}

function fieldTop(y) {
  return Math.max(0, Math.min(100, (1 - numberOf(y) / FIELD_HEIGHT) * 100));
}

function damageSourceRowsForMatch(row) {
  if (!row) return [];
  return state.damageSources.filter((item) => item["match_id"] === row["序号"]);
}

function damageSourceCandidates(row) {
  const point = state.selectedDamagePoint;
  const rows = damageSourceRowsForMatch(row);
  if (!point || !rows.length) return [];
  const withDistance = rows
    .map((item) => {
      const dx = numberOf(item["hit_x"]) - point.x;
      const dy = numberOf(item["hit_y"]) - point.y;
      return { ...item, clickDistance: Math.hypot(dx, dy) };
    })
    .sort((a, b) => a.clickDistance - b.clickDistance || numberOf(b["hit_count"]) - numberOf(a["hit_count"]));
  const close = withDistance.filter((item) => item.clickDistance <= 2.2);
  return mergeDamageSourceCandidates(close.length ? close : withDistance.slice(0, 12))
    .sort((a, b) => numberOf(b["hit_count"]) - numberOf(a["hit_count"]))
    .slice(0, 18);
}

function mergeDamageSourceCandidates(rows) {
  const groups = new Map();
  rows.forEach((item) => {
    const sourceCellX = Math.round(numberOf(item["source_x"]) / 1.8);
    const sourceCellY = Math.round(numberOf(item["source_y"]) / 1.8);
    const key = `${item["source_robot_id"]}:${sourceCellX}:${sourceCellY}`;
    const hits = numberOf(item["hit_count"]);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...item, damageTypes: new Set([item["damage_type"]]) });
      return;
    }
    const oldHits = numberOf(existing["hit_count"]);
    const totalHits = oldHits + hits;
    const weighted = (field) => {
      const value = (numberOf(existing[field]) * oldHits + numberOf(item[field]) * hits) / Math.max(totalHits, 1);
      existing[field] = value.toFixed(field.includes("_distance") ? 2 : 3);
    };
    weighted("hit_x");
    weighted("hit_y");
    weighted("source_x");
    weighted("source_y");
    weighted("avg_distance");
    existing["hit_count"] = String(totalHits);
    existing["damage_sum"] = (numberOf(existing["damage_sum"]) + numberOf(item["damage_sum"])).toFixed(1);
    existing.damageTypes.add(item["damage_type"]);
    existing["damage_type"] = [...existing.damageTypes].filter(Boolean).join("/");
    existing.clickDistance = Math.min(existing.clickDistance, item.clickDistance);
  });
  return [...groups.values()].map((item) => {
    delete item.damageTypes;
    return item;
  });
}

function damageSourceMarker(item, index) {
  const sideClass = item["source_side"] === "红" ? "red" : "blue";
  const hits = numberOf(item["hit_count"]);
  const size = Math.max(24, Math.min(44, 22 + Math.sqrt(hits) * 2.4));
  const label = `${item["source_side"]}${item["source_robot_no"]}`;
  return `
    <button
      class="damage-source-marker ${sideClass}"
      style="left:${fieldLeft(item["source_x"])}%;top:${fieldTop(item["source_y"])}%;width:${size}px;height:${size}px"
      title="${item["source_school"]} ${item["source_side"]}${item["source_robot_no"]}号 ${item["source_robot_type"]} · ${hits} 次"
      data-source-index="${index}"
    >
      <strong>${label}</strong>
      <span>${item["source_robot_type"]}</span>
    </button>
  `;
}

function damageSourceListItem(item) {
  const sideClass = item["source_side"] === "红" ? "red" : "blue";
  return `
    <div class="damage-source-card ${sideClass}">
      <strong>${item["source_side"]}${item["source_robot_no"]}号 ${item["source_robot_type"]}</strong>
      <span>${item["source_school"]}</span>
      <em>${item["damage_type"]} · ${fmt.format(numberOf(item["hit_count"]))} 次 · 伤害 ${fmt.format(numberOf(item["damage_sum"]))}</em>
      <small>主要命中 ${item["target_side"]}${item["target_robot_no"]}号 ${item["target_robot_type"]} · 均距 ${fmt.format(numberOf(item["avg_distance"]))}m</small>
    </div>
  `;
}

function renderDamageSourceMap(row) {
  const map = document.querySelector("#damageSourceMap");
  const overlay = document.querySelector("#damageSourceOverlay");
  const meta = document.querySelector("#damageSourceMeta");
  const list = document.querySelector("#damageSourceList");
  if (!map || !overlay || !meta || !list) return;

  const rows = damageSourceRowsForMatch(row);
  map.onclick = (event) => {
    if (!row) return;
    const rect = map.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * FIELD_WIDTH;
    const y = (1 - (event.clientY - rect.top) / rect.height) * FIELD_HEIGHT;
    state.selectedDamagePoint = {
      x: Math.max(0, Math.min(FIELD_WIDTH, x)),
      y: Math.max(0, Math.min(FIELD_HEIGHT, y)),
    };
    renderDamageSourceMap(row);
  };

  if (!row) {
    overlay.innerHTML = "";
    meta.textContent = "未选择对局";
    list.innerHTML = "";
    return;
  }
  if (!rows.length) {
    overlay.innerHTML = "";
    meta.textContent = "该对局暂无可匹配来源数据";
    list.innerHTML = "";
    return;
  }
  if (!state.selectedDamagePoint) {
    overlay.innerHTML = "";
    meta.textContent = `${rows.length} 个来源聚合点`;
    list.innerHTML = `
      <div class="damage-source-empty">
        <strong>选择一个地图位置</strong>
        <span>将显示附近受击事件对应的发弹来源。</span>
      </div>
    `;
    return;
  }

  const point = state.selectedDamagePoint;
  const candidates = damageSourceCandidates(row);
  const lines = candidates
    .slice(0, 12)
    .map(
      (item) => `
        <line
          x1="${fieldLeft(point.x)}" y1="${fieldTop(point.y)}"
          x2="${fieldLeft(item["source_x"])}" y2="${fieldTop(item["source_y"])}"
        />
      `
    )
    .join("");
  overlay.innerHTML = `
    <svg class="damage-source-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
    <div class="damage-click-point" style="left:${fieldLeft(point.x)}%;top:${fieldTop(point.y)}%"></div>
    ${candidates.map(damageSourceMarker).join("")}
  `;
  meta.textContent = `坐标 ${fmt.format(point.x)}, ${fmt.format(point.y)} · 来源 ${candidates.length} 组`;
  list.innerHTML = candidates.length
    ? candidates.map(damageSourceListItem).join("")
    : `
      <div class="damage-source-empty">
        <strong>附近暂无匹配来源</strong>
        <span>可换一个交火更密集的位置查看。</span>
      </div>
    `;
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
                  <span>${row["队伍名称"]} · ${row["风格分类"] || "未分类"} · 上赛季 ${row["上赛季国赛成绩"] || "-"}</span>
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

  renderDetailCards("#predictionSummary", [
    ["筛选队伍", `${rows.length} 支`],
    ["模拟次数", state.tournamentSimulation[0]?.["模拟次数"] || "-"],
    ["上赛季权重", "30%"],
    ["争冠最高", topChampion ? `${topChampion["学校名"]} ${probPct(topChampion["全国赛夺冠概率"])}` : "-"],
  ]);
  const revivalRows = rows
    .filter((row) => row["参赛类别"] === "复活赛")
    .sort((a, b) => numberOf(b["复活赛晋级全国赛概率"]) - numberOf(a["复活赛晋级全国赛概率"]));
  document.querySelector("#predictionSimulationChart").innerHTML = `
    <div class="analysis-note">
      按参赛手册抽签盒随机分组，并模拟复活赛 3 轮瑞士轮、复活赛双败名额争夺战、全国赛 5 轮瑞士轮、16 进 8/8 进 4 双败淘汰、半决赛和 BO5 决赛。模型强度按 70% 当前区域赛指标与 30% 上赛季国赛成绩参考分合成，不代表官方预测。
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
    ["上赛季", (r) => r["上赛季国赛成绩"] || "-"],
    ["强度", (r) => fmt.format(numberOf(r["模型强度分"]))],
    ["复活赛晋级", (r) => (r["参赛类别"] === "复活赛" ? probPct(r["复活赛晋级全国赛概率"]) : "-")],
    ["十六强", (r) => probPct(r["全国赛十六强概率"])],
    ["八强", (r) => probPct(r["全国赛八强概率"])],
    ["四强", (r) => probPct(r["全国赛四强概率"])],
    ["冠军", (r) => probPct(r["全国赛夺冠概率"])],
  ]);
  renderPredictionStyleChart(rows);
}

function rankOf(rows, key, school, desc = true) {
  const sorted = rows
    .slice()
    .sort((a, b) => (desc ? numberOf(b[key]) - numberOf(a[key]) : numberOf(a[key]) - numberOf(b[key])));
  return sorted.findIndex((row) => row["学校名"] === school) + 1;
}

function sharkMetricRows(team, style, prediction) {
  const maxes = profileMaxes();
  return [
    {
      label: "平均造成伤害",
      sub: `全体第 ${rankOf(state.teams, "火力收益_平均造成伤害", SHARK_SCHOOL)} / ${state.teams.length}`,
      value: maxes.fire ? numberOf(team["火力收益_平均造成伤害"]) / maxes.fire : 0,
      display: fmt.format(numberOf(team["火力收益_平均造成伤害"])),
      color: "negative",
    },
    {
      label: "平均装配次数",
      sub: `全体第 ${rankOf(state.teams, "平均装配次数", SHARK_SCHOOL)} / ${state.teams.length}`,
      value: Math.max(...state.teams.map((row) => numberOf(row["平均装配次数"]))) ? numberOf(team["平均装配次数"]) / Math.max(...state.teams.map((row) => numberOf(row["平均装配次数"]))) : 0,
      display: fmt.format(numberOf(team["平均装配次数"])),
      color: "green",
    },
    {
      label: "平均飞镖伤害",
      sub: `全体第 ${rankOf(state.teams, "平均飞镖伤害", SHARK_SCHOOL)} / ${state.teams.length}`,
      value: maxes.dart ? numberOf(team["飞镖收益指数_显示用"]) / maxes.dart : 0,
      display: fmt.format(numberOf(team["平均飞镖伤害"])),
    },
    {
      label: "风格低暴露分",
      sub: `${style?.["风格分类"] || "未分类"} · 易伤分 ${fmt.format(numberOf(style?.["平均易伤机器人秒_分"]))}`,
      value: Math.max(0.02, 1 - numberOf(style?.["平均易伤机器人秒_分"]) / 100),
      display: fmt.format(100 - numberOf(style?.["平均易伤机器人秒_分"])),
      color: "green",
    },
    {
      label: "模型强度分",
      sub: `区域赛 ${fmt.format(numberOf(prediction?.["区域赛模型强度分"]))} · 上赛季 ${prediction?.["上赛季国赛成绩"] || "-"}`,
      value: numberOf(prediction?.["模型强度分"]) / 100,
      display: fmt.format(numberOf(prediction?.["模型强度分"])),
    },
  ];
}

function renderSharkProfile(team, style, prediction) {
  renderRankRows("#sharkProfile", sharkMetricRows(team, style, prediction), {
    label: (row) => row.label,
    sub: (row) => row.sub,
    value: (row) => row.value,
    max: 1,
    color: (row) => row.color || "",
    format: (_, row) => row.display,
  });
}

function renderSharkPrediction(prediction) {
  const rows = [
    ["全国赛十六强", prediction?.["全国赛十六强概率"], "瑞士轮 3 胜晋级 16 强"],
    ["全国赛八强", prediction?.["全国赛八强概率"], "16 进 8 双败后留存"],
    ["全国赛四强", prediction?.["全国赛四强概率"], "8 进 4 双败后留存"],
    ["全国赛冠军", prediction?.["全国赛夺冠概率"], "半决赛与决赛路径"],
  ].map(([label, value, sub]) => ({ label, value: numberOf(value), sub }));
  renderRankRows("#sharkPrediction", rows, {
    label: (row) => row.label,
    sub: (row) => row.sub,
    value: (row) => row.value,
    max: Math.max(...rows.map((row) => row.value), 0.01),
    format: (value) => probPct(value),
  });
}

function renderSharkMapControl() {
  const rows = state.mapTopZones
    .filter((row) => row["学校名"] === SHARK_SCHOOL)
    .sort((a, b) => numberOf(b["占比"]) - numberOf(a["占比"]));
  const grouped = rows.reduce((acc, row) => {
    acc[row["区域"]] ||= [];
    acc[row["区域"]].push(row);
    return acc;
  }, {});
  document.querySelector("#sharkMapControl").innerHTML = `
    <div class="field-map-panel shark-field-map">
      <img src="./assets/field/official_field_map.png" alt="官方场地图" />
      <div class="field-zone-overlay">
        ${Object.entries(grouped).map(([zoneName, zoneRows]) => zoneCell(zoneName, zoneRows)).join("")}
      </div>
    </div>
    <div class="table-wrap shark-subtable"></div>
  `;
  renderDataTable("#sharkMapControl .shark-subtable", rows, [
    ["兵种", (r) => r["机器人类型"]],
    ["最高活动区域", (r) => r["区域"]],
    ["占比", (r) => pct(r["占比"])],
    ["样本数", (r) => fmt.format(numberOf(r["样本数"]))],
  ]);
}

function sharkMatchRows() {
  return state.matches
    .filter((row) => row["红方学校"] === SHARK_SCHOOL || row["蓝方学校"] === SHARK_SCHOOL)
    .sort((a, b) => numberOf(b["场总伤害"]) - numberOf(a["场总伤害"]));
}

function renderSharkMatches() {
  const rows = sharkMatchRows();
  const wins = rows.filter((row) => row["胜方学校"] === SHARK_SCHOOL).length;
  const sideRows = state.matchSideMetrics.filter((row) => row["学校名"] === SHARK_SCHOOL);
  const totalDamage = sideRows.reduce((sum, row) => sum + numberOf(row["造成伤害"]), 0);
  const totalTaken = sideRows.reduce((sum, row) => sum + numberOf(row["受伤害"]), 0);
  renderDetailCards("#sharkMatchSummary", [
    ["已分析场次", rows.length],
    ["场胜率", pct(rows.length ? wins / rows.length : 0)],
    ["总造成伤害", fmt.format(totalDamage)],
    ["伤害净值", fmt.format(totalDamage - totalTaken)],
  ]);
  renderDataTable("#sharkMatches", rows, [
    ["赛区", (r) => r["赛区"]],
    ["场次", (r) => `第${r["场次号"]}场`],
    ["对阵", (r) => `${r["红方学校"]} ${r["红胜局"]}:${r["蓝胜局"]} ${r["蓝方学校"]}`],
    ["胜方", (r) => r["胜方学校"]],
    ["场总伤害", (r) => fmt.format(numberOf(r["场总伤害"]))],
    ["图集", (r) => `<button class="inline-action shark-match-link" data-match="${r["序号"]}">查看</button>`],
  ]);
  document.querySelectorAll(".shark-match-link").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMatch = button.dataset.match;
      setView("matches");
      renderMatches();
    });
  });
}

function avg(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + numberOf(row[key]), 0) / rows.length;
}

function renderSharkReasonAnalysis() {
  const games = state.teamGameMetrics.filter((row) => row["学校名"] === SHARK_SCHOOL);
  const winRows = games.filter((row) => numberOf(row["是否胜方"]) === 1);
  const lossRows = games.filter((row) => numberOf(row["是否胜方"]) === 0);
  const metrics = [
    ["输出伤害", "造成非判罚伤害", "higher", "胜局平均输出越高，越能主动结束交火并保护基地。"],
    ["受伤害", "受非判罚伤害", "lower", "败局受伤害显著抬升时，说明正面换血或防守轮转被压制。"],
    ["装配次数", "装配次数", "higher", "胜局装配次数更高，说明工程/科技核心收益更完整。"],
    ["总发弹", "总发弹", "higher", "胜局发弹量更高，通常代表持续压制和交火参与度更足。"],
    ["末基地血量", "末基地血量", "higher", "基地保持是胜负结果的直接体现，也反映防守与资源交换质量。"],
    ["末总金币", "末总金币", "higher", "胜局末金币更高，说明经济循环和资源利用更稳定。"],
    ["易伤机器人秒", "易伤机器人秒", "context", "该指标需要结合输出看：南工骁鹰胜局易伤更高，偏向主动承压换输出。"],
    ["伤害每百发", "伤害每百发", "higher", "单发效率不是唯一胜因，低发弹量下该指标可能虚高。"],
  ].map(([label, key, direction, note]) => {
    const winAvg = avg(winRows, key);
    const lossAvg = avg(lossRows, key);
    const diff = winAvg - lossAvg;
    const favorable = direction === "lower" ? diff < 0 : direction === "context" ? true : diff > 0;
    return { label, key, note, winAvg, lossAvg, diff, favorable };
  });
  const byKey = Object.fromEntries(metrics.map((row) => [row.key, row]));
  const causeCards = [
    {
      title: "胜局主因",
      label: "输出建立优势",
      text: `胜局平均造成伤害 ${fmt.format(byKey["造成非判罚伤害"].winAvg)}，比败局高 ${fmt.format(Math.abs(byKey["造成非判罚伤害"].diff))}。`,
    },
    {
      title: "胜局主因",
      label: "承伤压力可控",
      text: `胜局平均受伤害 ${fmt.format(byKey["受非判罚伤害"].winAvg)}，比败局低 ${fmt.format(Math.abs(byKey["受非判罚伤害"].diff))}。`,
    },
    {
      title: "胜局主因",
      label: "装配更完整",
      text: `胜局平均装配 ${fmt.format(byKey["装配次数"].winAvg)} 次，败局为 ${fmt.format(byKey["装配次数"].lossAvg)} 次。`,
    },
    {
      title: "败局风险",
      label: "基地血量被快速压低",
      text: `败局末基地均值 ${fmt.format(byKey["末基地血量"].lossAvg)}，比胜局低 ${fmt.format(Math.abs(byKey["末基地血量"].diff))}。`,
    },
  ];
  document.querySelector("#sharkReasonSummary").innerHTML = causeCards
    .map(
      (card) => `
        <div class="reason-card">
          <span>${card.title}</span>
          <strong>${card.label}</strong>
          <p>${card.text}</p>
        </div>
      `
    )
    .join("");
  const maxDiff = Math.max(...metrics.map((row) => Math.abs(row.diff)), 1);
  renderRankRows("#sharkReasonChart", metrics, {
    label: (row) => row.label,
    sub: (row) => `胜局 ${fmt.format(row.winAvg)} / 败局 ${fmt.format(row.lossAvg)}`,
    value: (row) => row.diff,
    max: maxDiff,
    color: (row) => (row.favorable ? "green" : "negative"),
    format: (value) => `${value >= 0 ? "+" : ""}${fmt.format(value)}`,
  });
  renderDataTable("#sharkReasonTable", metrics, [
    ["指标", (r) => r.label],
    ["胜局均值", (r) => fmt.format(r.winAvg)],
    ["败局均值", (r) => fmt.format(r.lossAvg)],
    ["胜负差", (r) => `${r.diff >= 0 ? "+" : ""}${fmt.format(r.diff)}`],
    ["原因解读", (r) => r.note],
  ]);
}

function renderSharkGameMetrics() {
  const rows = state.teamGameMetrics
    .filter((row) => row["学校名"] === SHARK_SCHOOL)
    .sort((a, b) => numberOf(a["场次号"]) - numberOf(b["场次号"]) || numberOf(a["局号"]) - numberOf(b["局号"]));
  renderDataTable("#sharkGameMetrics", rows, [
    ["赛程", (r) => r["赛程"]],
    ["局号", (r) => r["局号"]],
    ["阵营", (r) => r["阵营"]],
    ["对手", (r) => r["对手学校"]],
    ["结果", (r) => (numberOf(r["是否胜方"]) ? "胜" : "负")],
    ["造成伤害", (r) => fmt.format(numberOf(r["造成非判罚伤害"]))],
    ["受伤害", (r) => fmt.format(numberOf(r["受非判罚伤害"]))],
    ["装配", (r) => fmt.format(numberOf(r["装配次数"]))],
    ["易伤秒", (r) => fmt.format(numberOf(r["易伤机器人秒"]))],
    ["末基地", (r) => fmt.format(numberOf(r["末基地血量"]))],
  ]);
}

function renderSharkColumn() {
  const team = state.teams.find((row) => row["学校名"] === SHARK_SCHOOL);
  const style = state.teamStyles.find((row) => row["学校名"] === SHARK_SCHOOL);
  const prediction = state.tournamentSimulation.find((row) => row["学校名"] === SHARK_SCHOOL);
  if (!team) return;
  renderDetailCards("#sharkSummary", [
    ["队伍", `${team["队伍名称"]} · ${team["手册参赛类别"]}`],
    ["区域赛胜局率", pct(team["区域赛胜局率"])],
    ["战术画像", team["战术画像"]],
    ["风格分类", style?.["风格分类"] || "-"],
    ["上赛季国赛", prediction?.["上赛季国赛成绩"] || "-"],
    ["十六强概率", probPct(prediction?.["全国赛十六强概率"])],
    ["八强概率", probPct(prediction?.["全国赛八强概率"])],
    ["四强概率", probPct(prediction?.["全国赛四强概率"])],
  ]);
  renderSharkProfile(team, style, prediction);
  renderSharkPrediction(prediction);
  renderSharkMapControl();
  renderSharkMatches();
  renderSharkReasonAnalysis();
  renderSharkGameMetrics();
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
  ["battleReplaySearch", "battleReplaySide"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", () => {
      stopReplayPlayback();
      renderReplayMatches();
    });
  });
  document.querySelector("#battleReplaySlider").addEventListener("input", (event) => {
    stopReplayPlayback();
    state.replayTime = numberOf(event.target.value);
    renderReplayFrame();
  });
  ["input", "change"].forEach((eventName) => {
    document.querySelector("#battleReplaySpeed").addEventListener(eventName, (event) => {
      state.replaySpeed = numberOf(event.target.value) || 1;
    });
  });
  document.querySelector("#battleReplayTrail").addEventListener("input", (event) => {
    state.replayTrail = Math.max(4, Math.min(90, numberOf(event.target.value) || 20));
    renderReplayFrame();
  });
  document.querySelector("#battleReplayDamageToggle").addEventListener("input", (event) => {
    state.replayDamageEnabled = event.target.checked;
    renderReplayFrame();
  });
  document.querySelector("#battleReplayPlay").addEventListener("click", () => {
    if (!state.replayModel) return;
    if (state.replayTimer || state.replayAnimationFrame) {
      stopReplayPlayback();
      return;
    }
    startSmoothReplayPlayback();
  });
  document.querySelector("#openReplayFromMatch").addEventListener("click", () => {
    stopReplayPlayback();
    const row = state.matches.find((item) => item["序号"] === state.selectedMatch);
    const representative = replayGamesForMatch(row).find((game) => String(game["round_no"]) === String(row?.["代表局号"]));
    state.selectedReplayMatch = state.selectedMatch;
    state.selectedReplayGame = representative?.["replay_id"] || "";
    setView("replay");
    renderReplayMatches();
  });
  replayFieldImage.addEventListener("load", renderReplayFrame);
  window.addEventListener("resize", renderReplayFrame);
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
    state.assemblyTeams = window.RMUC_DATA.assemblyTeams || [];
    state.mapZones = window.RMUC_DATA.mapZones || [];
    state.mapTopZones = window.RMUC_DATA.mapTopZones || [];
    state.matchSideMetrics = window.RMUC_DATA.matchSideMetrics || [];
    state.teamStyles = window.RMUC_DATA.teamStyles || [];
    state.tournamentSimulation = window.RMUC_DATA.tournamentSimulation || [];
    state.teamGameMetrics = window.RMUC_DATA.teamGameMetrics || [];
    state.damageSources = window.RMUC_DATA.damageSources || [];
    state.replayGames = await loadCsv("./data/battlescope_replay_index.csv");
  } else {
    const [
      teams,
      matches,
      assemblyTeams,
      mapZones,
      mapTopZones,
      matchSideMetrics,
      teamStyles,
      tournamentSimulation,
      teamGameMetrics,
      damageSources,
      replayGames,
    ] = await Promise.all([
      loadCsv("./data/all_qualified_team_tactical_profile_metrics.csv"),
      loadCsv("./data/all_handbook_h2h_matches_visuals.csv"),
      loadCsv("./data/analysis_assembly_team_summary.csv"),
      loadCsv("./data/analysis_map_control_zones.csv"),
      loadCsv("./data/analysis_map_control_top_zones.csv"),
      loadCsv("./data/analysis_match_side_metrics.csv"),
      loadCsv("./data/analysis_team_style_clusters.csv"),
      loadCsv("./data/simulation_tournament_probabilities.csv"),
      loadCsv("./data/analysis_team_game_metrics.csv"),
      loadCsv("./data/analysis_damage_source_points.csv"),
      loadCsv("./data/battlescope_replay_index.csv"),
    ]);
    state.teams = teams;
    state.matches = matches;
    state.assemblyTeams = assemblyTeams;
    state.mapZones = mapZones;
    state.mapTopZones = mapTopZones;
    state.matchSideMetrics = matchSideMetrics;
    state.teamStyles = teamStyles;
    state.tournamentSimulation = tournamentSimulation;
    state.teamGameMetrics = teamGameMetrics;
    state.damageSources = damageSources;
    state.replayGames = replayGames;
  }
  renderMetrics();
  renderIntensityChart();
  renderOverviewProfileChart();
  renderProfileChart();
  renderTeamTable();
  renderPrediction();
  renderReplayMatches();
  renderSharkColumn();
  renderMatches();
  renderAnalysis();
}

init().catch((error) => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div style="padding:12px;background:#fee;border-bottom:1px solid #d88;color:#800">数据加载失败：${error.message}</div>`
  );
});
