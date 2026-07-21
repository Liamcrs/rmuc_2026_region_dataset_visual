# Buff Effect Type Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a static `增益效果` topic that selects one observed buff type and ranks schools by count, while treating small/large energy mechanisms as activation counts.

**Architecture:** Generate a small derived CSV from the existing SQLite `events` table, then load it into the existing static frontend. The frontend reuses the `专题分析` panel, rank-row renderer, summary cards, search input, and data table patterns.

**Tech Stack:** Node.js scripts, SQLite CLI, CSV, plain browser JavaScript, existing static HTML/CSS.

## Global Constraints

- Count ordinary observed `增益` types from the dataset.
- Cover all schools found in the SQLite regional `matches` table, not only the 96 head-to-head matches where both sides are final-tournament teams.
- Do not calculate, infer, or label concrete rule effects such as defense percentages or heat-cooling multipliers unless those exact values already appear as source data fields.
- Include `事件类型='能量机关'` with `类别='rune_type=1.0'` as `小能量机关`.
- Include `事件类型='能量机关'` with `类别='rune_type=0.0'` as `大能量机关`.
- Do not include `增益 · 小能量机关增益` or `增益 · 大能量机关增益` rows, because those count units receiving the team buff.
- Store energy mechanism rows with robot type `全队`; keep ordinary buff rows by robot type.
- Include any school found in regional matches. Use qualified profile categories when available, otherwise mark `队伍类别` as `分区赛队伍`.
- Display the full matching result set, not only a ranked subset.
- Use the existing `专题分析` panel rather than adding a top-level navigation tab.

---

### Task 1: Add Generated Buff Statistics Data

**Files:**
- Create: `tools/generate_buff_type_summary.js`
- Create: `tools/verify_buff_type_summary.js`
- Create: `data/analysis_buff_type_summary.csv`

**Interfaces:**
- Consumes: `/Users/chaoran/Documents/RoboMaster/2026赛季/分区赛数据分析/rmuc_2026_region_dataset.sqlite`
- Consumes: `data/all_qualified_team_tactical_profile_metrics.csv` for known national/revival team categories only.
- Produces: `data/analysis_buff_type_summary.csv`
- Produces verification command: `node tools/verify_buff_type_summary.js`

- [x] **Step 1: Write the failing verifier**

Create `tools/verify_buff_type_summary.js` with CSV parsing, required-column checks, regional-school checks, numeric metric checks, distinct type coverage checks, and source event coverage checks.

- [x] **Step 2: Run verifier to verify it fails**

Run: `node tools/verify_buff_type_summary.js`

Expected before the generator/data exists: exit code 1 with `data/analysis_buff_type_summary.csv: missing`.

- [x] **Step 3: Write the generator**

Create `tools/generate_buff_type_summary.js`. It should query ordinary `增益` rows from SQLite while excluding `小能量机关增益` and `大能量机关增益`, and combine those rows with small/large energy activation counts reconstructed from all SQLite `能量机关` events. It should map `rune_type=1.0` to `小能量机关`, map `rune_type=0.0` to `大能量机关`, set energy mechanism robot type to `全队`, keep ordinary buff robot types, calculate counts and first-trigger timing, and write the CSV.

- [x] **Step 4: Generate the CSV**

Run: `node tools/generate_buff_type_summary.js`

Expected: prints `Generated <n> buff type summary rows`.

- [x] **Step 5: Run verifier to verify it passes**

Run: `node tools/verify_buff_type_summary.js`

Expected: `Buff type summary data OK`.

### Task 2: Load The New Dataset In The Frontend

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `data/analysis_buff_type_summary.csv`
- Produces: `state.buffTypes: Array<Record<string,string>>`

- [x] **Step 1: Write failing static structure check**

Extend `tools/verify_buff_type_summary.js` to confirm `app.js` contains `buffTypes` state, `./data/analysis_buff_type_summary.csv`, and `renderBuffTypeAnalysis`.

- [x] **Step 2: Run verifier to verify it fails**

Run: `node tools/verify_buff_type_summary.js`

Expected: exit code 1 with missing frontend integration messages.

- [x] **Step 3: Add state and loading path**

In `app.js`, add `buffTypes: []` to state. In the `window.RMUC_DATA` path, read `window.RMUC_DATA.buffTypes || []`. In the CSV loading path, load `./data/analysis_buff_type_summary.csv` and assign it to `state.buffTypes`.

- [x] **Step 4: Run verifier to verify it passes**

Run: `node tools/verify_buff_type_summary.js`

Expected: `Buff type summary data OK`.

### Task 3: Add The `增益效果` Analysis Topic

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `state.buffTypes`
- Produces: `<option value="buff">增益效果</option>`
- Produces: `<select id="buffEffectType">`
- Produces: `renderBuffTypeAnalysis(term: string): void`

- [x] **Step 1: Extend verifier for UI hooks**

Extend `tools/verify_buff_type_summary.js` to confirm `index.html` contains `<option value="buff">增益效果</option>` and `styles.css` contains `.analysis-chart.full-list`.

- [x] **Step 2: Run verifier to verify it fails**

Run: `node tools/verify_buff_type_summary.js`

Expected: exit code 1 with missing UI hook messages.

- [x] **Step 3: Add dropdown option**

In `index.html`, add `<option value="buff">增益效果</option>` to `#analysisTopic`.

- [x] **Step 4: Implement `renderBuffTypeAnalysis(term)`**

In `app.js`, branch `renderAnalysis()` to call `renderBuffTypeAnalysis(term)` when topic is `buff`.

`renderBuffTypeAnalysis` should:

- Populate `#buffEffectType` with ordinary buff types plus `能量机关 · 小能量机关` and `能量机关 · 大能量机关`.
- Filter rows to the selected single buff/effect type.
- Aggregate by school using school-level trigger/game/match columns.
- Sort schools by count descending, then school.
- Render summary cards for selected type, schools, total count, covered games, and leading school.
- Render all matching school rows in `#analysisChart`, using `.analysis-chart.full-list`.
- Render all matching school rows in `#analysisTable`, with energy mechanism target shown as `全队激活` and ordinary buff rows showing robot-type breakdown.

- [x] **Step 5: Add compact full-list styles**

In `styles.css`, add `.analysis-chart.full-list` rules that keep a long complete result set readable without truncation.

- [x] **Step 6: Run verifier to verify it passes**

Run: `node tools/verify_buff_type_summary.js`

Expected: `Buff type summary data OK`.

### Task 4: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `tools/verify_buff_type_summary.js`

**Interfaces:**
- Consumes: completed tasks 1-3
- Produces: verified static feature

- [x] **Step 1: Update README**

Add `增益效果` to the `专题分析` section and add `analysis_buff_type_summary.csv` to the data list.

- [x] **Step 2: Run JavaScript syntax check**

Run: `node --check app.js`

Expected: exit code 0.

- [x] **Step 3: Run buff verifier**

Run: `node tools/verify_buff_type_summary.js`

Expected: `Buff type summary data OK`.

- [x] **Step 4: Run existing project checks**

Run:

```bash
node tools/verify_battlescope_replays.js
node tools/verify_replay_module_static.js
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 5: Run local HTTP smoke checks**

Start or reuse the local static server. Run:

```bash
curl -I --max-time 5 http://127.0.0.1:8771/
curl -I --max-time 5 http://127.0.0.1:8771/data/analysis_buff_type_summary.csv
```

Expected: both responses include `HTTP/1.0 200 OK`.
