/* =====================================================================
 * stranded-report.js — 「滞留 72 小时中国出口重车」清单式报表渲染 / 导出
 *
 * 报表版式与使用者提供的清单一致：
 *   标题「2026年10月8日中国车出口滞留72小时」
 *   明细「车牌  重车  入场日期」
 *   合计「合计：14车」
 * 页面展示时额外加一列浅色序号便于核对，导出的 CSV 不含序号。
 * ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.StrandedReport = api;
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this), function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 导出 CSV：标题独占一行 → 明细三列 → 合计独占一行（Excel 可直接打开） */
  function toCSV(rep) {
    if (!rep) return "";
    return [csvCell(rep.title)]
      .concat((rep.lines || []).map(function (l) {
        return [l.plate, l.vehicle_type, l.entry_label].map(csvCell).join(",");
      }))
      .concat(["合计：" + (rep.total || 0) + "车"])
      .join("\r\n");
  }

  /** 版式化渲染到容器 */
  function render(el, rep) {
    if (!el) return;
    if (!rep || !rep.lines || !rep.lines.length) {
      el.innerHTML = '<div class="empty st-empty">暂无可生成的报表数据</div>';
      return;
    }
    var body = rep.lines.map(function (l, i) {
      return '<div class="st-report-line">' +
        '<span class="st-report-no">' + (i + 1) + '</span>' +
        '<span class="st-report-plate">' + esc(l.plate) + '</span>' +
        '<span class="st-report-type">' + esc(l.vehicle_type || "—") + '</span>' +
        '<span class="st-report-date">' + esc(l.entry_label || "—") + '</span>' +
        '</div>';
    }).join("");
    el.innerHTML = '<div class="st-report-paper">' +
      '<div class="st-report-title">' + esc(rep.title) + '</div>' +
      '<div class="st-report-meta">统计日期 ' + esc(rep.date || "—") +
      ' · 共 ' + (rep.total || 0) + ' 辆 · 阈值 ' + esc(rep.threshold || 72) + 'h</div>' +
      '<div class="st-report-lines">' + body + '</div>' +
      '<div class="st-report-total">合计：<b>' + (rep.total || 0) + '</b> 车</div>' +
      '</div>';
  }

  function saveBlob(name, text, mime) {
    if (typeof document === "undefined") return false;
    var blob = new Blob(["\ufeff" + text], { type: (mime || "text/csv") + ";charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    return true;
  }

  function toast(msg, kind) {
    if (typeof window !== "undefined" && window.App && window.App.toast) window.App.toast(msg, kind);
  }

  function download(rep) {
    if (!rep || !rep.lines || !rep.lines.length) { toast("暂无可导出的报表", "warn"); return false; }
    var name = String(rep.title || "滞留重车报表").replace(/[\\/:*?"<>|]/g, "") + ".csv";
    saveBlob(name, toCSV(rep), "text/csv");
    toast("已导出 " + name, "ok");
    return true;
  }

  /** 清单式空白模板：标题 + 填写说明行 + 合计占位，不含任何示意业务数据 */
  function downloadTemplate(dateStr, threshold) {
    var d = new Date();
    var date = dateStr || (d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日");
    var t = Number(threshold) > 0 ? Number(threshold) : 72;
    var text = [
      date + "中国车出口滞留" + t + "小时",
      "车牌,重车,入场日期（填写说明：从第 2 行起每行一辆车，按「车牌 / 重车 / M月D日」填写；本行导入时自动跳过）",
      "合计：N车"
    ].join("\r\n");
    saveBlob("滞留72小时中国出口重车_清单模板.csv", text, "text/csv");
    toast("清单模板已下载，按示例版式填写即可", "ok");
    return true;
  }

  return {
    render: render,
    toCSV: toCSV,
    download: download,
    downloadTemplate: downloadTemplate,
    esc: esc
  };
});
