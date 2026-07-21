# Buff Effect Type Statistics Design

## Goal

Add a static analysis view for team and robot buff-effect type statistics.

The feature answers: for each team, which robot types have received which buff/event types, and how often those types appeared in the dataset.

## Scope

The feature only counts observed event types from the dataset. It does not calculate, infer, or label concrete rule effects such as defense percentages or heat-cooling multipliers unless those exact values already appear as source data fields.

Included source events:

- `事件类型='增益'`: counted by `类别`.
- `事件类型='能量机关'`: counted by `类别`, so small/large energy mechanism activations are visible as event types.

Excluded behavior:

- No inferred conversion from event category to rule-effect values.
- No duration modeling.
- No attempt to decide whether a buff was strategically useful.

## Data Output

Create `data/analysis_buff_type_summary.csv` from the SQLite `events` table.

Each row represents one observed grouping:

- `学校名`
- `队伍类别`
- `事件类型`
- `增益类型`
- `机器人类型`
- `触发次数`
- `覆盖局数`
- `覆盖场数`
- `平均首次触发时间`
- `最早触发时间`

For team-level `能量机关` rows, `机器人类型` is stored as `全队`.

The generator should restrict rows to teams that are already in the qualified team profile dataset, matching the current project scope.

## Frontend

Add `增益效果` as a third topic in the existing `专题分析` dropdown.

When selected:

- Summary cards show the number of teams, buff types, total triggers, and the leading team/type pair.
- The chart lists the full matching result set.
- The table lists all matching rows with school, category, event type, buff type, robot type, trigger count, covered games, covered matches, and average first trigger time.
- The existing search input filters by school, team category, event type, buff type, and robot type.

The chart should remain scrollable/readable for the full result set rather than truncating the data.

## UI Placement

Use the existing `专题分析` panel rather than adding a new first-level navigation tab. This keeps the feature with other derived tactical analyses and avoids increasing top-level navigation density.

## Data Loading

The new CSV is loaded during the existing startup path, alongside the other analysis CSV files.

If `window.RMUC_DATA` is present, support an optional `buffTypes` array, but the standalone CSV load path remains the source of truth for local static use.

## Error Handling

If the CSV is empty or missing from `state.buffTypes`, the analysis view shows an empty summary and an empty table instead of throwing.

If source rows have blank `机器人类型`, display `全队`.

## Verification

Add a Node verification script for the generated CSV. It should confirm:

- The CSV exists and has rows.
- Required columns exist.
- Rows contain only qualified-team schools.
- `触发次数`, `覆盖局数`, and `覆盖场数` are numeric.
- At least one `增益` row and at least one `能量机关` row exist.

Before completion, run:

- `node --check app.js`
- the new CSV verification script
- existing replay/data verification scripts if touched by the change
- `git diff --check`
