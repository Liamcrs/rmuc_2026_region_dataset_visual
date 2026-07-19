# Static BattleScope Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate `战术回放` module that recreates the clear Canvas replay experience of `ezthor/rm-battlescope` using the existing 96 static replay JSON files.

**Architecture:** Keep the site static and load replay JSON on demand. Convert each compact replay JSON into an internal per-entity replay model, then render the field, tracks, robots, events, and damage effects on a responsive Canvas. The existing `对局地图` view remains for static heatmap/path images and damage-source click analysis.

**Tech Stack:** Plain HTML, CSS, browser JavaScript, Canvas 2D, existing CSV/JSON files, GitHub Pages static hosting.

## Global Constraints

- The module covers only the 96 matches already available in the current website.
- Do not add a Python parsing server or user-triggered replay generation jobs.
- Do not embed all replay JSON files into `data.js`.
- Load replay JSON on demand and cache it in memory after first use.
- Use `assets/field/official_field_map.png` as the field background.
- Remove the existing small replay block inside `对局地图` or replace it with a lightweight link/button into the new module.
- Do not present unavailable mechanics, such as true economy lanes or paid revival intervals, as certain.
- Verification must include `node --check app.js`, `git diff --check`, replay data shape checks, and local HTTP checks.

---

### Task 1: Add The Separate Replay View

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`

**Interfaces:**
- Consumes: `setView(viewName)` existing tab switcher.
- Produces: DOM ids `battleReplaySearch`, `battleReplaySide`, `battleReplayList`, `battleReplayCanvas`, `battleReplayRedRoster`, `battleReplayBlueRoster`, `battleReplayDetail`, `battleReplaySlider`, `battleReplayPlay`, `battleReplaySpeed`, `battleReplayTrail`, `battleReplayDamageToggle`, `battleReplayTrackFilters`, and `battleReplayEventFilters`.

- [ ] **Step 1: Add the nav tab**

Add this button in `index.html` between `比赛预测` and `南工骁鹰`:

```html
<button class="tab" data-view="replay">战术回放</button>
```

- [ ] **Step 2: Add the replay section**

Add a new `section id="replay"` with a match browser and replay workspace. The center workspace must contain a Canvas, not DOM markers:

```html
<section id="replay" class="view">
  <section class="panel replay-shell">
    <div class="panel-head">
      <div>
        <h2>战术回放</h2>
        <p>静态 BattleScope：选择已有 96 场代表局，查看机器人轨迹、状态、受击与事件。</p>
      </div>
      <div class="filters">
        <input id="battleReplaySearch" type="search" placeholder="搜索学校、赛区或场次" />
        <select id="battleReplaySide">
          <option value="">全部</option>
          <option value="红胜">红方胜</option>
          <option value="蓝胜">蓝方胜</option>
        </select>
      </div>
    </div>
    <div class="replay-layout">
      <aside id="battleReplayList" class="replay-match-list" aria-label="战术回放比赛列表"></aside>
      <section class="replay-workspace">
        <div class="replay-controls" aria-label="战术回放控制"></div>
        <div class="replay-filters">
          <div id="battleReplayTrackFilters"></div>
          <div id="battleReplayEventFilters"></div>
        </div>
        <div class="replay-battle-grid">
          <aside id="battleReplayRedRoster" class="replay-roster red"></aside>
          <div class="replay-center">
            <div class="replay-stage"><canvas id="battleReplayCanvas"></canvas></div>
            <div id="battleReplayDetail" class="replay-detail"></div>
          </div>
          <aside id="battleReplayBlueRoster" class="replay-roster blue"></aside>
        </div>
      </section>
    </div>
  </section>
</section>
```

- [ ] **Step 3: Add minimal state**

Add these fields to the existing `state` object in `app.js`:

```js
selectedReplayMatch: "",
replayCache: {},
replayModel: null,
replayTime: 0,
replayTimer: null,
replaySpeed: 1,
replayTrail: 20,
replayVisibleEntities: new Set(),
replayVisibleEvents: new Set(),
replayDamageEnabled: true,
replaySelectedEntity: "",
```

- [ ] **Step 4: Verify static parsing**

Run:

```bash
node --check app.js
```

Expected: exit code 0.

### Task 2: Build The Replay Data Adapter

**Files:**
- Modify: `app.js`
- Create: `tools/verify_battlescope_replays.js`

**Interfaces:**
- Consumes: compact replay JSON with `meta`, `entities`, `frames[].s`, and `events`.
- Produces: `buildReplayModel(replay)` returning `{ meta, entities, frames, tracks, events, eventTypes, duration }`.
- Produces: `stateAt(model, time)` returning `{ frame, byEntity }`.

- [ ] **Step 1: Add adapter functions**

Implement these functions in `app.js`:

```js
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
```

```js
function buildReplayModel(replay) {
  const frames = (replay.frames || []).map((frame) => ({
    t: numberOf(frame.t),
    states: (frame.s || []).map((compact) => unpackReplayState(replay, compact)),
  }));
  const tracks = {};
  frames.forEach((frame) => {
    frame.states.forEach((item) => {
      tracks[item.key] ||= { entity: item.entity, points: [] };
      tracks[item.key].points.push({ t: frame.t, x: item.x, y: item.y, heading: item.heading });
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
```

```js
function stateAt(model, time) {
  const frame = nearestReplayFrame(model, time);
  return {
    frame,
    byEntity: Object.fromEntries((frame?.states || []).map((item) => [item.key, item])),
  };
}
```

- [ ] **Step 2: Add the verification script**

Create `tools/verify_battlescope_replays.js`:

```js
const fs = require("fs");

const problems = [];
for (let i = 1; i <= 96; i += 1) {
  const file = `data/battlescope_replays/match_${String(i).padStart(3, "0")}.json`;
  if (!fs.existsSync(file)) {
    problems.push(`${file}: missing`);
    continue;
  }
  const replay = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!replay.meta || !Array.isArray(replay.entities) || !Array.isArray(replay.frames) || !Array.isArray(replay.events)) {
    problems.push(`${file}: invalid top-level shape`);
  }
  if (!replay.frames.some((frame) => Array.isArray(frame.s) && frame.s.length > 0)) {
    problems.push(`${file}: no populated frames`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("BattleScope replay data OK");
```

- [ ] **Step 3: Verify adapter assumptions**

Run:

```bash
node tools/verify_battlescope_replays.js
```

Expected output:

```text
BattleScope replay data OK
```

### Task 3: Implement Canvas Replay Rendering

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `buildReplayModel(replay)` and `stateAt(model, time)`.
- Produces: `renderReplayFrame()` and `drawReplayCanvas(model, time)`.

- [ ] **Step 1: Implement Canvas helpers**

Add helpers:

```js
function replayCanvasPoint(canvas, x, y) {
  return [(numberOf(x) / FIELD_WIDTH) * canvas.width, (1 - numberOf(y) / FIELD_HEIGHT) * canvas.height];
}

function replayEntityColor(entity) {
  return entity.side === "红" ? "#ff4c5d" : "#3f8cff";
}
```

- [ ] **Step 2: Draw field and trails**

`drawReplayCanvas(model, time)` must clear the Canvas, draw the field image, and draw trails for visible entities within `state.replayTrail` seconds.

- [ ] **Step 3: Draw robots and effects**

Draw each visible current robot as a BattleScope-like icon:

- filled HP circle
- heat ring
- number label
- heading line
- vulnerability glow
- recent damage pulse if a hit event occurred within the last 1.5 seconds

- [ ] **Step 4: Verify syntax**

Run:

```bash
node --check app.js
```

Expected: exit code 0.

### Task 4: Implement Replay UI Controls And Rosters

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `state.replayModel`, `renderReplayFrame()`, and `drawReplayCanvas()`.
- Produces: `renderReplayMatches()`, `loadReplayMatch(row)`, `renderReplayRosters()`, `renderReplayFilters()`, and `stopReplayPlayback()`.

- [ ] **Step 1: Render match browser**

Render `state.matches` into `#battleReplayList` with the same filters as `对局地图`.

- [ ] **Step 2: Load selected replay**

`loadReplayMatch(row)` fetches `battleScopeFile(row)`, converts it with `buildReplayModel`, stores it in `state.replayCache`, resets filters, and renders the first frame.

- [ ] **Step 3: Wire controls**

Bind:

- search and winner filters
- timeline input
- play/pause
- speed selector
- trail length
- damage toggle
- entity filter changes
- event filter changes
- roster card click for highlight/toggle

- [ ] **Step 4: Render side rosters**

Rosters show role, number, school, HP bar, heat bar, shots, and recent status.

- [ ] **Step 5: Verify interaction selectors exist**

Run:

```bash
node --check app.js
```

Expected: exit code 0.

### Task 5: Remove The Embedded Mini Replay

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `setView("replay")` and `state.selectedReplayMatch`.
- Produces: a button in `对局地图` detail that opens the selected match in the `战术回放` module.

- [ ] **Step 1: Remove old embedded replay HTML**

Delete the `.battlescope-tool` block currently inside `#matches`.

- [ ] **Step 2: Add a replay jump button**

Add:

```html
<button id="openReplayFromMatch" class="ghost-button" type="button">打开战术回放</button>
```

- [ ] **Step 3: Remove old DOM-marker renderer**

Remove old functions that only support the embedded DOM replay:

- `stopBattleScope`
- `loadBattleScope`
- `nearestBattleScopeFrame`
- `renderBattleScope`
- `renderBattleScopeFrame`

Keep `battleScopeFile(row)` if reused by the new loader, or rename it to `replayFile(row)`.

- [ ] **Step 4: Wire the jump button**

Clicking `#openReplayFromMatch` sets `state.selectedReplayMatch = state.selectedMatch`, calls `setView("replay")`, and calls `renderReplayMatches()`.

### Task 6: Final Verification And Commit

**Files:**
- Modify: `README.md` if the user-facing module list mentions BattleScope.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: committed and pushed feature branch/main update.

- [ ] **Step 1: Run syntax check**

```bash
node --check app.js
```

Expected: exit code 0.

- [ ] **Step 2: Run replay data check**

```bash
node tools/verify_battlescope_replays.js
```

Expected:

```text
BattleScope replay data OK
```

- [ ] **Step 3: Run whitespace check**

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 4: Run local HTTP checks**

```bash
curl -I --max-time 5 http://127.0.0.1:8766/
curl -I --max-time 5 http://127.0.0.1:8766/data/battlescope_replays/match_001.json
```

Expected: both return `HTTP/1.0 200 OK` or `HTTP/1.1 200 OK`.

- [ ] **Step 5: Commit**

```bash
git add index.html app.js styles.css README.md tools/verify_battlescope_replays.js
git commit -m "Add standalone BattleScope replay module"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

