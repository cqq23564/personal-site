/* =====================================================================
 * report-template.js — 每日报表：模板上传解析 / 货物名称自动识别 / 按模板统计
 * 依赖：window.XLSX（本地 js/vendor/xlsx.full.min.js）
 * 纯逻辑层，不触碰 DOM；由 query-reports.html 调用。
 *
 * 设计要点（依据用户提供的两份真实样例）：
 *  - 模板「B卡报表」：多工作表；货物统计表形如
 *      A=序号 B=货物名称列 C=车数 D=重量 | E=排序 F=货物名称列 G=车数 H=重量
 *    含「水果合计 / 干货合计 / …合计」等小计行，支持左右多栏。
 *  - 明细「边小口进出记录」：边小进口 表头含
 *      货物名称 / 皮重(千克) / 毛重(千克) / 净重(千克) / 入场时间
 *    统计口径：车数 = 明细行数；重量 = 毛重(千克) ÷ 1000 = 吨（与模板数字逐项吻合）。
 * ===================================================================== */
(function () {
  "use strict";

  var GOODS_HINTS = ["货物名称", "品名", "商品名称", "货类", "货物", "商品", "货名", "goods", "product", "commodity"];
  var WEIGHT_HINTS = ["毛重", "净重", "重量", "地磅重", "皮重", "weight", "gross", "netweight"];
  var CAR_HINTS = ["车数", "车次", "辆", "数量", "计数", "台数", "车"];
  var WT_HINTS = ["重量", "净重", "毛重", "吨", "weight", "t"];
  var NAME_RE = /统计|名称|商品|货物|品名|货类|name|goods/i;
  var SKIP_HEAD = /^(序号|排序|编号|no|index|备注)$/i;
  var TOTAL_RE = /合计|小计|总计|总数/;
  var NON_ITEM_RE = /合计|小计|总|空车|车头|备注|说明|参数|请勿删除|放行|申报|重量|车数/;
  var EMPTY_GOODS = ["", "null", "NULL", "None", "none", "-", "—", "0", "无", "/"];

  function pad2(n) { return String(n).padStart(2, "0"); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function toNum(v) {
    if (v == null || v === "") return 0;
    var n = Number(String(v).replace(/[^\d.\-]/g, ""));
    return isFinite(n) && n > 0 ? n : 0;
  }
  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/[\s\u3000]/g, "")
      .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "")
      .replace(/[（(【\[].*$/, "")
      .replace(/[：:,，.。/\\\-_、]/g, "")
      .toLowerCase();
  }
  function hasContent(row) {
    return (row || []).some(function (c) { return String(c == null ? "" : c).trim() !== ""; });
  }
  /* 在一行里按别名找列：先精确，再包含；返回列索引数组 */
  function findCols(row, hints) {
    var out = [], i, h, nh, c;
    row = row || [];
    for (h = 0; h < hints.length; h++) {
      nh = norm(hints[h]);
      for (i = 0; i < row.length; i++) {
        if (norm(row[i]) === nh && out.indexOf(i) < 0) out.push(i);
      }
    }
    for (h = 0; h < hints.length; h++) {
      nh = norm(hints[h]);
      if (nh.length < 2) continue;
      for (i = 0; i < row.length; i++) {
        c = norm(row[i]);
        if (c.length >= 2 && c.indexOf(nh) > -1 && out.indexOf(i) < 0) out.push(i);
      }
    }
    return out;
  }

  /* ---------- 读取工作簿：全部工作表 → 二维数组 ---------- */
  function readWorkbook(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error("文件读取失败，请重试")); };
      fr.onload = function (e) {
        try {
          if (!window.XLSX) throw new Error("Excel 解析组件未加载，请刷新页面重试");
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
          if (!wb.SheetNames || !wb.SheetNames.length) throw new Error("文件中没有工作表");
          var sheets = wb.SheetNames.map(function (n) {
            var ws = wb.Sheets[n];
            /* 保留空行：导出的报表与上传模板的行布局完全一致 */
            var matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: true });
            return { name: n, matrix: matrix || [] };
          });
          resolve({ wb: wb, sheets: sheets });
        } catch (err) { reject(err); }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------- 解析模板：找「货物名称列 / 车数列 / 重量列」列组与合计行 ---------- */
  function parseTemplate(sheets, filename) {
    var groups = [], items = [], totalRows = [], coreNames = {};
    (sheets || []).forEach(function (sh) {
      var m = sh.matrix || [];
      var headerRow = -1, carCols = [], wtCols = [], r, limit = Math.min(m.length, 14);
      for (r = 0; r < limit; r++) {
        var cars = findCols(m[r] || [], CAR_HINTS);
        var wts = findCols(m[r] || [], WT_HINTS);
        if (cars.length && wts.length) { headerRow = r; carCols = cars; wtCols = wts; break; }
      }
      if (headerRow < 0) return;
      var hdr = m[headerRow] || [];

      /* 阶段 1：为每个「车数列」建立列组 */
      var localGroups = [];
      carCols.forEach(function (carCol) {
        var nameCol = -1, c;
        for (c = carCol - 1; c >= 0; c--) {
          var raw = String(hdr[c] == null ? "" : hdr[c]).trim();
          if (!raw || SKIP_HEAD.test(raw)) continue;
          if (findCols([hdr[c]], CAR_HINTS).length || findCols([hdr[c]], WT_HINTS).length) continue;
          nameCol = c; break;
        }
        if (nameCol < 0) return;
        var headText = String(hdr[nameCol] == null ? "" : hdr[nameCol]).trim();
        if (!NAME_RE.test(headText)) return;   /* 排除「类别」等非货物名称列 */
        var nextCar = 99999;
        carCols.forEach(function (x) { if (x > carCol && x < nextCar) nextCar = x; });
        var wtCol = -1;
        wtCols.forEach(function (w) { if (wtCol < 0 && w > carCol && w < nextCar) wtCol = w; });
        if (wtCol < 0) wtCol = carCol + 1;
        localGroups.push({
          sheet: sh.name, headerRow: headerRow, nameCol: nameCol,
          carCol: carCol, wtCol: wtCol,
          lane: headText || ("第 " + (carCol + 1) + " 组"),
          groupIndex: groups.length + localGroups.length
        });
      });
      if (!localGroups.length) return;
      localGroups.forEach(function (g) { groups.push(g); });

      /* 阶段 2：逐行收集货物项 + 合计行（合计行按 sheet 只收一次） */
      var rowTotals = {};
      for (r = headerRow + 1; r < m.length; r++) {
        var row = m[r] || [];
        if (!hasContent(row)) continue;
        var rowText = row.map(function (x) { return x == null ? "" : String(x); }).join("|");
        if (TOTAL_RE.test(rowText) && /\d/.test(rowText)) {
          var cells = [];
          localGroups.forEach(function (g) {
            [["car", g.carCol], ["weight", g.wtCol]].forEach(function (pair) {
              var col = pair[1];
              var v = row[col];
              if (v != null && v !== "" && (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim()))) {
                cells.push({ col: col, groupIndex: g.groupIndex, kind: pair[0] });
              }
            });
          });
          if (cells.length) {
            rowTotals[r] = { sheet: sh.name, row: r, label: rowText.replace(/\|+/g, " ").trim().slice(0, 40), cells: cells };
          }
          continue;
        }
        localGroups.forEach(function (g) {
          var nm = String(row[g.nameCol] == null ? "" : row[g.nameCol]).trim();
          if (!nm || NON_ITEM_RE.test(nm) || /^\d+(\.\d+)?$/.test(nm)) return;
          items.push({ sheet: sh.name, row: r, name: nm, groupIndex: g.groupIndex, lane: g.lane });
          coreNames[sh.name] = true;
        });
      }
      Object.keys(rowTotals).forEach(function (k) { totalRows.push(rowTotals[k]); });
    });

    /* 丢弃没有任何货物项的列组（例如模板里只有表头的空统计表） */
    var usedGroups = {};
    items.forEach(function (it) { usedGroups[it.groupIndex] = true; });
    var keep = groups.filter(function (g) { return usedGroups[g.groupIndex]; });
    var remap = {};
    keep.forEach(function (g, i) { remap[g.groupIndex] = i; g.groupIndex = i; });
    items = items.filter(function (it) {
      if (remap[it.groupIndex] == null) return false;
      it.groupIndex = remap[it.groupIndex];
      return true;
    });
    /* 核心工作表 = 确实收集到货物项的工作表；合计行也必须属于这些表 */
    coreNames = {};
    items.forEach(function (it) { coreNames[it.sheet] = true; });
    totalRows = totalRows.map(function (t) {
      t.cells = t.cells.filter(function (c) { return remap[c.groupIndex] != null; })
                       .map(function (c) { return { col: c.col, groupIndex: remap[c.groupIndex], kind: c.kind }; });
      return t;
    }).filter(function (t) { return t.cells.length && coreNames[t.sheet]; });

    /* 只保留含货物统计列组的工作表 matrix，用于云端配置与导出回填 */
    var coreSheets = (sheets || []).filter(function (s) { return coreNames[s.name]; })
      .map(function (s) { return { name: s.name, matrix: s.matrix }; });

    return {
      filename: filename || "", parsedAt: new Date().toISOString(),
      sheetCount: (sheets || []).length,
      sheetNames: (sheets || []).map(function (s) { return s.name; }),
      sheets: coreSheets, groups: keep, items: items, totalRows: totalRows,
      coreNames: coreNames
    };
  }

  /* 云端只存精简配置；刷新后据此恢复（含核心工作表 matrix） */
  function buildConfig(tpl) {
    return {
      version: 1, filename: tpl.filename, parsedAt: tpl.parsedAt,
      sheetCount: tpl.sheetCount, sheetNames: tpl.sheetNames,
      sheets: tpl.sheets, groups: tpl.groups, items: tpl.items, totalRows: tpl.totalRows
    };
  }
  function restoreConfig(cfg) {
    if (!cfg || cfg.version !== 1 || !cfg.groups || !cfg.items) return null;
    var names = {};
    (cfg.items || []).forEach(function (it) { names[it.sheet] = true; });
    return {
      filename: cfg.filename || "", parsedAt: cfg.parsedAt || "",
      sheetCount: cfg.sheetCount || 0, sheetNames: cfg.sheetNames || [],
      sheets: cfg.sheets || [], groups: cfg.groups || [],
      items: cfg.items || [], totalRows: cfg.totalRows || [], coreNames: names,
      fromCloud: true
    };
  }

  /* ---------- 货物名称自动识别 ---------- */
  function detectGoods(sheets) {
    var detections = [], skipped = [];
    (sheets || []).forEach(function (sh) {
      var m = sh.matrix || [], headerRow = -1, goodsCol = -1;
      for (var r = 0; r < Math.min(m.length, 8) && goodsCol < 0; r++) {
        var cols = findCols(m[r] || [], GOODS_HINTS);
        if (cols.length) { headerRow = r; goodsCol = cols[0]; }
      }
      if (goodsCol < 0) { skipped.push(sh.name); return; }
      var hdr = m[headerRow] || [];
      var wts = findCols(hdr, WEIGHT_HINTS);
      var weightCol = -1, i;
      for (i = 0; i < wts.length; i++) {
        if (/毛重/.test(String(hdr[wts[i]] || ""))) { weightCol = wts[i]; break; }
      }
      if (weightCol < 0 && wts.length) weightCol = wts[0];
      var headText = weightCol >= 0 ? String(hdr[weightCol] || "") : hdr.join("");
      var divisor = 1, unitLabel = "吨";
      if (/千克|kg/i.test(headText)) { divisor = 1000; unitLabel = "毛重(千克) ÷ 1000 = 吨"; }
      else if (/吨/.test(headText)) { divisor = 1; unitLabel = "吨"; }
      var plates = findCols(hdr, ["车牌号", "车牌", "号牌", "plate"]);
      var times = findCols(hdr, ["入场时间", "时间", "日期", "过卡时间"]);
      detections.push({
        sheet: sh.name, headerRow: headerRow, goodsCol: goodsCol, weightCol: weightCol,
        divisor: divisor, unitLabel: unitLabel,
        plateCol: plates.length ? plates[0] : -1,
        timeCol: times.length ? times[0] : -1
      });
    });
    return { detections: detections, skipped: skipped };
  }

  /* ---------- 按货物名称聚合明细（先统一口径，再合并车数 / 重量） ---------- */
  function aggregate(det, sheets, filename, canonDict) {
    var map = {}, date = "";
    canonDict = canonDict || buildCanonDict(null);
    var fm = String(filename || "").match(/(20\d{2})[-\/.年]?(\d{2})[-\/.月]?(\d{2})/);
    if (fm) date = fm[1] + "-" + fm[2] + "-" + fm[3];
    if (!date) {
      var fm2 = String(filename || "").match(/(20\d{6})/);
      if (fm2) date = fm2[1].slice(0, 4) + "-" + fm2[1].slice(4, 6) + "-" + fm2[1].slice(6, 8);
    }
    (det.detections || []).forEach(function (d) {
      var sh = (sheets || []).filter(function (s) { return s.name === d.sheet; })[0];
      if (!sh) return;
      var m = sh.matrix || [];
      for (var r = d.headerRow + 1; r < m.length; r++) {
        var row = m[r] || [];
        if (!hasContent(row)) continue;
        var rawName = String(row[d.goodsCol] == null ? "" : row[d.goodsCol]).trim();
        if (EMPTY_GOODS.indexOf(rawName) > -1) rawName = "未填写货物";
        /* 统一口径：白 / 红心 / 鲜 火龙果等一律归并为「火龙果」后再累加 */
        var g = rawName === "未填写货物" ? rawName : canonicalGoods(rawName, canonDict);
        var w = d.weightCol >= 0 ? toNum(row[d.weightCol]) / d.divisor : 0;
        if (!map[g]) map[g] = { goods: g, cnt: 0, weight: 0, sources: {}, variants: {} };
        map[g].cnt++;
        map[g].weight += w;
        map[g].sources[d.sheet] = true;
        if (g !== rawName && rawName !== "未填写货物") map[g].variants[rawName] = true;
        if (!date && d.timeCol >= 0) {
          var mm = String(row[d.timeCol] == null ? "" : row[d.timeCol]).match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
          if (mm) date = mm[1] + "-" + pad2(mm[2]) + "-" + pad2(mm[3]);
        }
      }
    });
    var raw = Object.keys(map).map(function (k) {
      var o = map[k];
      return {
        goods: o.goods, cnt: o.cnt, weight: round2(o.weight),
        sources: Object.keys(o.sources).join("、"), variants: Object.keys(o.variants)
      };
    }).sort(function (a, b) { return b.cnt - a.cnt || b.weight - a.weight; });
    return {
      raw: raw, date: date || today(),
      unitLabel: (det.detections[0] && det.detections[0].unitLabel) || "吨",
      detections: det.detections, skipped: det.skipped
    };
  }

  /* ---------- 已汇总报表解析（用户每日下班导入的成品报表，如「B卡报表」） ----------
   * 与逐车明细不同：这类文件里「货物名称 / 车数 / 重量」已按列组汇总好，
   * 另有「类别 / 车数 / 重量」的车辆验放统计表。按表头自动识别列组，
   * 不写死工作表名、卡口名与货物清单，返回可直接写入 site_reports / site_report_goods 的汇总。
   */
  function fmtDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      var d = new Date(v.getTime());
      /* SheetJS 会把 Excel 的「2026-11-07 00:00」解析成 UTC 15:59:17，
       * 在 GMT+8 落成本地 23:59:17（比整日少约 43 秒），直接 getDate() 会退回前一天。
       * 把贴近次日午夜的异常值吸附到次日，消除 1900 历元 / 时区转换误差。 */
      var mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
      if (mins >= 23 * 60 + 58) d = new Date(d.getTime() + 5 * 60 * 1000);
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }
    return "";
  }
  function dateFromName(filename) {
    var fm = String(filename || "").match(/(20\d{2})[-\/.年]?(\d{1,2})[-\/.月]?(\d{1,2})/);
    if (fm) return fm[1] + "-" + pad2(fm[2]) + "-" + pad2(fm[3]);
    var f2 = String(filename || "").match(/(20\d{6})/);
    if (f2) return f2[1].slice(0, 4) + "-" + f2[1].slice(4, 6) + "-" + f2[1].slice(6, 8);
    return "";
  }

  function parseDailyReport(sheets, filename, canonDict) {
    var all = sheets || [], date = "", rawItems = [], metrics = [];
    var goodsSheets = {}, classSheets = {};

    /* 1) 统计日期：文件名优先（用户按当天命名，最可靠），单元格日期兜底。
     *    Excel 整日日期经 SheetJS 可能偏一天，故不让它覆盖文件名日期。 */
    date = dateFromName(filename);
    if (!date) {
      for (var si = 0; si < all.length && !date; si++) {
        var mm = all[si].matrix || [];
        for (var r0 = 0; r0 < Math.min(mm.length, 4) && !date; r0++) {
          var row0 = mm[r0] || [];
          for (var c0 = 0; c0 < Math.min(row0.length, 5); c0++) {
            var v = row0[c0];
            if (v instanceof Date) { date = fmtDate(v); if (date) break; }
            var mt = String(v == null ? "" : v).match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
            if (mt) { date = mt[1] + "-" + pad2(mt[2]) + "-" + pad2(mt[3]); break; }
          }
        }
      }
    }
    if (!date) date = today();

    /* 2) 逐表按表头识别「货物列组」与「车辆类别列组」 */
    all.forEach(function (sh) {
      var m = sh.matrix || [], headerRow = -1, carCols = [], wtCols = [];
      for (var r = 0; r < Math.min(m.length, 12); r++) {
        var cc = findCols(m[r] || [], CAR_HINTS), ww = findCols(m[r] || [], WT_HINTS);
        if (cc.length && ww.length) { headerRow = r; carCols = cc; wtCols = ww; break; }
      }
      if (headerRow < 0) return;
      var hdr = m[headerRow] || [], groups = [];
      carCols.forEach(function (carCol) {
        var nameCol = -1;
        for (var c = carCol - 1; c >= 0; c--) {
          var raw = String(hdr[c] == null ? "" : hdr[c]).trim();
          if (!raw || SKIP_HEAD.test(raw)) continue;
          if (findCols([hdr[c]], CAR_HINTS).length || findCols([hdr[c]], WT_HINTS).length) continue;
          nameCol = c; break;
        }
        if (nameCol < 0) return;
        var headText = String(hdr[nameCol] == null ? "" : hdr[nameCol]).trim();
        var nextCar = 99999;
        carCols.forEach(function (x) { if (x > carCol && x < nextCar) nextCar = x; });
        var wtCol = -1;
        wtCols.forEach(function (w) { if (wtCol < 0 && w > carCol && w < nextCar) wtCol = w; });
        if (wtCol < 0) wtCol = carCol + 1;
        groups.push({ nameCol: nameCol, carCol: carCol, wtCol: wtCol,
                      lane: headText, isGoods: NAME_RE.test(headText) });
      });
      if (!groups.length) return;
      var hasGoods = groups.some(function (g) { return g.isGoods; });
      if (hasGoods) goodsSheets[sh.name] = true; else classSheets[sh.name] = true;

      for (var rr = headerRow + 1; rr < m.length; rr++) {
        var row = m[rr] || [];
        if (!hasContent(row)) continue;
        groups.forEach(function (g) {
          var nm = String(row[g.nameCol] == null ? "" : row[g.nameCol]).trim();
          if (!nm) return;
          var cars = toNum(row[g.carCol]), wt = toNum(row[g.wtCol]);
          /* 合计行 / 车辆类别行 → 指标；不参与货物名称归并 */
          if (TOTAL_RE.test(nm) || /空车|车头|重车|退运|总车数|类别/.test(nm) || !g.isGoods) {
            metrics.push({ sheet: sh.name, label: nm, cars: cars, weight: wt, goodsSheet: g.isGoods });
            return;
          }
          if (NON_ITEM_RE.test(nm) || /^\d+(\.\d+)?$/.test(nm) || (!cars && !wt)) return;
          rawItems.push({ name: nm, cnt: cars, weight: wt, lane: g.lane, sheet: sh.name });
        });
      }
    });

    /* 3) 统一货物名称口径：词库 = 内置 + 本报表货物项（报表标准名优先）+ 模板/参数扩展 */
    var dict = buildCanonDict(rawItems.map(function (x) { return { name: x.name }; }));
    if (canonDict) {
      Object.keys(canonDict).forEach(function (k) { if (dict[k] == null) dict[k] = canonDict[k]; });
    }
    var gmap = {};
    rawItems.forEach(function (x) {
      var canon = canonicalGoods(x.name, dict);
      if (!gmap[canon]) gmap[canon] = { goods: canon, cnt: 0, weight: 0, lanes: {}, variants: {} };
      gmap[canon].cnt += x.cnt;
      gmap[canon].weight += x.weight;
      gmap[canon].lanes[x.lane] = true;
      if (canon !== x.name) gmap[canon].variants[x.name] = true;
    });
    var goods = Object.keys(gmap).map(function (k) {
      var o = gmap[k];
      return { goods: o.goods, cnt: o.cnt, weight: round2(o.weight),
               lanes: Object.keys(o.lanes), variants: Object.keys(o.variants) };
    }).sort(function (a, b) { return b.cnt - a.cnt || b.weight - a.weight; });

    /* 4) 汇总指标：入区车数 / 重量由货物项推导，空车与出区取「合计 / 类别」行 */
    var inHeavy = goods.reduce(function (s, g) { return s + g.cnt; }, 0);
    var inWeight = round2(goods.reduce(function (s, g) { return s + g.weight; }, 0));
    var inEmpty = metrics.filter(function (x) { return x.goodsSheet && /空车|车头/.test(x.label); })
                         .reduce(function (s, x) { return s + x.cars; }, 0);
    var explicitIn = metrics.filter(function (x) { return x.goodsSheet && /总车数/.test(x.label) && x.cars > 0; });
    var inCars = explicitIn.length ? explicitIn[explicitIn.length - 1].cars : inHeavy + inEmpty;

    var outM = metrics.filter(function (x) { return !x.goodsSheet; });
    var outTotalRows = outM.filter(function (x) { return /合计|总计/.test(x.label) && x.cars > 0; });
    var outCars = outTotalRows.length ? outTotalRows[outTotalRows.length - 1].cars
      : outM.reduce(function (s, x) { return s + x.cars; }, 0);
    var outWtRows = outM.filter(function (x) { return /合计|总计/.test(x.label) && x.weight > 0; });
    var outWeight = round2(outWtRows.length ? outWtRows[outWtRows.length - 1].weight
      : outM.reduce(function (s, x) { return s + x.weight; }, 0));
    var outHeavy = outM.filter(function (x) { return /重车/.test(x.label); })
                       .reduce(function (s, x) { return s + x.cars; }, 0);
    var outEmpty = outM.filter(function (x) { return /空车/.test(x.label); })
                       .reduce(function (s, x) { return s + x.cars; }, 0);

    return {
      date: date, gate: "", source: filename || "",
      sheetNames: all.map(function (s) { return s.name; }),
      goodsSheets: Object.keys(goodsSheets), classSheets: Object.keys(classSheets),
      goods: goods, metrics: metrics,
      totals: {
        inCars: inCars, inHeavy: inHeavy, inEmpty: inEmpty, inWeight: inWeight,
        outCars: outCars, outHeavy: outHeavy, outEmpty: outEmpty, outWeight: outWeight,
        goodsKinds: goods.length
      }
    };
  }

  /* ---------- 货物名称统一口径（用户诉求核心） ----------
   * 白火龙果 / 红心火龙果 / 鲜火龙果 / 火龙果(越南) … 一律按「火龙果」计算。
   * 做法：清洗（去括号 / 空白）→ 剥离前缀修饰词（鲜 / 红心 / 白 / 进口…）→
   *       仅当结果命中「标准货物名词库」时才采用，避免把「白砂糖 / 红豆」误并。
   * 词库 = 内置常见货物 + 用户上传模板的货物项（模板即权威清单，随模板变化）。
   */
  var BASE_GOODS = [
    "火龙果", "菠萝蜜", "木薯淀粉", "服务器用电路板组件", "液晶显示屏", "相机镜头",
    "电路板组件", "扩展卡", "榴莲", "芒果", "菠萝", "龙眼", "荔枝", "山竹", "红毛丹",
    "百香果", "香蕉", "西瓜", "椰青", "椰子", "木瓜", "哈密瓜", "柑橘", "橙子",
    "苹果", "葡萄", "柚子", "红枣", "粽叶", "草绳", "主板", "淀粉", "坚果", "干果",
    "白砂糖", "红豆", "白糖", "黄糖", "红糖", "大米", "玉米", "木薯", "橡胶", "家具"
  ];
  var MOD_PREFIX = /^(鲜|新鲜|冰鲜|冷冻|冻|冷藏|进口|国产|特级|一级|二级|三级|精品|优质|大果|小果|中果|大|小|红白心|红心|白心|白肉|红肉|青皮|黄皮|白|红|青|黄|金|紫|越南|泰国|老挝|缅甸)+/;

  function cleanGoods(s) {
    return String(s == null ? "" : s)
      .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "")
      .replace(/[\s\u3000]/g, "")
      .trim();
  }
  function stripPrefix(c) {
    var prev, core = c;
    do { prev = core; core = core.replace(MOD_PREFIX, ""); } while (core !== prev && core.length >= 2);
    return core;
  }
  /* 词典：key = 清洗名 / 核心名，value = 统一后的标准显示名 */
  function buildCanonDict(items) {
    var dict = {};
    BASE_GOODS.forEach(function (n) {
      var c = cleanGoods(n);
      if (c.length >= 2) dict[c] = c;             /* 内置词库本身即标准名，不剥前缀 */
    });
    (items || []).forEach(function (it) {
      var c = cleanGoods(it.name);
      if (!c || c.length < 2) return;
      var core = stripPrefix(c);
      if (core !== c && core.length >= 2) {
        /* 模板项带修饰词（如「鲜火龙果」）→ 归并到已有标准词 */
        var hit = dict[core] || "";
        if (!hit) {
          var bl = 0;
          Object.keys(dict).forEach(function (k) {
            if (k.length >= 2 && (core.indexOf(k) > -1 || k.indexOf(core) > -1) && k.length > bl) {
              hit = String(dict[k]); bl = k.length;
            }
          });
        }
        dict[c] = hit || core;
        if (!dict[core]) dict[core] = hit || core;
      } else {
        dict[c] = c;                              /* 模板项本身即标准名（如「主板，扩展卡」） */
      }
    });
    return dict;
  }
  function canonicalGoods(s, dict) {
    var original = String(s == null ? "" : s).trim();
    var c = cleanGoods(s);
    if (!c) return original;
    var core = stripPrefix(c);
    dict = dict || buildCanonDict(null);
    if (core.length >= 2 && dict[core]) return String(dict[core]);   /* 先按剥前缀核心命中 */
    if (dict[c]) return String(dict[c]);                              /* 再按原名命中（保护「白砂糖」） */
    var best = "", bestLen = 0;                                       /* 最后子串最长匹配兜底 */
    Object.keys(dict).forEach(function (k) {
      if (k.length >= 2 && (c.indexOf(k) > -1 || core.indexOf(k) > -1) && k.length > bestLen) {
        best = String(dict[k]); bestLen = k.length;
      }
    });
    return best || original || c;
  }
  /* 兼容旧调用：归一化后用于模板项匹配评分，与统计口径保持一致 */
  function normGoods(s) { return canonicalGoods(s, null); }
  function matchScore(goods, name) {
    if (goods === name) return 3;
    var a = normGoods(goods), b = normGoods(name);
    if (a && a === b) return 2;
    if (a.length >= 2 && b.length >= 2 && (a.indexOf(b) > -1 || b.indexOf(a) > -1)) return 1;
    return 0;
  }
  /* 每条明细货物只归属到「最佳匹配」的一个模板项，避免重复计数 */
  function matchItems(raw, items) {
    var assign = {}, ri, ii;
    (raw || []).forEach(function (r, idx) {
      if (r.goods === "未填写货物") return;
      var best = -1, bestScore = 0;
      (items || []).forEach(function (it, j) {
        var sc = matchScore(r.goods, it.name);
        if (sc > bestScore) { bestScore = sc; best = j; }
      });
      if (best >= 0) assign[idx] = best;
    });
    var byTemplate = (items || []).map(function (it, j) {
      var hits = [], cnt = 0, weight = 0;
      (raw || []).forEach(function (r, idx) {
        if (assign[idx] === j) {
          hits.push(r.goods + "(" + r.cnt + ")" +
            (r.variants && r.variants.length ? "〔含 " + r.variants.join("、") + "〕" : ""));
          cnt += r.cnt; weight += r.weight;
        }
      });
      return {
        sheet: it.sheet, row: it.row, groupIndex: it.groupIndex, lane: it.lane,
        name: it.name, cnt: cnt, weight: round2(weight), matched: hits.join("、")
      };
    });
    var unmatched = (raw || []).filter(function (r, idx) {
      return assign[idx] == null && r.goods !== "未填写货物";
    });
    var blank = (raw || []).filter(function (r) { return r.goods === "未填写货物"; })[0] || null;
    return { byTemplate: byTemplate, unmatched: unmatched, blank: blank };
  }

  /* ---------- 按模板格式回填，生成可导出的多工作表报表 ---------- */
  function buildFilled(tpl, result, meta) {
    meta = meta || {};
    var val = {};
    /* 键必须带 groupIndex：同一行可能同时属于左右两个货物列组 */
    (result.byTemplate || []).forEach(function (b) { val[b.sheet + "|" + b.row + "|" + b.groupIndex] = b; });
    var out = [];
    (tpl.sheets || []).forEach(function (sh) {
      var m = (sh.matrix || []).map(function (row) { return (row || []).slice(); });
      /* 1) 货物行填新车数 / 新重量 */
      (tpl.items || []).forEach(function (it) {
        if (it.sheet !== sh.name) return;
        var g = (tpl.groups || [])[it.groupIndex];
        var v = val[it.sheet + "|" + it.row + "|" + it.groupIndex];
        var row = m[it.row];
        if (!g || !row) return;
        row[g.carCol] = v ? v.cnt : 0;
        if (g.wtCol >= 0) row[g.wtCol] = v ? v.weight : 0;
      });
      /* 2) 合计行：按「上一个合计行之后、本合计行之前」的同组货物行重新求和；
            区间内没有货物行则保留模板原值（多为含空车等的全局口径）。 */
      var totals = (tpl.totalRows || []).filter(function (t) { return t.sheet === sh.name; })
        .sort(function (a, b) { return a.row - b.row; });
      var lastByGroup = {};
      totals.forEach(function (t) {
        (t.cells || []).forEach(function (cell) {
          var g = (tpl.groups || [])[cell.groupIndex];
          if (!g) return;
          var prev = lastByGroup[cell.groupIndex] == null ? g.headerRow : lastByGroup[cell.groupIndex];
          var seg = (tpl.items || []).filter(function (it) {
            return it.sheet === sh.name && it.groupIndex === cell.groupIndex && it.row > prev && it.row < t.row;
          });
          if (!seg.length) return;
          var sum = 0;
          seg.forEach(function (it) {
            var v = val[it.sheet + "|" + it.row + "|" + it.groupIndex];
            if (v) sum += (cell.kind === "weight" ? v.weight : v.cnt);
          });
          if (m[t.row]) m[t.row][cell.col] = cell.kind === "weight" ? round2(sum) : sum;
        });
        (t.cells || []).forEach(function (cell) { lastByGroup[cell.groupIndex] = t.row; });
      });
      out.push({ name: sh.name, rows: m });
    });

    /* 3) 附表：按模板归类 / 货物统计明细 / 数据来源说明 */
    out.push({
      name: "按模板归类",
      rows: [["工作表", "分类列", "货物名称", "车数", "重量(吨)", "匹配到的明细货物"]].concat(
        (result.byTemplate || []).map(function (b) {
          return [b.sheet, b.lane, b.name, b.cnt, b.weight, b.matched];
        }))
    });
    out.push({
      name: "货物统计明细",
      rows: [["统一货物名称", "车数", "重量(吨)", "来源工作表", "合并来源（原始货名）", "归类情况"]].concat(
        (result.raw || []).map(function (r) {
          var hit = (result.byTemplate || []).filter(function (b) {
            return b.matched && b.matched.indexOf(r.goods + "(") > -1;
          })[0];
          return [r.goods, r.cnt, r.weight, r.sources,
            (r.variants || []).join("、"),
            hit ? "→ " + hit.name : (r.goods === "未填写货物" ? "空值（未参与模板归类）" : "未列入模板")];
        }))
    });
    out.push({
      name: "数据来源说明",
      rows: [
        ["项目", "说明"],
        ["报表模板", tpl.filename || meta.templateName || "（未上传）"],
        ["明细数据", meta.detailName || "（本次导入）"],
        ["统计日期", meta.date || ""],
        ["统计口径", "车数 = 明细行数；重量 = " + (meta.unitLabel || "毛重(千克) ÷ 1000 = 吨")],
        ["货物名称识别", "自动识别明细表头中的「货物名称 / 品名 / 商品名称」列；无表头的工作表已跳过"],
        ["货物名称统一口径", "白火龙果 / 红心火龙果 / 鲜火龙果 / 火龙果(产地) 等一律归并为「火龙果」；去括号、空白与鲜/红心/白/进口等前缀修饰词，命中标准货物名词库后合并车数与重量"],
        ["归类规则", "统一口径后的货名先精确匹配模板清单，再按归一化匹配；每条明细只归入一个最佳匹配项"],
        ["合计行", "按模板内货物行重新求和；区间内无货物行的合计行保留模板原值"],
        ["模板范围", "导出包含模板中的货物统计工作表及统计附表；模板内的原始明细工作表不重复导出"],
        ["", ""],
        ["声明", "本站未与任何生产业务系统对接；导入内容由使用者提供并自行负责，本站不校验、不背书其真实性"]
      ]
    });
    return out;
  }

  window.ReportTpl = {
    readWorkbook: readWorkbook,
    parseTemplate: parseTemplate,
    buildConfig: buildConfig,
    restoreConfig: restoreConfig,
    detectGoods: detectGoods,
    aggregate: aggregate,
    parseDailyReport: parseDailyReport,
    matchItems: matchItems,
    buildFilled: buildFilled,
    buildCanonDict: buildCanonDict,
    canonicalGoods: canonicalGoods,
    normGoods: normGoods,
    today: today,
    round2: round2
  };
})();
