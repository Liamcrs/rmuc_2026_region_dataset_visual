# Static BattleScope Module Design

## Goal

Add a separate `战术回放` module that more clearly recreates the interaction style of `ezthor/rm-battlescope`, while keeping this project deployable as a static GitHub Pages site.

The module covers only the 96 matches already available in the current website. It does not add a Python parsing server or user-triggered replay generation jobs.

## User Experience

The module is a first-level navigation view, separate from `对局地图`.

The view has two areas:

- Match browser: searchable list of the 96 available matches, showing region, match number, score, winner, red team, blue team, and representative `game_id`.
- Replay workspace: a wide BattleScope-style replay surface with red roster on the left, official field Canvas in the center, blue roster on the right, timeline controls above, and current event details below.

The existing small replay block inside `对局地图` should be removed or replaced with a lightweight link/button into the new module. This avoids duplicating the same replay in two different UI patterns.

## Core Controls

The replay workspace includes:

- Play/pause.
- 1x, 2x, 3x, and 5x playback.
- Scrubbable timeline.
- Match clock and countdown display.
- Trail length control.
- Damage number toggle.
- Robot visibility filters by side and robot type.
- Event filters for hit, shoot, energy/rune, dart, assembly, death/respawn-like events when available.

The default view should show cleaned robot tracks, robot icons, HP/heat rings, headings, recent damage, and high-signal events.

## Data Contract

Use the existing static files:

- `data/battlescope_replay_index.csv`
- `data/battlescope_replays/match_001.json` through `match_096.json`
- `assets/field/official_field_map.png`

Current replay JSON is compact:

- `meta`: title, subtitle, duration, field dimensions, game id.
- `entities`: entity catalog with side, robot number, type, and school.
- `frames`: time-sliced state using compact `s` arrays.
- `events`: aggregated telemetry events.

The frontend should adapt this compact format into an internal replay model:

- Track history per entity for drawing trails.
- Current entity state for HP, heat, shots, vulnerability, heading, and position.
- Recent events for map effects and detail text.
- Damage source arrows inferred from nearby opponent positions when the event is a hit and source confidence can be estimated.

Fields that are unavailable in the compact JSON, such as true economy lanes, paid revival intervals, buff windows, and full attack inference metadata, should be omitted or shown only when defensible from existing data. The UI should not present guessed mechanics as certain.

## Canvas Rendering

Use one responsive Canvas over the official field map image.

The renderer draws in this order:

1. Cropped/scaled official field map.
2. Robot trails for visible entities.
3. Recent inferred attack arrows and damage pulses.
4. Robot icons with side color, number, HP fill, heat ring, heading line, and vulnerability glow.
5. Event rings and floating damage numbers.
6. Optional labels for selected/highlighted robot or event.

All coordinates use the known 28m x 15m field dimensions. The Canvas should resize for device pixel ratio and viewport changes.

## Roster Panels

Each side has roster cards ordered by role:

- 英雄
- 工程
- 步兵3
- 步兵4
- 空中, if present
- 哨兵
- 基地/前哨站, if present

Cards show robot number, type, school, HP bar, heat bar, cumulative shots, recent shot delta, and state badges such as `易伤` or `受击`.

The cards are clickable and toggle/highlight the corresponding robot on the Canvas.

## Navigation Integration

Add a `战术回放` tab between `比赛预测` and `南工骁鹰`.

The existing `对局地图` view remains focused on static heatmap/path images and the damage-source click map. Its embedded replay block should be removed, with a simple button to open the selected match in `战术回放`.

## Error Handling

If a replay JSON fails to load:

- Keep the module visible.
- Show a concise error state in the replay workspace.
- Keep the match browser usable.

If a selected match has no replay file:

- Show `该场暂无回放数据`.
- Do not break other views.

## Performance

Do not embed all replay JSON files into `data.js`.

Load replay JSON on demand and cache it in memory after first use. Precomputing per-entity tracks happens once per loaded replay.

The Canvas render loop should run only during playback or when the user changes the current time/filter. It should not continuously redraw while paused.

## Verification

Before completion:

- Run `node --check app.js`.
- Run `git diff --check`.
- Verify 96 replay JSON files exist and the replay index references existing files.
- Serve the site locally and verify the home page and at least one replay JSON return HTTP 200.
- Manually inspect the new module in a browser if browser automation is available; otherwise run a data-shape sanity script against multiple replay files.

