/* ============================================================
 * data.js — 页面初始展示数据（云端数据由 cloud.js 覆盖）
 * 说明：页面交互基于这些数据渲染，云端真实数据优先。
 * ============================================================ */

window.MOCK = (function () {
  "use strict";

  /* ---------- 当前登录用户 ---------- */
  const currentUser = {
    name: "林运维",
    role: "系统管理员",
    avatar: "assets/img/avatar.png",
    dept: "园区运营中心",
    phone: "138****6688",
    email: "linops@example.cn",
    joined: "2023-04-18",
    lastLogin: "2026-11-03 09:12",
    loginCount: 1286
  };

  /* ---------- 仪表盘 KPI ---------- */
  const kpis = [
    { key: "onSite",   label: "在场车辆",   value: 326, unit: "辆", icon: "🚛", color: "blue",   trend: "+3.2%", up: true },
    { key: "todayIn",  label: "今日入区",   value: 95,  unit: "车", icon: "📥", color: "green",  trend: "+8.1%", up: true },
    { key: "todayOut", label: "今日出卡",   value: 86,  unit: "车", icon: "📤", color: "orange", trend: "-2.4%", up: false },
    { key: "stranded", label: "滞留超72小时", value: 1, unit: "车", icon: "⚠️", color: "red",    trend: "待处理", up: false },
    { key: "release",  label: "一线放行(过驳)", value: 16, unit: "车", icon: "✅", color: "cyan",  trend: "+12.5%", up: true },
    { key: "decl",     label: "边民申报总数", value: 138, unit: "单", icon: "📋", color: "purple", trend: "+5.7%", up: true }
  ];

  /* ---------- 30 日入区/出卡趋势 ---------- */
  const trend30 = (function () {
    const arr = [];
    let baseIn = 82, baseOut = 74;
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const wave = Math.sin(i / 4.2) * 9 + (i % 7 === 0 || i % 7 === 6 ? -14 : 0);
      const rnd = ((i * 37) % 11) - 5;
      const inV = Math.max(35, Math.round(baseIn + wave + rnd));
      const outV = Math.max(30, Math.round(baseOut + wave * 0.9 + rnd - 4));
      arr.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        in: inV, out: outV
      });
    }
    return arr;
  })();

  /* ---------- 货物构成 ---------- */
  const goodsPie = [
    { name: "东盟水果", value: 34, color: "#3b6ef5" },
    { name: "机电产品", value: 22, color: "#7c5cff" },
    { name: "纺织服装", value: 16, color: "#16a34a" },
    { name: "农产品", value: 14, color: "#d97706" },
    { name: "橡胶/木薯", value: 9, color: "#0891b2" },
    { name: "其他", value: 5, color: "#94a3b8" }
  ];

  /* ---------- 闸口实时流量（近12小时） ---------- */
  const gateFlow = (function () {
    const arr = [];
    const now = new Date().getHours();
    for (let h = Math.max(0, now - 11); h <= now; h++) {
      arr.push({ hour: `${String(h).padStart(2, "0")}:00`, in: ((h * 13) % 9) + 3, out: ((h * 7) % 8) + 2 });
    }
    return arr;
  })();

  /* ---------- 园区示意图点位（示意图，非地理底图） ---------- */
  const mapMarkers = [
    { id: "gateA", name: "闸口A（主卡口）", x: 12, y: 22, type: "gate", count: 42, status: "ok" },
    { id: "gateB", name: "闸口B（边小卡）", x: 88, y: 20, type: "gate", count: 28, status: "ok" },
    { id: "ch516", name: "场所通道 <516>", x: 78, y: 62, type: "channel", count: 12, status: "warn" },
    { id: "park", name: "海关监管停车场", x: 42, y: 46, type: "park", count: 96, status: "ok" },
    { id: "yard", name: "查验场", x: 20, y: 74, type: "yard", count: 18, status: "ok" },
    { id: "wh", name: "保税仓库", x: 60, y: 84, type: "wh", count: 30, status: "ok" }
  ];

  /* ---------- 在场车辆 ---------- */
  const vehiclesOnSite = [
    { plate: "桂A·D5821", type: "重车", goods: "东盟水果", gate: "闸口B边小", entry: "2026-11-02 21:36", dwell: 16.7, nation: "中国", driver: "黄伟", status: "在场" },
    { plate: "桂C·K2097", type: "重车", goods: "机电产品", gate: "闸口A", entry: "2026-11-02 18:05", dwell: 20.2, nation: "越南", driver: "Nguyễn Văn A", status: "在场" },
    { plate: "桂B·T7734", type: "空车", goods: "—", gate: "闸口B边小", entry: "2026-11-03 07:52", dwell: 6.5, nation: "中国", driver: "李强", status: "在场" },
    { plate: "桂A·M1180", type: "重车", goods: "纺织服装", gate: "闸口B边小", entry: "2026-11-01 14:20", dwell: 48.0, nation: "中国", driver: "韦诚", status: "滞留预警" },
    { plate: "桂D·P9042", type: "重车", goods: "农产品", gate: "闸口A", entry: "2026-11-03 06:18", dwell: 8.0, nation: "越南", driver: "Trần Thị B", status: "在场" },
    { plate: "桂C·X3315", type: "重车", goods: "橡胶/木薯", gate: "闸口B边小", entry: "2026-11-03 05:44", dwell: 8.6, nation: "中国", driver: "覃芳", status: "在场" },
    { plate: "桂B·F6608", type: "空车", goods: "—", gate: "闸口A", entry: "2026-11-03 08:10", dwell: 6.2, nation: "中国", driver: "周杰", status: "在场" },
    { plate: "桂E·J4473", type: "重车", goods: "东盟水果", gate: "闸口B边小", entry: "2026-11-03 09:26", dwell: 4.9, nation: "越南", driver: "Lê Văn C", status: "在场" },
    { plate: "桂A·W8820", type: "重车", goods: "机电产品", gate: "闸口A", entry: "2026-11-02 09:33", dwell: 28.8, nation: "中国", driver: "罗成", status: "滞留预警" },
    { plate: "桂C·B5566", type: "空车", goods: "—", gate: "闸口B边小", entry: "2026-11-03 10:02", dwell: 4.3, nation: "中国", driver: "廖静", status: "在场" },
    { plate: "桂D·N7721", type: "重车", goods: "农产品", gate: "闸口A", entry: "2026-11-02 23:47", dwell: 14.6, nation: "越南", driver: "Phạm Văn D", status: "在场" },
    { plate: "桂B·Q1983", type: "重车", goods: "纺织服装", gate: "闸口B边小", entry: "2026-11-03 04:55", dwell: 9.4, nation: "中国", driver: "黄金", status: "在场" }
  ];

  /* ---------- 滞留 72 小时重车清单 ---------- */
  const stranded = [
    { plate: "桂A·M1180", goods: "纺织服装", entry: "2026-11-01 14:20", dwell: 72.4, reason: "报关单待补充随附单据", contact: "韦诚 138****2231", nation: "中国" },
    { plate: "桂A·W8820", goods: "机电产品", entry: "2026-11-02 09:33", dwell: 73.1, reason: "海关查验中（机检）", contact: "罗成 139****8872", nation: "中国" }
  ];

  /* ---------- 卡口车辆管理 ---------- */
  const checkpointVehicles = [
    { plate: "桂A·D5821", gate: "闸口B边小", channel: "<516>", type: "重车", goods: "东盟水果", action: "入区", time: "2026-11-02 21:36", result: "放行" },
    { plate: "桂C·K2097", gate: "闸口A", channel: "<501>", type: "重车", goods: "机电产品", action: "入区", time: "2026-11-02 18:05", result: "放行" },
    { plate: "桂B·T7734", gate: "闸口B边小", channel: "<516>", type: "空车", goods: "—", action: "出区", time: "2026-11-03 07:52", result: "放行" },
    { plate: "桂D·P9042", gate: "闸口A", channel: "<501>", type: "重车", goods: "农产品", action: "入区", time: "2026-11-03 06:18", result: "抬杆" },
    { plate: "桂C·X3315", gate: "闸口B边小", channel: "<516>", type: "重车", goods: "橡胶/木薯", action: "入区", time: "2026-11-03 05:44", result: "抬杆" },
    { plate: "桂B·F6608", gate: "闸口A", channel: "<501>", type: "空车", goods: "—", action: "出区", time: "2026-11-03 08:10", result: "放行" },
    { plate: "桂E·J4473", gate: "闸口B边小", channel: "<516>", type: "重车", goods: "东盟水果", action: "入区", time: "2026-11-03 09:26", result: "抬杆" },
    { plate: "桂C·B5566", gate: "闸口B边小", channel: "<516>", type: "空车", goods: "—", action: "入区", time: "2026-11-03 10:02", result: "放行" },
    { plate: "桂A·L3344", gate: "闸口A", channel: "<501>", type: "重车", goods: "东盟水果", action: "过驳", time: "2026-11-03 09:58", result: "抬杆" },
    { plate: "桂D·H9988", gate: "闸口B边小", channel: "<516>", type: "重车", goods: "纺织服装", action: "过驳", time: "2026-11-03 10:15", result: "抬杆" },
    { plate: "桂B·V2255", gate: "闸口A", channel: "<501>", type: "空车", goods: "—", action: "出区", time: "2026-11-03 10:22", result: "放行" },
    { plate: "桂C·Z6611", gate: "闸口B边小", channel: "<516>", type: "重车", goods: "机电产品", action: "入区", time: "2026-11-03 10:41", result: "待核" }
  ];

  /* ---------- 核放记录 ---------- */
  const releaseRecords = [
    { no: "HF2026110300121", plate: "桂A·L3344", gate: "闸口A", type: "过驳", goods: "东盟水果", weight: "12.6 吨", time: "2026-11-03 09:58", result: "成功抬杆", operator: "系统" },
    { no: "HF2026110300120", plate: "桂D·H9988", gate: "闸口B边小", type: "过驳", goods: "纺织服装", weight: "8.2 吨", time: "2026-11-03 10:15", result: "成功抬杆", operator: "系统" },
    { no: "HF2026110300119", plate: "桂D·P9042", gate: "闸口A", type: "入区核放", goods: "农产品", weight: "15.0 吨", time: "2026-11-03 06:18", result: "成功抬杆", operator: "王磊" },
    { no: "HF2026110300118", plate: "桂C·X3315", gate: "闸口B边小", type: "入区核放", goods: "橡胶/木薯", weight: "21.4 吨", time: "2026-11-03 05:44", result: "成功抬杆", operator: "系统" },
    { no: "HF2026110300117", plate: "桂B·F6608", gate: "闸口A", type: "出区核放", goods: "—", weight: "—", time: "2026-11-03 08:10", result: "成功抬杆", operator: "系统" },
    { no: "HF2026110300116", plate: "桂E·J4473", gate: "闸口B边小", type: "入区核放", goods: "东盟水果", weight: "9.8 吨", time: "2026-11-03 09:26", result: "成功抬杆", operator: "系统" },
    { no: "HF2026110300115", plate: "桂C·B5566", gate: "闸口B边小", type: "出区核放", goods: "—", weight: "—", time: "2026-11-03 10:02", result: "成功抬杆", operator: "李婷" },
    { no: "HF2026110300114", plate: "桂A·M1180", gate: "闸口B边小", type: "出区核放", goods: "纺织服装", weight: "11.2 吨", time: "2026-11-03 10:35", result: "失败-单证不符", operator: "系统" }
  ];

  /* ---------- 每日报表 ---------- */
  const dailyReports = [
    { date: "2026-11-03", inTotal: 95, inHeavy: 63, inEmpty: 32, outTotal: 86, outHeavy: 40, outEmpty: 46, release: 16, decl: 138, abnormal: 3 },
    { date: "2026-11-02", inTotal: 88, inHeavy: 58, inEmpty: 30, outTotal: 90, outHeavy: 44, outEmpty: 46, release: 14, decl: 131, abnormal: 2 },
    { date: "2026-11-01", inTotal: 76, inHeavy: 49, inEmpty: 27, outTotal: 81, outHeavy: 39, outEmpty: 42, release: 12, decl: 118, abnormal: 5 },
    { date: "2026-10-31", inTotal: 92, inHeavy: 61, inEmpty: 31, outTotal: 85, outHeavy: 41, outEmpty: 44, release: 15, decl: 142, abnormal: 1 },
    { date: "2026-10-30", inTotal: 84, inHeavy: 55, inEmpty: 29, outTotal: 88, outHeavy: 43, outEmpty: 45, release: 13, decl: 126, abnormal: 4 },
    { date: "2026-10-29", inTotal: 79, inHeavy: 52, inEmpty: 27, outTotal: 76, outHeavy: 37, outEmpty: 39, release: 11, decl: 119, abnormal: 2 },
    { date: "2026-10-28", inTotal: 90, inHeavy: 59, inEmpty: 31, outTotal: 82, outHeavy: 40, outEmpty: 42, release: 14, decl: 133, abnormal: 3 }
  ];

  /* ---------- 用户管理 ---------- */
  const users = [
    { id: 1, account: "admin", name: "林运维", role: "系统管理员", dept: "园区运营中心", phone: "138****6688", status: "正常", last: "2026-11-03 09:12", created: "2023-04-18" },
    { id: 2, account: "wanglei", name: "王磊", role: "场站操作员", dept: "卡口管理部", phone: "137****4521", status: "正常", last: "2026-11-03 08:40", created: "2023-06-02" },
    { id: 3, account: "liting", name: "李婷", role: "报关专员", dept: "通关服务部", phone: "150****3389", status: "正常", last: "2026-11-02 17:22", created: "2024-01-15" },
    { id: 4, account: "weicheng", name: "韦诚", role: "场站操作员", dept: "卡口管理部", phone: "188****7726", status: "禁用", last: "2026-10-28 11:05", created: "2024-03-09" },
    { id: 5, account: "qinfang", name: "覃芳", role: "数据统计员", dept: "园区运营中心", phone: "135****9914", status: "正常", last: "2026-11-03 07:58", created: "2024-07-21" },
    { id: 6, account: "luocheng", name: "罗成", role: "场站操作员", dept: "卡口管理部", phone: "186****1027", status: "正常", last: "2026-11-01 16:44", created: "2025-02-11" },
    { id: 7, account: "liaojing", name: "廖静", role: "报关专员", dept: "通关服务部", phone: "159****6643", status: "正常", last: "2026-11-03 10:02", created: "2025-05-30" }
  ];

  /* ---------- 注册审核 ---------- */
  const registerApps = [
    { id: "RA20261103001", name: "越南鑫源物流", contact: "陈明", phone: "083****2210", type: "企业用户", applied: "2026-11-03 08:12", status: "待审核" },
    { id: "RA20261103002", name: "边民互助组-第七组", contact: "农伟强", phone: "136****0088", type: "边民用户", applied: "2026-11-03 07:45", status: "待审核" },
    { id: "RA20261102015", name: "李氏货运代理", contact: "李慧", phone: "077****5566", type: "企业用户", applied: "2026-11-02 15:30", status: "已通过" },
    { id: "RA20261102012", name: "东盟果品贸易", contact: "Nguyễn Văn E", phone: "032****7788", type: "企业用户", applied: "2026-11-02 10:18", status: "已驳回" },
    { id: "RA20261101008", name: "边民互助组-第三组", contact: "赵芳", phone: "137****1199", type: "边民用户", applied: "2026-11-01 09:02", status: "已通过" }
  ];

  /* ---------- 菜单管理 ---------- */
  const menus = [
    { id: 1, parent: 0, name: "首页驾驶舱", path: "/dashboard", icon: "📊", sort: 1, visible: true, type: "菜单" },
    { id: 2, parent: 0, name: "系统管理", path: "#", icon: "⚙️", sort: 2, visible: true, type: "目录" },
    { id: 3, parent: 2, name: "用户管理", path: "/system-users", icon: "👤", sort: 1, visible: true, type: "菜单" },
    { id: 4, parent: 2, name: "菜单管理", path: "/system-menus", icon: "📑", sort: 2, visible: true, type: "菜单" },
    { id: 5, parent: 2, name: "参数管理", path: "/system-params", icon: "🔧", sort: 3, visible: true, type: "菜单" },
    { id: 6, parent: 2, name: "操作日志", path: "/system-logs", icon: "📜", sort: 4, visible: true, type: "菜单" },
    { id: 7, parent: 0, name: "查询统计", path: "#", icon: "🔍", sort: 3, visible: true, type: "目录" },
    { id: 8, parent: 7, name: "在场车辆查询", path: "/query-vehicles", icon: "🚛", sort: 1, visible: true, type: "菜单" },
    { id: 9, parent: 7, name: "卡口车辆管理", path: "/query-checkpoint", icon: "🛂", sort: 2, visible: true, type: "菜单" },
    { id: 10, parent: 7, name: "核放记录查询", path: "/query-records", icon: "✅", sort: 3, visible: true, type: "菜单" },
    { id: 11, parent: 7, name: "每日报表", path: "/query-reports", icon: "📈", sort: 4, visible: true, type: "菜单" },
    { id: 12, parent: 0, name: "文件管理", path: "/files", icon: "📁", sort: 4, visible: true, type: "菜单" },
    { id: 13, parent: 2, name: "注册审核", path: "#reg-audit", icon: "🛡️", sort: 5, visible: true, type: "按钮" },
    { id: 14, parent: 0, name: "个人中心", path: "/profile", icon: "🙋", sort: 5, visible: false, type: "菜单" }
  ];

  /* ---------- 参数管理 ---------- */
  const params = [
    { id: 1, name: "滞留预警阈值", key: "vehicle.stranded.hours", value: "72", unit: "小时", group: "场站参数", remark: "超过该时长未出区触发滞留预警" },
    { id: 2, name: "在场刷新间隔", key: "vehicle.refresh.interval", value: "30", unit: "秒", group: "场站参数", remark: "在场车辆列表自动刷新周期" },
    { id: 3, name: "单日申报上限", key: "decl.daily.limit", value: "500", unit: "单", group: "通关参数", remark: "单个边民每日互市申报单数上限" },
    { id: 4, name: "报表导出格式", key: "report.export.format", value: "xlsx", unit: "", group: "报表参数", remark: "每日报表默认导出格式：xlsx / csv" },
    { id: 5, name: "文件上传大小限制", key: "file.upload.maxsize", value: "50", unit: "MB", group: "文件参数", remark: "单个文件上传大小上限" },
    { id: 6, name: "会话超时时间", key: "session.timeout", value: "30", unit: "分钟", group: "安全参数", remark: "无操作自动登出时间" },
    { id: 7, name: "密码错误锁定次数", key: "security.pwd.lock", value: "5", unit: "次", group: "安全参数", remark: "连续错误达到次数后锁定账号" },
    { id: 8, name: "数据保留周期", key: "data.retention.days", value: "180", unit: "天", group: "安全参数", remark: "操作日志与明细数据保留天数" }
  ];

  /* ---------- 操作日志 ---------- */
  const logs = [
    { id: "L20261103091201", user: "林运维", module: "用户管理", action: "新增用户", ip: "10.20.3.16", result: "成功", time: "2026-11-03 09:12:01", cost: 86 },
    { id: "L20261103090844", user: "系统调度", module: "查询统计", action: "每日报表生成", ip: "127.0.0.1", result: "成功", time: "2026-11-03 09:08:44", cost: 2340 },
    { id: "L20261103084012", user: "王磊", module: "卡口车辆管理", action: "手动抬杆", ip: "10.20.3.42", result: "成功", time: "2026-11-03 08:40:12", cost: 132 },
    { id: "L20261103081055", user: "李婷", module: "核放记录", action: "导出发票数据", ip: "10.20.3.58", result: "成功", time: "2026-11-03 08:10:55", cost: 510 },
    { id: "L20261103075933", user: "覃芳", module: "参数管理", action: "修改参数[滞留预警阈值]", ip: "10.20.3.31", result: "成功", time: "2026-11-03 07:59:33", cost: 96 },
    { id: "L20261102172208", user: "李婷", module: "注册审核", action: "审核通过[李氏货运代理]", ip: "10.20.3.58", result: "成功", time: "2026-11-02 17:22:08", cost: 145 },
    { id: "L20261102171120", user: "韦诚", module: "用户登录", action: "登录系统", ip: "10.20.3.77", result: "失败-密码错误", time: "2026-11-02 17:11:20", cost: 42 },
    { id: "L20261102164502", user: "罗成", module: "卡口车辆管理", action: "修改车辆信息", ip: "10.20.3.42", result: "成功", time: "2026-11-02 16:45:02", cost: 178 },
    { id: "L20261102140031", user: "林运维", module: "菜单管理", action: "隐藏菜单[个人中心]", ip: "10.20.3.16", result: "成功", time: "2026-11-02 14:00:31", cost: 63 },
    { id: "L20261102135947", user: "系统调度", module: "文件管理", action: "清理临时文件", ip: "127.0.0.1", result: "成功", time: "2026-11-02 13:59:47", cost: 890 }
  ];

  /* ---------- 文件管理 ---------- */
  const files = [
    { id: "F001", name: "2026-11-03_园区日报.xlsx", size: "2.4 MB", type: "excel", owner: "系统调度", time: "2026-11-03 09:08", downloads: 12 },
    { id: "F002", name: "滞留车辆清单_20261103.csv", size: "18 KB", type: "csv", owner: "林运维", time: "2026-11-03 09:15", downloads: 3 },
    { id: "F003", name: "闸口B边小入区明细_20261103.xlsx", size: "1.1 MB", type: "excel", owner: "王磊", time: "2026-11-03 08:40", downloads: 5 },
    { id: "F004", name: "边民申报汇总_第44周.pdf", size: "860 KB", type: "pdf", owner: "覃芳", time: "2026-11-01 17:20", downloads: 8 },
    { id: "F005", name: "一线放行过驳记录_20261103.csv", size: "12 KB", type: "csv", owner: "系统调度", time: "2026-11-03 09:10", downloads: 2 },
    { id: "F006", name: "园区平面示意图.png", size: "345 KB", type: "image", owner: "林运维", time: "2026-10-30 14:12", downloads: 6 },
    { id: "F007", name: "越南拼车出场统计_20261103.xlsx", size: "980 KB", type: "excel", owner: "李婷", time: "2026-11-03 09:05", downloads: 4 },
    { id: "F008", name: "进口商品申报单_通过清单.csv", size: "22 KB", type: "csv", owner: "李婷", time: "2026-11-03 09:02", downloads: 3 }
  ];

  /* ---------- 个人主页：时间线 ---------- */
  const timeline = [
    { date: "2026 - 至今", title: "园区运营中心 · 系统管理员", text: "负责进出口场站数字化系统建设，主导车辆在场监管、卡口核放、每日报表三条主线从 0 到 1 落地。" },
    { date: "2023 - 2026", title: "通关服务部 · 报关专员", text: "深耕互市贸易通关实务，累计处理边民申报超 12 万单，推动申报时效平均缩短 38%。" },
    { date: "2021 - 2023", title: "某科技公司 · 前端工程师", text: "负责数据可视化与中后台系统开发，沉淀了一套可复用的组件与图表体系。" },
    { date: "2017 - 2021", title: "大学 · 软件工程", text: "主修软件工程，任技术社团负责人，两次省级程序设计竞赛奖项。" }
  ];

  /* ---------- 个人主页：留言 ---------- */
  const messages = [
    { name: "王磊", time: "2 小时前", text: "滞留车辆提醒很及时，昨天靠它赶在关区前完成了单证补充！" },
    { name: "李婷", time: "昨天 17:32", text: "报表导出能按口岸拆分就更好了，期待更新。" },
    { name: "匿名访客", time: "3 天前", text: "园区示意图做得很清晰，一眼就能找到各个卡口位置。" }
  ];

  return {
    currentUser, kpis, trend30, goodsPie, gateFlow, mapMarkers,
    vehiclesOnSite, stranded, checkpointVehicles, releaseRecords,
    dailyReports, users, registerApps, menus, params, logs, files,
    timeline, messages
  };
})();
