/* =====================================================================
 * dashboard-gates.js — 多卡口数据看板：注册表 / 切换条 / 未接入空态
 *
 * 5 个看板各自独立页面，便于后续按卡口定制指标与报表口径
 * （用户已说明「各卡口需要查询的数据及报表是不一样的」）。
 * 未接入的卡口一律显示明确的空态，不套用 B 卡口径、不填示意数字。
 * 纯前端，无外部依赖；由各看板页面在 DOM 就绪后调用 GateDash.mount()。
 * ===================================================================== */
(function () {
  "use strict";

  var GATES = [
    { id: "bcard", name: "B卡", icon: "🅱️", file: "dashboard.html",
      desc: "B卡地磅报表 / 边小口进出 / 总署一线入区", status: "ready", statusText: "已接入" },
    { id: "hushi", name: "互市", icon: "🛒", file: "dashboard-hushi.html",
      desc: "边民互市业务", status: "pending", statusText: "待接入" },
    { id: "chukou", name: "出口", icon: "📤", file: "dashboard-chukou.html",
      desc: "出口业务", status: "pending", statusText: "待接入" },
    { id: "linggongli", name: "零公里", icon: "📍", file: "dashboard-linggongli.html",
      desc: "零公里卡口", status: "pending", statusText: "待接入" },
    { id: "chayanqu", name: "查验区", icon: "🔍", file: "dashboard-chayanqu.html",
      desc: "查验区", status: "pending", statusText: "待接入" }
  ];

  var NEED_LIST = [
    "卡口名称 / 编号",
    "该卡口数据文件（工作表清单 + 各自表头）",
    "该卡口目标报表模板或报表差异点",
    "该卡口统计口径（是否仍是货物名称 / 车数 / 重量，还是另有指标）"
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function currentId() {
    return document.body.getAttribute("data-gate") || "bcard";
  }
  function gate(id) {
    for (var i = 0; i < GATES.length; i++) if (GATES[i].id === id) return GATES[i];
    return GATES[0];
  }

  function renderSwitcher(cur) {
    return '<div class="gate-switcher-inner">' + GATES.map(function (g) {
      var on = g.id === cur;
      return '<a class="gate-tab' + (on ? " active" : "") + '" href="' + esc(g.file) + '"' +
        (on ? ' aria-current="page"' : "") + '>' +
        '<span class="gate-tab-ico">' + esc(g.icon) + '</span>' +
        '<span class="gate-tab-txt"><b>' + esc(g.name) + '</b>' +
        '<span class="gate-tab-status ' + g.status + '">' + esc(g.statusText) + '</span></span>' +
        '</a>';
    }).join("") + '</div>';
  }

  function renderPlaceholders(g) {
    var labels = ["入区车数", "出区车数", "入区重量", "出区重量", "货物品种", "统计日期"];
    return labels.map(function (t) {
      return '<div class="gate-kpi-placeholder">' +
        '<div class="gate-kpi-label">' + esc(t) + '</div>' +
        '<div class="gate-kpi-value">—</div>' +
        '<div class="gate-kpi-tip">' + (g.status === "ready" ? "云端读取" : "待该卡口数据接入") + '</div>' +
        '</div>';
    }).join("");
  }

  function renderEmpty(g) {
    return '' +
      '<div class="card gate-empty-card mb-24">' +
        '<div class="card-hd">📋 ' + esc(g.name) + '看板 · 数据接入说明</div>' +
        '<div class="card-bd">' +
          '<div class="gate-empty-hero">' +
            '<div class="gate-empty-ico">' + esc(g.icon) + '</div>' +
            '<h3>' + esc(g.name) + '数据看板</h3>' +
            '<p>此看板已预留独立入口、独立页面与独立数据结构。由于各卡口「需要查询的数据及报表是不一样的」，' +
              '本站<strong>不会把 B 卡的表头 / 工作表 / 统计口径套用到本卡口</strong>，也不会填入示意或演示数字。</p>' +
          '</div>' +
          '<div class="gate-need">' +
            '<h4>接入本卡口需要提供</h4>' +
            '<ol>' + NEED_LIST.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ol>' +
            '<p class="text-3">样例到齐后一次性完成该卡口的指标配置、导入解析与三端发布，避免反复覆盖。</p>' +
          '</div>' +
          '<div class="gate-empty-actions">' +
            '<a class="btn btn-primary" href="query-reports.html">前往每日报表 →</a>' +
            '<a class="btn btn-line" href="dashboard.html">查看 B卡看板（已接入）</a>' +
            '<a class="btn btn-line" href="source.html">数据来源与声明</a>' +
          '</div>' +
          '<p class="text-3 gate-empty-foot">本站未与任何生产业务系统对接；所有数据由使用者手动导入并自行负责，' +
            '站内不含真实监管业务数据。</p>' +
        '</div>' +
      '</div>';
  }

  function mount() {
    var g = gate(currentId());
    var sw = document.getElementById("gateSwitcher");
    if (sw) sw.innerHTML = renderSwitcher(g.id);

    var title = document.getElementById("gateBoardTitle");
    if (title) title.textContent = g.icon + " " + g.name + "数据看板";
    var desc = document.getElementById("gateBoardDesc");
    if (desc) desc.textContent = g.desc + " · " + g.statusText;

    var kpi = document.getElementById("gateKpiGrid");
    if (kpi) kpi.innerHTML = renderPlaceholders(g);

    var empty = document.getElementById("gateEmpty");
    if (empty && g.status !== "ready") empty.innerHTML = renderEmpty(g);

    /* 侧边栏当前项高亮：静态 HTML 已写好 active，这里再做一次兜底 */
    var links = document.querySelectorAll(".side-group .side-link[data-gate]");
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("data-gate") === g.id) links[i].classList.add("active");
    }
    document.body.setAttribute("data-gate-ready", g.status);
  }

  window.GateDash = {
    GATES: GATES,
    NEED_LIST: NEED_LIST,
    esc: esc,
    gate: gate,
    currentId: currentId,
    renderSwitcher: renderSwitcher,
    renderEmpty: renderEmpty,
    renderPlaceholders: renderPlaceholders,
    mount: mount
  };
})();
