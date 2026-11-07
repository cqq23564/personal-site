/* ============================================================
 * main.js — 全站交互脚本（零依赖）
 * 模块：工具 / 导航 / 轮播 / 滚动显现 / 数字动画 / 表格引擎 /
 *      Tabs / 弹窗 / 表单校验 / 图表 / 园区示意图 / 文件管理
 * ============================================================ */
(function () {
  "use strict";

  /* ================= 主题（尽早同步应用，避免首屏闪白） ================= */
  var THEME_KEY = "site-theme";
  var rootEl = document.documentElement;
  function systemDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function storedTheme() {
    try { return window.localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function currentTheme() {
    return rootEl.getAttribute("data-theme") || (systemDark() ? "dark" : "light");
  }
  function syncThemeUI() {
    var dark = currentTheme() === "dark";
    var label = dark ? "切换到浅色主题" : "切换到深色主题";
    Array.prototype.forEach.call(document.querySelectorAll(".theme-toggle"), function (b) {
      b.textContent = dark ? "☀️" : "🌙";
      b.setAttribute("aria-pressed", String(dark));
      b.setAttribute("aria-label", label);
      b.title = label;
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0b1120" : "#f4f6fb");
  }
  function applyTheme(theme, persist) {
    var t = theme === "dark" || theme === "light" ? theme : (systemDark() ? "dark" : "light");
    rootEl.setAttribute("data-theme", t);
    if (persist) { try { window.localStorage.setItem(THEME_KEY, t); } catch (e) {} }
    syncThemeUI();
    return t;
  }
  /* 立即应用：用户记录 > HTML 显式声明 > 系统偏好 */
  var initialTheme = storedTheme() || rootEl.getAttribute("data-theme");
  applyTheme(initialTheme, false);

  /* ================= 工具 ================= */
  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => Array.from((p || document).querySelectorAll(s));

  function toast(msg, type) {
    let wrap = $(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    const t = document.createElement("div");
    t.className = "toast " + (type || "");
    const icon = { ok: "✅", err: "❌", warn: "⚠️" }[type] || "💬";
    t.innerHTML = `<span>${icon}</span><span></span>`;
    $("span:last-child", t).textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.classList.add("hide"); setTimeout(() => t.remove(), 260); }, 2600);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function exportCSV(filename, headers, rows) {
    const csv = [headers.join(",")]
      .concat(rows.map(r => r.map(c => {
        const v = c == null ? "" : String(c);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      })))
      .join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast(`已导出 ${filename}`, "ok");
  }

  function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  /* ================= 全局增强：主题切换 / 跳转链接 / 返回顶部 ================= */
  function initTheme() {
    /* theme-color：让移动端浏览器地址栏跟随主题 */
    if (!document.querySelector('meta[name="theme-color"]')) {
      var meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = "#f4f6fb";
      (document.head || document.documentElement).appendChild(meta);
    }
    syncThemeUI();

    var actions = document.querySelector(".nav-actions");
    if (actions && !actions.querySelector(".theme-toggle")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-toggle";
      btn.addEventListener("click", function () {
        var next = currentTheme() === "dark" ? "light" : "dark";
        applyTheme(next, true);
        toast(next === "dark" ? "已切换到深色主题" : "已切换到浅色主题", "ok");
      });
      var dd = actions.querySelector(".dropdown");
      if (dd) actions.insertBefore(btn, dd);
      else actions.appendChild(btn);
      syncThemeUI();
    }

    /* 用户未手动选择时，跟随系统主题实时变化 */
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function (e) {
        if (storedTheme()) return;
        applyTheme(e.matches ? "dark" : "light", false);
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  function initSkipLink() {
    if (document.querySelector(".skip-link")) return;
    var main = document.querySelector("main") ||
               document.querySelector(".main") ||
               document.querySelector(".hero") ||
               document.querySelector("section");
    var targetId = "main-content";
    if (main) {
      targetId = main.id || "main-content";
      if (!main.id) main.id = targetId;
      main.setAttribute("tabindex", "-1");
    }
    var a = document.createElement("a");
    a.className = "skip-link";
    a.href = "#" + targetId;
    a.textContent = "跳到主要内容";
    document.body.insertBefore(a, document.body.firstChild);
  }

  function initBackToTop() {
    if (document.querySelector(".back-to-top")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "back-to-top";
    btn.setAttribute("aria-label", "返回顶部");
    btn.title = "返回顶部";
    btn.textContent = "↑";
    document.body.appendChild(btn);
    var onScroll = function () {
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      btn.classList.toggle("show", y > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
    });
  }

  /* ================= 导航 ================= */
  function initNav() {
    const burger = $(".hamburger"), links = $(".nav-links");
    if (burger && links) {
      links.id = links.id || "primary-nav";
      links.setAttribute("aria-label", "主导航");
      burger.setAttribute("aria-controls", links.id);
      burger.setAttribute("aria-expanded", "false");
      burger.setAttribute("aria-label", "展开导航菜单");
      burger.addEventListener("click", () => {
        const open = links.classList.toggle("open");
        burger.setAttribute("aria-expanded", String(open));
        burger.setAttribute("aria-label", open ? "收起导航菜单" : "展开导航菜单");
      });
      links.addEventListener("click", e => {
        if (e.target.closest("a") && links.classList.contains("open")) {
          links.classList.remove("open");
          burger.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && links.classList.contains("open")) {
          links.classList.remove("open");
          burger.setAttribute("aria-expanded", "false");
        }
      });
    }

    // 当前页高亮
    const page = location.pathname.split("/").pop() || "index.html";
    $$(".nav-links > a").forEach(a => {
      const href = a.getAttribute("href") || "";
      if (href === page || (page === "" && href === "index.html")) a.classList.add("active");
    });

    // 用户下拉
    $$(".dropdown").forEach(dd => {
      const trigger = $(".nav-user, .dropdown-trigger", dd);
      if (!trigger) return;
      trigger.addEventListener("click", e => {
        e.stopPropagation();
        $$(".dropdown").forEach(d => d !== dd && d.classList.remove("open"));
        dd.classList.toggle("open");
      });
    });
    document.addEventListener("click", () => $$(".dropdown").forEach(d => d.classList.remove("open")));

    // 顶部搜索
    const search = $("#navSearch");
    if (search) {
      search.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          const v = search.value.trim();
          if (!v) return toast("请输入搜索关键词", "warn");
          location.href = "query-vehicles.html?kw=" + encodeURIComponent(v);
        }
      });
    }
  }

  /* ================= 轮播图 ================= */
  function initCarousel() {
    $$(".carousel").forEach(car => {
      const track = $(".carousel-track", car);
      const slides = $$(".slide", car);
      const dotsBox = $(".carousel-dots", car);
      if (!track || slides.length === 0) return;
      let idx = 0, timer = null;

      slides.forEach((_, i) => {
        const b = document.createElement("button");
        b.addEventListener("click", () => go(i));
        dotsBox && dotsBox.appendChild(b);
      });
      const dots = $$("button", dotsBox);

      function go(i) {
        idx = (i + slides.length) % slides.length;
        track.style.transform = `translateX(-${idx * 100}%)`;
        dots.forEach((d, j) => d.classList.toggle("active", j === idx));
      }
      function auto() { timer = setInterval(() => go(idx + 1), 4500); }
      function stop() { clearInterval(timer); }

      $(".prev", car) && $(".prev", car).addEventListener("click", () => { go(idx - 1); stop(); auto(); });
      $(".next", car) && $(".next", car).addEventListener("click", () => { go(idx + 1); stop(); auto(); });
      car.addEventListener("mouseenter", stop);
      car.addEventListener("mouseleave", auto);
      go(0); auto();
    });
  }

  /* ================= 滚动显现 ================= */
  function initReveal() {
    const els = $$(".reveal");
    if (!els.length) return;
    /* 视口内的元素直接显示（兜底：截图 / 打印 / 爬虫场景 IO 可能不触发） */
    const markInView = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      els.forEach(el => {
        if (el.classList.contains("in")) return;
        const r = el.getBoundingClientRect();
        if (r.top < vh - 40 && r.bottom > 0) el.classList.add("in");
      });
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
      }, { threshold: 0.12 });
      els.forEach(el => io.observe(el));
    } else {
      els.forEach(el => el.classList.add("in"));
    }
    window.addEventListener("load", markInView);
    window.addEventListener("scroll", markInView, { passive: true });
    setTimeout(markInView, 600);
  }

  /* ================= 数字动画 ================= */
  function animateCount(el) {
    const target = Number(el.dataset.count || 0);
    const dur = 900, t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString("zh-CN");
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function initCounters() {
    const els = $$("[data-count]");
    if (!els.length) return;
    const done = new WeakSet();
    const run = el => { if (done.has(el)) return; done.add(el); animateCount(el); };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } });
      }, { threshold: 0.4 });
      els.forEach(el => io.observe(el));
    } else {
      els.forEach(run);
    }
    /* 兜底：截图 / 打印 / IO 未触发时，不能让统计数字停留在 0 */
    setTimeout(() => {
      els.forEach(el => {
        if (done.has(el)) return;
        done.add(el);
        const target = Number(el.dataset.count || 0);
        el.textContent = target.toLocaleString("zh-CN");
      });
    }, 1600);
  }

  /* ================= Tabs ================= */
  function initTabs() {
    $$(".tabs").forEach(tabs => {
      const scope = tabs.closest("[data-tabs-scope]") || document;
      $$(".tab", tabs).forEach(tab => {
        tab.addEventListener("click", () => {
          $$(".tab", tabs).forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          const name = tab.dataset.tab;
          $$("[data-tab-pane]", scope).forEach(p => p.classList.toggle("hidden", p.dataset.tabPane !== name));
        });
      });
    });
  }

  /* ================= 弹窗 ================= */
  function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add("show"); }
  function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove("show"); }
  function initModal() {
    $$("[data-modal-open]").forEach(btn =>
      btn.addEventListener("click", () => openModal(btn.dataset.modalOpen)));
    $$(".modal-mask").forEach(mask => {
      mask.addEventListener("click", e => { if (e.target === mask) mask.classList.remove("show"); });
      $$("[data-modal-close]", mask).forEach(b => b.addEventListener("click", () => mask.classList.remove("show")));
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") $$(".modal-mask.show").forEach(m => m.classList.remove("show"));
    });
  }

  /* ================= 表单校验 ================= */
  function validateField(input) {
    const rules = (input.dataset.rule || "").split("|").filter(Boolean);
    const v = input.value.trim();
    const msgEl = input.closest(".field") ? $(".field-msg", input.closest(".field")) : null;
    let msg = "";
    for (const rule of rules) {
      if (rule === "required" && !v) { msg = "此项为必填"; break; }
      if (rule.startsWith("min:")) {
        const n = Number(rule.slice(4));
        if (v.length < n) { msg = `长度不能少于 ${n} 位`; break; }
      }
      if (rule === "phone" && v && !/^1[3-9]\d{9}$/.test(v)) { msg = "请输入正确的手机号"; break; }
      if (rule === "email" && v && !/^[\w.-]+@[\w.-]+\.\w+$/.test(v)) { msg = "请输入正确的邮箱"; break; }
      if (rule === "account" && v && !/^[a-zA-Z][a-zA-Z0-9_]{3,15}$/.test(v)) { msg = "字母开头，4-16 位字母数字下划线"; break; }
      if (rule === "pwd" && v && !/^(?=.*[A-Za-z])(?=.*\d).{6,18}$/.test(v)) { msg = "6-18 位，须同时包含字母和数字"; break; }
      if (rule === "captcha" && v && v.length !== 4) { msg = "请输入 4 位验证码"; break; }
    }
    if (msgEl) { msgEl.textContent = msg; msgEl.className = "field-msg" + (msg ? "" : " ok"); if (!msg && v) msgEl.textContent = "✓ 格式正确"; }
    input.classList.toggle("err", Boolean(msg));
    return !msg;
  }
  function initForms() {
    $$("[data-rule]").forEach(input => {
      input.addEventListener("blur", () => validateField(input));
      input.addEventListener("input", () => { if (input.classList.contains("err")) validateField(input); });
    });
    $$("form[data-validate]").forEach(form => {
      form.addEventListener("submit", e => {
        e.preventDefault();
        const inputs = $$("[data-rule]", form);
        const ok = inputs.map(validateField).every(Boolean);
        if (!ok) return toast("请检查表单填写", "err");
        const done = form.dataset.done || "提交成功";
        toast(done, "ok");
        const btn = $("button[type=submit]", form);
        if (btn) { btn.disabled = true; setTimeout(() => btn.disabled = false, 1500); }
      });
    });
    // 验证码刷新
    $$(".captcha-img").forEach(cap => {
      cap.addEventListener("click", () => {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code = "";
        for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
        cap.textContent = code;
        cap.style.color = `hsl(${Math.floor(Math.random() * 360)},65%,42%)`;
        toast("验证码已刷新");
      });
    });
  }

  /* ================= 表格引擎 ================= */
  class DataTable {
    /**
     * @param {Object} opt
     *   el         表格容器选择器（内含 thead/tbody 由引擎生成）
     *   data       数据数组
     *   columns    [{key,title,sortable,render,cls,align}]
     *   searchKeys 参与关键字搜索的字段
     *   filters    [{el, key, value}]  外部 select/输入框
     *   pageSize   每页条数
     *   pager      分页容器选择器
     *   selectable 是否显示复选框列（按 id 或第一条 key）
     *   onSelect   选择变化回调
     *   emptyText  空数据文案
     */
    constructor(opt) {
      this.opt = Object.assign({ pageSize: 8, emptyText: "暂无数据" }, opt);
      this.el = typeof opt.el === "string" ? $(opt.el) : opt.el;
      this.pagerEl = opt.pager ? (typeof opt.pager === "string" ? $(opt.pager) : opt.pager) : null;
      this.keyword = "";
      this.filters = {};
      this.sortKey = null;
      this.sortAsc = true;
      this.page = 1;
      this.selected = new Set();
      (opt.filters || []).forEach(f => {
        this.filters[f.key] = f.value || "";
        const el = typeof f.el === "string" ? $(f.el) : f.el;
        if (el) el.addEventListener("input", () => { this.filters[f.key] = el.value; this.page = 1; this.render(); });
        if (el) el.addEventListener("change", () => { this.filters[f.key] = el.value; this.page = 1; this.render(); });
      });
      const kw = typeof opt.keywordEl === "string" ? $(opt.keywordEl) : opt.keywordEl;
      if (kw) {
        kw.addEventListener("input", () => { this.keyword = kw.value.trim().toLowerCase(); this.page = 1; this.render(); });
        // 支持 URL ?kw= 预填
        const q = new URLSearchParams(location.search).get("kw");
        if (q) { kw.value = q; this.keyword = q.toLowerCase(); }
      }
      this.render();
    }
    get filtered() {
      let rows = this.opt.data.slice();
      const kw = this.keyword;
      if (kw) {
        const keys = this.opt.searchKeys || [];
        rows = rows.filter(r => keys.some(k => String(r[k] ?? "").toLowerCase().includes(kw)));
      }
      for (const [k, v] of Object.entries(this.filters)) {
        if (v) rows = rows.filter(r => String(r[k]) === v);
      }
      if (this.sortKey) {
        const k = this.sortKey, asc = this.sortAsc;
        rows.sort((a, b) => {
          const x = a[k], y = b[k];
          const nx = parseFloat(x), ny = parseFloat(y);
          const cmp = (!isNaN(nx) && !isNaN(ny) && String(x).match(/^[\d.\-]+$/))
            ? nx - ny : String(x ?? "").localeCompare(String(y ?? ""), "zh");
          return asc ? cmp : -cmp;
        });
      }
      return rows;
    }
    render() {
      const o = this.opt;
      const rows = this.filtered;
      const total = rows.length;
      const pages = Math.max(1, Math.ceil(total / o.pageSize));
      if (this.page > pages) this.page = pages;
      const start = (this.page - 1) * o.pageSize;
      const pageRows = rows.slice(start, start + o.pageSize);

      // 表头
      let head = "<tr>";
      if (o.selectable) head += `<th class="check-col"><input type="checkbox" data-checkall title="全选"></th>`;
      o.columns.forEach(c => {
        const arrow = this.sortKey === c.key ? (this.sortAsc ? "▲" : "▼") : "⇅";
        head += `<th class="${c.sortable ? "sortable" : ""} ${c.align === "right" ? "num" : ""}" data-sort="${c.sortable ? c.key : ""}">${esc(c.title)}${c.sortable ? `<span class="arrow">${arrow}</span>` : ""}</th>`;
      });
      head += "</tr>";

      // 表体
      let body = "";
      if (pageRows.length === 0) {
        body = `<tr class="empty-row"><td colspan="${o.columns.length + (o.selectable ? 1 : 0)}">${esc(o.emptyText)}</td></tr>`;
      } else {
        pageRows.forEach(r => {
          const rowKey = String(o.rowKey ? r[o.rowKey] : r[o.columns[0].key]);
          body += "<tr>";
          if (o.selectable) body += `<td><input type="checkbox" data-check="${esc(rowKey)}" ${this.selected.has(rowKey) ? "checked" : ""}></td>`;
          o.columns.forEach(c => {
            const v = r[c.key];
            const content = c.render ? c.render(v, r) : esc(v);
            body += `<td class="${c.cls || ""} ${c.align === "right" ? "num" : ""} ${c.wrap ? "wrap-cell" : ""}">${content}</td>`;
          });
          body += "</tr>";
        });
      }

      this.el.innerHTML = `<table class="table"><thead>${head}</thead><tbody>${body}</tbody></table>`;

      // 排序事件
      $$("th.sortable", this.el).forEach(th => th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (this.sortKey === k) this.sortAsc = !this.sortAsc;
        else { this.sortKey = k; this.sortAsc = true; }
        this.render();
      }));

      // 选择事件
      if (o.selectable) {
        const all = $("[data-checkall]", this.el);
        if (all) {
          all.checked = pageRows.length > 0 && pageRows.every(r => this.selected.has(String(o.rowKey ? r[o.rowKey] : r[o.columns[0].key])));
          all.addEventListener("change", () => {
            pageRows.forEach(r => {
              const k = String(o.rowKey ? r[o.rowKey] : r[o.columns[0].key]);
              all.checked ? this.selected.add(k) : this.selected.delete(k);
            });
            this.render();
            o.onSelect && o.onSelect([...this.selected]);
          });
        }
        $$("[data-check]", this.el).forEach(cb => cb.addEventListener("change", () => {
          cb.checked ? this.selected.add(cb.dataset.check) : this.selected.delete(cb.dataset.check);
          o.onSelect && o.onSelect([...this.selected]);
          this.render();
        }));
      }

      // 分页
      if (this.pagerEl) this.renderPager(total, pages, start, pageRows.length);
    }
    renderPager(total, pages, start, shown) {
      const p = this.pagerEl;
      const btn = (label, page, opts = {}) =>
        `<button ${opts.active ? 'class="active"' : ""} ${opts.disabled ? "disabled" : ""} data-page="${page}">${label}</button>`;
      let html = "";
      html += btn("‹", this.page - 1, { disabled: this.page <= 1 });
      const add = (n) => html += btn(n, n, { active: n === this.page });
      if (pages <= 7) { for (let i = 1; i <= pages; i++) add(i); }
      else {
        add(1);
        if (this.page > 3) html += `<span class="ellipsis">…</span>`;
        for (let i = Math.max(2, this.page - 1); i <= Math.min(pages - 1, this.page + 1); i++) add(i);
        if (this.page < pages - 2) html += `<span class="ellipsis">…</span>`;
        add(pages);
      }
      html += btn("›", this.page + 1, { disabled: this.page >= pages });
      p.innerHTML = `<div class="pagination">${html}</div>`;
      $$("button[data-page]", p).forEach(b => b.addEventListener("click", () => {
        const n = Number(b.dataset.page);
        if (n >= 1 && n <= pages && n !== this.page) { this.page = n; this.render(); }
      }));
      const footer = p.closest(".table-footer");
      if (footer) {
        const totalEl = $(".total", footer);
        if (totalEl) totalEl.textContent = `共 ${total} 条，当前第 ${this.page}/${pages} 页`;
      }
    }
    selectedRows() {
      return this.filtered.filter(r => this.selected.has(String(this.opt.rowKey ? r[this.opt.rowKey] : r[this.opt.columns[0].key])));
    }
    clearSelected() { this.selected.clear(); this.render(); }
    /** 替换数据源并重新渲染（用于云端数据加载后刷新） */
    setData(data) { this.opt.data = Array.isArray(data) ? data : []; this.page = 1; this.render(); }
    /** 当前过滤/排序后的全部行 */
    rows() { return this.filtered; }
    /** 当前过滤后的总行数 */
    get total() { return this.filtered.length; }
  }

  /* ================= 图表（纯 SVG） ================= */
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function renderLineChart(container, opt) {
    const box = typeof container === "string" ? $(container) : container;
    if (!box) return;
    const W = 720, H = 260, padL = 46, padR = 16, padT = 18, padB = 34;
    const labels = opt.labels, series = opt.series;
    const maxV = Math.max(...series.flatMap(s => s.data)) * 1.15;
    const iw = W - padL - padR, ih = H - padT - padB;
    const x = i => padL + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
    const y = v => padT + ih - (v / maxV) * ih;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });

    // 网格与坐标
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV / ticks) * i, yy = y(v);
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: "#e8edf6", "stroke-width": 1 }));
      const t = svgEl("text", { x: padL - 8, y: yy + 4, "text-anchor": "end", "font-size": 11, fill: "#94a3b8" });
      t.textContent = v >= 10000 ? (v / 10000).toFixed(1) + "万" : Math.round(v);
      svg.appendChild(t);
    }
    labels.forEach((lb, i) => {
      if (labels.length > 12 && i % Math.ceil(labels.length / 10) !== 0) return;
      const t = svgEl("text", { x: x(i), y: H - 10, "text-anchor": "middle", "font-size": 10.5, fill: "#94a3b8" });
      t.textContent = lb;
      svg.appendChild(t);
    });

    // 折线 + 面积 + 数据点
    series.forEach(s => {
      const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
      if (s.area) {
        const areaPts = `${padL},${padT + ih} ${pts} ${x(s.data.length - 1)},${padT + ih}`;
        const grad = svgEl("linearGradient", { id: "g_" + s.name, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": s.color, "stop-opacity": 0.28 }));
        grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": s.color, "stop-opacity": 0.02 }));
        const defs = svgEl("defs", {}); defs.appendChild(grad); svg.appendChild(defs);
        svg.appendChild(svgEl("polygon", { points: areaPts, fill: `url(#g_${s.name})` }));
      }
      svg.appendChild(svgEl("polyline", { points: pts, fill: "none", stroke: s.color, "stroke-width": 2.4, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      s.data.forEach((v, i) => {
        const c = svgEl("circle", { cx: x(i), cy: y(v), r: 3, fill: "#fff", stroke: s.color, "stroke-width": 2 });
        const title = svgEl("title", {});
        title.textContent = `${labels[i]} ${s.name}: ${v}`;
        c.appendChild(title);
        c.addEventListener("mouseenter", () => c.setAttribute("r", 5));
        c.addEventListener("mouseleave", () => c.setAttribute("r", 3));
        svg.appendChild(c);
      });
    });
    box.innerHTML = "";
    box.appendChild(svg);

    if (opt.legend !== false) {
      const lg = document.createElement("div");
      lg.className = "legend";
      lg.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
      box.appendChild(lg);
    }
  }

  function renderBarChart(container, opt) {
    const box = typeof container === "string" ? $(container) : container;
    if (!box) return;
    const W = 720, H = 240, padL = 40, padR = 12, padT = 14, padB = 30;
    const labels = opt.labels, series = opt.series;
    const maxV = Math.max(...series.flatMap(s => s.data)) * 1.15;
    const iw = W - padL - padR, ih = H - padT - padB;
    const groupW = iw / labels.length;
    const barW = Math.max(4, (groupW - 10) / series.length - 3);
    const y = v => padT + ih - (v / maxV) * ih;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` });
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i, yy = y(v);
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: "#e8edf6" }));
      const t = svgEl("text", { x: padL - 6, y: yy + 4, "text-anchor": "end", "font-size": 11, fill: "#94a3b8" });
      t.textContent = Math.round(v);
      svg.appendChild(t);
    }
    labels.forEach((lb, i) => {
      const gx = padL + i * groupW;
      series.forEach((s, j) => {
        const bx = gx + (groupW - barW * series.length - 3 * (series.length - 1)) / 2 + j * (barW + 3);
        const by = y(s.data[i]);
        const r = svgEl("rect", { x: bx, y: by, width: barW, height: padT + ih - by, rx: 3, fill: s.color });
        const title = svgEl("title", {});
        title.textContent = `${lb} ${s.name}: ${s.data[i]}`;
        r.appendChild(title);
        svg.appendChild(r);
      });
      const t = svgEl("text", { x: gx + groupW / 2, y: H - 9, "text-anchor": "middle", "font-size": 10.5, fill: "#94a3b8" });
      t.textContent = lb;
      svg.appendChild(t);
    });
    box.innerHTML = "";
    box.appendChild(svg);
    if (opt.legend !== false) {
      const lg = document.createElement("div");
      lg.className = "legend";
      lg.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
      box.appendChild(lg);
    }
  }

  function renderDonut(container, items, opts) {
    opts = opts || {};
    const unit = opts.unit || "%";
    const label = opts.label || "占比";
    const box = typeof container === "string" ? $(container) : container;
    if (!box) return;
    const size = 220, cx = size / 2, cy = size / 2, r = 78, sw = 30;
    const total = items.reduce((a, b) => a + b.value, 0);
    const svg = svgEl("svg", { viewBox: `0 0 ${size} ${size}` });
    let angle = -Math.PI / 2;
    items.forEach(it => {
      const frac = it.value / total;
      const a2 = angle + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const p = svgEl("path", {
        d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
        fill: "none", stroke: it.color, "stroke-width": sw, "stroke-linecap": "butt"
      });
      const pct = (frac * 100).toFixed(1);
      const title = svgEl("title", {});
      title.textContent = `${it.name}: ${it.value}${unit === "%" ? "%" : " " + unit}（${pct}%）`;
      p.appendChild(title);
      p.addEventListener("mouseenter", () => p.setAttribute("stroke-width", sw + 6));
      p.addEventListener("mouseleave", () => p.setAttribute("stroke-width", sw));
      svg.appendChild(p);
      angle = a2;
    });
    const t1 = svgEl("text", { x: cx, y: cy - 2, "text-anchor": "middle", "font-size": 22, "font-weight": 800, fill: "#1e293b" });
    t1.textContent = unit === "%" ? total + "%" : total + " " + unit;
    const t2 = svgEl("text", { x: cx, y: cy + 18, "text-anchor": "middle", "font-size": 11, fill: "#94a3b8" });
    t2.textContent = label;
    svg.appendChild(t1); svg.appendChild(t2);
    box.innerHTML = "";
    box.appendChild(svg);
    const lg = document.createElement("div");
    lg.className = "legend";
    lg.innerHTML = items.map(it => {
      const pct = (it.value / total * 100).toFixed(0);
      const txt = unit === "%" ? `${it.value}%` : `${pct}% · ${it.value}${unit}`;
      return `<span><i style="background:${it.color}"></i>${esc(it.name)} ${txt}</span>`;
    }).join("");
    box.appendChild(lg);
  }

  /* ================= 园区平面示意图 ================= */
  function renderParkMap(container, markers) {
    const box = typeof container === "string" ? $(container) : container;
    if (!box) return;
    const W = 760, H = 420;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` });
    // 背景
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#0e1a33" }));
    // 网格
    for (let x = 0; x <= W; x += 38) svg.appendChild(svgEl("line", { x1: x, x2: x, y1: 0, y2: H, stroke: "rgba(255,255,255,0.045)" }));
    for (let y = 0; y <= H; y += 38) svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y, y2: y, stroke: "rgba(255,255,255,0.045)" }));
    // 园区边界
    svg.appendChild(svgEl("rect", { x: 40, y: 30, width: W - 80, height: H - 70, rx: 16, fill: "rgba(59,110,245,0.07)", stroke: "rgba(124,92,255,0.5)", "stroke-width": 1.5, "stroke-dasharray": "7 5" }));
    // 内部道路
    svg.appendChild(svgEl("path", { d: `M 40 210 H ${W - 40}`, stroke: "rgba(255,255,255,0.16)", "stroke-width": 10, "stroke-linecap": "round" }));
    svg.appendChild(svgEl("path", { d: `M 380 30 V ${H - 40}`, stroke: "rgba(255,255,255,0.12)", "stroke-width": 8, "stroke-linecap": "round" }));
    // 区域块
    const blocks = [
      { x: 90, y: 70, w: 120, h: 80, label: "申报大厅" },
      { x: 430, y: 70, w: 150, h: 80, label: "查验场" },
      { x: 90, y: 270, w: 150, h: 90, label: "监管停车场" },
      { x: 430, y: 250, w: 170, h: 110, label: "保税仓库" }
    ];
    blocks.forEach(b => {
      svg.appendChild(svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10, fill: "rgba(255,255,255,0.06)", stroke: "rgba(255,255,255,0.2)" }));
      const t = svgEl("text", { x: b.x + b.w / 2, y: b.y + b.h / 2 + 4, "text-anchor": "middle", "font-size": 12, fill: "rgba(255,255,255,0.75)" });
      t.textContent = b.label;
      svg.appendChild(t);
    });
    // 标题与免责说明
    const cap = svgEl("text", { x: 20, y: H - 12, "font-size": 11, fill: "rgba(255,255,255,0.5)" });
    cap.textContent = "※ 园区平面示意图（非地理底图，仅表示卡口/通道相对位置）";
    svg.appendChild(cap);

    const typeIcon = { gate: "🚪", channel: "🛂", park: "🅿️", yard: "🔍", wh: "📦" };
    markers.forEach(m => {
      const px = (m.x / 100) * (W - 120) + 60, py = (m.y / 100) * (H - 130) + 46;
      const g = svgEl("g", { class: "map-marker", cursor: "pointer" });
      const color = m.status === "warn" ? "#f59e0b" : "#3b6ef5";
      if (m.status === "warn") {
        const pulse = svgEl("circle", { class: "pulse", cx: px, cy: py, r: 6, fill: "none", stroke: color, "stroke-width": 2 });
        g.appendChild(pulse);
      }
      g.appendChild(svgEl("circle", { cx: px, cy: py, r: 13, fill: color, stroke: "#fff", "stroke-width": 2 }));
      const icon = svgEl("text", { x: px, y: py + 4, "text-anchor": "middle", "font-size": 10 });
      icon.textContent = typeIcon[m.type] || "📍";
      g.appendChild(icon);
      const label = svgEl("text", { x: px, y: py - 20, "text-anchor": "middle", "font-size": 11.5, fill: "#fff", "font-weight": 600 });
      label.textContent = m.name;
      g.appendChild(label);
      const tip = svgEl("title", {});
      tip.textContent = `${m.name} · 当前车辆 ${m.count} 辆`;
      g.appendChild(tip);
      g.addEventListener("mouseenter", () => {
        const t = $(".map-tip", box);
        if (t) {
          t.style.display = "block";
          t.style.left = (px / W * 100) + "%";
          t.style.top = (py / H * 100) + "%";
          t.textContent = `${m.name} · ${m.count} 辆`;
        }
      });
      g.addEventListener("mouseleave", () => { const t = $(".map-tip", box); if (t) t.style.display = "none"; });
      svg.appendChild(g);
    });

    box.innerHTML = "";
    box.appendChild(svg);
    const tip = document.createElement("div");
    tip.className = "map-tip";
    box.appendChild(tip);
  }

  /* ================= 文件管理 =================
   * initFileManager(files, { onChange })
   * 渲染网格、上传区、多选与批量操作、预览弹窗
   */
  function initFileManager(files, opts) {
    opts = opts || {};
    const grid = $("#fileGrid");
    if (!grid || !files) return;
    const selected = new Set();
    const typeIcon = { excel: "📗", csv: "📄", pdf: "📕", image: "🖼️", zip: "🗜️", other: "📁" };

    function render() {
      grid.innerHTML = "";
      files.forEach(f => {
        const on = selected.has(f.id);
        const item = document.createElement("div");
        item.className = "file-item";
        if (on) item.style.borderColor = "var(--primary)";
        item.innerHTML = `
          <div class="fico">${typeIcon[f.type] || typeIcon.other}</div>
          <div class="fname">${esc(f.name)}</div>
          <div class="fmeta">${esc(f.size)} · ${esc(f.owner)}</div>
          <div class="fmeta">${esc(f.time)} · 下载 ${f.downloads}</div>
          <div class="flex-center gap-8 mt-8" style="justify-content:center">
            <button class="btn-link" data-fpv="${esc(f.id)}">预览</button>
            <button class="btn-link" data-fdl="${esc(f.id)}">下载</button>
            <button class="btn-link danger" data-fdel="${esc(f.id)}">删除</button>
          </div>
          ${on ? '<span class="badge badge-ok plain" style="position:absolute;top:8px;left:8px">已选</span>' : ""}`;
        item.addEventListener("click", e => {
          if (e.target.closest("[data-fpv],[data-fdl],[data-fdel]")) return;
          selected.has(f.id) ? selected.delete(f.id) : selected.add(f.id);
          render(); updateBar();
        });
        grid.appendChild(item);
      });
    }
    function updateBar() {
      const bar = $("#fileSelBar");
      if (!bar) return;
      const n = selected.size;
      bar.style.display = n ? "flex" : "none";
      const info = $(".sel-info", bar);
      if (info) info.textContent = `已选择 ${n} 个文件`;
    }
    /* 预览 */
    function preview(f) {
      openModal("previewModal");
      const bd = $("#previewBody");
      bd.innerHTML = f.type === "image"
        ? `<img src="assets/img/gallery${1 + (files.indexOf(f) % 4)}.png" style="border-radius:8px;width:100%">`
        : `<div style="text-align:center;padding:30px 10px">
             <div style="font-size:52px">${typeIcon[f.type] || "📁"}</div>
             <h3 style="margin:12px 0 4px">${esc(f.name)}</h3>
             <p class="text-2">${esc(f.size)} · ${esc(f.owner)} · ${esc(f.time)}</p>
             <p class="text-3" style="margin-top:10px">预览：文本/表格内容请下载后查看</p>
           </div>`;
      const nm = $("#previewName");
      if (nm) nm.textContent = "预览 - " + f.name;
    }
    /* 网格内按钮（事件委托） */
    grid.addEventListener("click", e => {
      const pv = e.target.closest("[data-fpv]");
      const dl = e.target.closest("[data-fdl]");
      const del = e.target.closest("[data-fdel]");
      const id = (pv || dl || del || {}).dataset;
      const key = id ? (id.fpv || id.fdl || id.fdel) : null;
      const f = files.find(x => x.id === key);
      if (!f) return;
      if (pv) preview(f);
      else if (dl) { f.downloads++; render(); toast(`开始下载 ${f.name}`, "ok"); opts.onChange && opts.onChange(); }
      else if (del) {
        const i = files.indexOf(f);
        files.splice(i, 1);
        selected.delete(f.id);
        render(); updateBar();
        toast(`已删除「${f.name}」`, "ok");
        opts.onChange && opts.onChange();
      }
    });
    /* 上传区 */
    const zone = $("#uploadZone");
    if (zone) {
      zone.addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.multiple = true;
        inp.onchange = () => {
          [...inp.files].forEach(f => files.unshift({
            id: "F" + Date.now() + Math.floor(Math.random() * 1000),
            name: f.name,
            size: f.size / 1048576 > 1 ? (f.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(f.size / 1024)) + " KB",
            type: /\.(xlsx|xls)$/i.test(f.name) ? "excel" : /\.csv$/i.test(f.name) ? "csv"
              : /\.pdf$/i.test(f.name) ? "pdf" : /\.(png|jpg|jpeg|gif)$/i.test(f.name) ? "image"
              : /\.zip$/i.test(f.name) ? "zip" : "other",
            owner: (window.MOCK && window.MOCK.currentUser ? window.MOCK.currentUser.name : "我"),
            time: new Date().toISOString().slice(0, 16).replace("T", " "),
            downloads: 0
          }));
          render();
          toast(`已添加 ${inp.files.length} 个文件`, "ok");
          opts.onChange && opts.onChange();
        };
        inp.click();
      });
      ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("dragover"); }));
      ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("dragover"); }));
      zone.addEventListener("drop", e => toast(`检测到 ${e.dataTransfer.files.length} 个文件，请点击上传区选择`, "warn"));
    }
    /* 批量操作栏 */
    const bar = $("#fileSelBar");
    if (bar) {
      bar.addEventListener("click", e => {
        const act = (e.target.closest("[data-act]") || {}).dataset;
        if (!act || !act.act) return;
        if (act.act === "clear") { selected.clear(); render(); updateBar(); return; }
        const sel = files.filter(f => selected.has(f.id));
        if (!sel.length) return toast("请先选择文件", "warn");
        if (act.act === "batch-download") {
          const content = sel.map(f => `${f.id},${f.name},${f.size},${f.owner},${f.time}`).join("\r\n");
          downloadTextFile("文件清单_" + new Date().toISOString().slice(0, 10) + ".txt",
            "ID,文件名,大小,上传者,时间\r\n" + content);
          toast(`已批量导出 ${sel.length} 个文件的清单`, "ok");
        }
        if (act.act === "batch-delete") {
          sel.forEach(f => { const i = files.indexOf(f); if (i > -1) files.splice(i, 1); });
          selected.clear();
          render(); updateBar();
          toast(`已删除 ${sel.length} 个文件`, "ok");
          opts.onChange && opts.onChange();
        }
      });
    }
    render();
    return { render, selected, files };
  }

  /* ================= 启动 ================= */
  function boot() {
    initTheme();
    initSkipLink();
    initBackToTop();
    initNav();
    initCarousel();
    initReveal();
    initCounters();
    initTabs();
    initModal();
    initForms();
    /* 退出登录（已接入云服务时真实登出，否则本地提示） */
    const lo = $("#logoutBtn");
    if (lo) lo.addEventListener("click", () => {
      if (window.Cloud && window.Cloud.isReady && window.Cloud.isReady()) {
        lo.disabled = true; lo.textContent = "退出中…";
        window.Cloud.signOut().then(() => { location.href = "login.html"; });
      } else {
        toast("已退出登录", "ok");
        setTimeout(() => location.href = "login.html", 700);
      }
    });
  }
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", boot)
    : boot();

  /* ================= 对外暴露 ================= */
  window.App = {
    $, $$, toast, esc, exportCSV, downloadTextFile,
    DataTable, renderLineChart, renderBarChart, renderDonut, renderParkMap,
    initFileManager, openModal, closeModal, validateField, animateCount,
    setTheme: applyTheme, getTheme: currentTheme
  };
})();
