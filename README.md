# 陈庆棋 · 个人综合网页

纯静态个人主页 + 场站数据工具集，**零依赖、零构建**，双击 `index.html` 即可打开（建议用本地服务方式打开，见下文）。

## 目录结构

```
personal-site/
├── index.html            个人主页（Hero / 轮播图 / 关于我 / 技能 / 相册 / 视频 / 时间线 / 留言板）
├── login.html            登录（账号 + 密码 + 验证码）
├── register.html         注册（表单校验 + 协议确认）
├── profile.html          个人中心（基本资料 / 安全设置 / 我的文件 / 操作记录）
├── dashboard.html        B卡数据看板（已接入：KPI / 折线·柱状·环形图 / 园区平面示意 / 在场车辆表 / 导入日报联动）
├── dashboard-hushi.html       互市数据看板（独立页面 · 待接入该卡口样例）
├── dashboard-chukou.html      出口数据看板（独立页面 · 待接入该卡口样例）
├── dashboard-linggongli.html  零公里数据看板（独立页面 · 待接入该卡口样例）
├── dashboard-chayanqu.html    查验区数据看板（独立页面 · 待接入该卡口样例）
├── system-menus.html     菜单管理（树形表格、显示隐藏、增删）
├── system-users.html     用户管理 + 注册审核（Tabs、批量通过）
├── system-params.html    参数管理（分组筛选、编辑、导出、成长经历增删改排序）
├── system-logs.html      操作日志（统计卡、筛选、导出、清空）
├── query-vehicles.html   在场车辆查询（滞留 72h 预警表）
├── query-checkpoint.html 卡口车辆管理（多选、批量抬杆）
├── query-records.html    核放记录查询（图表 + 明细）
├── query-reports.html    每日报表（Excel 导入自动生成日报 + 已汇总报表识别 + 模板上传 + 货物名称统一口径统计 + 按日期云端持久化 + 历史面板 + 看板首屏联动 + 报表导出）
├── files.html            文件管理（上传 / 下载 / 预览 / 批量导出 / 网格列表切换）
├── css/style.css         全站样式（设计变量 + 组件 + 响应式）
├── js/data.js            演示数据（改这里即可接真实数据）
├── js/main.js            交互引擎（DataTable / 图表 / 示意图 / 表单校验 / 导出等）
├── js/report-template.js 报表模板解析 / 货物名称识别与统一口径归并 / 按模板归类统计 / 回填导出
├── js/dashboard-gates.js 5 个卡口看板注册表 / 切换条 / 未接入卡口空态与占位 KPI
├── js/vendor/xlsx.full.min.js  本地 SheetJS（Excel 解析，不依赖 CDN）
└── assets/img/           AI 生成配图（banner/gallery/avatar）
```

## 本地运行

```bash
cd personal-site
python -m http.server 8899        # 或 npx serve .
# 浏览器打开 http://localhost:8899/index.html
```

## 功能清单

| 分类 | 功能 | 位置 |
|---|---|---|
| 核心 | 导航栏 / 内容区 / 侧边栏 / 页脚 | 全站 |
| 核心 | 文字 / 图片 / 视频 / 表格 | 首页、各功能页 |
| 核心 | 表单提交 / 按钮 / 链接 / 轮播图 | 首页、登录注册、留言板 |
| 核心 | 响应式（≥1200/992/768/480 断点，移动端汉堡菜单） | 全站 |
| 系统管理 | 菜单管理、用户管理、参数管理、操作日志、注册审核；首页「成长经历」由云端参数动态渲染，可新增 / 编辑 / 删除 / 上移下移并即时生效 | system-*.html |
| 查询统计 | 在场车辆、卡口车辆、核放记录、每日报表；Excel 导入自动生成日报、报表模板上传、货物名称自动识别与统一口径归并、按模板归类统计、按日期云端持久化、历史导入数据面板、看板导入货物统计、报表导出（Excel 工作簿 / CSV） | query-*.html、dashboard.html |
| 用户管理 | 登录、注册、个人中心 | login / register / profile |
| 数据可视化 | 折线图、柱状图、环形图（纯 SVG）、园区平面示意图、数据表格 | dashboard 等 |
| 搜索 | 关键词搜索（车牌/货物/单号/文件名）、下拉筛选、表头排序、分页 | 各表格页 |
| 文件管理 | 上传（点击/拖拽）、下载、预览弹窗、批量导出清单、批量删除 | files.html |

## 说明

- 表格引擎为通用 `App.DataTable`；业务数据由 WorkBuddy 云端数据库（`js/cloud.js`）提供，`js/data.js` 仅为静态镜像的示意兜底数据。
- 园区平面示意图为自绘 SVG 示意图（非地理底图），仅表示卡口/通道相对位置，符合地图合规要求。
- 表单校验规则通过 `data-rule` 声明（required / min:n / phone / email / account / pwd / captcha）。
- 每日报表支持「每日下班导入 Excel（.xlsx / .xls / .csv）→ 按日期自动汇总生成日报 → 报表导出」闭环；解析由本地 `js/vendor/xlsx.full.min.js` 与 `js/report-template.js` 提供，不依赖外部 CDN。
- 支持上传自定义报表模板：自动解析模板的「货物名称 / 车数 / 重量」列组与合计行，自动识别明细里的货物名称列，按货物名称归类统计并回填成模板格式的报表；模板文件存云端（`site_report_templates`），统计结果存 `site_report_goods`。
- **货物名称统一口径**：`js/report-template.js` 的 `canonicalGoods / buildCanonDict / aggregate` 在聚合前先把「白火龙果 / 红心火龙果 / 鲜火龙果 / 火龙果(产地)」等归并为「火龙果」再合并车数与重量；词库 = 内置常见货物 + 用户上传模板的货物项 + 云端参数 `report.goods.canon.extra` 扩充的自定义标准名（在「参数管理 → 报表参数」修改，即时生效，不写死），剥前缀仅在命中标准词库时生效，避免误并「白砂糖 / 红豆」。导出与面板均保留「合并来源（原始货名）」列以便核对。
- **按日期持久化、刷新不丢失**：`commitGoods()` 按 `rdate` 整组替换写入 `site_report_goods`（含 `variants` 合并来源列，同一天重复导入覆盖更新，不残留旧叫法重复行）；`query-reports.html` 的 `loadGoodsCloud()` 在页面初始化与 `Cloud.onChange` 时读回，重建货物统计状态并渲染「历史导入数据」面板（日期切换 / 导出该日 / 删除该日）；`dashboard.html` 的 `loadAll()` 增查该表，新增「导入货物统计」面板，并把货物构成环形图切换为最新导入日期的统一口径数据。
- **已汇总报表导入 + 看板首屏联动**：`js/report-template.js` 的 `parseDailyReport()` 按表头自动识别成品报表（如 B 卡报表）里的「货物名称 / 车数 / 重量」列组与车辆验放合计，不写死工作表名、卡口名与货物清单；`query-reports.html` 的 `handleFile()` 优先走该模式，按统计日期把入区 / 出区车数、重量、统一口径货物品种写入 `site_reports`（新增 `gate / in_weight / out_weight / goods_kinds / source` 列）并整组替换写入 `site_report_goods`；`dashboard.html` 首屏 6 个 KPI 优先展示这些导入值，趋势图 / 货物构成 / 导入货物统计面板同步。任何解析结果全 0 时都**不会写入全 0 日报**，避免覆盖真实数据。图表层 `renderLineChart / renderBarChart / renderDonut` 对空 / 全 0 数据做了除零保护，数字动画支持小数。
- **5 个卡口数据看板**：`dashboard.html`（B卡，已接入真实导入数据）、`dashboard-hushi.html`（互市）、`dashboard-chukou.html`（出口）、`dashboard-linggongli.html`（零公里）、`dashboard-chayanqu.html`（查验区）。注册表与切换条在 `js/dashboard-gates.js`，全站侧边栏「数据看板 · 5 个卡口」分组均提供 5 个入口。**各卡口需要查询的数据及报表口径不同**，未接入的 4 个看板显示空态与「接入需要提供」清单（卡口名称/编号、数据文件工作表与表头、目标报表模板、统计口径），不套用 B 卡结构、不填示意数字；样例到齐后按卡口独立定制指标。云端 `site_reports` / `site_report_goods` 已有 `gate` 维度，现有数据标记 `bcard`。
- 首页「成长经历」不再写死 4 条：条目由云端 `site_params` 的 `home.timeline.N.*`（date / title / text）聚合，编号 N 决定顺序，任意条数均可；在「参数管理 → 成长经历」专用管理区增删改排序后整组保存，首页即时生效，无需改代码或重新发布。
- 导出为浏览器端生成：CSV（带 BOM，Excel 可直接打开）或 Excel 工作簿（SpreadsheetML `.xls`）；模板统计报表含模板货物统计表及「按模板归类 / 货物统计明细 / 数据来源说明」附表，无需后端。

## 数据来源与合规声明

- 本站为**个人技术作品集与功能演示站点**，非任何政府机关、海关、国有企业或业务平台的官方网站，与相关单位无隶属、授权、合作或数据对接关系。
- 看板、在场车辆、卡口记录、核放记录、文件、日志等模块中的车牌、单号、企业名、人名与数量均为**本站自行构造的示意数据**，非真实业务数据。**每日报表**改由使用者每日下班手动导入 Excel 表格后按日期自动汇总生成，不自动从任何外部系统取数，导入内容由使用者自行负责；站内不包含海关监管数据、商业秘密或个人敏感信息，也**未**与「边境贸易（浦寨）慧眼智控嵌入式管理平台」等生产系统建立接口或数据同步。
- 首页「公开资料速览」的统计数字摘自公开新闻宣传报道，为相关平台/口岸整体运行成效，非本站数据、非个人业绩、非实时数据；完整出处见 `source.html`。
- 站内图片均为自绘或 AI 生成的**示意素材**，非现场实景、非新闻摄影作品；未使用任何单位标识或受版权保护的第三方图片、视频。
- 完整说明见 `source.html`（数据来源与声明页），全站页脚均有入口。**该页文案与首页 Hero 说明行为静态内容，不通过参数管理覆盖，以免免责声明被改动或删除。**
