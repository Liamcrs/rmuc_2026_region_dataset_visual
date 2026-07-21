# 更新日志

## 2026-07-21

### 新增

- 在 `专题分析` 中新增 `增益效果` 主题，可按单一增益类型查看全部学校排名。
- 新增增益类型筛选器，支持 `飞坡`、`台阶跨越`、`过中央高地`、`小能量机关`、`大能量机关`。
- 新增 `data/analysis_buff_type_summary.csv`，作为静态页面加载的增益效果统计数据源。
- 新增 `tools/generate_buff_type_summary.js`，从 SQLite 数据库生成增益效果统计 CSV。
- 新增 `tools/verify_buff_type_summary.js`，校验 CSV 结构、统计口径、能量机关合并规则、前端接入和导航顺序。

### 调整

- 增益效果统计范围改为数据库中的全部分区赛对局：`266` 场、`613` 局。
- 学校范围改为 `matches` 表中的全部参赛学校；未进入全国赛/复活赛手册的学校标记为 `分区赛队伍`。
- 小能量机关和大能量机关由 `rune_type` 事件合并得到，并按激活次数统计。
- 不再统计 `小能量机关增益`、`大能量机关增益` 这类单位获得增益记录。
- 增益摘要改为显示去重后的类型覆盖场数/局数，并展示完整数据范围。
- 顶部导航调整为：`总览 -> 队伍画像 -> 战术回放 -> 专题分析 -> 对局地图 -> 比赛预测 -> 南工骁鹰`。

### 验证

- `node tools/generate_buff_type_summary.js`
- `node tools/verify_buff_type_summary.js`
- `node --check app.js`
- `node --check tools/generate_buff_type_summary.js`
- `node --check tools/verify_buff_type_summary.js`
- `node tools/verify_battlescope_replays.js`
- `node tools/verify_replay_module_static.js`
- `git diff --check`
