/* =====================================================================
 * stranded.js — 「滞留 72 小时中国出口重车」专题台账解析、统计与报表生成
 *
 * 纯逻辑层，不触碰 DOM；可在浏览器与 Node 下同时运行（便于离线单测）。
 * 兼容三类来源：
 *   ① 清单式报表（无表头，本站按原版式还原）：
 *      标题「2026年10月8日中国车出口滞留72小时」
 *      明细「浙JB8983  重车  11月4日」（tab / 空格 / 连写 / 多列均可）
 *      合计「合计：14车」
 *   ② 逐车明细清单：车牌 / 入场时间 / 滞留时长 / 货物 / 贸易方式 / 国籍 …
 *   ③ 汇总统计表（如 B卡报表「出口重车」工作表）
 * 清单式按标题行自动识别并优先；否则按「别名归一化 + 最长匹配」识别表头。
 *
 * 口径原则：清单标题已声明「滞留 72 小时」，因此每行视为已达阈值；
 * 明细只给出「M月D日」、无年份与时刻，不足以可靠推算精确滞留小时数，
 * 故 dwell_hours 保持 0、dwell_basis='declared'，绝不编造时长数字。
 * ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Stranded = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* 字段别名：按长度降序全局匹配，避免「挂车车牌号」被「车牌」抢走 */
  var FIELDS = [
    { key: "trailer_plate", alias: ["挂车车牌号", "挂车车牌", "挂车牌号", "挂车牌", "挂车号"] },
    { key: "plate", alias: ["车牌号码", "主车牌号", "车辆牌号", "车牌号", "车牌", "号牌", "车号"] },
    { key: "nation", alias: ["中国/越南车", "中国越南车", "车辆国籍", "车籍", "国籍", "国别"] },
    { key: "direction", alias: ["进出场区", "出入场区", "进出方向", "出入方向", "进出口", "方向", "进出"] },
    { key: "trade_mode", alias: ["贸易方式", "贸易类型", "业务类型", "监管方式"] },
    { key: "goods", alias: ["商品名称/车型", "商品名称车型", "货物名称", "商品名称", "货物品名", "车型", "货物", "品名"] },
    { key: "car_cnt", alias: ["车次（辆）", "车次(辆)", "车辆数", "车次数", "车次", "车数", "辆数"] },
    { key: "weight", alias: ["重量(T)", "重量（T）", "重量(吨)", "重量（吨）", "总重量", "重量"] },
    { key: "entry_at", alias: ["入场时间", "进场时间", "入区时间", "入场日期", "到达时间", "入场"] },
    { key: "dwell_hours", alias: ["滞留时长(h)", "滞留时长(h)", "在场时长(h)", "滞留时长", "在场时长", "停留时长", "滞留小时", "时长"] },
    { key: "reason", alias: ["滞留原因", "滞留事由", "原因"] },
    { key: "status", alias: ["处置状态", "处理状态", "车辆状态", "状态"] },
    { key: "contact", alias: ["跟进人", "责任人", "联系人"] },
    { key: "rdate", alias: ["统计日期", "报表日期", "数据日期", "日期"] }
  ];

  var ALIAS = [];
  FIELDS.forEach(function (f) {
    f.alias.forEach(function (a) { ALIAS.push({ key: f.key, text: norm(a), len: norm(a).length }); });
  });
  ALIAS.sort(function (a, b) { return b.len - a.len; });

  /* ---------- 清单式报表识别规则 ---------- */
  /* 中国民用车牌：省份简称 + 发牌机关字母 + 5~6 位字母数字 */
  var PLATE_RE = /[\u4e00-\u9fa5][A-Za-z][A-Za-z0-9]{5,6}/;
  var TITLE_RE = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  var MD_RE = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  var ISO_RE = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/;
  var TOTAL_RE = /^\s*(合\s*计|总\s*计|小\s*计)\s*[:：]?\s*(\d+)\s*[车辆]?/;

  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/[\s\u3000]/g, "")
      .replace(/[（）()【】\[\]、,，.。:：\/\\'"-]/g, "")
      .toLowerCase();
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  /* SheetJS 会把 Excel 的整日 00:00 解析成本地 23:59:17，需吸附到次日 */
  function fmtDateCell(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      var d = new Date(v.getTime());
      if (d.getHours() >= 23 && d.getMinutes() >= 58) d = new Date(d.getTime() + 5 * 60000);
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }
    var s = String(v == null ? "" : v).trim();
    var m = s.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (m) return m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]);
    return "";
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /* 统计日期以文件名为兜底（避免表内整日日期偏移退回前一天） */
  function dateFromName(filename) {
    var s = String(filename || "");
    var m = s.match(/(20\d{2})[-._/年](\d{1,2})[-._/月](\d{1,2})/);
    if (m) return m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]);
    m = s.match(/(20\d{2})(\d{2})(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    return "";
  }

  function num(v) {
    if (v instanceof Date) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = String(v == null ? "" : v).replace(/[,，\s]/g, "").replace(/[吨Tt辆车次小时hH]/g, "");
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function text(v) {
    if (v == null) return "";
    if (v instanceof Date && !isNaN(v.getTime())) {
      var d = new Date(v.getTime());
      if (d.getHours() >= 23 && d.getMinutes() >= 58) d = new Date(d.getTime() + 5 * 60000);
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
        " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    }
    /* Excel 日期序列号（1900 日期系统，约 20000~60000 对应 1954~2064 年） */
    if (typeof v === "number" && v > 20000 && v < 60000) {
      var dt = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1) + "-" + pad2(dt.getUTCDate()) +
        " " + pad2(dt.getUTCHours()) + ":" + pad2(dt.getUTCMinutes()) + ":00";
    }
    var s = String(v).trim();
    return s === "null" || s === "-" ? "" : s;
  }

  function isTotalRow(s) {
    return /^(合计|小计|总计|共计|总车数|总数|备注|说明|制表|填报)/.test(String(s || "").trim());
  }

  /* 把一行单元格拼成可匹配的文本：兼容三列、单列整行粘贴、tab/空格连写 */
  function lineText(row) {
    return (row || []).map(function (c) { return text(c); }).join(" ").replace(/\s+/g, " ").trim();
  }

  /* 清单标题：中文年月日 + 「滞留」+ 阈值/小时。
   * 纯文本中文日期不存在 Excel 整日日期偏移，故优先级高于文件名。 */
  function parseTitle(s) {
    var raw = String(s || "").trim();
    var m = raw.match(TITLE_RE);
    if (!m) return null;
    if (!/滞留/.test(raw) || !/(72|小时|h)/i.test(raw)) return null;
    return {
      date: m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]),
      title: raw
    };
  }

  /* 清单明细：车牌 + 重车/空车 + 入场日期（原文保留） */
  function parseDetailLine(s) {
    var raw = String(s || "");
    var pm = raw.match(PLATE_RE);
    if (!pm) return null;
    var vt = /空车/.test(raw) ? "空车" : /重车/.test(raw) ? "重车" : "";
    if (!vt) return null;
    var label = "", mmdd = 0;
    var md = raw.match(MD_RE);
    var iso = md ? null : raw.match(ISO_RE);
    if (md || iso) {
      var mo = Number((md || iso)[md ? 1 : 2]), dy = Number((md || iso)[md ? 2 : 3]);
      label = mo + "月" + dy + "日";
      mmdd = mo * 100 + dy;
    }
    return { plate: pm[0].toUpperCase(), vehicle_type: vt, entry_label: label, mmdd: mmdd };
  }

  /* 把 ISO / 中文日期统一成报表里的「M月D日」 */
  function shortLabel(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var m = s.match(MD_RE);
    if (m) return Number(m[1]) + "月" + Number(m[2]) + "日";
    m = s.match(ISO_RE);
    if (m) return Number(m[2]) + "月" + Number(m[3]) + "日";
    return "";
  }

  /* 表头行识别：必须同时满足
   *   ① 命中字段数 >= 3；
   *   ② 含业务主体列（车牌或货物）。
   * 否则 B卡报表里只有「车数 / 重量」的入区、出区统计表会被误当成滞留台账。 */
  function matchHeader(row) {
    var map = {}, hits = 0;
    (row || []).forEach(function (cell, i) {
      var t = norm(cell);
      if (!t) return;
      for (var k = 0; k < ALIAS.length; k++) {
        if (t.indexOf(ALIAS[k].text) > -1 && map[ALIAS[k].key] === undefined) {
          map[ALIAS[k].key] = i; hits++; return;
        }
      }
    });
    var hasBody = map.plate !== undefined || map.goods !== undefined;
    return hits >= 3 && hasBody ? map : null;
  }

  /* 由入场时间 + 统计日期推算滞留小时；无依据时返回 0，不编造 */
  function dwellFromEntry(entry, rdate) {
    var m = String(entry || "").match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
    if (!m || !rdate) return 0;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 23), Number(m[5] || 59), 0);
    var end = new Date(rdate + "T23:59:00");
    var h = (end - d) / 3600000;
    return h > 0 && isFinite(h) ? Math.round(h * 10) / 10 : 0;
  }

  /* =====================================================================
   * ① 清单式报表解析（无表头）
   * ===================================================================== */
  function parseStrandedList(sheets, filename, opts) {
    opts = opts || {};
    var threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : 72;
    var all = sheets || [], rows = [], matched = [], warnings = [], mmdds = [];
    var title = "", titleDate = "", declaredTotal = 0, hasTotal = false;

    all.forEach(function (sh) {
      var m = sh.matrix || [];
      if (!m.length) return;
      var hit = null, hRow = -1;
      for (var r = 0; r < Math.min(m.length, 8); r++) {
        hit = parseTitle(lineText(m[r]));
        if (hit) { hRow = r; break; }
      }
      if (!hit) return;
      if (!title) { title = hit.title; titleDate = hit.date; }
      matched.push({ sheet: sh.name, headerRow: hRow + 1, fields: ["清单式报表"] });

      for (var i = hRow + 1; i < m.length; i++) {
        var line = lineText(m[i]);
        if (!line) continue;
        var tm = line.match(TOTAL_RE);
        if (tm) { hasTotal = true; declaredTotal += Number(tm[2]); continue; }
        var d = parseDetailLine(line);
        if (!d) continue;
        rows.push({
          rdate: titleDate,
          plate: d.plate,
          trailer_plate: "",
          nation: /中国/.test(title) ? "中国" : "",
          direction: /出口/.test(title) ? "出口" : "",
          trade_mode: "",
          goods: "",
          car_cnt: 1,
          weight: 0,
          entry_at: d.entry_label,
          dwell_hours: 0,
          reason: "",
          status: "滞留≥" + threshold + "h",
          contact: "",
          row_kind: "detail",
          source: String(filename || ""),
          vehicle_type: d.vehicle_type,
          entry_label: d.entry_label,
          report_title: title,
          dwell_basis: "declared"
        });
        if (d.mmdd) mmdds.push(d.mmdd);
      }
    });

    if (!rows.length) return null;

    /* 标题日期优先（中文纯文本，无 Excel 偏移），其余依次兜底 */
    var date = titleDate || String(opts.date || "") || dateFromName(filename) || today();
    rows.forEach(function (r) { r.rdate = date; if (r.status) r.status = "滞留≥" + threshold + "h"; });

    /* 合计行校验：只核对，不用声明值覆盖实际明细 */
    if (hasTotal && declaredTotal !== rows.length) {
      warnings.push("原报表合计 " + declaredTotal + " 车，实际识别 " + rows.length + " 行，请核对；本站以实际识别的明细为准");
    }
    var dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var statMd = dm ? Number(dm[2]) * 100 + Number(dm[3]) : 0;
    var later = mmdds.filter(function (x) { return statMd && x > statMd; }).length;
    if (later) {
      warnings.push(later + " 行的入场月日晚于统计日期（可能跨年或标题日期笔误），已按原文保留，未据此推算滞留时长");
    }
    warnings.push("清单式报表：标题已声明滞留 " + threshold + " 小时，每行按 1 辆计并视为已达阈值；明细仅给出「M月D日」，无年份与时刻，故不生成精确滞留时长");

    return {
      date: date,
      rows: rows,
      sheetNames: all.map(function (s) { return s.name; }),
      matchedSheets: matched,
      threshold: threshold,
      warnings: warnings,
      stats: summarize(rows, threshold),
      mode: "list",
      declaredTotal: hasTotal ? declaredTotal : null,
      totalMatched: hasTotal && declaredTotal === rows.length,
      report: buildReport(rows, { title: title, date: date, threshold: threshold })
    };
  }

  /* =====================================================================
   * ②③ 带表头的明细清单 / 汇总统计表
   * ===================================================================== */
  function parseTableWorkbook(sheets, filename, opts) {
    opts = opts || {};
    var threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : 72;
    var all = sheets || [], rows = [], matched = [], warnings = [];
    var date = String(opts.date || "") || dateFromName(filename) || "";

    all.forEach(function (sh) {
      var m = sh.matrix || [];
      if (!m.length) return;
      var header = null, hRow = -1;
      for (var r = 0; r < Math.min(m.length, 15); r++) {
        var hit = matchHeader(m[r]);
        if (hit) { header = hit; hRow = r; break; }
      }
      if (!header) return;
      matched.push({ sheet: sh.name, headerRow: hRow + 1, fields: Object.keys(header) });

      /* 表内日期仅作文件名缺失时的兜底 */
      if (!date) {
        for (var r0 = 0; r0 < Math.min(m.length, 5) && !date; r0++) {
          var row0 = m[r0] || [];
          for (var c0 = 0; c0 < Math.min(row0.length, 6); c0++) {
            var dv = fmtDateCell(row0[c0]);
            if (dv) { date = dv; break; }
          }
        }
      }

      for (var i = hRow + 1; i < m.length; i++) {
        var src = m[i] || [];
        var get = function (k) { return header[k] === undefined ? "" : text(src[header[k]]); };
        var plate = get("plate"), goods = get("goods");
        var cnt = num(src[header.car_cnt]), wt = num(src[header.weight]);
        var first = text(src[0]);
        if (isTotalRow(first) || isTotalRow(plate) || /^(车牌|车牌号|序号)$/.test(plate)) continue;
        /* 无任何业务主体数据的备注行 / 空行跳过 */
        if (!plate && !goods && !cnt && !wt) continue;
        var entry = get("entry_at");
        var dwell = num(src[header.dwell_hours]);
        if (!dwell && entry) dwell = dwellFromEntry(entry, date);
        var rowDate = get("rdate") ? (fmtDateCell(get("rdate")) || get("rdate").slice(0, 10)) : date;
        rows.push({
          rdate: rowDate || date,
          plate: plate,
          trailer_plate: get("trailer_plate"),
          nation: get("nation"),
          direction: get("direction"),
          trade_mode: get("trade_mode"),
          goods: goods,
          car_cnt: cnt || 1,
          weight: wt,
          entry_at: entry,
          dwell_hours: dwell,
          reason: get("reason"),
          status: get("status"),
          contact: get("contact"),
          row_kind: plate ? "detail" : "summary",
          source: String(filename || ""),
          vehicle_type: "",
          entry_label: shortLabel(entry),
          report_title: "",
          dwell_basis: dwell > 0 ? "calculated" : ""
        });
      }
    });

    if (!date) date = today();
    rows.forEach(function (r) { if (!r.rdate) r.rdate = date; });
    if (!rows.length) warnings.push("未识别到有效数据行：请确认含中文表头，或改用「标题 + 车牌/重车/日期 + 合计」的清单式报表");
    var noDwell = rows.filter(function (r) { return !r.dwell_hours; }).length;
    if (noDwell) warnings.push(noDwell + " 行缺少滞留时长且无法由入场时间推算，滞留指标按 0 处理");

    return {
      date: date,
      rows: rows,
      sheetNames: all.map(function (s) { return s.name; }),
      matchedSheets: matched,
      threshold: threshold,
      warnings: warnings,
      stats: summarize(rows, threshold),
      mode: "table",
      declaredTotal: null,
      totalMatched: false,
      report: null
    };
  }

  /**
   * 解析工作簿：清单式优先，未命中则回退表头模式
   * @param {Array} sheets  [{name, matrix:[[...]]}]
   * @param {String} filename 文件名
   * @param {Object} opts  { threshold:Number, date:String }
   */
  function parseWorkbook(sheets, filename, opts) {
    var list = parseStrandedList(sheets, filename, opts);
    if (list && list.rows.length) return list;
    return parseTableWorkbook(sheets, filename, opts);
  }

  /** 由台账行计算看板指标与图表数据（云端读回后同样调用） */
  function summarize(rows, threshold) {
    rows = rows || [];
    threshold = Number(threshold) > 0 ? Number(threshold) : 72;
    var cars = 0, weight = 0, over = 0, maxDwell = 0, dwellSum = 0, dwellN = 0;
    var declared = 0, unknownDwell = 0;
    var goodsMap = {}, nationMap = {}, tradeMap = {}, typeMap = {}, buckets = [0, 0, 0, 0, 0];
    rows.forEach(function (r) {
      var c = Number(r.car_cnt) || 0, h = Number(r.dwell_hours) || 0;
      var basis = String(r.dwell_basis || "");
      cars += c; weight += Number(r.weight) || 0;
      if (basis === "declared") declared += c;
      /* 清单标题已声明达阈值，即使没有精确小时数也计入预警 */
      if (h >= threshold || (basis === "declared" && h === 0)) over += c;
      if (h > 0) {
        if (h > maxDwell) maxDwell = h;
        dwellSum += h * (c || 1); dwellN += (c || 1);
        /* 0-24 / 24-48 / 48-72 / 72-96 / >=96 小时；无时长不入桶，避免误判为「<24h」 */
        var bi = h < 24 ? 0 : h < 48 ? 1 : h < 72 ? 2 : h < 96 ? 3 : 4;
        buckets[bi] += c;
      } else { unknownDwell += c; }
      var g = String(r.goods || "").trim() || "未填写";
      goodsMap[g] = (goodsMap[g] || 0) + c;
      var n = String(r.nation || "").trim() || "未填写";
      nationMap[n] = (nationMap[n] || 0) + c;
      var t = String(r.trade_mode || "").trim() || "未填写";
      tradeMap[t] = (tradeMap[t] || 0) + c;
      var vt = String(r.vehicle_type || "").trim();
      if (vt) typeMap[vt] = (typeMap[vt] || 0) + c;
    });
    function toList(map) {
      return Object.keys(map).map(function (k) { return { name: k, value: Math.round(map[k] * 100) / 100 }; })
        .sort(function (a, b) { return b.value - a.value; });
    }
    return {
      rows: rows.length,
      cars: Math.round(cars * 100) / 100,
      weight: Math.round(weight * 100) / 100,
      over: Math.round(over * 100) / 100,
      maxDwell: Math.round(maxDwell * 10) / 10,
      avgDwell: dwellN ? Math.round(dwellSum / dwellN * 10) / 10 : 0,
      goodsKinds: Object.keys(goodsMap).length,
      goods: toList(goodsMap),
      nations: toList(nationMap),
      trades: toList(tradeMap),
      vehicleTypes: toList(typeMap),
      declared: Math.round(declared * 100) / 100,
      unknownDwell: Math.round(unknownDwell * 100) / 100,
      buckets: buckets.map(function (v) { return Math.round(v * 100) / 100; }),
      bucketLabels: ["<24h", "24-48h", "48-72h", "72-96h", "≥96h"],
      threshold: threshold,
      listMode: declared > 0 && Math.abs(declared - cars) < 0.001
    };
  }

  /** 生成与导入清单同版式的报表：标题 + 明细（车牌 / 重车 / 入场日期）+ 合计 */
  function buildReport(rows, opts) {
    opts = opts || {};
    var list = (rows || []).filter(function (r) { return r.plate; });
    var date = String(opts.date || "") || (list[0] && list[0].rdate) || "";
    var threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : 72;
    var title = String(opts.title || "").trim() || (list[0] && list[0].report_title) || "";
    if (!title) {
      var p = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      title = p ? (p[1] + "年" + Number(p[2]) + "月" + Number(p[3]) + "日中国车出口滞留" + threshold + "小时")
        : ("中国车出口滞留" + threshold + "小时");
    }
    return {
      title: title,
      date: date,
      threshold: threshold,
      lines: list.map(function (r) {
        return {
          plate: r.plate || "",
          vehicle_type: String(r.vehicle_type || ""),
          entry_label: String(r.entry_label || shortLabel(r.entry_at) || "")
        };
      }),
      total: list.reduce(function (a, r) { return a + (Number(r.car_cnt) || 1); }, 0)
    };
  }

  /** 报表转成与清单一致的纯文本行（tab 分隔，供复制 / 导出） */
  function reportToText(rep) {
    if (!rep) return "";
    return [rep.title]
      .concat(rep.lines.map(function (l) {
        return [l.plate, l.vehicle_type, l.entry_label].join("\t");
      }))
      .concat(["合计：" + rep.total + "车"])
      .join("\r\n");
  }

  /** 按日期分组（历史批次面板用） */
  function byDate(rows, threshold) {
    var map = {};
    (rows || []).forEach(function (r) {
      var d = String(r.rdate || "").slice(0, 10) || "未标注";
      (map[d] = map[d] || []).push(r);
    });
    return Object.keys(map).sort().reverse().map(function (d) {
      return {
        date: d,
        rows: map[d],
        stats: summarize(map[d], threshold),
        report: buildReport(map[d], { threshold: threshold })
      };
    });
  }

  return {
    parseWorkbook: parseWorkbook,
    parseStrandedList: parseStrandedList,
    parseTableWorkbook: parseTableWorkbook,
    buildReport: buildReport,
    reportToText: reportToText,
    summarize: summarize,
    byDate: byDate,
    dateFromName: dateFromName,
    fmtDateCell: fmtDateCell,
    shortLabel: shortLabel,
    norm: norm,
    num: num,
    text: text,
    today: today
  };
});
