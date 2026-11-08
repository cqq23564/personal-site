/* =====================================================================
 * cloud.js — 云服务数据层（认证 + profiles 用户资料表）
 * 依赖：js/cloud-config.js（window.CLOUD_CONFIG）
 *       SDK CDN：@tencent-ai/workbuddy-cloud-sdk@dev（window.WorkBuddyCloud）
 *
 * 域名边界：云服务按 Origin 精确匹配，仅在 WorkBuddy 托管域名下可用。
 * 其他域名（GitHub Pages / Cloudflare Pages / localhost）自动进入静态镜像模式：
 * 页面顶部显示明确提示，不伪造登录态、不静默失败。
 * ===================================================================== */
(function () {
  "use strict";

  var CFG = window.CLOUD_CONFIG || null;
  var cloud = null;
  var listeners = [];
  var HOSTED_URL = "https://personal-site-12467.app.workbuddy.host/?sharecode=7KQMYZSJPE";

  var state = {
    ready: false,      // SDK 已就绪（当前域名获准访问云服务）
    reason: "",        // 不可用原因：config / domain / sdk / init
    session: null,
    user: null,        // 认证用户 { id, phone, email, name, avatarUrl }
    profile: null      // profiles 表当前用户的资料行
  };

  /* ---------- 基础工具 ---------- */
  function trimSlash(s) { return String(s || "").replace(/\/+$/, ""); }
  function currentOrigin() {
    return trimSlash(location.origin || (location.protocol + "//" + location.host));
  }
  function validPhone(p) { return /^1\d{10}$/.test(String(p || "").trim()); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim()); }
  /** 归一化手机号：去非数字、去 +86 前缀，返回 11 位或 "" */
  function normalizePhone(p) {
    var d = String(p || "").replace(/\D/g, "");
    if (d.length === 13 && d.indexOf("86") === 0) d = d.slice(2);
    return /^1\d{10}$/.test(d) ? d : "";
  }
  function nowISO() { return new Date().toISOString(); }
  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* 忽略监听器异常 */ } }); }

  var REASON_TEXT = {
    config: "云服务未配置",
    domain: "当前域名未接入云服务",
    sdk: "云服务组件加载失败",
    init: "云服务初始化失败"
  };
  function unavailableText() {
    return (REASON_TEXT[state.reason] || "云服务不可用") + "，请在 WorkBuddy 托管域名下使用。";
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (!CFG || !CFG.endpoint) { state.reason = "config"; return false; }
    if (currentOrigin() !== trimSlash(CFG.endpoint)) { state.reason = "domain"; return false; }
    if (!window.WorkBuddyCloud || typeof window.WorkBuddyCloud.createWorkBuddyCloud !== "function") {
      state.reason = "sdk"; return false;
    }
    try {
      cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: CFG.endpoint,
        oauthRelayBaseUrl: CFG.oauthRelayBaseUrl,
        publishableKey: CFG.publishableKey
      });
    } catch (e) {
      state.reason = "init"; return false;
    }
    state.ready = true;
    if (cloud.auth && typeof cloud.auth.onAuthStateChange === "function") {
      cloud.auth.onAuthStateChange(function (event, session) {
        if (event === "SIGNED_OUT") {
          state.session = null; state.user = null; state.profile = null; emit();
        } else if (session) {
          state.session = session; state.user = session.user || null;
          loadProfile().then(emit);
        }
      });
    }
    return true;
  }

  /* ---------- 会话恢复 + OAuth 回调处理 ---------- */
  function cleanCallbackParams(url) {
    ["code", "state", "provider", "error", "error_description"].forEach(function (k) {
      url.searchParams.delete(k);
    });
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  async function handleCallbackIfAny() {
    var url = new URL(location.href);
    if (!url.searchParams.has("code") && !url.searchParams.has("error")) return false;
    var provider = url.searchParams.get("provider");
    if (provider !== "wechat" || typeof cloud.auth.handleWechatWebCallback !== "function") {
      cleanCallbackParams(url); // 非本应用使用的回调参数，清理避免重复消费
      return false;
    }
    var res = {};
    try { res = await cloud.auth.handleWechatWebCallback(); } catch (e) { res = { error: e }; }
    cleanCallbackParams(url);
    if (!res.error && res.data) { await restore(); return true; }
    return false;
  }

  async function restore() {
    if (!state.ready) { emit(); return state; }
    try { await handleCallbackIfAny(); } catch (e) { /* 回调处理失败不阻塞启动 */ }
    try {
      var r = await cloud.auth.getSession();
      if (r && !r.error && r.data) {
        state.session = r.data;
        state.user = r.data.user || null;
        await loadProfile();
      } else {
        state.session = null; state.user = null; state.profile = null;
      }
    } catch (e) { /* 网络异常：保留当前状态，不伪造登录态 */ }
    emit();
    return state;
  }

  /* ---------- profiles 资料读写 ---------- */
  async function loadProfile() {
    if (!state.ready || !state.user) { state.profile = null; return null; }
    try {
      var r = await cloud.database.from("profiles").select("*").eq("owner_id", String(state.user.id)).maybeSingle();
      state.profile = (r && !r.error && r.data) || null;
    } catch (e) { state.profile = null; }
    /* 兜底：按手机号匹配（会话 user 只有 id，raw 里带 phone_number；防止 owner_id 不一致时看不到自己的资料） */
    if (!state.profile) {
      var ph = normalizePhone(state.user.raw && (state.user.raw.phone_number || state.user.raw.phone));
      if (ph) {
        try {
          var r2 = await cloud.database.from("profiles").select("*").eq("phone", ph).maybeSingle();
          if (r2 && !r2.error && r2.data) state.profile = r2.data;
        } catch (e2) { /* 忽略兜底异常 */ }
      }
    }
    return state.profile;
  }

  /** 保存我的资料（无资料行时补建；owner_id 由数据库默认填充，客户端不发送） */
  async function saveMyProfile(patch) {
    if (!state.ready) return { error: { message: unavailableText() } };
    var r = await cloud.auth.getSession();
    if (!r || r.error || !r.data) return { error: { message: "登录已过期，请重新登录" } };
    state.session = r.data; state.user = r.data.user || state.user;
    await loadProfile();
    var row = {};
    Object.keys(patch || {}).forEach(function (k) { if (patch[k] !== undefined) row[k] = patch[k]; });
    row.updated_at = nowISO();
    try {
      if (state.profile) {
        var u = await cloud.database.from("profiles").update(row).eq("id", state.profile.id).select();
        if (u && u.error) return { error: u.error };
        var rows = (u && u.data) || [];
        if (!rows.length) return { error: { message: "保存失败：没有权限或记录不存在" } };
        state.profile = rows[0];
      } else {
        var c = await cloud.database.from("profiles").insert(row).select();
        if (c && c.error) return { error: c.error };
        state.profile = (c && c.data && c.data[0]) || null;
      }
    } catch (e) { return { error: { message: "网络异常，保存失败" } }; }
    emit();
    return { data: state.profile };
  }

  /** 用户列表（需登录；关键字过滤在前端进行，用户量小） */
  async function listProfiles(opts) {
    opts = opts || {};
    if (!state.ready) return { data: [], error: { message: unavailableText() } };
    var r = await cloud.auth.getSession();
    if (!r || r.error || !r.data) return { data: [], error: { message: "请先登录" } };
    try {
      var q = cloud.database.from("profiles").select("*", { count: "exact" }).order("created_at", { ascending: false });
      if (opts.status) q = q.eq("status", opts.status);
      var res = await q;
      if (res && res.error) return { data: [], error: res.error };
      var rows = (res && res.data) || [];
      var kw = String(opts.keyword || "").trim().toLowerCase();
      if (kw) {
        rows = rows.filter(function (p) {
          return [p.name, p.nickname, p.phone, p.email, p.dept].join(" ").toLowerCase().indexOf(kw) !== -1;
        });
      }
      return { data: rows, error: null };
    } catch (e) { return { data: [], error: { message: "网络异常，读取失败" } }; }
  }

  /** 更新指定用户（本人或管理员，RLS 控制） */
  async function updateProfile(id, patch) {
    if (!state.ready) return { error: { message: unavailableText() } };
    var row = {};
    Object.keys(patch || {}).forEach(function (k) { if (patch[k] !== undefined) row[k] = patch[k]; });
    row.updated_at = nowISO();
    try {
      var u = await cloud.database.from("profiles").update(row).eq("id", id).select();
      if (u && u.error) return { error: u.error };
      var rows = (u && u.data) || [];
      if (!rows.length) return { error: { message: "操作失败：记录不存在或权限不足" } };
      if (state.profile && state.profile.id === id) state.profile = rows[0];
      emit();
      return { data: rows[0] };
    } catch (e) { return { error: { message: "网络异常，操作失败" } }; }
  }

  /** 删除用户（仅管理员，RLS 控制） */
  async function deleteProfile(id) {
    if (!state.ready) return { error: { message: unavailableText() } };
    try {
      var d = await cloud.database.from("profiles").delete().eq("id", id).select();
      if (d && d.error) return { error: d.error };
      var rows = (d && d.data) || [];
      if (!rows.length) return { error: { message: "删除失败：权限不足" } };
      emit();
      return { data: rows };
    } catch (e) { return { error: { message: "网络异常，删除失败" } }; }
  }

  /* ---------- 通用业务表 CRUD（登录可读、管理员可写，RLS 控制） ---------- */
  async function tableList(name, opts) {
    opts = opts || {};
    if (!state.ready) return { data: [], error: { message: unavailableText() } };
    var r = await cloud.auth.getSession();
    if (!r || r.error || !r.data) return { data: [], error: { message: "请先登录" } };
    try {
      var q = cloud.database.from(name).select("*");
      if (opts.order) q = q.order(opts.order, { ascending: opts.asc !== false });
      var res = await q;
      if (res && res.error) return { data: [], error: res.error };
      return { data: (res && res.data) || [], error: null };
    } catch (e) { return { data: [], error: { message: "网络异常，读取失败" } }; }
  }

  async function tableInsert(name, row) {
    if (!state.ready) return { error: { message: unavailableText() } };
    var data = {};
    Object.keys(row || {}).forEach(function (k) { if (row[k] !== undefined && row[k] !== "") data[k] = row[k]; });
    try {
      var c = await cloud.database.from(name).insert(data).select();
      if (c && c.error) return { error: c.error };
      emit();
      return { data: (c && c.data && c.data[0]) || null };
    } catch (e) { return { error: { message: "网络异常，保存失败" } }; }
  }

  async function tableUpdate(name, id, patch) {
    if (!state.ready) return { error: { message: unavailableText() } };
    var data = {};
    Object.keys(patch || {}).forEach(function (k) { if (patch[k] !== undefined) data[k] = patch[k]; });
    data.updated_at = nowISO();
    try {
      var u = await cloud.database.from(name).update(data).eq("id", id).select();
      if (u && u.error) return { error: u.error };
      var rows = (u && u.data) || [];
      if (!rows.length) return { error: { message: "操作失败：没有权限（仅管理员可修改）或记录不存在" } };
      emit();
      return { data: rows[0] };
    } catch (e) { return { error: { message: "网络异常，操作失败" } }; }
  }

  async function tableRemove(name, id) {
    if (!state.ready) return { error: { message: unavailableText() } };
    try {
      var d = await cloud.database.from(name).delete().eq("id", id).select();
      if (d && d.error) return { error: d.error };
      var rows = (d && d.data) || [];
      if (!rows.length) return { error: { message: "删除失败：权限不足" } };
      emit();
      return { data: rows };
    } catch (e) { return { error: { message: "网络异常，删除失败" } }; }
  }

  /** 清空整表（仅管理员，RLS 控制）——用于操作日志等可重置数据 */
  async function tableClear(name) {
    if (!state.ready) return { error: { message: unavailableText() } };
    try {
      var d = await cloud.database.from(name).delete().gte("id", 0).select();
      if (d && d.error) return { error: d.error };
      return { data: (d && d.data) || [] };
    } catch (e) { return { error: { message: "网络异常，清空失败" } }; }
  }

  /** 记录操作日志（失败静默，不阻塞主流程） */
  async function logAction(module, action, detail) {
    if (!state.ready || !state.user) return;
    try {
      var who = state.profile ? (state.profile.nickname || state.profile.name || "") : "";
      var d = new Date();
      var pad = function (n) { return String(n).padStart(2, "0"); };
      var lid = "L" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
      await cloud.database.from("site_logs").insert({
        log_id: lid,
        user_name: who || "用户",
        module: module,
        action: detail ? action + "[" + detail + "]" : action,
        ip: "",
        result: "成功",
        cost: 0,
        happened_at: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
      });
    } catch (e) { /* 日志失败不影响主流程 */ }
  }

  /* ---------- 站点参数（驱动首页展示数据；仅管理员可写） ---------- */
  var homeParamsCache = null;

  /** 参数列表（需登录；按分组、ID 排序） */
  async function listParams() {
    if (!state.ready) return { data: [], error: { message: unavailableText() } };
    var r = await cloud.auth.getSession();
    if (!r || r.error || !r.data) return { data: [], error: { message: "请先登录" } };
    try {
      var res = await cloud.database.from("site_params").select("*")
        .order("pgroup", { ascending: true }).order("id", { ascending: true });
      if (res && res.error) return { data: [], error: res.error };
      homeParamsCache = (res && res.data) || [];
      return { data: homeParamsCache, error: null };
    } catch (e) { return { data: [], error: { message: "网络异常，读取失败" } }; }
  }

  /** 新增/更新参数（仅管理员，RLS 控制）。row = { id?, pname, pkey, pvalue, unit, pgroup, remark } */
  async function saveParam(row) {
    if (!state.ready) return { error: { message: unavailableText() } };
    var r = await cloud.auth.getSession();
    if (!r || r.error || !r.data) return { error: { message: "登录已过期，请重新登录" } };
    var data = {};
    ["pname", "pkey", "pvalue", "unit", "pgroup", "remark", "ptarget"].forEach(function (k) {
      if (row[k] !== undefined) data[k] = row[k];
    });
    data.updated_at = nowISO();
    try {
      if (row.id) {
        var u = await cloud.database.from("site_params").update(data).eq("id", row.id).select();
        if (u && u.error) return { error: u.error };
        var rows = (u && u.data) || [];
        if (!rows.length) return { error: { message: "保存失败：没有权限（仅管理员可修改）或记录不存在" } };
        homeParamsCache = null;
        emit();
        return { data: rows[0] };
      }
      var c = await cloud.database.from("site_params").insert(data).select();
      if (c && c.error) return { error: c.error };
      homeParamsCache = null;
      emit();
      return { data: (c && c.data && c.data[0]) || null };
    } catch (e) { return { error: { message: "网络异常，保存失败" } }; }
  }

  /** 删除参数（仅管理员，RLS 控制） */
  async function deleteParam(id) {
    if (!state.ready) return { error: { message: unavailableText() } };
    try {
      var d = await cloud.database.from("site_params").delete().eq("id", id).select();
      if (d && d.error) return { error: d.error };
      var rows = (d && d.data) || [];
      if (!rows.length) return { error: { message: "删除失败：权限不足" } };
      homeParamsCache = null;
      emit();
      return { data: rows };
    } catch (e) { return { error: { message: "网络异常，删除失败" } }; }
  }

  /** 把参数值写到元素上（数字动画 / 换行 / 纯文本，全部转义防注入） */
  function setParamValue(el, v, allowHtml) {
    v = String(v == null ? "" : v);
    if (el.hasAttribute("data-count")) {
      var num = v.replace(/[^\d.-]/g, "");
      el.setAttribute("data-count", num);
      if (window.App && typeof window.App.animateCount === "function") window.App.animateCount(el);
      else el.textContent = Number(num).toLocaleString("zh-CN");
    } else if (allowHtml && v.indexOf("\n") > -1) {
      el.innerHTML = v.split("\n").map(function (s) {
        return s.replace(/[&<>"]/g, function (c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
      }).join("<br>");
    } else {
      el.textContent = v;
    }
    /* 进度条联动：元素带 data-param-width 时把数值同步到所在行的进度条宽度 */
    if (el.hasAttribute("data-param-width")) {
      var sel = el.getAttribute("data-param-width");
      var host = sel ? document.querySelector(sel) : (el.closest ? el.closest(".skill-row") : null);
      var bar = host && host.querySelector ? host.querySelector(".progress i") : null;
      if (bar) bar.style.width = (v.replace(/[^\d.]/g, "") || "0") + "%";
    }
  }

  /* ---------- 首页「成长经历」：由 home.timeline.N.* 参数动态渲染（可增删改排序） ----------
   * 不再写死 4 条 DOM：编号 N 决定顺序，任意条数均可；参数管理页整组保存后即时生效。
   */
  var TIMELINE_RE = /^home\.timeline\.(\d+)\.(date|title|text)$/;
  var TIMELINE_FIELDS = ["date", "title", "text"];
  var TIMELINE_LABEL = { date: "时间", title: "标题", text: "正文" };
  function tlEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  /** 聚合 site_params 里所有 home.timeline.N.* -> [{date,title,text}]，按编号升序 */
  function timelineFromParams(list) {
    var map = {};
    (list || []).forEach(function (p) {
      var m = TIMELINE_RE.exec(p.pkey || "");
      if (!m) return;
      var n = Number(m[1]);
      if (!map[n]) map[n] = { date: "", title: "", text: "" };
      map[n][m[2]] = p.pvalue == null ? "" : String(p.pvalue);
    });
    return Object.keys(map).map(Number).sort(function (a, b) { return a - b; })
      .map(function (n) { return map[n]; })
      .filter(function (it) { return it.date || it.title || it.text; });
  }
  /** 首页时间线动态渲染；无云端参数时显示空状态（未登录 / 静态镜像时本函数不执行，保留静态兜底） */
  function renderTimeline(list) {
    var box = document.getElementById("homeTimeline");
    if (!box) return;
    var items = timelineFromParams(list);
    if (!items.length) {
      box.innerHTML = '<div class="empty" style="padding:10px 0"><div class="ico">🧭</div>还没有成长经历，管理员可到「参数管理 → 成长经历」添加</div>';
      return;
    }
    box.innerHTML = items.map(function (it, i) {
      return '<div class="timeline-item' + (i === 0 ? "" : " done") + '">' +
        '<div class="timeline-date">' + tlEsc(it.date) + "</div>" +
        '<div class="timeline-title">' + tlEsc(it.title) + "</div>" +
        '<div class="timeline-text">' + tlEsc(it.text) + "</div></div>";
    }).join("");
  }
  /** 参数管理页读取成长经历（按编号聚合） */
  async function listTimeline() {
    var res = homeParamsCache ? { data: homeParamsCache } : await listParams();
    if (res.error) return { data: [], error: res.error };
    return { data: timelineFromParams(res.data), error: null };
  }
  /** 整组保存成长经历：复用已有参数 id 更新、新增缺失编号、删除多余编号，只广播一次 */
  async function saveTimeline(items) {
    if (!state.ready) return { error: { message: unavailableText() } };
    if (!isAdmin()) return { error: { message: "仅管理员可修改成长经历" } };
    var r = await cloud.auth.getSession();
    if (!r || r.error || !r.data) return { error: { message: "登录已过期，请重新登录" } };
    try {
      var res = await listParams();
      if (res.error) return { error: res.error };
      var olds = (res.data || []).filter(function (p) { return /^home\.timeline\.\d+\./.test(p.pkey || ""); });
      var oldMap = {};
      olds.forEach(function (p) { oldMap[p.pkey] = p; });
      var keep = {};
      var list = items || [];
      for (var n = 0; n < list.length; n++) {
        for (var f = 0; f < TIMELINE_FIELDS.length; f++) {
          var key = TIMELINE_FIELDS[f];
          var pkey = "home.timeline." + (n + 1) + "." + key;
          var payload = {
            pname: "经历" + (n + 1) + "-" + TIMELINE_LABEL[key],
            pvalue: String(list[n][key] == null ? "" : list[n][key]),
            pgroup: "成长经历",
            remark: "成长经历第" + (n + 1) + "条（参数管理页可增删改排序）",
            updated_at: nowISO()
          };
          keep[pkey] = true;
          var old = oldMap[pkey];
          var op;
          if (old) {
            op = await cloud.database.from("site_params").update(payload).eq("id", old.id).select();
          } else {
            var row = { pkey: pkey };
            Object.keys(payload).forEach(function (k) { row[k] = payload[k]; });
            op = await cloud.database.from("site_params").insert(row).select();
          }
          if (op && op.error) return { error: op.error };
          if (op && op.data && !op.data.length) return { error: { message: "保存失败：没有权限（仅管理员可修改）或记录不存在" } };
        }
      }
      /* 删除编号超出新列表的旧条目（例如从 4 条删到 2 条） */
      for (var i = 0; i < olds.length; i++) {
        if (keep[olds[i].pkey]) continue;
        var d = await cloud.database.from("site_params").delete().eq("id", olds[i].id);
        if (d && d.error) return { error: d.error };
      }
      homeParamsCache = null;
      emit();
      return { data: list };
    } catch (e) { return { error: { message: "网络异常，保存成长经历失败" } }; }
  }

  /**
   * 全站文案联动（真实数据，无需改代码）：
   * 1) 页面 [data-param] 元素按 pkey 取值；
   * 2) 参数自带 ptarget（CSS 选择器）时，把值写到匹配元素——管理员新增参数即可改任意文案。
   * 未登录 / 无对应参数时保留页面默认值，不静默改写。
   */
  async function applyHomeParams() {
    if (!state.ready || !state.user) return;
    var res = homeParamsCache ? { data: homeParamsCache } : await listParams();
    if (!res || res.error) return;
    var list = res.data || [];
    var map = {};
    list.forEach(function (p) { map[p.pkey] = p.pvalue; });
    document.querySelectorAll("[data-param]").forEach(function (el) {
      var k = el.getAttribute("data-param");
      var v = map[k];
      if (v === undefined || v === null || v === "") return;
      setParamValue(el, v, k === "home.hero.desc" || k === "home.about.intro" || k === "home.video.desc");
    });
    /* 自定义选择器绑定：新增参数可改页面任意元素，保存后立即生效 */
    list.forEach(function (p) {
      var sel = (p.ptarget || "").trim();
      var v = p.pvalue;
      if (!sel || v === undefined || v === null || v === "") return;
      try {
        document.querySelectorAll(sel).forEach(function (el) { setParamValue(el, v, true); });
      } catch (e) { /* 选择器非法时忽略，不影响页面 */ }
    });
    /* 成长经历：按云端参数动态渲染任意条数（增删改排序后即时生效） */
    renderTimeline(list);
  }
  listeners.push(applyHomeParams);

  /* ---------- 认证：OTP 登录 / 注册 ---------- */
  /** 发送手机验证码。返回 { verificationId, isExistingUser } 供提交时使用 */
  async function sendPhoneCode(phone) {
    if (!state.ready) return { error: { message: unavailableText() } };
    phone = String(phone || "").trim();
    if (!validPhone(phone)) return { error: { message: "请输入正确的 11 位手机号" } };
    try { return await cloud.auth.sendOtp({ phone: phone }); }
    catch (e) { return { error: { message: "验证码发送失败，请稍后重试" } }; }
  }

  /** 发送邮箱验证码 */
  async function sendEmailCode(email) {
    if (!state.ready) return { error: { message: unavailableText() } };
    email = String(email || "").trim();
    if (!validEmail(email)) return { error: { message: "请输入正确的邮箱地址" } };
    try { return await cloud.auth.sendOtp({ email: email }); }
    catch (e) { return { error: { message: "验证码发送失败，请稍后重试" } }; }
  }

  /** 验证码登录（手机）。challenge = { phone, verificationId, isExistingUser, token } */
  async function loginWithPhone(challenge) {
    if (!state.ready) return { error: { message: unavailableText() } };
    try {
      var res = await cloud.auth.verifyOtp({
        phone: challenge.phone,
        verificationId: challenge.verificationId,
        isExistingUser: challenge.isExistingUser,
        token: String(challenge.token || "").trim()
      });
      if (res && res.error) return { error: res.error };
      await restore();
      if (!state.user) return { error: { message: "登录状态建立失败，请重试" } };
      return { data: state };
    } catch (e) { return { error: { message: "登录失败，请重试" } }; }
  }

  /** 验证码登录（邮箱） */
  async function loginWithEmail(challenge) {
    if (!state.ready) return { error: { message: unavailableText() } };
    try {
      var res = await cloud.auth.verifyOtp({
        email: challenge.email,
        verificationId: challenge.verificationId,
        isExistingUser: challenge.isExistingUser,
        token: String(challenge.token || "").trim()
      });
      if (res && res.error) return { error: res.error };
      await restore();
      if (!state.user) return { error: { message: "登录状态建立失败，请重试" } };
      return { data: state };
    } catch (e) { return { error: { message: "登录失败，请重试" } }; }
  }

  /**
   * 注册：验证通过后写入 profiles 资料行（状态 pending，待管理员审核）。
   * info = { phone|email, verificationId, isExistingUser, token, name, dept, email, phone }
   * 已注册的号码/邮箱返回 existed: true，交由页面引导去登录。
   */
  async function register(info) {
    if (!state.ready) return { error: { message: unavailableText() } };
    var payload = {
      verificationId: info.verificationId,
      isExistingUser: info.isExistingUser,
      token: String(info.token || "").trim()
    };
    if (info.phone) payload.phone = info.phone; else payload.email = info.email;
    try {
      var res = await cloud.auth.verifyOtp(payload);
      if (res && res.error) return { error: res.error };
      if (info.isExistingUser) {
        await Cloud.signOut();
        return { error: { message: "该账号已注册，请直接登录", existed: true } };
      }
      await restore();
      if (!state.user) return { error: { message: "注册失败：会话未建立，请重试" } };
      await loadProfile();
      if (state.profile) {
        var u = await cloud.database.from("profiles")
          .update({ name: info.name || "", dept: info.dept || "", phone: info.phone || state.profile.phone, email: info.email || state.profile.email, updated_at: nowISO() })
          .eq("id", state.profile.id).select();
        state.profile = (u && u.data && u.data[0]) || state.profile;
      } else {
        var c = await cloud.database.from("profiles").insert({
          name: info.name || "",
          dept: info.dept || "",
          phone: info.phone || "",
          email: info.email || "",
          status: "pending",
          updated_at: nowISO()
        }).select();
        state.profile = (c && c.data && c.data[0]) || null;
      }
      await Cloud.signOut(); // 注册后需审核，先退出，审核通过再登录
      return { data: { registered: true } };
    } catch (e) { return { error: { message: "注册失败，请重试" } }; }
  }

  /** 微信登录（网站授权）。redirectTo 必须是托管域名根路径 */
  async function signInWithWechat() {
    if (!state.ready) return { error: { message: unavailableText() } };
    try {
      var back = new URL(location.href);
      back.pathname = "/";
      ["code", "state", "provider"].forEach(function (k) { back.searchParams.delete(k); });
      var res = await cloud.auth.signInWithOAuth({ provider: "wechat", redirectTo: back.toString() });
      if (res && res.error) return { error: res.error };
      location.assign(res.data.url); // 同标签页跳转
      return { data: res.data };
    } catch (e) { return { error: { message: "微信登录启动失败" } }; }
  }

  async function signOut() {
    state.session = null; state.user = null; state.profile = null;
    homeParamsCache = null;
    if (state.ready && cloud.auth) {
      try { await cloud.auth.signOut(); } catch (e) { /* 忽略 */ }
    }
    emit();
    return { data: true };
  }

  /* ---------- 状态判断 ---------- */
  function isReady() { return state.ready; }
  function isLoggedIn() { return !!(state.ready && state.user); }
  function isAdmin() { return !!(state.profile && state.profile.role === "admin"); }
  function isSuperAdmin() { return !!(state.profile && (state.profile.is_super === true || state.profile.role === "admin")); }
  function profileStatus() { return state.profile ? state.profile.status : ""; }
  var STATUS_TEXT = { pending: "待审核", active: "正常", disabled: "已禁用", rejected: "已驳回" };
  var ROLE_TEXT = { admin: "超级管理员", user: "普通用户" };

  /* ---------- 静态镜像提示条 ---------- */
  function mountBanner() {
    if (state.ready || document.getElementById("cloudFallbackBanner")) return;
    var bar = document.createElement("div");
    bar.id = "cloudFallbackBanner";
    bar.setAttribute("style", [
      "background:#b45309", "color:#fff", "text-align:center",
      "padding:8px 14px", "font-size:13px", "line-height:1.5"
    ].join(";"));
    bar.innerHTML = "⚠️ 当前为<b>静态镜像</b>：真实用户系统（登录/注册/资料/用户管理）仅在 WorkBuddy 托管域名可用 → " +
      '<a href="' + HOSTED_URL + '" target="_blank" style="color:#fff;text-decoration:underline">打开可用版本</a>';
    document.body.insertBefore(bar, document.body.firstChild);
  }

  /* ---------- 导航用户区 ---------- */
  function mountNav() {
    var actions = document.querySelector(".nav-actions");
    if (!actions) return;
    var dd = actions.querySelector(".dropdown");
    if (!dd) return;
    if (!isLoggedIn()) {
      dd.innerHTML = '<a class="btn btn-line btn-sm" href="login.html">登录</a>' +
        '<a class="btn btn-primary btn-sm" href="register.html" style="margin-left:8px">注册</a>';
      return;
    }
    var btn = dd.querySelector(".nav-user");
    if (!btn) return;
    var p = state.profile;
    var span = btn.querySelector("span");
    var label = p ? (p.nickname || p.name || "我的账号") : "我的账号";
    if (p && p.status === "pending") label += "（审核中）";
    if (span) span.textContent = label;
  }

  /* ---------- 站点身份（品牌 / Hero / 标题跟随登录用户） ---------- */
  var DEFAULT_BRAND = "陈庆棋 · 个人主页";
  function displayName() {
    var p = state.profile;
    return (p && (p.nickname || p.name || "").trim()) || "";
  }
  function setBrandText(brand, text) {
    var logo = brand.querySelector(".nav-logo");
    Array.prototype.slice.call(brand.childNodes).forEach(function (n) {
      if (n !== logo) brand.removeChild(n);
    });
    brand.appendChild(document.createTextNode(text));
  }
  function mountIdentity() {
    var name = isLoggedIn() ? displayName() : "";
    var brand = document.querySelector(".nav-brand");
    if (brand) {
      var logo = brand.querySelector(".nav-logo");
      if (logo) logo.textContent = name ? name.charAt(0) : "陈";
      setBrandText(brand, name ? name + " · 个人主页" : DEFAULT_BRAND);
    }
    var hero = document.getElementById("heroName");
    if (hero) hero.textContent = name || "陈庆棋";
    /* 页脚品牌与版权同样跟随真实账号（兼容所有页面） */
    var fbrand = document.querySelector(".footer-brand");
    if (fbrand) {
      var flogo = fbrand.querySelector(".nav-logo");
      if (flogo) flogo.textContent = name ? name.charAt(0) : "陈";
      var ftext = name ? name + " · 个人主页" : DEFAULT_BRAND;
      var fspan = fbrand.querySelector("[data-site-brand]");
      if (fspan) fspan.textContent = ftext;
      else {
        Array.prototype.slice.call(fbrand.childNodes).forEach(function (n) {
          if (n !== flogo && n.nodeType === 3) fbrand.removeChild(n);
        });
        fbrand.appendChild(document.createTextNode(ftext));
      }
    }
    document.querySelectorAll("[data-site-copyright], .copyright span").forEach(function (s) {
      if (name && s.textContent.indexOf("陈庆棋") > -1) {
        s.textContent = s.textContent.replace("陈庆棋 · 个人主页", name + " · 个人主页");
      }
    });
    /* 标题中的站点名跟随真实账号（任意位置，替换后不再含默认名，避免重复拼接） */
    if (name && document.title.indexOf("陈庆棋") > -1) {
      document.title = document.title.replace(/陈庆棋\s*(?:·\s*个人主页)?/g, function (m) {
        return m.indexOf("·") > -1 ? name + " · 个人主页" : name;
      });
    }
  }
  listeners.push(mountIdentity);

  /* ---------- 云端菜单 / 按钮：导航与首页按钮区实时渲染 ---------- */
  function menuEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  /** 云端路径 /dashboard、/index#about -> 站内可点链接 */
  function menuHref(path) {
    var p = String(path || "").trim();
    if (!p) return "#";
    if (p.charAt(0) === "#") return p;
    p = p.replace(/^\//, "");
    var hash = "";
    var hi = p.indexOf("#");
    if (hi > -1) { hash = p.slice(hi); p = p.slice(0, hi); }
    if (!p) return "#";
    if (!/\.html$/i.test(p)) p = p + ".html";
    return p + hash;
  }
  function currentPage() {
    return (location.pathname.split("/").pop() || "index.html").toLowerCase();
  }
  function renderMenus(list) {
    var nav = document.querySelector(".nav-links");
    var hero = document.getElementById("heroBtns");
    var cur = currentPage();
    var tops = (list || []).filter(function (m) {
      return m.parent_id === 0 && m.visible && (m.mtype === "目录" || m.mtype === "菜单");
    }).sort(function (a, b) { return (a.sort_no || 0) - (b.sort_no || 0); });
    if (nav) {
      var html = tops.map(function (m) {
        var href = menuHref(m.path);
        var kids = [];
        if (m.mtype === "目录") {
          kids = (list || []).filter(function (x) {
            return x.parent_id === m.id && x.visible && x.mtype === "菜单";
          }).sort(function (a, b) { return (a.sort_no || 0) - (b.sort_no || 0); });
          if (kids.length) href = menuHref(kids[0].path);
        }
        var hit = href.indexOf("#") === -1 && href.toLowerCase() === cur;
        if (m.mtype === "目录" && kids.length) {
          hit = kids.some(function (k) { return menuHref(k.path).toLowerCase() === cur; });
        }
        return '<a href="' + menuEsc(href) + '"' + (hit ? ' class="active"' : "") + ">" + menuEsc(m.name) + "</a>";
      }).join("");
      if (html) nav.innerHTML = html;
    }
    if (hero) {
      var btns = (list || []).filter(function (m) {
        return m.mtype === "按钮" && m.visible;
      }).sort(function (a, b) { return (a.sort_no || 0) - (b.sort_no || 0); });
      if (btns.length) {
        hero.innerHTML = btns.map(function (m, i) {
          return '<a class="btn ' + (i === 0 ? "btn-primary" : "btn-line") +
            ' btn-lg" href="' + menuEsc(menuHref(m.path)) + '">' +
            (m.icon ? menuEsc(m.icon) + " " : "") + menuEsc(m.name) + "</a>";
        }).join("");
      }
    }
  }
  /** 项目展示：菜单表里 mtype='项目' 的记录渲染成首页卡片，可后台自由增删 */
  function renderProjects(list) {
    var grid = document.getElementById("projectGrid");
    if (!grid) return;
    var items = (list || []).filter(function (m) {
      return m.mtype === "项目" && m.visible;
    }).sort(function (a, b) { return (a.sort_no || 0) - (b.sort_no || 0); });
    if (!items.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="ico">📦</div>还没有项目，到「系统管理 → 菜单管理」新增「项目」类型记录即可显示</div>';
      return;
    }
    grid.innerHTML = items.map(function (m) {
      return '<a class="card project-card" href="' + menuEsc(menuHref(m.path)) + '"><div class="card-bd">' +
        '<div class="project-tag">' + menuEsc(m.icon || "📌 项目") + "</div>" +
        "<h3>" + menuEsc(m.name) + "</h3>" +
        '<p class="text-2 mt-8">' + menuEsc(m.summary || "暂无简介，可在菜单管理中补充") + "</p>" +
        '<span class="btn-link project-more">查看项目 →</span></div></a>';
    }).join("");
  }
  /** 菜单管理里增删改/显隐后由 emit 自动重渲染，无需刷新页面 */
  async function mountMenus() {
    var nav = document.querySelector(".nav-links");
    var hero = document.getElementById("heroBtns");
    var grid = document.getElementById("projectGrid");
    if (!nav && !hero && !grid) return;
    if (!state.ready || !state.user) return; /* 未登录 / 静态镜像保留页面自带导航 */
    var res = await tableList("site_menus", { order: "sort_no", asc: true });
    if (res.error || !res.data || !res.data.length) return;
    renderMenus(res.data);
    renderProjects(res.data);
  }
  listeners.push(mountMenus);

  /* ---------- 对外接口 ---------- */
  var Cloud = {
    state: state,
    init: init,
    restore: restore,
    onChange: function (fn) { listeners.push(fn); },
    isReady: isReady,
    unavailableText: unavailableText,
    isLoggedIn: isLoggedIn,
    isAdmin: isAdmin,
    isSuperAdmin: isSuperAdmin,
    profileStatus: profileStatus,
    /** 底层 SDK 客户端（storage 等模块用）；未就绪返回 null */
    client: function () { return state.ready ? cloud : null; },
    STATUS_TEXT: STATUS_TEXT,
    ROLE_TEXT: ROLE_TEXT,
    loadProfile: loadProfile,
    saveMyProfile: saveMyProfile,
    listProfiles: listProfiles,
    updateProfile: updateProfile,
    deleteProfile: deleteProfile,
    tableList: tableList,
    tableInsert: tableInsert,
    tableUpdate: tableUpdate,
    tableRemove: tableRemove,
    tableClear: tableClear,
    logAction: logAction,
    listParams: listParams,
    saveParam: saveParam,
    deleteParam: deleteParam,
    listTimeline: listTimeline,
    saveTimeline: saveTimeline,
    renderTimeline: renderTimeline,
    applyHomeParams: applyHomeParams,
    mountMenus: mountMenus,
    sendPhoneCode: sendPhoneCode,
    sendEmailCode: sendEmailCode,
    loginWithPhone: loginWithPhone,
    loginWithEmail: loginWithEmail,
    register: register,
    signInWithWechat: signInWithWechat,
    signOut: signOut,
    validPhone: validPhone,
    validEmail: validEmail,
    mountBanner: mountBanner,
    mountNav: mountNav
  };
  window.Cloud = Cloud;

  /* ---------- 自动启动 ---------- */
  init();
  mountBanner();
  mountNav();
  mountIdentity();
  restore().then(function () { mountNav(); mountIdentity(); mountMenus(); });
})();
