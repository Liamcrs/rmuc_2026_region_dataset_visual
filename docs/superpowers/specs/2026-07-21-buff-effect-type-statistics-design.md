# Buff Effect Type Statistics Design

## Goal

Add a static analysis view for team and robot buff-effect type statistics.

The feature answers: for each team, which observed non-energy buff types appeared, and how many small-energy and large-energy mechanism activations appeared.

## Scope

The feature only counts observed event types from the dataset. It covers all schools found in the SQLite regional `matches` table, not only the 96 head-to-head matches where both sides are final-tournament teams. It does not calculate, infer, or label concrete rule effects such as defense percentages or heat-cooling multipliers unless those exact values already appear as source data fields.

Included source events:

- `事件类型='增益'`: counted by `类别`, except unit rows for small/large energy mechanism buffs.
- `事件类型='能量机关'` and `类别='rune_type=1.0'`: counted as `小能量机关`.
- `事件类型='能量机关'` and `类别='rune_type=0.0'`: counted as `大能量机关`.

Excluded behavior:

- No inferred conversion from event category to rule-effect values.
- No duration modeling.
- No attempt to decide whether a buff was strategically useful.
- No counting of `增益 · 小能量机关增益` or `增益 · 大能量机关增益` rows, because those rows represent units receiving the team buff rather than mechanism activation attempts.

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
- `学校触发次数`
- `学校覆盖局数`
- `学校覆盖场数`
- `类型覆盖局数`
- `类型覆盖场数`
- `统计范围局数`
- `统计范围场数`
- `平均首次触发时间`
- `最早触发时间`

Energy mechanism rows store `机器人类型` as `全队`; ordinary buff rows keep robot type breakdowns.

The generator should include any school found in regional matches. Schools that are not in the qualified profile dataset use `分区赛队伍` as `队伍类别`.

## Frontend

Add `增益效果` as a third topic in the existing `专题分析` dropdown.

When selected:

- A buff-type dropdown selects one observed type at a time, including non-energy buffs and `能量机关 · 小能量机关` / `能量机关 · 大能量机关`.
- Summary cards show the selected type, matching school count, total count, distinct type coverage, full regional data scope, and the leading school.
- The chart ranks schools for the selected type using school-level counts.
- The table lists all matching schools with school category, event type, buff type, count, covered games, covered matches, and statistical target. Energy mechanism rows show `全队激活`; non-energy buff rows show robot-type breakdown.
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
- Rows contain only schools found in the regional `matches` table, and include at least one non-qualified regional school when such rows have observed buff events.
- `触发次数`, `覆盖局数`, and `覆盖场数` are numeric.
- At least one `增益` row and at least one `能量机关` row exist.

Before completion, run:

- `node --check app.js`
- the new CSV verification script
- existing replay/data verification scripts if touched by the change
- `git diff --check`
