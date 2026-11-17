// ==UserScript==
// @name         B漫章节导出（PDF + ZIP）
// @name:en      BiliManga Chapter Exporter
// @namespace    https://github.com/mdy114514mdy/bili-manga-downloader
// @version      1.3
// @description  哔哩哔哩漫画：章节页一键导出本话 PDF+ZIP；详情页一键下载全本（逐章打包成一个大 ZIP）。零外部依赖。
// @description:en Export one chapter (PDF+ZIP) or the whole series (one big ZIP) on bilibili manga.
// @author       mdy114514mdy
// @match        https://manga.bilibili.com/*
// @icon         https://raw.githubusercontent.com/mdy114514mdy/bili-manga-downloader/main/assets/icon-128.png
// @homepageURL  https://github.com/mdy114514mdy/bili-manga-downloader
// @supportURL   https://github.com/mdy114514mdy/bili-manga-downloader/issues
// @downloadURL  https://raw.githubusercontent.com/mdy114514mdy/bili-manga-downloader/main/bili-manga-downloader.user.js
// @updateURL    https://raw.githubusercontent.com/mdy114514mdy/bili-manga-downloader/main/bili-manga-downloader.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.__bmExportInstalled) return;
  window.__bmExportInstalled = true;

  /* =========================================================
   * 0. 工具
   * =======================================================*/
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('[B漫导出]', ...a);

  /* =========================================================
   * 0.5 抢先保存原生 API
   *    站点在页面脚本里把 toDataURL / toBlob / getImageData 全换成了
   *    混淆过的假函数（toBlob 回调永远不给数据，getImageData 只回
   *    1×1 空白），用来防盗图。必须在 document-start 就把原生引用
   *    存下来，后面一律用 NATIVE.xxx.call()。
   * =======================================================*/
  const NATIVE = (() => {
    const c = HTMLCanvasElement.prototype;
    const ctx = CanvasRenderingContext2D.prototype;
    return {
      toBlob: c.toBlob,
      toDataURL: c.toDataURL,
      getImageData: ctx.getImageData,
      drawImage: ctx.drawImage,
      createImageBitmap: window.createImageBitmap,
      createObjectURL: URL.createObjectURL,
    };
  })();
  window.__bmNativeRefs = NATIVE;

  // 自检：要是在页面脚本之后才跑起来，拿到的就是被混淆过的假函数
  const isNativeFn = (fn) => {
    try { return /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn)); }
    catch (e) { return false; }
  };
  const NATIVE_OK = isNativeFn(NATIVE.toBlob) && isNativeFn(NATIVE.toDataURL);

  /* =========================================================
   * 1. 抓取层（document-start 就要装好）
   *    原理：站点把解密后的原图做成 Blob → createObjectURL →
   *    new Image() → drawImage 到 canvas。canvas 被跨域污染，
   *    但 Blob 本身是可读的，所以把 Blob 截下来就是原图。
   * =======================================================*/
  const url2blob = new Map();  // blob: 地址 → Blob
  const seenBlobs = [];        // 兜底：按出现顺序

  (function hookBlob() {
    try {
      const ou = NATIVE.createObjectURL.bind(URL);
      URL.createObjectURL = function (b) {
        const u = ou(b);
        try {
          if (b && typeof b.size === 'number') { url2blob.set(u, b); seenBlobs.push(b); }
        } catch (e) {}
        return u;
      };
    } catch (e) { log('hook createObjectURL 失败', e); }

    try {
      const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (d && d.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          configurable: true,
          enumerable: true,
          get: function () { return d.get.call(this); },
          set: function (v) {
            try {
              if (typeof v === 'string') {
                if (v.indexOf('blob:') === 0) this.__bmBlobUrl = v;
                else if (/hdslb\.com/.test(v)) this.__bmRemote = v;
              }
            } catch (e) {}
            return d.set.call(this, v);
          },
        });
      }
    } catch (e) { log('hook img.src 失败', e); }

    try {
      const cb = NATIVE.createImageBitmap;
      if (cb) {
        window.createImageBitmap = async function (src, ...rest) {
          const bm = await cb.call(window, src, ...rest);
          try { if (src && typeof src.size === 'number') bm.__bmBlob = src; } catch (e) {}
          return bm;
        };
      }
    } catch (e) { log('hook createImageBitmap 失败', e); }

    try {
      const di = NATIVE.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
        try {
          const c = this.canvas;
          if (src && src.__bmBlobUrl) c.__bmBlobUrl = src.__bmBlobUrl;
          else if (src && src.__bmBlob) c.__bmBlob = src.__bmBlob;
          else if (src && src.__bmRemote) c.__bmRemote = src.__bmRemote;
        } catch (e) {}
        return di.call(this, src, ...rest);
      };
    } catch (e) { log('hook drawImage 失败', e); }
  })();

  /* =========================================================
   * 2. 收集：滚完整话 → 按 canvas 顺序取 Blob → 转 JPEG
   * =======================================================*/
  async function collectPageBlobs(onProgress) {
    const items = Array.from(document.querySelectorAll('.image-item'));
    const total = items.length;

    if (total === 0) {
      throw new Error('没找到图片容器（.image-item）。请确认在漫画章节页，且阅读模式是「滚动」。');
    }

    for (let i = 0; i < total; i++) {
      const el = items[i];
      const target = el.querySelector('canvas') || el;
      try { target.scrollIntoView({ block: 'start' }); } catch (e) {}
      // 末尾几页给足解码时间
      await sleep(i > total - 4 ? 420 : 240);
      if (onProgress) onProgress('加载中', i + 1, total);
    }
    await sleep(700); // 等最后几页解码

    const canvases = Array.from(document.querySelectorAll('canvas'));
    const out = [];
    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i];
      let blob = null;
      if (c.__bmBlobUrl && url2blob.has(c.__bmBlobUrl)) blob = url2blob.get(c.__bmBlobUrl);
      else if (c.__bmBlob) blob = c.__bmBlob;
      else if (c.__bmRemote) {
        // 兜底：明文域直链（同 CDN 一般带 CORS 头）
        try {
          const r = await fetch(c.__bmRemote, { credentials: 'include' });
          if (r.ok) blob = await r.blob();
        } catch (e) {}
      }
      out.push({ index: i, blob });
      if (onProgress) onProgress('提取原图', i + 1, canvases.length);
    }
    return out;
  }

  async function blobToJpeg(blob, quality) {
    const bmp = await NATIVE.createImageBitmap.call(window, blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    // willReadFrequently 让 canvas 走 CPU 后备缓冲，读回（toBlob/toDataURL）更可靠
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();

    let jb = await new Promise((res) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); res(v); } };
      const timer = setTimeout(() => finish(null), 5000);
      try { NATIVE.toBlob.call(cv, (b) => finish(b), 'image/jpeg', quality); } catch (e) { finish(null); }
    });

    // 兜底：toBlob 偶发返回 null（内存压力），改用 toDataURL
    if (!jb) {
      const dataUrl = NATIVE.toDataURL.call(cv, 'image/jpeg', quality);
      if (typeof dataUrl !== 'string' || dataUrl.length < 100) throw new Error('canvas 读回不可用（toBlob/toDataURL 均失败）');
      const bin = atob(dataUrl.split(',')[1] || '');
      const arr = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      jb = new Blob([arr], { type: 'image/jpeg' });
    }

    const size = { w: cv.width, h: cv.height };
    cv.width = 0; cv.height = 0; // 立即释放画布内存
    return { blob: jb, w: size.w, h: size.h };
  }

  /* =========================================================
   * 3. ZIP（STORE，不压缩；JPEG 已经压过）
   * =======================================================*/
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function buildZip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;

      const lh = new Uint8Array(30 + nameBytes.length);
      const dl = new DataView(lh.buffer);
      dl.setUint32(0, 0x04034b50, true);
      dl.setUint16(4, 20, true);
      dl.setUint16(6, 0x0800, true); // UTF-8 文件名
      dl.setUint16(8, 0, true);      // STORE
      dl.setUint16(10, 0, true);
      dl.setUint16(12, 0x21, true);
      dl.setUint32(14, crc, true);
      dl.setUint32(18, size, true);
      dl.setUint32(22, size, true);
      dl.setUint16(26, nameBytes.length, true);
      dl.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, f.data);

      const ch = new Uint8Array(46 + nameBytes.length);
      const dc = new DataView(ch.buffer);
      dc.setUint32(0, 0x02014b50, true);
      dc.setUint16(4, 20, true);
      dc.setUint16(6, 20, true);
      dc.setUint16(8, 0x0800, true);
      dc.setUint16(10, 0, true);
      dc.setUint16(12, 0, true);
      dc.setUint16(14, 0x21, true);
      dc.setUint32(16, crc, true);
      dc.setUint32(20, size, true);
      dc.setUint32(24, size, true);
      dc.setUint16(28, nameBytes.length, true);
      dc.setUint16(30, 0, true);
      dc.setUint16(32, 0, true);
      dc.setUint16(34, 0, true);
      dc.setUint16(36, 0, true);
      dc.setUint32(38, 0, true);
      dc.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + size;
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const c of central) { parts.push(c); centralSize += c.length; }

    const eocd = new Uint8Array(22);
    const de = new DataView(eocd.buffer);
    de.setUint32(0, 0x06054b50, true);
    de.setUint16(4, 0, true);
    de.setUint16(6, 0, true);
    de.setUint16(8, files.length, true);
    de.setUint16(10, files.length, true);
    de.setUint32(12, centralSize, true);
    de.setUint32(16, centralOffset, true);
    de.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
  }

  /* =========================================================
   * 4. PDF（每页一张 JPEG，DCTDecode 直嵌，不重编码）
   * =======================================================*/
  function buildPdf(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let length = 0;

    const push = (d) => {
      const b = typeof d === 'string' ? enc.encode(d) : d;
      chunks.push(b);
      length += b.length;
    };
    const objStart = (n) => { offsets[n] = length; push(n + ' 0 obj\n'); };
    const objEnd = () => push('endobj\n');

    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // 二进制注释

    const n = pages.length;
    const base = 3; // 1=Catalog 2=Pages，之后每页 3 个对象
    const kids = [];
    for (let i = 0; i < n; i++) kids.push(base + i * 3 + ' 0 R');

    objStart(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\n');
    objEnd();

    objStart(2);
    push('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\n');
    objEnd();

    for (let i = 0; i < n; i++) {
      const p = pages[i];
      const W = (p.w * 0.75).toFixed(2); // px → pt (96dpi)
      const H = (p.h * 0.75).toFixed(2);
      const pNum = base + i * 3;
      const cNum = pNum + 1;
      const iNum = pNum + 2;

      objStart(pNum);
      push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] ' +
           '/Resources << /XObject << /Im0 ' + iNum + ' 0 R >> >> ' +
           '/Contents ' + cNum + ' 0 R >>\n');
      objEnd();

      const content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
      objStart(cNum);
      push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\n');
      objEnd();

      objStart(iNum);
      push('<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h +
           ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
           p.jpeg.length + ' >>\nstream\n');
      push(p.jpeg);
      push('\nendstream\n');
      objEnd();
    }

    const xrefPos = length;
    const total = base + n * 3;
    push('xref\n0 ' + total + '\n');
    push('0000000000 65535 f \n');
    for (let i = 1; i < total; i++) {
      push(String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n');
    }
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  /* =========================================================
   * 5. 主流程
   * =======================================================*/
  function chapterName() {
    const t = (document.title || '').split(' - ');
    const epShort = (t[0] || '').trim();
    const bookName = (t[1] || '哔哩哔哩漫画').trim();
    let label = epShort;
    if (/^\d+$/.test(epShort)) label = '第' + epShort + '话';
    const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
    return safe(bookName + ' ' + label);
  }

  /* 下载：必须在隔离的 iframe 里点 <a download>。
     页面在 document 上挂了全局 click 拦截（SPA 路由），直接用页面里的
     <a> 点击会被 preventDefault 并当成站内跳转，落盘的就是首页 HTML
     （4733 字节、开头是 `<!---  Bilibili Manga PC Project`）。 */
  function download(blob, filename) {
    const u = NATIVE.createObjectURL.call(URL, blob);
    let ok = false;
    try {
      const fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0';
      document.documentElement.appendChild(fr);
      const doc = fr.contentDocument;
      const a = doc.createElement('a');
      a.href = u;
      a.download = filename;
      doc.body.appendChild(a);
      a.click();
      ok = true;
      setTimeout(() => { try { URL.revokeObjectURL(u); } catch (e) {} fr.remove(); }, 180000);
    } catch (e) {
      log('iframe 下载不可用，回退页面内链接', e);
    }
    if (!ok) {
      const a = document.createElement('a');
      a.href = u;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(u); } catch (e) {} a.remove(); }, 180000);
    }
  }

  // 终极兜底：dataURL 直链（不经过 blob:，页面拦不到）
  function downloadAsDataUrl(blob, filename) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const a = document.createElement('a');
          a.href = String(fr.result);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => a.remove(), 10000);
          resolve(true);
        } catch (e) { resolve(false); }
      };
      fr.onerror = () => resolve(false);
      fr.readAsDataURL(blob);
    });
  }

  let busy = false;

  async function exportAll(ui) {
    if (busy) return;
    busy = true;
    const t0 = performance.now();
    try {
      if (!NATIVE_OK) {
        throw new Error('脚本没能抢在页面之前加载（canvas 接口已被页面替换）。请在本页按 F5 刷新一次再点导出。');
      }
      ui.status('开始解析本话…');

      const pages = await collectPageBlobs((stage, i, n) => ui.status(stage + ' ' + i + '/' + n, i / n));

      const picked = pages.filter((p) => p.blob);
      if (picked.length === 0) throw new Error('一页都没抓到。可能阅读模式不是「滚动」，或图片还没加载。');

      const jpegs = [];
      let failed = 0;
      for (let i = 0; i < picked.length; i++) {
        try {
          const { blob, w, h } = await blobToJpeg(picked[i].blob, 0.92);
          if (!blob) throw new Error('转码得到空图');
          jpegs.push({ index: picked[i].index, data: new Uint8Array(await blob.arrayBuffer()), w, h });
        } catch (e) {
          failed++;
          (window.__bmErrors = window.__bmErrors || []).push('p' + (picked[i].index + 1) + ': ' + (e && e.stack ? String(e.stack).slice(0, 200) : e));
          log('第 ' + (picked[i].index + 1) + ' 页转码失败', e);
        }
        ui.status('转码 ' + (i + 1) + '/' + picked.length + (failed ? '（失败 ' + failed + '）' : ''), 0.5 + 0.3 * (i / picked.length));
      }
      if (jpegs.length === 0) throw new Error('所有页转码都失败了。');
      jpegs.sort((a, b) => a.index - b.index);

      ui.status('打包 ZIP…', 0.85);
      const name = chapterName();
      const zipBlob = buildZip(jpegs.map((p, i) => ({
        name: String(i + 1).padStart(3, '0') + '.jpg',
        data: p.data,
      })));

      ui.status('生成 PDF…', 0.92);
      const pdfBlob = buildPdf(jpegs.map((p) => ({ jpeg: p.data, w: p.w, h: p.h })));

      const dt = ((performance.now() - t0) / 1000).toFixed(1);
      ui.done(name, pdfBlob, zipBlob, jpegs.length, dt);

      download(pdfBlob, name + '.pdf');
      await sleep(900);
      download(zipBlob, name + '.zip');
    } catch (e) {
      ui.error(e && e.message ? e.message : String(e));
      log('导出失败', e);
    } finally {
      busy = false;
    }
  }

  /* =========================================================
   * 6. UI
   * =======================================================*/
  function isChapterPage() {
    return /^\/mc\d+\/\d+/.test(location.pathname);
  }

  function mountUI() {
    if (!isChapterPage()) return;
    if (document.getElementById('bm-export-root')) return;

    const root = document.createElement('div');
    root.id = 'bm-export-root';
    Object.assign(root.style, {
      position: 'fixed', top: '76px', right: '18px', zIndex: '2147483647',
      font: '13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      color: '#fff', textAlign: 'right', userSelect: 'none',
    });

    const btn = document.createElement('button');
    btn.textContent = '⬇ 导出本话';
    Object.assign(btn.style, {
      padding: '9px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer',
      background: 'linear-gradient(135deg,#fb7299,#fc5c7d)', color: '#fff',
      fontSize: '13px', fontWeight: '600', boxShadow: '0 4px 14px rgba(251,114,153,.45)',
      transition: 'transform .12s',
    });
    btn.onmouseenter = () => (btn.style.transform = 'translateY(-1px)');
    btn.onmouseleave = () => (btn.style.transform = 'none');

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      display: 'none', marginTop: '10px', width: '238px', padding: '12px 14px',
      background: 'rgba(22,22,28,.94)', borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0,0,0,.4)', textAlign: 'left',
      backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.08)',
    });

    const status = document.createElement('div');
    Object.assign(status.style, { color: '#ddd', marginBottom: '8px', wordBreak: 'break-all' });

    const bar = document.createElement('div');
    Object.assign(bar.style, { height: '4px', background: 'rgba(255,255,255,.14)', borderRadius: '2px', overflow: 'hidden' });
    const fill = document.createElement('div');
    Object.assign(fill.style, { height: '100%', width: '0%', background: 'linear-gradient(90deg,#fb7299,#ff9a9e)', transition: 'width .2s' });
    bar.appendChild(fill);

    const actions = document.createElement('div');
    Object.assign(actions.style, { marginTop: '10px', display: 'none', gap: '8px' });

    panel.append(status, bar, actions);
    root.append(btn, panel);
    document.body.appendChild(root);

    const ui = {
      status(text, ratio) {
        panel.style.display = 'block';
        status.textContent = text;
        if (typeof ratio === 'number') fill.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
      },
      done(name, pdfBlob, zipBlob, pages, sec) {
        status.textContent = '✅ 完成：' + pages + ' 页，用时 ' + sec + 's';
        fill.style.width = '100%';
        actions.style.display = 'flex';
        actions.innerHTML = '';
        const mk = (text, blob, fn, color) => {
          const b = document.createElement('button');
          b.textContent = text;
          Object.assign(b.style, {
            flex: '1', padding: '6px 0', border: 'none', borderRadius: '6px',
            cursor: 'pointer', fontSize: '12px', fontWeight: '600',
            background: color, color: '#fff',
          });
          b.onclick = () => download(blob, fn);
          return b;
        };
        actions.append(
          mk('PDF ' + (pdfBlob.size / 1048576).toFixed(1) + 'MB', pdfBlob, name + '.pdf', '#4a90e2'),
          mk('ZIP ' + (zipBlob.size / 1048576).toFixed(1) + 'MB', zipBlob, name + '.zip', '#3aa76d')
        );
        const alt = document.createElement('div');
        alt.style.cssText = 'margin-top:8px;font-size:11px;color:#9aa;cursor:pointer;text-decoration:underline';
        alt.textContent = '文件打不开？点这里换通道重下';
        alt.onclick = () => {
          downloadAsDataUrl(pdfBlob, name + '.pdf');
          setTimeout(() => downloadAsDataUrl(zipBlob, name + '.zip'), 1200);
        };
        panel.appendChild(alt);
      },
      error(msg) {
        panel.style.display = 'block';
        status.innerHTML = '<span style="color:#ff6b6b">✗ ' + msg + '</span>';
        fill.style.width = '0%';
      },
    };

    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.textContent = '解析中…';
      exportAll(ui).finally(() => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = '⬇ 导出本话';
      });
    });
  }

  /* =========================================================
   * 7. 全本下载（仅在详情页 /detail/mcXXXX 生效）
   *    思路：不离开详情页，用隐藏 iframe 逐章加载章节页，
   *    借用章节页里同一份脚本的采集能力，逐章产出 PDF / 图片 ZIP，
   *    最后拼成一个大 ZIP。
   * =======================================================*/
  function chapterLabel(short) {
    return /^\d+$/.test(String(short)) ? '第' + short + '话' : String(short);
  }

  function readChapterList() {
    const m = location.pathname.match(/\/detail\/mc(\d+)/);
    if (!m) return null;
    const comicId = m[1];
    const known = new Set();
    document.querySelectorAll('a[href*="/mc' + comicId + '/"]').forEach((a) => {
      const mm = (a.getAttribute('href') || '').match(/\/mc\d+\/(\d+)/);
      if (mm) known.add(Number(mm[1]));
    });
    const el = document.querySelector('.episode-list');
    const comp = el && (el.__vueParentComponent || el.__vue__);
    const arrs = [];
    try {
      const eff = comp && comp._scope && comp._scope.effects;
      if (eff) {
        for (const k of Object.keys(eff)) {
          const v = eff[k] && eff[k].value;
          if (!Array.isArray(v)) continue;
          for (const sub of v) {
            if (Array.isArray(sub) && sub.length && sub[0] && typeof sub[0].id === 'number' && 'ord' in sub[0]) {
              arrs.push(sub);
            }
          }
        }
      }
    } catch (e) {}
    if (!arrs.length) return null;
    let book = arrs.find((a) => a.some((it) => known.has(it.id)));
    if (!book) {
      book = arrs.find((a) => a.some((it) => Number(it.ord) === 1)) ||
             arrs.slice().sort((a, b) => b.length - a.length)[0];
    }
    const list = book.slice()
      .sort((a, b) => Number(a.ord) - Number(b.ord))
      .map((it) => ({
        id: it.id,
        ord: Number(it.ord),
        short: String(it._shortTitle != null ? it._shortTitle : it.ord),
        locked: !!it.isLocked,
      }));
    const bookName = (document.title || '').split(' - ')[0].trim() || '漫画';
    return { comicId, list, bookName };
  }

  async function fetchChapterJpegs(comicId, ep, onStage) {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:2200px;border:0;' +
                       'opacity:0.01;pointer-events:none;z-index:-99';
    fr.src = '/mc' + comicId + '/' + ep.id;
    document.body.appendChild(fr);
    try {
      const t0 = Date.now();
      let api = null;
      while (Date.now() - t0 < 50000) {
        const w = fr.contentWindow;
        if (w) {
          let ok = false;
          try {
            // 必须等 iframe 真正导航到章节页——about:blank 会沿原型链拿到父窗口的
            // __bmExport，那个函数绑的是详情页的 document，必然找不到 .image-item
            ok = w.location.href.indexOf('/mc' + comicId + '/' + ep.id) > 0 &&
                 w.document.readyState !== 'loading' &&
                 w.document.querySelectorAll('.image-item').length > 0;
          } catch (e) {}
          if (ok) { api = w.__bmExport; break; }
        }
        await sleep(280);
      }
      if (!api) throw new Error('章节页加载超时（未渲染出图片容器）');
      const pages = await api.collectPageBlobs((stage, i, n) => onStage(stage, i, n));
      const pics = pages.filter((p) => p.blob);
      if (!pics.length) throw new Error('没有抓到图片（可能是锁定章节或阅读模式不是滚动）');
      const jpegs = [];
      for (let i = 0; i < pics.length; i++) {
        try {
          const r = await api.blobToJpeg(pics[i].blob, 0.92);
          jpegs.push({
            index: pics[i].index,
            data: new Uint8Array(await r.blob.arrayBuffer()),
            w: r.w, h: r.h,
          });
        } catch (e) { /* 单页失败跳过 */ }
        onStage('转码', i + 1, pics.length);
      }
      jpegs.sort((a, b) => a.index - b.index);
      return jpegs;
    } finally {
      fr.remove();
    }
  }

  async function crc32OfBlob(blob) {
    let c = 0xffffffff;
    const CH = 4 * 1024 * 1024;
    for (let off = 0; off < blob.size; off += CH) {
      const buf = new Uint8Array(await blob.slice(off, off + CH).arrayBuffer());
      for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  /** 流式装配大 ZIP：条目是 Blob，不用把整包读进内存 */
  async function buildZipFromBlobs(entries, onProgress) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i++) {
      const f = entries[i];
      const nameBytes = enc.encode(f.name);
      const crc = await crc32OfBlob(f.blob);
      const size = f.blob.size;

      const lh = new Uint8Array(30 + nameBytes.length);
      const dl = new DataView(lh.buffer);
      dl.setUint32(0, 0x04034b50, true);
      dl.setUint16(4, 20, true);
      dl.setUint16(6, 0x0800, true);
      dl.setUint16(8, 0, true);
      dl.setUint16(10, 0, true);
      dl.setUint16(12, 0x21, true);
      dl.setUint32(14, crc, true);
      dl.setUint32(18, size, true);
      dl.setUint32(22, size, true);
      dl.setUint16(26, nameBytes.length, true);
      dl.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, f.blob);

      const ch = new Uint8Array(46 + nameBytes.length);
      const dc = new DataView(ch.buffer);
      dc.setUint32(0, 0x02014b50, true);
      dc.setUint16(4, 20, true);
      dc.setUint16(6, 20, true);
      dc.setUint16(8, 0x0800, true);
      dc.setUint16(10, 0, true);
      dc.setUint16(12, 0, true);
      dc.setUint16(14, 0x21, true);
      dc.setUint32(16, crc, true);
      dc.setUint32(20, size, true);
      dc.setUint32(24, size, true);
      dc.setUint16(28, nameBytes.length, true);
      dc.setUint16(30, 0, true);
      dc.setUint16(32, 0, true);
      dc.setUint16(34, 0, true);
      dc.setUint16(36, 0, true);
      dc.setUint32(38, 0, true);
      dc.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + size;
      if (onProgress) onProgress(i + 1, entries.length, f.name);
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const c of central) { parts.push(c); centralSize += c.length; }

    const eocd = new Uint8Array(22);
    const de = new DataView(eocd.buffer);
    de.setUint32(0, 0x06054b50, true);
    de.setUint16(4, 0, true);
    de.setUint16(6, 0, true);
    de.setUint16(8, entries.length, true);
    de.setUint16(10, entries.length, true);
    de.setUint32(12, centralSize, true);
    de.setUint32(16, centralOffset, true);
    de.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
  }

  async function bulkDownload(opts, ui) {
    const info = readChapterList();
    if (!info) throw new Error('读不到章节列表，请确认在漫画详情页（/detail/mcXXXX）并等页面加载完');
    const todo = info.list.filter((x) => !x.locked).slice(0, opts.limit || 9999);
    if (!todo.length) throw new Error('没有可下载的章节（全被锁定了）');
    const skipped = info.list.filter((x) => x.locked).length;
    const entries = [];
    const total = todo.length;

    for (let i = 0; i < total; i++) {
      if (ui.isCancelled()) throw new Error('已取消');
      const ep = todo[i];
      const label = chapterLabel(ep.short);
      ui.head(label + '（' + (i + 1) + '/' + total + '）', i / total);
      const jpegs = await fetchChapterJpegs(info.comicId, ep, (stage, a, b) => {
        ui.sub(label + ' · ' + stage + ' ' + a + '/' + b, (i + a / Math.max(1, b)) / total);
      });
      if (opts.pdf) {
        const pdf = buildPdf(jpegs.map((p) => ({ jpeg: p.data, w: p.w, h: p.h })));
        entries.push({ name: label + '.pdf', blob: pdf });
      }
      if (opts.zip) {
        const z = buildZip(jpegs.map((p, k) => ({
          name: String(k + 1).padStart(3, '0') + '.jpg', data: p.data,
        })));
        entries.push({ name: label + '.zip', blob: z });
      }
      jpegs.length = 0;
      await sleep(300);
    }

    ui.head('正在组装 ' + info.bookName + '.zip', 0.97);
    const big = await buildZipFromBlobs(entries, (i, n, name) => {
      ui.sub('打包 ' + i + '/' + n + ' · ' + name, 0.97 + 0.03 * (i / n));
    });
    return { name: info.bookName, blob: big, count: entries.length, skipped, chapters: total };
  }

  function mountBulk() {
    if (!/^\/detail\/mc\d+/.test(location.pathname)) return;
    if (document.getElementById('bm-bulk-root')) return;

    const root = document.createElement('div');
    root.id = 'bm-bulk-root';
    Object.assign(root.style, {
      position: 'fixed', top: '122px', right: '18px', zIndex: '2147483646',
      font: '13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      color: '#fff', textAlign: 'right', userSelect: 'none',
    });

    const btn = document.createElement('button');
    btn.textContent = '⬇ 下载全本 ZIP';
    Object.assign(btn.style, {
      padding: '9px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer',
      background: 'linear-gradient(135deg,#2b62f6,#1b3fcb)', color: '#fff',
      fontSize: '13px', fontWeight: '600', boxShadow: '0 4px 14px rgba(43,98,246,.45)',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      display: 'none', marginTop: '10px', width: '272px', padding: '12px 14px',
      background: 'rgba(22,22,28,.95)', borderRadius: '10px', textAlign: 'left',
      boxShadow: '0 10px 30px rgba(0,0,0,.45)', border: '1px solid rgba(255,255,255,.08)',
    });

    const info = document.createElement('div');
    info.style.cssText = 'color:#cfd6e6;font-size:12px;margin-bottom:8px;line-height:1.6';

    const opt1 = document.createElement('label');
    opt1.style.cssText = 'display:flex;align-items:center;gap:6px;color:#dfe4f0;font-size:12px;margin:4px 0;cursor:pointer';
    opt1.innerHTML = '<input type="checkbox" checked disabled> 生成每章 PDF（必选）';

    const opt2 = document.createElement('label');
    opt2.style.cssText = 'display:flex;align-items:center;gap:6px;color:#dfe4f0;font-size:12px;margin:4px 0;cursor:pointer';
    opt2.innerHTML = '<input type="checkbox" id="bm-opt-zip" checked> 同时打包图片 ZIP（体积翻倍）';

    const go = document.createElement('button');
    go.textContent = '开始';
    Object.assign(go.style, {
      width: '100%', marginTop: '10px', padding: '7px 0', border: 'none',
      borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
      background: '#2b62f6', color: '#fff',
    });

    const status = document.createElement('div');
    status.style.cssText = 'color:#ddd;font-size:12px;margin-top:8px;word-break:break-all;display:none';
    const sub = document.createElement('div');
    sub.style.cssText = 'color:#8b93a7;font-size:11px;margin-top:2px;word-break:break-all;display:none';

    const bar = document.createElement('div');
    bar.style.cssText = 'height:4px;background:rgba(255,255,255,.14);border-radius:2px;overflow:hidden;margin-top:8px;display:none';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#4a84ff,#7aa8ff);transition:width .2s';
    bar.appendChild(fill);

    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.style.cssText = 'width:100%;margin-top:8px;padding:6px 0;border:none;border-radius:6px;' +
                           'cursor:pointer;font-size:12px;background:#3a3a46;color:#ddd;display:none';

    panel.append(info, opt1, opt2, go, bar, status, sub, cancel);
    root.append(btn, panel);

    // 贴到「追漫」按钮右边：用绝对定位按 rect 计算坐标，挂到 body 上。
    // 页面里有多层文字为「追漫」的元素（button.do-favourite 里还套着 div），
    // 直接 insertBefore 很容易插进 overflow:hidden 的小容器被裁掉。
    function findFavBtn() {
      const cands = [...document.querySelectorAll('button.do-favourite')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 60 && r.height > 28;
      });
      if (cands.length) {
        return cands.sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        })[0];
      }
      return [...document.querySelectorAll('button')].find((b) =>
        /^(追漫|取消追漫|已追漫|追番)$/.test((b.innerText || '').trim()));
    }

    document.body.appendChild(root);
    Object.assign(root.style, {
      position: 'absolute', display: 'block', width: 'max-content',
      whiteSpace: 'nowrap', zIndex: '2147483646',
    });
    // 面板必须绝对定位，否则展开时会把 root 撑宽、触发下面的“换边”逻辑
    Object.assign(panel.style, {
      position: 'absolute', top: '100%', right: '0', marginTop: '8px',
      width: '272px',
    });

    function place() {
      const host = findFavBtn();
      if (!host) {
        // 找不到就固定在右上角，避免压在导航上
        Object.assign(root.style, { position: 'fixed', right: '18px', top: '120px', left: 'auto' });
        return;
      }
      const r = host.getBoundingClientRect();
      const right = r.right + window.scrollX + 12;
      const top = r.top + window.scrollY + Math.max(0, (r.height - root.offsetHeight) / 2);
      Object.assign(root.style, {
        position: 'absolute',
        left: right + 'px',
        top: top + 'px',
        right: 'auto',
      });
    }
    place();
    setTimeout(place, 900);
    window.addEventListener('resize', () => setTimeout(place, 120));

    let cancelled = false;
    let running = false;

    const ui = {
      isCancelled: () => cancelled,
      head(t, r) {
        status.style.display = 'block'; bar.style.display = 'block';
        status.textContent = t;
        if (typeof r === 'number') fill.style.width = Math.max(0, Math.min(1, r)) * 100 + '%';
      },
      sub(t, r) {
        sub.style.display = 'block'; sub.textContent = t;
        if (typeof r === 'number') fill.style.width = Math.max(0, Math.min(1, r)) * 100 + '%';
      },
    };

    btn.onclick = () => {
      if (running) return;
      const c = readChapterList();
      info.innerHTML = c
        ? '《' + c.bookName + '》<br>共 ' + c.list.length + ' 章，可下载 ' +
          c.list.filter((x) => !x.locked).length + ' 章' +
          (c.list.some((x) => x.locked) ? '（锁定 ' + c.list.filter((x) => x.locked).length + ' 章将跳过）' : '')
        : '<span style="color:#ff8a8a">没读到章节列表，先等页面加载或刷新</span>';
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    };

    cancel.onclick = () => { cancelled = true; status.textContent = '正在取消…'; };

    go.onclick = async () => {
      if (running) return;
      running = true; cancelled = false;
      go.disabled = true; go.style.opacity = '0.5';
      cancel.style.display = 'block';
      bar.style.display = 'block';
      status.style.display = 'block';
      const opts = { pdf: true, zip: document.getElementById('bm-opt-zip').checked };
      try {
        const r = await bulkDownload(opts, ui);
        status.textContent = '✅ 完成：' + r.chapters + ' 章 / ' + r.count + ' 个文件，' +
                             (r.blob.size / 1048576).toFixed(1) + 'MB' +
                             (r.skipped ? '（跳过锁定 ' + r.skipped + ' 章）' : '');
        fill.style.width = '100%';
        download(r.blob, r.name + '.zip');
      } catch (e) {
        status.innerHTML = '<span style="color:#ff6b6b">✗ ' + (e && e.message ? e.message : e) + '</span>';
      } finally {
        running = false;
        go.disabled = false; go.style.opacity = '1';
        cancel.style.display = 'none';
      }
    };
  }

  // 暴露给控制台手动调用（调试用）
  window.__bmExport = { collectPageBlobs, blobToJpeg, buildZip, buildPdf, chapterName, exportAll, download, downloadAsDataUrl,
    readChapterList, fetchChapterJpegs, buildZipFromBlobs, bulkDownload };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(mountUI, 1200));
  } else {
    setTimeout(mountUI, 1200);
  }
  // SPA 路由切换后补挂按钮
  setInterval(() => {
    if (!document.body) return;
    mountUI();
    mountBulk();
  }, 2000);
})();
