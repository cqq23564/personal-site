/* =====================================================================
 * import-validate.js — 导入质量闸门（纯逻辑 + 轻量渲染）
 *
 * 设计原则：宁可拦下可疑文件，也不把错误数据写进云端覆盖真实日报。
 *   blockers  硬阻断：修好源文件才能导入，按钮直接禁用
 *   confirms  需人工确认：勾选「我已核对」后才放行，异常照实入库并留痕
 *   warnings  仅说明口径，不影响提交
 * 质量校验在「预览阶段」完成，提交入口再做一次 canCommit() 兜底，
 * 防止绕过 UI 直接调用 commit。
 * ===================================================================== */
(function () {
  "use strict";

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  /* 宽松车牌：1~3 位中文/字母省份与字母 + 4~9 位字母数字，覆盖新能源与挂车 */
  var PLATE_RE = /^[A-Z\u4e00-\u9fa5]{1,3}[A-Z0-9]{4,9}$/;
  var DAILY_KEYS = ["inCars", "inHeavy", "inEmpty", "inWeight", "outCars", "outHeavy", "outEmpty", "outWeight"];

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function pack(blockers, confirms, warnings) {
    return {
      blockers: blockers, confirms: confirms, warnings: warnings,
      allowed: blockers.length === 0, needConfirm: confirms.length > 0
    };
  }
  function canCommit(result, acknowledged) {
    if (!result) return true;                       // 该模式未启用质量闸门
    return result.allowed && (!result.needConfirm || !!acknowledged);
  }

  /* ---------------- 滞留 72h 台账 ---------------- */
  function stranded(d) {
    var blockers = [], confirms = [], warnings = [];
    var rows = (d && d.rows) || [];
    var date = String((d && d.date) || "");

    if (!rows.length) blockers.push("未识别到有效明细行，禁止写入空批次（会清空当天已有归档）");
    if (!DATE_RE.test(date)) blockers.push("统计日期缺失或格式非法（应为 YYYY-MM-DD），无法按日期归档");

    if (d && d.mode === "list" && d.declaredTotal !== null && d.declaredTotal !== undefined &&
        num(d.declaredTotal) !== rows.length) {
      blockers.push("原报表合计 " + d.declaredTotal + " 车，实际解析 " + rows.length +
        " 行；合计与明细不符，请修正源文件后重新导入");
    }

    var emptyPlate = 0, oddPlate = [], seen = {}, dup = [], negative = 0, huge = 0;
    rows.forEach(function (r) {
      if (r.row_kind === "summary") return;         // 汇总行允许无车牌
      var p = String(r.plate || "").trim().toUpperCase();
      if (!p) { emptyPlate++; return; }
      if (!PLATE_RE.test(p)) oddPlate.push(p);
      if (seen[p]) { if (dup.indexOf(p) < 0) dup.push(p); } else seen[p] = 1;
    });
    rows.forEach(function (r) {
      if (num(r.car_cnt) < 0 || num(r.weight) < 0) negative++;
      if (num(r.weight) > 1000) huge++;
    });
    if (emptyPlate) blockers.push(emptyPlate + " 行缺少车牌号，禁止写入（无法核对车辆）");
    if (negative) blockers.push(negative + " 行车数或重量为负数，禁止写入");
    if (oddPlate.length) confirms.push(oddPlate.length + " 个车牌格式可疑（" +
      uniq(oddPlate).slice(0, 3).join("、") + "），请确认解析无误");
    if (dup.length) confirms.push("重复车牌 " + dup.length + " 个（" +
      dup.slice(0, 3).join("、") + "），请确认不是重复录入");

    if (DATE_RE.test(date)) {
      var md = Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10));
      var later = rows.filter(function (r) {
        var m = String(r.entry_label || r.entry_at || "").match(/(\d{1,2})月(\d{1,2})日/);
        return m ? (Number(m[1]) * 100 + Number(m[2]) > md) : false;
      }).length;
      if (later) confirms.push(later + " 行入场月日晚于统计日期 " + date +
        "（可能跨年，或标题日期笔误），请确认统计日期是否正确");
    }
    if (huge) confirms.push(huge + " 行重量数值 > 1000，可能混用 kg 与吨，请确认单位口径");
    if (d && d.mode === "list") {
      warnings.push("清单明细只给「M月D日」，无年份与时刻：不推算、不编造精确滞留时长，按报表标题声明计为已达阈值");
    }
    var noDwell = rows.filter(function (r) { return !num(r.dwell_hours); }).length;
    if (d && d.mode === "table" && noDwell) {
      warnings.push(noDwell + " 行无滞留时长且无法由入场时间推算，滞留指标按 0 处理（不会编造数字）");
    }
    return pack(blockers, confirms, warnings);
  }

  /* ---------------- 每日报表（已汇总成品报表） ---------------- */
  function daily(d) {
    if (!d) return pack(["未生成有效日报数据"], [], []);
    var blockers = [], confirms = [], warnings = [];
    var t = d.totals || {}, goods = d.goods || [];
    var date = String(d.date || "");

    if (!DATE_RE.test(date)) blockers.push("统计日期缺失或格式非法（应为 YYYY-MM-DD），无法按日期归档");
    if (DAILY_KEYS.every(function (k) { return !num(t[k]); })) {
      blockers.push("日报各项数值全为 0，禁止写入（会覆盖真实日报）");
    }
    DAILY_KEYS.forEach(function (k) {
      if (num(t[k]) < 0) blockers.push("日报字段 " + k + " 为负数，禁止写入");
    });
    var badGoods = goods.filter(function (g) {
      return !String(g.goods || "").trim() || num(g.cnt) < 0 || num(g.weight) < 0;
    });
    if (badGoods.length) blockers.push(badGoods.length + " 条货物记录缺名称或含负数，请修正源文件");

    if (num(t.inCars) > 0 && num(t.inHeavy) + num(t.inEmpty) !== num(t.inCars)) {
      confirms.push("入区重车 + 空车（" + (num(t.inHeavy) + num(t.inEmpty)) + "）≠ 入区车数（" +
        num(t.inCars) + "），请确认列组识别是否正确");
    }
    if (num(t.outCars) > 0 && num(t.outHeavy) + num(t.outEmpty) !== num(t.outCars)) {
      confirms.push("出区重车 + 空车（" + (num(t.outHeavy) + num(t.outEmpty)) + "）≠ 出区车数（" +
        num(t.outCars) + "），请确认列组识别是否正确");
    }
    if (num(t.outCars) > num(t.inCars) * 3 && num(t.inCars) > 0) {
      confirms.push("出区车数明显大于入区车数，请确认是否把两列读反");
    }
    var unnamed = goods.filter(function (g) { return /未填写|未知|其他$|其它$/.test(String(g.goods || "")); });
    if (unnamed.length) confirms.push(unnamed.length + " 条货物名称未填写或为兜底分类，请确认是否继续");
    if (!goods.length) confirms.push("未识别到货物明细，本次只写日报、不写货物统计");
    if (goods.length) warnings.push("货物名称已按统一口径归并；「合并来源」列可查看被归并的原始货名");
    return pack(blockers, confirms, warnings);
  }

  /* ---------------- 轻量渲染（两个导入页共用） ---------------- */
  function listHtml(items) {
    return "<ul>" + items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
  }
  function render(container, result, onAck) {
    if (!container) return;
    if (!result) { container.innerHTML = ""; container.style.display = "none"; return; }
    var h = "";
    if (result.blockers.length) {
      h += '<div class="iv-block"><div class="iv-hd">⛔ 已阻断导入（' + result.blockers.length + " 项）</div>" +
        listHtml(result.blockers) + '<div class="iv-tip">请修正源文件后重新选择；本次不会写入或覆盖任何云端数据。</div></div>';
    }
    if (result.confirms.length) {
      h += '<div class="iv-confirm"><div class="iv-hd">⚠️ 需人工确认（' + result.confirms.length + " 项）</div>" +
        listHtml(result.confirms) +
        '<label class="iv-ack"><input type="checkbox" class="iv-ack-box"> 我已逐项核对上述异常，确认仍要按原文导入</label></div>';
    }
    if (result.warnings.length) {
      h += '<div class="iv-info"><div class="iv-hd">ℹ️ 口径说明</div>' + listHtml(result.warnings) + "</div>";
    }
    container.innerHTML = h;
    container.style.display = h ? "block" : "none";
    var box = container.querySelector(".iv-ack-box");
    if (box) box.addEventListener("change", function () { if (onAck) onAck(box.checked); });
  }

  window.ImportValidate = {
    stranded: stranded, daily: daily, canCommit: canCommit, render: render,
    esc: esc, DATE_RE: DATE_RE, PLATE_RE: PLATE_RE
  };
})();
