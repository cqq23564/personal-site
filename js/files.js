/* =====================================================================
 * files.js — 文件管理：云存储真实上传 / 下载 / 预览 / 删除（登录用户可用）
 * 依赖：js/cloud.js（window.Cloud，含 client() 暴露的 SDK 实例）
 * 存储：shared/<uid>/files/<uuid>.<ext>（登录用户可读，属主可写/删）
 * 元数据：site_files 表（RLS：登录可读；仅管理员可改/删）
 * 初始台账记录无 storage_path：可查看/导出清单，预览下载给出明确提示。
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Cloud;
  var $ = function (s) { return document.querySelector(s); };
  var files = [];          // site_files 行（最新在前）
  var selected = new Set();
  var myId = "", admin = false;
  var gridMode = true, listTable = null, previewFile = null;
  var MAX_SIZE = 80 * 1024 * 1024;  // 80MB
  var TTL = 300;                    // 下载/预览签名URL有效期（秒）

  function toast(msg, type) { if (window.App && App.toast) App.toast(msg, type); }
  function esc(s) {
    if (window.App && App.esc) return App.esc(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2, 10);
  }
  function extOf(name) {
    var m = String(name || "").match(/\.([a-zA-Z0-9]{1,8})$/);
    return m ? "." + m[1].toLowerCase() : "";
  }
  function typeOf(name, mime) {
    var n = String(name || "").toLowerCase();
    if (/\.pdf$/.test(n)) return "pdf";
    if (/\.(xlsx|xls|xlsm)$/.test(n)) return "excel";
    if (/\.(csv|tsv)$/.test(n)) return "csv";
    if (/^image\//.test(mime || "")) return "image";
    if (/\.(zip|rar|7z)$/.test(n)) return "zip";
    if (/\.(mp4|mov|avi|mkv)$/.test(n)) return "video";
    return "other";
  }
  var typeMap = { excel: "Excel", csv: "CSV", pdf: "PDF", image: "图片", zip: "压缩包", video: "视频", other: "其他" };
  var typeIcon = { excel: "📗", csv: "📄", pdf: "📕", image: "🖼️", zip: "🗜️", video: "🎬", other: "📁" };
  var palette = { Excel: "#16a34a", CSV: "#3b6ef5", PDF: "#dc2626", 图片: "#d97706", 压缩包: "#7c5cff", 视频: "#0891b2", 其他: "#94a3b8" };
  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }
  function nowISO() { return new Date().toISOString(); }

  /* ---------- 行映射 ---------- */
  function toRows(list) {
    return (list || []).map(function (f) {
      return {
        id: "F" + f.id, _nid: f.id, name: f.name,
        type: f.ftype || "other",
        size: f.size_txt || "—",
        owner: f.owner_name || "—",
        time: f.created_at ? String(f.created_at).slice(0, 16).replace("T", " ") : "—",
        downloads: f.downloads || 0,
        storage_path: f.storage_path || "",
        real: !!f.storage_path
      };
    });
  }

  /* ---------- 统计 + 图表 ---------- */
  function renderStats() {
    var rows = toRows(files);
    var downloads = rows.reduce(function (a, b) { return a + (b.downloads || 0); }, 0);
    var tables = rows.filter(function (f) { return f.type === "excel" || f.type === "csv"; }).length;
    var realCnt = rows.filter(function (f) { return f.real; }).length;
    $("#fileStats").innerHTML = `
      <div class="stat-card"><div class="stat-icon blue">📁</div><div><div class="stat-value">${rows.length}</div><div class="stat-label">文件记录</div></div></div>
      <div class="stat-card"><div class="stat-icon green">📊</div><div><div class="stat-value">${tables}</div><div class="stat-label">表格文件</div></div></div>
      <div class="stat-card"><div class="stat-icon orange">⬇️</div><div><div class="stat-value">${downloads}</div><div class="stat-label">累计下载</div></div></div>
      <div class="stat-card"><div class="stat-icon purple">☁️</div><div><div class="stat-value">${realCnt}</div><div class="stat-label">云端实体文件</div></div></div>`;
    var cnt = {};
    rows.forEach(function (f) { var k = typeMap[f.type] || "其他"; cnt[k] = (cnt[k] || 0) + 1; });
    App.renderDonut("#fileChart", Object.keys(cnt).map(function (name) {
      return { name: name, value: cnt[name], color: palette[name] || "#94a3b8" };
    }), { label: "文件类型", unit: "个" });
  }

  /* ---------- 网格渲染 ---------- */
  function renderGrid() {
    var grid = $("#fileGrid");
    var rows = toRows(files);
    if (!rows.length) {
      grid.innerHTML = '<div class="empty"><div class="ico">📂</div>还没有文件——登录后点击上方上传区添加</div>';
      return;
    }
    grid.innerHTML = rows.map(function (f) {
      var on = selected.has(f.id);
      var delBtn = admin ? '<button class="btn-link danger" data-fdel="' + esc(f.id) + '">删除</button>' : "";
      return `
        <div class="file-item" data-fid="${esc(f.id)}" style="${on ? "border-color:var(--primary)" : ""}">
          <div class="fico">${typeIcon[f.type] || typeIcon.other}</div>
          <div class="fname">${esc(f.name)}${f.real ? "" : ' <span class="badge badge-gray plain" style="font-size:10px">台账</span>'}</div>
          <div class="fmeta">${esc(f.size)} · ${esc(f.owner)}</div>
          <div class="fmeta">${esc(f.time)} · 下载 ${f.downloads}</div>
          <div class="flex-center gap-8 mt-8" style="justify-content:center">
            <button class="btn-link" data-fpv="${esc(f.id)}">预览</button>
            <button class="btn-link" data-fdl="${esc(f.id)}">下载</button>
            ${delBtn}
          </div>
          ${on ? '<span class="badge badge-ok plain" style="position:absolute;top:8px;left:8px">已选</span>' : ""}
        </div>`;
    }).join("");
  }

  function updateBar() {
    var bar = $("#fileSelBar");
    var n = selected.size;
    bar.style.display = n ? "flex" : "none";
    var info = $(".sel-info", bar);
    if (info) info.textContent = "已选择 " + n + " 个文件";
  }

  /* ---------- 列表视图 ---------- */
  function buildListTable() {
    if (listTable) return listTable;
    listTable = new App.DataTable({
      el: "#fileTable", data: toRows(files), pageSize: 8, pager: "#filePager",
      keywordEl: "#fileKw", searchKeys: ["name", "owner"],
      filters: [{ key: "type", el: "#fileType" }],
      selectable: true, rowKey: "id",
      columns: [
        { key: "name", title: "文件名", wrap: true, render: v => `<b>${App.esc(v)}</b>` },
        { key: "type", title: "类型", sortable: true, render: v => `<span class="badge badge-gray">${App.esc(typeMap[v] || v)}</span>` },
        { key: "size", title: "大小", sortable: true },
        { key: "owner", title: "上传者", sortable: true },
        { key: "time", title: "时间", sortable: true, render: v => `<span class="mono text-2">${App.esc(v)}</span>` },
        { key: "downloads", title: "下载次数", sortable: true, align: "right" },
        {
          key: "id", title: "操作", render: (v, r) => {
            var del = admin ? '<button class="btn-link danger" onclick="delFile(\'' + v + '\')">删除</button>' : "";
            return '<button class="btn-link" onclick="previewFileById(\'' + v + '\')">预览</button>' +
              '<button class="btn-link" onclick="downloadFile(\'' + v + '\')">下载</button>' + del;
          }
        }
      ]
    });
    return listTable;
  }

  /* ---------- 预览 / 下载 ---------- */
  async function signUrl(path) {
    var client = C.client && C.client();
    if (!client) return "";
    var res = await client.storage.createSignedUrls([path], TTL);
    if (res && res.error) { toast("链接签发失败：" + res.error.message, "err"); return ""; }
    var arr = (res && res.data) || [];
    var hit = arr[0] || {};
    return hit.signedUrl || hit.signedURL || "";
  }

  async function previewFileById(id) {
    var f = toRows(files).find(function (x) { return x.id === id; });
    if (!f) return;
    previewFile = f;
    var bd = $("#previewBody");
    $("#previewName").textContent = "预览 - " + f.name;
    if (!f.real) {
      bd.innerHTML = '<div style="text-align:center;padding:30px 10px">' +
        '<div style="font-size:52px">' + (typeIcon[f.type] || "📁") + '</div>' +
        "<h3 style=\"margin:12px 0 4px\">" + esc(f.name) + "</h3>" +
        '<p class="text-2">' + esc(f.size) + " · " + esc(f.owner) + " · " + esc(f.time) + "</p>" +
        '<p class="text-3" style="margin-top:10px">初始台账记录：仅登记文件信息，无云端实体文件。上传新文件后即可真实预览与下载。</p></div>';
      App.openModal("previewModal");
      return;
    }
    bd.innerHTML = '<div style="text-align:center;padding:30px 10px"><p class="text-2">正在获取访问链接…</p></div>';
    App.openModal("previewModal");
    var url = await signUrl(f.storage_path);
    if (!url) { bd.innerHTML = '<div class="empty"><div class="ico">⚠️</div>链接获取失败，请稍后重试</div>'; return; }
    bd.innerHTML = f.type === "image"
      ? '<img src="' + esc(url) + '" style="border-radius:8px;width:100%">'
      : '<div style="text-align:center;padding:30px 10px"><div style="font-size:52px">' + (typeIcon[f.type] || "📁") + "</div>" +
        "<h3 style=\"margin:12px 0 4px\">" + esc(f.name) + "</h3>" +
        '<p class="text-2">' + esc(f.size) + " · " + esc(f.owner) + "</p>" +
        '<p class="text-3" style="margin-top:10px">该类型不支持在线预览，请下载后查看</p>' +
        '<a class="btn btn-primary mt-16" href="' + esc(url) + '" target="_blank" rel="noopener">📥 下载文件</a></div>';
  }

  async function downloadFile(id) {
    var f = toRows(files).find(function (x) { return x.id === id; });
    if (!f) return;
    if (!f.real) { toast("初始台账记录无云端实体文件，请上传后下载", "warn"); return; }
    toast("正在获取下载链接…", null);
    var url = await signUrl(f.storage_path);
    if (!url) return;
    var a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* 下载次数 +1 */
    var res = await C.tableUpdate("site_files", f._nid, { downloads: (f.downloads || 0) + 1 });
    if (!res.error) { f.downloads = (f.downloads || 0) + 1; renderStats(); renderGrid(); if (listTable) listTable.setData(toRows(files)); }
    toast("开始下载 " + f.name, "ok");
  }
  window.downloadFile = downloadFile;
  window.previewFileById = previewFileById;

  /* ---------- 删除 ---------- */
  window.delFile = async function (id) {
    var f = toRows(files).find(function (x) { return x.id === id; });
    if (!f) return;
    if (!admin) { toast("仅管理员可删除文件", "err"); return; }
    if (!confirm("确定删除「" + f.name + "」？云端文件将一并移除，不可恢复。")) return;
    var res = await C.tableRemove("site_files", f._nid);
    if (res.error) { toast(res.error.message, "err"); return; }
    var client = C.client && C.client();
    if (client && f.storage_path) await client.storage.remove([f.storage_path]).catch(function () { /* 清理失败不阻塞 */ });
    selected.delete(f.id);
    toast("已删除", "ok");
    C.logAction("文件管理", "删除文件", f.name);
    await loadFiles();
  };

  /* ---------- 上传 ---------- */
  async function uploadFiles(fileList) {
    var client = C.client && C.client();
    if (!client) { toast("当前域名未接入云服务，无法上传", "err"); return; }
    var list = Array.prototype.slice.call(fileList || []);
    if (!list.length) return;
    var p = C.state.profile || {};
    var okCount = 0, fails = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try {
        if (f.size > MAX_SIZE) throw new Error("超过 80MB 限制");
        var path = client.storage.sharedPath(myId, "files/" + uuid() + extOf(f.name));
        var up = await client.storage.upload(path, f, {
          contentType: f.type || "application/octet-stream",
          cacheControl: "3600"
        });
        if (up && up.error) throw new Error(up.error.message || "上传失败");
        var row = {
          name: f.name,
          size_txt: fmtSize(f.size),
          ftype: typeOf(f.name, f.type),
          owner_name: p.nickname || p.name || "我",
          storage_path: path,
          updated_at: nowISO()
        };
        var ins = await client.database.from("site_files").insert(row).select();
        if (ins && ins.error) {
          await client.storage.remove([path]).catch(function () { /* 清理孤儿文件 */ });
          throw new Error(ins.error.message || "保存记录失败");
        }
        okCount++;
      } catch (e) {
        fails.push(f.name + "：" + (e && e.message || e));
      }
    }
    if (fails.length) toast("部分文件未上传：" + fails.join("；"), "err");
    if (okCount) { toast("已上传 " + okCount + " 个文件", "ok"); C.logAction("文件管理", "上传文件", okCount + " 个"); }
    await loadFiles();
  }

  /* ---------- 加载 ---------- */
  async function loadFiles() {
    if (!C.isReady()) {
      $("#fileNotice").innerHTML = "当前为演示模式：文件上传需在 WorkBuddy 托管域名使用。";
      $("#fileNotice").className = "page-notice warn";
      $("#fileNotice").style.display = "";
      return;
    }
    if (!C.isLoggedIn()) {
      $("#fileNotice").innerHTML = '文件上传/下载需 <a href="login.html?next=files.html" style="color:inherit;text-decoration:underline">登录</a> 后使用。';
      $("#fileNotice").className = "page-notice warn";
      $("#fileNotice").style.display = "";
      return;
    }
    var res = await C.tableList("site_files", { order: "created_at", asc: false });
    if (res.error) {
      $("#fileNotice").textContent = "读取失败：" + res.error.message;
      $("#fileNotice").className = "page-notice warn";
      $("#fileNotice").style.display = "";
      return;
    }
    files = res.data || [];
    renderStats();
    renderGrid();
    updateBar();
    if (listTable) listTable.setData(toRows(files));
    $("#fileNotice").innerHTML = "共 <b>" + files.length + "</b> 条文件记录，其中 <b>" + files.filter(function (f) { return f.storage_path; }).length + "</b> 个为云端实体文件（登录用户可下载，仅管理员可删除）。";
    $("#fileNotice").className = "page-notice";
    $("#fileNotice").style.display = "";
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    /* 网格：选择 + 按钮 */
    $("#fileGrid").addEventListener("click", function (e) {
      var pv = e.target.closest("[data-fpv]");
      var dl = e.target.closest("[data-fdl]");
      var del = e.target.closest("[data-fdel]");
      if (pv) { previewFileById(pv.dataset.fpv); return; }
      if (dl) { downloadFile(dl.dataset.fdl); return; }
      if (del) { delFile(del.dataset.fdel); return; }
      var item = e.target.closest("[data-fid]");
      if (!item) return;
      var id = item.dataset.fid;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      renderGrid();
      updateBar();
      if (listTable) { listTable.setData(toRows(files)); }
    });

    /* 批量操作 */
    var bar = $("#fileSelBar");
    bar.addEventListener("click", function (e) {
      var act = (e.target.closest("[data-act]") || {}).dataset;
      if (!act || !act.act) return;
      if (act.act === "clear") { selected.clear(); renderGrid(); updateBar(); if (listTable) listTable.setData(toRows(files)); return; }
      if (act.act === "batch-download") {
        var rows = toRows(files).filter(function (f) { return selected.has(f.id); });
        if (!rows.length) return;
        App.exportCSV("文件清单.csv", ["文件名", "类型", "大小", "上传者", "时间", "下载次数", "云端实体"],
          rows.map(function (f) { return [f.name, typeMap[f.type] || f.type, f.size, f.owner, f.time, f.downloads, f.real ? "是" : "否"]; }));
        toast("已导出 " + rows.length + " 条文件清单", "ok");
        return;
      }
      if (act.act === "batch-delete") {
        if (!admin) { toast("仅管理员可批量删除", "err"); return; }
        var dels = toRows(files).filter(function (f) { return selected.has(f.id); });
        if (!dels.length) return;
        if (!confirm("确定删除所选 " + dels.length + " 个文件？云端文件将一并移除。")) return;
        (async function () {
          var ok = 0;
          for (var i = 0; i < dels.length; i++) {
            var r = await C.tableRemove("site_files", dels[i]._nid);
            if (!r.error) {
              ok++;
              var client = C.client && C.client();
              if (client && dels[i].storage_path) await client.storage.remove([dels[i].storage_path]).catch(function () { });
            }
          }
          selected.clear();
          toast("已删除 " + ok + " 个文件", "ok");
          C.logAction("文件管理", "批量删除文件", ok + " 个");
          await loadFiles();
        })();
      }
    });

    /* 上传区：点击 + 拖拽 */
    var zone = $("#uploadZone");
    var input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    zone.addEventListener("click", function () {
      if (!C.isLoggedIn()) { toast("请先登录", "warn"); location.href = "login.html?next=files.html"; return; }
      input.click();
    });
    input.addEventListener("change", function () {
      uploadFiles(input.files);
      input.value = "";
    });
    ["dragover", "dragenter"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.style.borderColor = "var(--primary)"; });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.style.borderColor = ""; });
    });
    zone.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });

    /* 预览弹窗下载按钮 */
    var pdl = $("#previewDownloadBtn");
    if (pdl) pdl.addEventListener("click", function () {
      if (previewFile) downloadFile(previewFile.id);
    });

    /* 视图切换 */
    document.getElementById("viewToggle").addEventListener("click", function () {
      gridMode = !gridMode;
      document.getElementById("gridView").classList.toggle("hidden", !gridMode);
      document.getElementById("listView").classList.toggle("hidden", gridMode);
      this.textContent = gridMode ? "🔳 切换网格/列表" : "📋 切换网格/列表";
      if (!gridMode) buildListTable().setData(toRows(files));
    });

    /* 全量导出清单 */
    document.getElementById("exportAll").addEventListener("click", function () {
      var rows = toRows(files);
      App.exportCSV("文件清单.csv", ["文件名", "类型", "大小", "上传者", "时间", "下载次数", "云端实体"],
        rows.map(function (f) { return [f.name, typeMap[f.type] || f.type, f.size, f.owner, f.time, f.downloads, f.real ? "是" : "否"]; }));
      toast("已导出 " + rows.length + " 条清单", "ok");
    });
  }

  /* ---------- 初始化 ---------- */
  function syncMe() {
    myId = (C.state.user && C.state.user.id) || "";
    admin = C.isAdmin();
  }
  function init() {
    if (!C) return;
    bind();
    syncMe();
    if (C.isReady()) {
      C.restore().then(function () { syncMe(); loadFiles(); });
    } else {
      loadFiles();
    }
    C.onChange(function () { syncMe(); loadFiles(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
