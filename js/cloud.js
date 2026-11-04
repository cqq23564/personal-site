/* =====================================================================
 * cloud.js — 云服务数据层（认证 + profiles 用户资料表）
 * 依赖：js/cloud-config.js（window.CLOUD_CONFIG）
 *       SDK CDN：@tencent-ai/workbuddy-cloud-sdk@dev（window.WorkBuddyCloud）
 *
 * 域名边界：云服务按 Origin 精确匹配，仅在 WorkBuddy 托管域名下可用。
 * 其他域名（GitHub Pages / Cloudflare Pages / localhost）自动进入演示模式：
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
    ["pname", "pkey", "pvalue", "unit", "pgroup", "remark"].forEach(function (k) {
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

  /**
   * 首页数据联动：把 site_params 中 home.* 参数应用到页面 [data-param] 元素。
   * 仅 index.html 挂了钩；未登录 / 无对应参数时保留页面默认值，不静默改写。
   */
  async function applyHomeParams() {
    if (!state.ready || !state.user) return;
    if (!document.querySelector("[data-param]")) return;
    var res = homeParamsCache ? { data: homeParamsCache } : await listParams();
    if (!res || res.error) return;
    var map = {};
    (res.data || []).forEach(function (p) { map[p.pkey] = p.pvalue; });
    document.querySelectorAll("[data-param]").forEach(function (el) {
      var k = el.getAttribute("data-param");
      var v = map[k];
      if (v === undefined || v === null || v === "") return;
      v = String(v);
      if (el.hasAttribute("data-count")) {
        var num = v.replace(/[^\d.-]/g, "");
        el.setAttribute("data-count", num);
        /* 重新播放一次数字动画到新值（main.js 的 animateCount 从 0 计到 target） */
        if (window.App && typeof window.App.animateCount === "function") window.App.animateCount(el);
        else el.textContent = Number(num).toLocaleString("zh-CN");
      } else if (k === "home.hero.desc") {
        el.innerHTML = v.replace(/\n/g, "<br>");
      } else {
        el.textContent = v;
      }
    });
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
  function profileStatus() { return state.profile ? state.profile.status : ""; }
  var STATUS_TEXT = { pending: "待审核", active: "正常", disabled: "已禁用", rejected: "已驳回" };
  var ROLE_TEXT = { admin: "系统管理员", user: "普通用户" };

  /* ---------- 演示模式提示条 ---------- */
  function mountBanner() {
    if (state.ready || document.getElementById("cloudFallbackBanner")) return;
    var bar = document.createElement("div");
    bar.id = "cloudFallbackBanner";
    bar.setAttribute("style", [
      "background:#b45309", "color:#fff", "text-align:center",
      "padding:8px 14px", "font-size:13px", "line-height:1.5"
    ].join(";"));
    bar.innerHTML = "⚠️ 当前为<b>演示模式</b>：真实用户系统（登录/注册/资料/用户管理）仅在 WorkBuddy 托管域名可用 → " +
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
  var DEFAULT_BRAND = "林运维 · 个人主页";
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
      if (logo) logo.textContent = name ? name.charAt(0) : "林";
      setBrandText(brand, name ? name + " · 个人主页" : DEFAULT_BRAND);
    }
    var hero = document.getElementById("heroName");
    if (hero) hero.textContent = name || "林运维";
    /* 标题前缀替换（仅替换一次，避免重复拼接） */
    if (name && document.title.indexOf("林运维") === 0) {
      document.title = name + document.title.slice(3);
    }
  }
  listeners.push(mountIdentity);

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
    applyHomeParams: applyHomeParams,
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
  restore().then(function () { mountNav(); mountIdentity(); });
})();
