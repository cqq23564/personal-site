# 陈庆棋 · 个人综合网页

纯静态个人主页 + 场站数据工具集，**零依赖、零构建**，双击 `index.html` 即可打开（建议用本地服务方式打开，见下文）。

## 目录结构

```
personal-site/
├── index.html            个人主页（Hero / 轮播图 / 关于我 / 技能 / 相册 / 视频 / 时间线 / 留言板）
├── login.html            登录（账号 + 密码 + 验证码）
├── register.html         注册（表单校验 + 协议确认）
├── profile.html          个人中心（基本资料 / 安全设置 / 我的文件 / 操作记录）
├── dashboard.html        数据看板（KPI / 折线·柱状·环形图 / 园区平面示意 / 在场车辆表）
├── system-menus.html     菜单管理（树形表格、显示隐藏、增删）
├── system-users.html     用户管理 + 注册审核（Tabs、批量通过）
├── system-params.html    参数管理（分组筛选、编辑、导出）
├── system-logs.html      操作日志（统计卡、筛选、导出、清空）
├── query-vehicles.html   在场车辆查询（滞留 72h 预警表）
├── query-checkpoint.html 卡口车辆管理（多选、批量抬杆）
├── query-records.html    核放记录查询（图表 + 明细）
├── query-reports.html    每日报表（趋势图 + 报表导出 + 明细导出）
├── files.html            文件管理（上传 / 下载 / 预览 / 批量导出 / 网格列表切换）
├── css/style.css         全站样式（设计变量 + 组件 + 响应式）
├── js/data.js            演示数据（改这里即可接真实数据）
├── js/main.js            交互引擎（DataTable / 图表 / 示意图 / 表单校验 / 导出等）
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
| 系统管理 | 菜单管理、用户管理、参数管理、操作日志、注册审核 | system-*.html |
| 查询统计 | 在场车辆、卡口车辆、核放记录、每日报表、报表/明细导出（CSV） | query-*.html |
| 用户管理 | 登录、注册、个人中心 | login / register / profile |
| 数据可视化 | 折线图、柱状图、环形图（纯 SVG）、园区平面示意图、数据表格 | dashboard 等 |
| 搜索 | 关键词搜索（车牌/货物/单号/文件名）、下拉筛选、表头排序、分页 | 各表格页 |
| 文件管理 | 上传（点击/拖拽）、下载、预览弹窗、批量导出清单、批量删除 | files.html |

## 说明

- 所有数据均为**演示数据**，集中在 `js/data.js`；表格引擎为通用 `App.DataTable`，替换数据源即可对接真实接口。
- 园区平面示意图为自绘 SVG 示意图（非地理底图），仅表示卡口/通道相对位置，符合地图合规要求。
- 表单校验规则通过 `data-rule` 声明（required / min:n / phone / email / account / pwd / captcha）。
- 导出功能为浏览器端 CSV 导出（带 BOM，Excel 可直接打开）。
