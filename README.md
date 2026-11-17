# bili-manga-downloader

<p align="center">
  <img src="assets/icon-256.png" width="120" alt="bili-manga-downloader icon">
</p>

> 哔哩哔哩漫画章节导出用户脚本 —— 在章节页右上角点一下，把本话全部**原图**抓下来，打包成 **PDF** 和 **ZIP** 两个文件。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-5.x%2B-orange)](https://www.tampermonkey.net/)
[![Version](https://img.shields.io/badge/version-1.1-brightgreen)](https://github.com/mdy114514mdy/bili-manga-downloader/releases)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success)](.)

一个纯浏览器端的用户脚本（UserScript），零外部依赖、不装服务、不调第三方接口。下载得到的是**与原图同尺寸、同比例**的图片，不是截屏。

---

## ✨ 特性

| 特性 | 说明 |
| --- | --- |
| **一键导出** | 章节页右上角固定一个按钮，点一下全程自动：滚动加载 → 提取原图 → 转码 → 打包 → 下载 |
| **原图尺寸** | 宽度 1088px 的长条原图，比例与线上完全一致（不是 canvas 截屏，不会拉伸变形） |
| **双格式产物** | 同时生成 `.pdf`（每页一张图，200dpi 视觉等效）和 `.zip`（`001.jpg … NNN.jpg`） |
| **零依赖** | 不引入 jsPDF / JSZip / CDN，PDF 与 ZIP 都是脚本内自己写的（约 190 行），断网也能用 |
| **绕过三道反爬** | 应对加密图片流、被劫持的 canvas API、全局 click 拦截，详见[工作原理](#-工作原理) |
| **进度可见** | 浮动面板实时显示「加载中 12/36 → 提取原图 → 转码 → 打包」，完成后留两个按钮可重下 |
| **失败不中断** | 单页转码失败会跳过并继续，最后统一报告成功页数 |
| **自动命名** | 文件名取自页面标题，如 `好徒儿你就饶了为师伐 第6话.pdf` |
| **全本下载** | 详情页「追漫」旁多一个按钮，逐章后台下载并合并成一个 `<书名>.zip`，章节进度实时显示 |

## 📦 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（Edge / Chrome / Firefox 均可）；
2. 点这里安装脚本：[**bili-manga-downloader.user.js**](https://raw.githubusercontent.com/mdy114514mdy/bili-manga-downloader/main/bili-manga-downloader.user.js)
   （Tampermonkey 会弹出安装页，点「安装」即可）；
3. 或手动：Tampermonkey 面板 → 添加新脚本 → 清空模板 → 粘贴本仓库的 `.user.js` → `Ctrl+S`。

> ⚠️ 装好或更新脚本后，**在漫画页按一次 F5**。脚本需要在页面自己的 JS 之前运行（`@run-at document-start`），否则拿不到原生 canvas API。
>
> ⚠️ Chrome 首次连续下载两个文件时，地址栏右侧可能提示「此网站尝试下载多个文件」，点**允许**即可。

## 🚀 使用

1. 打开任意章节页，例如 `https://manga.bilibili.com/mc29040/540942`；
2. 右上角出现粉色按钮 **「⬇ 导出本话」**，点它；
3. 面板开始跑进度，脚本会自动把整话从头滚到底（触发懒加载）；
4. 完成后自动下载 `书名 第N话.pdf` 和 `书名 第N话.zip`，面板上同时保留两个按钮可重下。

```
示例输出（29 页的一话，约 12 秒）
好徒儿你就饶了为师伐 第6话.pdf     8.8 MB
好徒儿你就饶了为师伐 第6话.zip     8.8 MB   001.jpg … 029.jpg
```

**如果文件打不开**：面板底部有「文件打不开？点这里换通道重下」，走 dataURL 直链再下一遍。

### 全本下载（作品详情页）

打开作品详情页，例如 `https://manga.bilibili.com/detail/mc29040`，「追漫」按钮旁边会出现蓝色 **「⬇ 下载全本 ZIP」**：

1. 点按钮 → 面板显示本书共几章、其中几章可下载（需购买/APP 解锁的章节自动跳过，并在结束时报告数量）
2. 勾选是否同时打包每章的**图片 ZIP**（不勾就只出 PDF，体积减半）
3. 点「开始」，脚本会在后台用隐藏 iframe 逐章加载章节页 → 采图 → 转码 → 打包，进度条实时显示「第 3/41 章 · 转码 12/56」
4. 全部完成后自动下载一个 `<书名>.zip`，结构如下：

```
好徒儿你就饶了为师伐.zip
├── 楔子.pdf          # 每章一份 PDF
├── 楔子.zip          # 每章一份图片 ZIP（可选）
├── 第1话.pdf
├── 第1话.zip
├── 第2话.pdf
└── ...
```

整个流程不离开详情页，可以随时点「取消」中断。耗时参考：40 页左右的一章约 45～60 秒，41 章的整本约 25～35 分钟。

## 🧠 工作原理

B 站漫画页有三层防护，脚本逐个绕开：

### 1. 图片是加密流的

新版接口（`mangaup.hdslb.com` + `cpx` 参数）返回的是加密字节流，响应头甚至是 `text/plain`，直接下载得到的是乱码。前端自己用 wasm 解密后才画到 canvas。

**绕过方式**：不去逆接口，直接截获前端**解密后**的产物 —— hook `URL.createObjectURL` 拿到 `Blob`，再用 `CanvasRenderingContext2D.prototype.drawImage` 把 `canvas.__bmBlobUrl` 反查回对应的 Blob，按 canvas 的 DOM 顺序即为页序。

### 2. canvas 读回 API 被替换

站点把三个关键方法换成了混淆过的假函数：

| 方法 | 被替换成 |
| --- | --- |
| `HTMLCanvasElement.prototype.toDataURL` | 混淆函数，返回 `undefined` |
| `HTMLCanvasElement.prototype.toBlob` | 混淆函数，回调永远不返回数据 |
| `CanvasRenderingContext2D.prototype.getImageData` | `() => new ImageData(1, 1)` |

**绕过方式**：`@run-at document-start` 抢在页面脚本之前把原生函数存进 `NATIVE`，之后一律 `NATIVE.toBlob.call(cv, …)`。脚本还带自检（`/\{\s*\[native code\]\s*\}/`），如果没能抢先，会直接提示「请按 F5 刷新」。

### 3. 页面拦截 `<a download>` 点击

SPA 在 `document` 上挂了全局 click 拦截，页面内创建的 `<a download>` 被 `preventDefault()` 后当成站内跳转 —— 落盘的是 **4733 字节的首页 HTML**（开头 `<!---  Bilibili Manga PC Project`），看起来「下载成功」其实打不开。

**绕过方式**：把 `<a download>` 放进挂在 `documentElement` 上、屏幕外的隐藏 `<iframe>` 里点击。iframe 是独立文档，click 事件不冒泡到父页面；另外备了一条 `FileReader → dataURL` 的下载通道。

### 4. PDF / ZIP 自己生成

- **ZIP**：STORE 模式（JPEG 已压缩，无需 deflate）+ CRC32 查表 + 中央目录 + EOCD，文件名 flag 置 `0x0800` 支持中文。
- **PDF**：每页三个对象（Page / 内容流 / 图片 XObject），图片用 `/Filter /DCTDecode` **直接嵌入 JPEG 原始字节**，不重编码、不掉画质；MediaBox 单位换算 pt = px × 0.75；最后写 xref 表逐对象记录字节偏移。

## ❓ 常见问题

**Q：点导出没反应 / 提示「没找到图片容器」。**
A：阅读模式必须是「滚动」（B 站 PC 默认就是）。如果切成了横向翻页，页面只渲染当前一页，脚本抓不到全话。在阅读器设置里改回滚动模式。

**Q：提示「请按 F5 刷新一次再点导出」。**
A：脚本注入时序晚于页面脚本，导致没抢到原生 canvas API。刷新一次即可。

**Q：导出的页数比实际少。**
A：多半是某几页还没解码完就被采集了。重跑一次；仍缺页说明该话有未解锁内容（见下条）。

**Q：锁定章节能导出吗？**
A：不能。需要购买或走 APP 解锁的章节，页面本身不下发图片，导出结果会是空或占位图。

**Q：手机上能用吗？**
A：能。iOS / iPadOS 上装 **Stay**（Edge / Safari 的用户脚本扩展）再装本脚本即可，已实测能完整导出；macOS Safari 配 Tampermonkey 同样通过。手机端生成 PDF 稍慢，建议一次导一话。

**Q：支持整部批量下载吗？**
A：本脚本只处理**当前一话**。整部批量需要另一个仓库里的 Python 工具链（headless Chrome + Blob 提取），按话循环即可。

**Q：PDF 里的图为什么不再压缩一下？**
A：JPEG 已经是有损压缩产物，二次编码只会掉画质。DCTDecode 直嵌是画质与体积的最优解。

## ⚙️ 兼容性

| 环境 | 状态 |
| --- | --- |
| Chrome / Edge 桌面版 120+（Tampermonkey） | ✅ 实测通过 |
| Safari + Tampermonkey（macOS） | ✅ 实测通过（2026-11-17 实测） |
| iOS / iPadOS Edge + **Stay** 扩展 | ✅ 实测通过（2026-11-17 实测，手机端也能完整导出） |
| Firefox 120+（Tampermonkey） | ✅ 理论可用（未做专项测试） |

移动端补充说明：iOS 上导出同样能跑通，但 Safari 系内核对单页 canvas 内存更保守，页数特别多的大话（60 页以上）偶尔会掉一两页。脚本会把这些页计入「失败 N」并在面板上提示，重跑一次通常能补齐。

## 📁 仓库结构

```
bili-manga-downloader/
├── bili-manga-downloader.user.js   # 用户脚本本体（单文件，约 570 行）
├── assets/                         # 图标（含 GitHub 社交预览图）
├── README.md
├── CHANGELOG.md
├── LICENSE
└── .gitignore
```

## 📜 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## ⚠️ 免责声明

本工具仅用于**个人已购/已解锁内容的离线备份与阅读**，不提供任何破解能力，也不会绕过付费墙。请勿用于二次分发或任何商业用途；漫画版权归原作者与平台所有。

## 📄 License

[MIT](LICENSE) © 2026 mdy114514mdy
