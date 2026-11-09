/* =====================================================================
 * snapshot.js — 覆盖前快照 / 一键回滚 / 全量备份
 *
 * 云端表：site_import_snapshots
 * 语义：每次「按日期整组覆盖」或「删除批次」之前，把该批次的旧行完整存档；
 *       回滚前会先给当前状态再拍一张，所以「回滚」本身也能被撤回。
 *       覆盖前若原本没有数据，也会存档一份空快照 —— 这样误导入新的一天
 *       同样可以一键回滚到「未导入」状态。
 *
 * 纯函数（buildPayload / stripRow / inBatch / normalizeRows / makeKey）
 * 不触碰 DOM，可在 Node 下直接单测；capture / list / restore / backupAll
 * 依赖 window.Cloud；mount 额外依赖 window.App。
 * ===================================================================== */
(function (root) {
  "use strict";

  var TABLE = "site_import_snapshots";
  var ALLOWED_TABLES = [
    "site_stranded_trucks", "site_reports", "site_report_goods", "site_report_templates"
  ];
  var MODULE_LABEL = {
    stranded: "滞留重车台账", daily: "每日报表", goods: "货物统计", template: "报表模板"
  };
  var REASON_LABEL = {
    overwrite: "覆盖前存档", delete: "删除前存档", before_restore: "回滚前自动存档"
  };
  var SERVER_FIELDS = { id: 1, created_at: 1, updated_at: 1 };
  var BACKUP_TABLES = [
    "site_params", "site_menus", "site_reports", "site_report_goods",
    "site_report_templates", "site_stranded_trucks", "site_vehicles",
    "site_checkpoint", "site_records", "site_files", "site_logs",
    "site_messages", "profiles", "gallery_items", "site_import_snapshots"
  ];
  var FORMAT = "personal-site-backup-v1";

  /* ---------------- 纯函数 ---------------- */

  /** 去掉服务端生成字段，避免回滚时主键冲突 */
  function stripRow(row) {
    var out = {};
    Object.keys(row || {}).forEach(function (k) {
      if (!SERVER_FIELDS[k]) out[k] = row[k];
    });
    return out;
  }

  function normalizeRows(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
    }
    return [];
  }

  function makeKey(module, rdate, gate) {
    return String(module || "") + ":" + String(rdate || "").slice(0, 10) +
      (gate ? ":" + String(gate) : "");
  }

  function buildPayload(opts) {
    opts = opts || {};
    var rows = (opts.rows || []).map(stripRow);
    var reason = REASON_LABEL[opts.reason] ? opts.reason : "overwrite";
    return {
      module: String(opts.module || ""),
      table_name: String(opts.table || ""),
      batch_key: makeKey(opts.module, opts.rdate, opts.gate),
      rdate: String(opts.rdate || "").slice(0, 10),
      gate: String(opts.gate || ""),
      rows_json: rows,
      row_count: rows.length,
      reason: reason,
      source: String(opts.source || ""),
      operator: String(opts.operator || ""),
      owner_id: String(opts.ownerId || "")
    };
  }

  /** 判断某行是否属于快照对应的批次（rdate 必配；快照带 gate 时 gate 也须一致） */
  function inBatch(snap, row) {
    if (String((row || {}).rdate || "").slice(0, 10) !== String(snap.rdate || "")) return false;
    if (snap.gate && String((row || {}).gate || "") !== String(snap.gate)) return false;
    return true;
  }

  function validateTarget(module, table) {
    if (!module || !table) return "快照参数不完整";
    if (ALLOWED_TABLES.indexOf(table) < 0) return "不受支持的数据表：" + table;
    return "";
  }

  /* ---------------- Cloud 薄封装 ---------------- */

  function capture(C, opts) {
    opts = opts || {};
    var bad = validateTarget(opts.module, opts.table);
    if (bad) return Promise.resolve({ error: { message: bad } });
    if (!C || typeof C.tableInsert !== "function")
      return Promise.resolve({ error: { message: "云服务未就绪，无法生成快照" } });
    var payload = buildPayload(opts);
    if (!payload.rdate) return Promise.resolve({ error: { message: "缺少统计日期，无法生成快照" } });
    return C.tableInsert(TABLE, payload).then(function (res) {
      if (res && res.error) return { error: res.error };
      if (C.logAction) C.logAction("数据备份", "生成覆盖前快照",
        payload.batch_key + " / " + payload.row_count + " 条 / " + REASON_LABEL[payload.reason],
        { target: payload.batch_key, before: { rows: payload.row_count, source: payload.source },
          after: { snapshot_id: (res && res.data && res.data.id) || null, reason: payload.reason } });
      return { data: (res && res.data) || null, payload: payload };
    }).catch(function (e) {
      return { error: { message: (e && e.message) || "快照写入失败" } };
    });
  }

  function list(C, modules) {
    if (!C || typeof C.tableList !== "function")
      return Promise.resolve({ data: [], error: { message: "云服务未就绪" } });
    return C.tableList(TABLE, { order: "id", asc: false }).then(function (r) {
      if (r && r.error) return { data: [], error: r.error };
      var want = modules && modules.length ? modules : null;
      var rows = (r.data || []).filter(function (x) {
        return !want || want.indexOf(x.module) >= 0;
      });
      return { data: rows, error: null };
    }).catch(function (e) {
      return { data: [], error: { message: (e && e.message) || "读取快照失败" } };
    });
  }

  /** 回滚：读当前批次 → 先存档 → 删除 → 写回快照行 */
  function restore(C, id) {
    if (!C || typeof C.tableList !== "function")
      return Promise.resolve({ error: { message: "云服务未就绪" } });
    return list(C, null).then(function (r) {
      if (r.error) return { error: r.error };
      var snap = null;
      (r.data || []).forEach(function (x) { if (String(x.id) === String(id)) snap = x; });
      if (!snap) return { error: { message: "快照不存在或已被清理" } };
      var bad = validateTarget(snap.module, snap.table_name);
      if (bad) return { error: { message: bad } };
      return C.tableList(snap.table_name).then(function (cur) {
        if (cur && cur.error) return { error: cur.error };
        var current = (cur.data || []).filter(function (x) { return inBatch(snap, x); });
        return capture(C, {
          module: snap.module, table: snap.table_name, rdate: snap.rdate, gate: snap.gate,
          rows: current, reason: "before_restore", source: "回滚前自动存档"
        }).then(function (pre) {
          if (pre.error) return {
            error: { message: "回滚前自动存档失败，已取消回滚：" + (pre.error.message || "") }
          };
          var saved = normalizeRows(snap.rows_json);
          var chain = Promise.resolve();
          current.forEach(function (x) {
            chain = chain.then(function () { return C.tableRemove(snap.table_name, x.id); })
              .then(function (d) {
                if (d && d.error) throw new Error(d.error.message || "清理当前批次失败");
              });
          });
          var ok = 0;
          saved.forEach(function (row) {
            chain = chain.then(function () { return C.tableInsert(snap.table_name, stripRow(row)); })
              .then(function (ins) {
                if (ins && ins.error) throw new Error(ins.error.message || "写回快照数据失败");
                ok++;
              });
          });
          return chain.then(function () {
            if (C.logAction) C.logAction("数据备份", "回滚批次",
              snap.batch_key + " / 恢复 " + ok + " 条 / 移除 " + current.length + " 条",
              { target: snap.batch_key,
                before: { rows: current.length, ids: current.slice(0, 5).map(function (x) { return x.id; }) },
                after: { restored: ok, removed: current.length, snapshot_id: snap.id } });
            return { data: { restored: ok, removed: current.length, batch: snap.batch_key } };
          });
        });
      });
    }).catch(function (e) {
      if (C.logAction) C.logAction("数据备份", "回滚批次", "快照 #" + id + " 回滚未完成",
        { target: "snapshot#" + id, ok: false, error: e });
      return { error: { message: (e && e.message) || "回滚失败" } };
    });
  }

  /** 全量备份：逐表读取，产出可下载的 JSON 对象 */
  function backupAll(C, tables) {
    var names = tables || BACKUP_TABLES;
    var out = { format: FORMAT, exported_at: new Date().toISOString(), tables: {} };
    var chain = Promise.resolve();
    names.forEach(function (name) {
      chain = chain.then(function () { return C.tableList(name); }).then(function (r) {
        out.tables[name] = (r && !r.error)
          ? (r.data || [])
          : { _error: (r && r.error && r.error.message) || "读取失败" };
      }).catch(function (e) {
        out.tables[name] = { _error: (e && e.message) || "读取失败" };
      });
    });
    return chain.then(function () { return out; });
  }

  /* ---------------- 页面组件 ---------------- */

  function stamp(v) {
    if (!v) return "—";
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function fallbackEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function mount(opts) {
    opts = opts || {};
    var C = opts.Cloud, App = opts.App || root.App;
    var el = opts.listEl;
    if (!el || !C) return { refresh: function () {} };
    var esc = function (s) { return App && App.esc ? App.esc(s) : fallbackEsc(s); };
    var toast = function (m, t) { if (App && App.toast) App.toast(m, t); };
    var modules = opts.modules || null;
    var canWrite = function () { return !C.isAdmin || C.isAdmin(); };
    var busy = false;
    var cache = [];

    function render(rows) {
      cache = rows;
      if (!rows.length) {
        el.innerHTML = '<div class="empty snap-empty">暂无快照。首次覆盖或删除批次后会自动生成；' +
          "覆盖前即使原本没有数据，也会留下一份空快照以便撤销误导入。</div>";
        return;
      }
      el.innerHTML = rows.slice(0, 20).map(function (s) {
        var label = MODULE_LABEL[s.module] || s.module || "—";
        var reason = REASON_LABEL[s.reason] || s.reason || "存档";
        var cls = s.reason === "before_restore" ? "snap-badge auto" : "snap-badge";
        var gate = s.gate ? " · " + esc(s.gate) : "";
        return '<div class="snap-item">' +
          '<div class="snap-main">' +
            '<div class="snap-line1"><span class="' + cls + '">' + esc(reason) + "</span>" +
              "<strong>" + esc(s.rdate) + "</strong>" + gate +
              ' <span class="snap-count">' + esc(s.row_count) + " 条</span></div>" +
            '<div class="snap-line2">' + esc(label) + " · " + esc(stamp(s.created_at)) +
              (s.source ? " · 来源 " + esc(s.source) : "") +
              (s.operator ? " · " + esc(s.operator) : "") + "</div>" +
          "</div>" +
          '<div class="snap-ops">' +
            '<button class="btn btn-line btn-sm" data-download="' + esc(s.id) + '">⬇ 存档</button>' +
            (canWrite() ? '<button class="btn btn-line btn-sm" data-restore="' + esc(s.id) + '">↺ 回滚到此版本</button>' : "") +
          "</div></div>";
      }).join("") + (rows.length > 20 ? '<p class="text-3 snap-more">仅显示最近 20 份，共 ' + rows.length + " 份。</p>" : "");

      Array.prototype.forEach.call(el.querySelectorAll("[data-download]"), function (b) {
        b.addEventListener("click", function () {
          var s = cache.filter(function (x) { return String(x.id) === String(b.dataset.download); })[0];
          if (!s || !App || !App.downloadTextFile) return;
          App.downloadTextFile("快照_" + (s.module || "data") + "_" + s.rdate + "_" + s.id + ".json",
            JSON.stringify({ format: FORMAT, snapshot: s }, null, 2));
          toast("快照已下载", "ok");
        });
      });
      Array.prototype.forEach.call(el.querySelectorAll("[data-restore]"), function (b) {
        b.addEventListener("click", function () {
          if (busy || !canWrite()) return;
          var s = cache.filter(function (x) { return String(x.id) === String(b.dataset.restore); })[0];
          if (!s) return;
          var msg = "确认把「" + (MODULE_LABEL[s.module] || s.module) + " " + s.rdate +
            "」回滚到 " + stamp(s.created_at) + " 的版本（" + s.row_count + " 条）？\n\n" +
            "当前状态会先自动存档一份，因此这次回滚之后仍可再撤回。";
          if (!root.confirm || !root.confirm(msg)) return;
          busy = true; b.disabled = true; b.textContent = "正在回滚…";
          restore(C, s.id).then(function (r) {
            if (r.error) { toast("回滚失败：" + (r.error.message || "权限不足"), "warn"); }
            else {
              toast("已回滚 " + r.data.batch + "：恢复 " + r.data.restored + " 条 / 移除 " + r.data.removed + " 条", "ok");
              if (opts.onRestored) opts.onRestored();
            }
          }).then(function () { busy = false; return refresh(); });
        });
      });
    }

    function refresh() {
      return list(C, modules).then(function (r) {
        if (r.error) {
          el.innerHTML = '<div class="empty snap-empty">读取快照失败：' +
            esc(r.error.message || "请先在托管域名登录") + "</div>";
          return;
        }
        render(r.data);
      });
    }

    if (opts.refreshBtn) opts.refreshBtn.addEventListener("click", function () {
      refresh(); toast("快照列表已刷新", "ok");
    });
    if (opts.backupBtn) opts.backupBtn.addEventListener("click", function () {
      var btn = opts.backupBtn;
      btn.disabled = true; btn.textContent = "正在导出…";
      backupAll(C).then(function (data) {
        if (!App || !App.downloadTextFile) { toast("导出组件不可用", "warn"); return; }
        var d = new Date();
        var name = "站点全量备份_" + d.getFullYear() + "-" +
          String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + ".json";
        App.downloadTextFile(name, JSON.stringify(data, null, 2));
        toast("全量备份已下载（含账号资料，请妥善保管）", "ok");
        if (C.logAction) C.logAction("数据备份", "导出全量备份", Object.keys(data.tables).length + " 张表");
      }).then(function () { btn.disabled = false; btn.textContent = "⬇ 全量备份 JSON"; });
    });
    if (C.onChange) {
      var t = null;
      C.onChange(function () { clearTimeout(t); t = setTimeout(refresh, 400); });
    }
    refresh();
    return { refresh: refresh };
  }

  var api = {
    TABLE: TABLE,
    FORMAT: FORMAT,
    ALLOWED_TABLES: ALLOWED_TABLES,
    BACKUP_TABLES: BACKUP_TABLES,
    MODULE_LABEL: MODULE_LABEL,
    REASON_LABEL: REASON_LABEL,
    stripRow: stripRow,
    normalizeRows: normalizeRows,
    makeKey: makeKey,
    buildPayload: buildPayload,
    inBatch: inBatch,
    validateTarget: validateTarget,
    capture: capture,
    list: list,
    restore: restore,
    backupAll: backupAll,
    mount: mount
  };
  root.Snapshot = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
