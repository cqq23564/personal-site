/* =====================================================================
 * admin-crud.js — 通用「云表 + 管理员 CRUD」页面绑定器
 * 用法：页面先建好 App.DataTable（data: []），再 AdminCrud.mount(cfg)
 * cfg = {
 *   table      云表名（site_vehicles / site_checkpoint / ...）
 *   entity     实体名（如「车辆」「记录」），用于提示与按钮文案
 *   module     日志模块名（如「在场车辆」）
 *   notice     提示元素选择器
 *   addBtn     新增按钮选择器（无则跳过）
 *   exportBtn  导出按钮选择器（无则跳过）
 *   exportFile 导出文件名
 *   exportHeaders 导出表头
 *   exportRow  r => [列值...]
 *   dt         App.DataTable 实例
 *   fields     [{ key, label, required, type: text|number|select|textarea,
 *                 options, def, ph, hint, pattern }]
 *   editFn / delFn  挂在 window 上的函数名（列渲染里 onclick 用）
 *   label      r => 字符串（删除确认/提示用）
 *   order / asc 加载排序
 *   onLoaded  rows => void（汇总卡等附加渲染）
 * }
 * 依赖：js/main.js（App.*）、js/cloud.js（window.Cloud）
 * ===================================================================== */
window.AdminCrud = (function () {
  "use strict";

  function mount(cfg) {
    var C = window.Cloud;
    var App = window.App;
    var rows = [];
    var editingId = null;
    var modalId = "acModal_" + cfg.table;
    var notice = cfg.notice ? document.querySelector(cfg.notice) : null;

    function showNotice(html, warn) {
      if (!notice) return;
      notice.innerHTML = html || "";
      notice.className = "page-notice" + (warn ? " warn" : "");
      notice.style.display = html ? "" : "none";
    }
    function fid(key) { return modalId + "_f_" + key; }

    /* ---------- 动态创建弹窗（main.js 初始化时不存在，需手动绑关闭） ---------- */
    var modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "modal-mask";
      modal.id = modalId;
      var fieldsHtml = cfg.fields.map(function (f) {
        var req = f.required ? '<span class="req">*</span>' : "";
        var input;
        if (f.type === "select") {
          var initOpts = typeof f.options === "function" ? [] : (f.options || []);
          input = '<select class="select" id="' + fid(f.key) + '">' + initOpts.map(function (o) {
            return "<option" + (f.def === o ? " selected" : "") + ">" + App.esc(o) + "</option>";
          }).join("") + "</select>";
        } else if (f.type === "checkbox") {
          input = '<label class="checkline"><input type="checkbox" id="' + fid(f.key) + '"' + (f.def !== false ? " checked" : "") + "> " + App.esc(f.boxLabel || "是") + "</label>";
        } else if (f.type === "number") {
          input = '<input class="input" id="' + fid(f.key) + '" type="number" step="any">';
        } else if (f.type === "textarea") {
          input = '<textarea class="textarea" id="' + fid(f.key) + '" style="min-height:70px"></textarea>';
        } else {
          input = '<input class="input" id="' + fid(f.key) + '" placeholder="' + App.esc(f.ph || "") + '">';
        }
        var hint = f.hint ? '<div class="text-3" style="font-size:12px;margin-top:4px">' + App.esc(f.hint) + "</div>" : "";
        return '<div class="field"><label>' + App.esc(f.label) + req + "</label>" + input + hint + "</div>";
      }).join("");
      modal.innerHTML =
        '<div class="modal">' +
        '<div class="modal-hd"><span id="' + modalId + '_title">新增</span><button class="modal-close" data-modal-close>✕</button></div>' +
        '<div class="modal-bd"><form id="' + modalId + '_form" novalidate><div class="form-row">' + fieldsHtml + "</div></form></div>" +
        '<div class="modal-ft"><button class="btn btn-line" data-modal-close>取消</button>' +
        '<button class="btn btn-primary" id="' + modalId + '_save">保存</button></div>' +
        "</div>";
      document.body.appendChild(modal);
      modal.addEventListener("click", function (e) { if (e.target === modal) modal.classList.remove("show"); });
      modal.querySelectorAll("[data-modal-close]").forEach(function (b) {
        b.addEventListener("click", function () { modal.classList.remove("show"); });
      });
    }

    /* ---------- 打开表单 ---------- */
    function openForm(row) {
      editingId = row ? row.id : null;
      document.getElementById(modalId + "_title").textContent = (row ? "编辑" : "新增") + cfg.entity;
      cfg.fields.forEach(function (f) {
        var el = document.getElementById(fid(f.key));
        if (!el) return;
        if (f.type === "checkbox") {
          var cv = row ? row[f.key] : f.def;
          el.checked = cv === undefined ? true : !!cv;
          return;
        }
        if (f.type === "select" && typeof f.options === "function") {
          var opts = f.options(row) || [];
          el.innerHTML = opts.map(function (o) {
            var ov = o.value === undefined ? o : o.value;
            return "<option value=\"" + App.esc(ov) + "\"" + (String(row && row[f.key]) === String(ov) ? " selected" : "") + ">" + App.esc(o.label !== undefined ? o.label : o) + "</option>";
          }).join("");
          return; /* 动态选项：selected 已处理，不再走通用赋值 */
        }
        var v = row && row[f.key] !== undefined && row[f.key] !== null ? row[f.key] : "";
        el.value = v !== "" ? v : (f.def !== undefined ? f.def : "");
      });
      App.openModal(modalId);
    }

    /* ---------- 保存 ---------- */
    document.getElementById(modalId + "_save").addEventListener("click", async function () {
      if (!C.isAdmin()) { App.toast("仅管理员可修改", "err"); return; }
      var data = {};
      for (var i = 0; i < cfg.fields.length; i++) {
        var f = cfg.fields[i];
        var el = document.getElementById(fid(f.key));
        var v = "";
        if (f.type === "checkbox") {
          data[f.key] = el ? el.checked : false;
          continue;
        }
        v = el ? String(el.value).trim() : "";
        if (f.required && !v) { App.toast("请填写" + f.label, "err"); return; }
        if (f.type === "number" && v !== "" && isNaN(Number(v))) { App.toast(f.label + "必须是数字", "err"); return; }
        if (f.pattern && v) {
          var re = f.pattern instanceof RegExp ? f.pattern : new RegExp(f.pattern);
          if (!re.test(v)) { App.toast(f.label + "格式不正确", "err"); return; }
        }
        data[f.key] = (f.type === "number" || f.numeric) && v !== "" ? Number(v) : v;
      }
      var btn = this;
      btn.disabled = true;
      var res = editingId ? await C.tableUpdate(cfg.table, editingId, data) : await C.tableInsert(cfg.table, data);
      btn.disabled = false;
      if (res.error) { App.toast(res.error.message, "err"); return; }
      App.closeModal(modalId);
      App.toast((editingId ? "已更新" : "已创建") + (cfg.label ? "「" + cfg.label(data) + "」" : ""), "ok");
      C.logAction(cfg.module, (editingId ? "修改" : "新增") + cfg.entity, cfg.label ? cfg.label(data) : "");
      load();
    });

    /* ---------- 编辑 / 删除（列渲染 onclick 调用） ---------- */
    window[cfg.editFn] = function (id) {
      var r = rows.find(function (x) { return x.id === id; });
      if (r) openForm(r);
    };
    window[cfg.delFn] = async function (id) {
      if (!C.isAdmin()) { App.toast("仅管理员可修改", "err"); return; }
      var r = rows.find(function (x) { return x.id === id; });
      if (!r) return;
      if (!confirm("确定删除「" + (cfg.label ? cfg.label(r) : id) + "」？")) return;
      var res = await C.tableRemove(cfg.table, id);
      if (res.error) { App.toast(res.error.message, "err"); return; }
      App.toast("已删除", "ok");
      C.logAction(cfg.module, "删除" + cfg.entity, cfg.label ? cfg.label(r) : "");
      load();
    };

    /* ---------- 新增按钮 ---------- */
    var addBtn = cfg.addBtn ? document.querySelector(cfg.addBtn) : null;
    if (addBtn) addBtn.addEventListener("click", function () {
      if (!C.isAdmin()) { App.toast("仅管理员可修改", "err"); return; }
      openForm(null);
    });

    /* ---------- 导出 ---------- */
    if (cfg.exportBtn) {
      var eb = document.querySelector(cfg.exportBtn);
      if (eb) eb.addEventListener("click", function () {
        App.exportCSV(cfg.exportFile, cfg.exportHeaders, cfg.dt.rows().map(cfg.exportRow));
      });
    }

    /* ---------- 加载与守卫 ---------- */
    async function load() {
      if (!C.isReady()) { showNotice("当前站点为静态镜像，" + cfg.entity + "数据需在 WorkBuddy 托管域名使用。", true); return; }
      if (!C.isLoggedIn()) {
        var page = location.pathname.split("/").pop() || "index.html";
        showNotice('请先 <a href="login.html?next=' + page + '" style="color:inherit;text-decoration:underline">登录</a> 后使用。', true);
        return;
      }
      var admin = C.isAdmin();
      if (addBtn) addBtn.classList.toggle("hidden", !admin);
      var res = await C.tableList(cfg.table, { order: cfg.order || "id", asc: cfg.asc });
      if (res.error) { showNotice("读取失败：" + App.esc(res.error.message), true); return; }
      rows = res.data || [];
      cfg.dt.setData(rows);
      if (cfg.onLoaded) cfg.onLoaded(rows);
      showNotice(admin
        ? "共 <b>" + rows.length + "</b> 条" + cfg.entity + "数据，管理员可增删改，改动实时保存到云端。"
        : "你当前是普通用户，仅可查看与导出（共 " + rows.length + " 条" + cfg.entity + "数据）。", !admin);
    }

    load();
    C.onChange(function () { if (C.isReady()) load(); });
    return { load: load, rows: function () { return rows; } };
  }

  return { mount: mount };
})();
