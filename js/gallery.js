/* =====================================================================
 * gallery.js — 生活相册：云存储上传 / 换新 / 改描述 / 删除（登录用户可用）
 * 依赖：js/cloud.js（window.Cloud，含 client() 暴露的 SDK 实例）
 * 存储：shared/<uid>/gallery/<uuid>.<ext>（登录用户可读，属主可写/删）
 * 元数据：gallery_items 表（RLS：登录可读；属主或管理员可改/删）
 * 未登录或非托管域名：不调用存储，仅展示静态图片并给出引导文案。
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Cloud;
  var $ = function (s) { return document.querySelector(s); };
  var items = [];        // gallery_items 行（最新在前）
  var urlById = {};      // id -> 签名URL
  var myId = "";
  var admin = false;
  var busy = false;

  var MAX_IMAGE = 15 * 1024 * 1024;   // 15MB
  var MAX_VIDEO = 80 * 1024 * 1024;   // 80MB
  var TTL = 3600;                     // 签名URL有效期（秒，上限3600）

  /* ---------- 小工具 ---------- */
  function tip(msg, ok) {
    var n = $("#galleryNotice");
    if (!n) return;
    n.textContent = msg || "";
    n.style.color = ok === false ? "#dc2626" : ok === true ? "#16a34a" : "#64748b";
  }
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
  function extOf(name, mime) {
    var m = String(name || "").match(/\.([a-zA-Z0-9]{1,8})$/);
    if (m) return "." + m[1].toLowerCase();
    return /^video\//.test(mime || "") ? ".mp4" : ".jpg";
  }
  function isVideoItem(it) { return it.kind === "video" || /^video\//.test(it.mime || ""); }
  function nowISO() { return new Date().toISOString(); }

  /* ---------- 图片压缩（>2MB 且尺寸可缩放时压到 1600px / JPEG 0.85） ---------- */
  function compressImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || file.size <= 2 * 1024 * 1024) return resolve(file);
      var img = new Image();
      var objUrl = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(objUrl);
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, max / Math.max(w, h));
        if (scale >= 1 && file.size <= 4 * 1024 * 1024) return resolve(file);
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        try {
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            resolve(blob && blob.size < file.size ? blob : file);
          }, "image/jpeg", 0.85);
        } catch (e) { resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(objUrl); resolve(file); };
      img.src = objUrl;
    });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var box = $("#cloudGallery");
    if (!box) return;
    if (!items.length) {
      box.innerHTML = C.isLoggedIn()
        ? '<div class="gl-empty">云端相册还是空的——点右上角「上传照片 / 视频」添加第一份记录。</div>'
        : "";
      return;
    }
    box.innerHTML = items.map(function (it) {
      var url = urlById[it.id] || "";
      var canManage = !!myId && (it.owner_id === myId || admin);
      var media = isVideoItem(it)
        ? '<video src="' + esc(url) + '" controls preload="metadata" playsinline></video>'
        : '<img src="' + esc(url) + '" alt="' + esc(it.caption) + '" loading="lazy">';
      var tools = canManage
        ? '<div class="gl-tools">' +
          '<button class="gl-btn" data-act="replace" data-id="' + it.id + '" title="换一个文件">换新</button>' +
          '<button class="gl-btn" data-act="caption" data-id="' + it.id + '" title="修改描述">描述</button>' +
          '<button class="gl-btn danger" data-act="del" data-id="' + it.id + '" title="删除">删除</button>' +
          '</div>'
        : "";
      return '<div class="gallery-item" data-id="' + it.id + '">' + media +
        '<div class="cap">' + esc(it.caption || "未命名") + '</div>' + tools + '</div>';
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll("[data-act]"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var act = btn.dataset.act, id = Number(btn.dataset.id);
        if (act === "replace") replaceItem(id);
        else if (act === "caption") openCaption(id);
        else if (act === "del") removeItem(id);
      });
    });
  }

  /* ---------- 读取 + 签发URL ---------- */
  async function loadItems() {
    var client = C.client && C.client();
    if (!client || !C.isLoggedIn()) { items = []; urlById = {}; render(); return; }
    var res = await client.database.from("gallery_items").select("*").order("created_at", { ascending: false });
    if (res && res.error) { tip("相册加载失败：" + res.error.message, false); return; }
    items = (res && res.data) || [];
    await signAll();
    render();
  }

  /** 批量签发签名URL；按 path 匹配回填，匹配不到再按顺序兜底 */
  async function signAll() {
    urlById = {};
    var client = C.client && C.client();
    if (!client || !items.length) return;
    var paths = items.map(function (it) { return it.storage_path; });
    var res = await client.storage.createSignedUrls(paths, TTL);
    if (res && res.error) { tip("图片链接签发失败：" + res.error.message, false); return; }
    var arr = (res && res.data) || [];
    function pickUrl(p, idx) {
      for (var i = 0; i < arr.length; i++) {
        var key = arr[i] && (arr[i].path || arr[i].key || "");
        if (key && (key === p || key.indexOf(p) > -1 || p.indexOf(key) > -1)) {
          return arr[i].signedUrl || arr[i].signedURL || "";
        }
      }
      var hit = arr[idx];
      return hit ? (hit.signedUrl || hit.signedURL || "") : "";
    }
    items.forEach(function (it, i) { urlById[it.id] = pickUrl(it.storage_path, i); });
  }

  /* ---------- 上传 ---------- */
  async function doUpload() {
    if (busy) return;
    var input = $("#galleryFiles");
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    if (!files.length) { toast("请先选择文件", "warn"); return; }
    var client = C.client && C.client();
    if (!client) { tip("当前域名未接入云服务，无法上传。", false); return; }
    var caption = ($("#galleryCaption").value || "").trim().slice(0, 60);
    var prog = $("#uploadProgress"), bar = prog ? prog.querySelector("i") : null;
    var msg = $("#uploadMsg");
    busy = true;
    $("#doUploadBtn").disabled = true;
    if (prog) prog.style.display = "";
    var okCount = 0, fails = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (msg) msg.textContent = "正在上传 " + (i + 1) + "/" + files.length + "：" + f.name;
      if (bar) bar.style.width = Math.round((i / files.length) * 100) + "%";
      try {
        var isImg = /^image\//.test(f.type), isVid = /^video\//.test(f.type);
        if (!isImg && !isVid) throw new Error("仅支持图片或视频");
        if (isImg && f.size > MAX_IMAGE) throw new Error("图片超过 15MB");
        if (isVid && f.size > MAX_VIDEO) throw new Error("视频超过 80MB");
        var body = isImg ? await compressImage(f) : f;
        var path = client.storage.sharedPath(myId, "gallery/" + uuid() + extOf(f.name, f.type));
        var up = await client.storage.upload(path, body, {
          contentType: f.type || "application/octet-stream",
          cacheControl: "3600"
        });
        if (up && up.error) throw new Error(up.error.message || "上传失败");
        var p = C.state.profile || {};
        var row = {
          storage_path: path,
          kind: isVid ? "video" : "image",
          caption: caption || f.name.replace(/\.[^.]+$/, ""),
          mime: f.type || "",
          size_bytes: body.size || f.size || 0,
          owner_name: p.nickname || p.name || "",
          updated_at: nowISO()
        };
        var ins = await client.database.from("gallery_items").insert(row).select();
        if (ins && ins.error) {
          await client.storage.remove([path]).catch(function () { /* 清理孤儿文件 */ });
          throw new Error(ins.error.message || "保存记录失败");
        }
        okCount++;
      } catch (e) {
        fails.push(f.name + "：" + (e && e.message || e));
      }
    }
    if (bar) bar.style.width = "100%";
    busy = false;
    $("#doUploadBtn").disabled = false;
    if (msg) msg.textContent = "";
    if (prog) setTimeout(function () { prog.style.display = "none"; if (bar) bar.style.width = "0%"; }, 600);
    input.value = "";
    $("#galleryCaption").value = "";
    if (fails.length) tip("部分文件未上传：" + fails.join("；"), false);
    else if (okCount) tip("上传完成，共 " + okCount + " 个文件", true);
    if (okCount) toast("已上传 " + okCount + " 个文件", "ok");
    App.closeModal("uploadModal");
    await loadItems();
  }

  /* ---------- 换新（替换文件） ---------- */
  function replaceItem(id) {
    var it = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) it = items[i];
    if (!it) return;
    var input = document.createElement("input");
    input.type = "file";
    input.accept = isVideoItem(it) ? "video/*" : "image/*";
    input.onchange = async function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var client = C.client && C.client();
      if (!client) return;
      toast("正在替换…", null);
      try {
        var isImg = /^image\//.test(f.type), isVid = /^video\//.test(f.type);
        if (!isImg && !isVid) throw new Error("仅支持图片或视频");
        if (isImg && f.size > MAX_IMAGE) throw new Error("图片超过 15MB");
        if (isVid && f.size > MAX_VIDEO) throw new Error("视频超过 80MB");
        var body = isImg ? await compressImage(f) : f;
        var oldPath = it.storage_path;
        var path = client.storage.sharedPath(myId, "gallery/" + uuid() + extOf(f.name, f.type));
        var up = await client.storage.upload(path, body, {
          contentType: f.type || "application/octet-stream",
          cacheControl: "3600"
        });
        if (up && up.error) throw new Error(up.error.message || "上传失败");
        var patch = {
          storage_path: path,
          kind: isVid ? "video" : "image",
          mime: f.type || "",
          size_bytes: body.size || f.size || 0,
          updated_at: nowISO()
        };
        var u = await client.database.from("gallery_items").update(patch).eq("id", id).select();
        if (u && u.error) throw new Error(u.error.message || "更新失败");
        await client.storage.remove([oldPath]).catch(function () { /* 旧文件清理失败不阻塞 */ });
        toast("已替换", "ok");
        await loadItems();
      } catch (e) {
        toast("替换失败：" + (e && e.message || e), "err");
      }
    };
    input.click();
  }

  /* ---------- 改描述 ---------- */
  function openCaption(id) {
    var it = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) it = items[i];
    if (!it) return;
    $("#captionItemId").value = String(id);
    $("#captionInput").value = it.caption || "";
    App.openModal("captionModal");
  }
  async function saveCaption() {
    var id = Number($("#captionItemId").value);
    var caption = ($("#captionInput").value || "").trim().slice(0, 60);
    var client = C.client && C.client();
    if (!client) return;
    var res = await client.database.from("gallery_items").update({ caption: caption, updated_at: nowISO() }).eq("id", id).select();
    if (res && res.error) { toast(res.error.message, "err"); return; }
    App.closeModal("captionModal");
    toast("描述已更新", "ok");
    await loadItems();
  }

  /* ---------- 删除 ---------- */
  async function removeItem(id) {
    var it = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) it = items[i];
    if (!it) return;
    if (!confirm("确定删除「" + (it.caption || "未命名") + "」？云端文件将一并移除，不可恢复。")) return;
    var client = C.client && C.client();
    if (!client) return;
    var d = await client.database.from("gallery_items").delete().eq("id", id).select();
    if (d && d.error) { toast(d.error.message, "err"); return; }
    await client.storage.remove([it.storage_path]).catch(function () { /* 清理失败不阻塞 */ });
    toast("已删除", "ok");
    await loadItems();
  }

  /* ---------- 初始化 ---------- */
  function refreshChrome() {
    var logged = !!C.isLoggedIn();
    var actions = $("#galleryActions");
    if (actions) actions.classList.toggle("hidden", !logged);
    if (!C.isReady()) tip("相册上传需在 WorkBuddy 托管域名使用（当前为演示模式）。", false);
    else if (!logged) tip("登录后即可上传照片 / 视频到云端相册。", null);
    else tip("", null);
  }
  function syncMe() {
    myId = (C.state.user && C.state.user.id) || "";
    admin = C.isAdmin();
  }
  function init() {
    if (!C) return;
    var uploadBtn = $("#galleryUploadBtn");
    if (uploadBtn) uploadBtn.addEventListener("click", function () {
      if (!C.isLoggedIn()) { location.href = "login.html?next=index.html"; return; }
      App.openModal("uploadModal");
    });
    var doBtn = $("#doUploadBtn");
    if (doBtn) doBtn.addEventListener("click", doUpload);
    var capBtn = $("#saveCaptionBtn");
    if (capBtn) capBtn.addEventListener("click", saveCaption);

    refreshChrome();
    if (C.isReady()) {
      C.restore().then(function () {
        syncMe();
        refreshChrome();
        if (C.isLoggedIn()) loadItems();
      });
    }
    C.onChange(function () {
      syncMe();
      refreshChrome();
      if (C.isLoggedIn()) loadItems();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
