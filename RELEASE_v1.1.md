## B漫章节导出 v1.1 — 一键把整话漫画导成 PDF + ZIP

给哔哩哔哩漫画章节页加一个按钮：点一下，脚本自动把**这一话从头滚到尾**、抓下每一页的**原图**，然后打包成一份 PDF 和一份 ZIP 直接下载。纯浏览器端运行，不装服务、不调接口、零外部依赖。

### 这个脚本能干什么

**一句话**：打开任意一话 → 点右上角「⬇ 导出本话」→ 得到 `书名 第N话.pdf` + `书名 第N话.zip`。

**具体能力**

- **抓全一话**：自动滚动整话触发懒加载，按页面顺序逐页采集，漏页会提示。实测 29～70 页的一话，12～18 秒出包。
- **拿的是原图，不是截屏**：宽度 1088px 的长条原图，比例与线上完全一致。不会像截图方案那样把 1088×2111 的原图压进正方形框里拉伸变形。
- **同时产出两种格式**
  - `PDF`：每页一张图，页面尺寸按图片实际比例生成（如 816×1584 pt），DCTDecode 直嵌 JPEG 原始字节，不二次编码、不掉画质，适合手机阅读和直接打印。
  - `ZIP`：`001.jpg … NNN.jpg` 逐页编号，STORE 模式不压缩（JPEG 已压缩，再 deflate 纯属浪费 CPU），CRC32 校验完整。
- **文件名自动取页面标题**：`好徒儿你就饶了为师伐 第6话.pdf`，不用手动改名。
- **进度可见**：浮动面板依次显示「加载中 12/36 → 提取原图 → 转码 → 打包」，完成后保留两个下载按钮，可随时重下。
- **单页失败不中断**：某一页转码异常会被跳过并计数，其余页照常产出，最后统一报告成功数量。
- **两条下载通道**：默认走隐藏 iframe；若系统或页面拦截导致文件异常，面板底部的「文件打不开？点这里换通道重下」会改用 dataURL 直链。E 盘根目录那 4 个 4733 字节的坏文件就是旧版本踩到的坑，v1.1 已修复。

### 技术上绕过了什么

这是 v1.1 相对 v1.0 的最重要改动，也是这个脚本能跑通的前提：

1. **加密图片流** —— 新版接口（`mangaup.hdslb.com` + `cpx`）返回加密字节流，响应头写着 `text/plain`，直接下是乱码。脚本不去逆接口，而是截获前端**解密后**的 Blob：hook `URL.createObjectURL` 拿 Blob，用 `drawImage` 把 `canvas.__bmBlobUrl` 反查回对应数据。

2. **canvas 读回 API 被替换** —— 站点把 `toDataURL` / `toBlob` 换成混淆假函数（返回 `undefined` / 回调不给数据），`getImageData` 直接改成 `() => new ImageData(1, 1)`。脚本靠 `@run-at document-start` 抢在页面脚本之前保存原生引用，之后一律 `NATIVE.toBlob.call(...)`；并带 `[native code]` 自检，没抢到就提示刷新。

3. **`<a download>` 点击被拦截** —— SPA 在 `document` 上挂全局 click 拦截，页面内的下载链接被 `preventDefault()` 当站内跳转，落盘成 4733 字节的首页 HTML。v1.1 改成在屏幕外的隐藏 `<iframe>` 里点击，事件不冒泡到父页面。

4. **不依赖任何 CDN** —— jsPDF / JSZip 全部替换为内置实现：ZIP 用 STORE + CRC32 + 中央目录 + EOCD；PDF 每页三个对象（Page / 内容流 / Image XObject），图片用 `/Filter /DCTDecode` 直嵌，xref 表逐对象记录字节偏移。断网、墙掉 jsdelivr 都不影响。

### 安装

装 [Tampermonkey](https://www.tampermonkey.net/) → 点下方脚本链接安装 → **在漫画页按一次 F5**。

```text
https://raw.githubusercontent.com/mdy114514mdy/bili-manga-downloader/main/bili-manga-downloader.user.js
```

### 已知限制

- 阅读模式必须是「滚动」（PC 默认就是），横向翻页模式只渲染当前页，抓不到全话；
- 需要购买或走 APP 解锁的章节拿不到图，导出结果是空或占位图；
- 只处理当前一话，整部批量请配合仓库外的 Python 脚本循环。

### 校验过的产物

- PDF：`/Type /Page` 计数与页数一致，xref 表 111 个对象偏移逐个对得上，PyMuPDF 渲染首屏正常；
- ZIP：`zipfile.testzip()` CRC 全通，首图为 1088×2111 可正常解码。

**Full Changelog**: https://github.com/mdy114514mdy/bili-manga-downloader/compare/v1.0...v1.1
