# Changelog

本项目的所有重要变更都记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.3] - 2026-11-17

### 修复
- **详情页按钮位置错误且被裁切**：原来用 `insertBefore` 往 DOM 里插，抓到的是「追漫」按钮内部那层文字 `div`，结果被塞进 `overflow:hidden` 的小容器（宽 102px），按钮只露出半截。改为用 `getBoundingClientRect()` 计算坐标、绝对定位挂在 `body` 上，稳定贴在「追漫 / 已追」按钮右侧 12px、垂直居中，宽 `max-content` 不再被压缩
- 追漫按钮选择器改为 `button.do-favourite`（取可见且面积最大的那个），避免匹配到页面其它位置的同名入口
- 展开的设置面板改为绝对定位，不再挤压按钮所在的那一行

## [1.2] - 2026-11-17

### 新增
- **全本下载**：作品详情页「追漫」按钮旁新增「下载全本 ZIP」，逐章后台采集并合并成一个 `<书名>.zip`
  - 章节列表从详情页 Vue 组件的响应式状态里读取（含 `isLocked`），锁定章节自动跳过
  - 用隐藏 iframe 逐章加载章节页，不离开详情页，可随时取消
  - 可选是否同时打包每章图片 ZIP（不勾则只出 PDF）
  - 流式装配大 ZIP（条目以 Blob 引用拼接，不把整包读进内存）
- 全本进度条：总章进度 + 章内「加载 / 转码 / 打包」三段进度

### 修复
- iframe 就绪判断：`about:blank` 阶段会沿原型链拿到父窗口的 `__bmExport`，导致误判为已加载（那一版绑的是详情页 document，必然找不到 `.image-item`）。改为检查 `location.href` 与 `.image-item` 数量

## [1.1] - 2026-11-17

### 新增
- 隐藏 iframe 下载通道：`<a download>` 放入屏幕外 iframe 点击，规避宿主页面的全局 click 拦截
- dataURL 兜底下载通道：面板底部「文件打不开？点这里换通道重下」
- 原生 canvas API 自检：检测 `toBlob` / `toDataURL` 是否为 `[native code]`，否则提示刷新
- `willReadFrequently` + 5 秒超时的 canvas 转码，失败页自动跳过并统计
- 逐页进度显示（加载 / 提取 / 转码 / 打包）

### 修复
- **下载得到 4733 字节 HTML 而非 PDF/ZIP**：页面 SPA 拦截页面内 `<a download>` 点击导致跳转，改为 iframe 隔离下载
- `blobToJpeg` 传参错误（数组元素未按下标取用）导致全部页转码失败
- `createImageBitmap` 包装层 `this` 绑定错误
- `toBlob` 偶发返回 `null` 时没有兜底路径

### 变更
- PDF 生成改为 DCTDecode 直嵌 JPEG 原始字节，不再二次编码
- 移除对 jsPDF / JSZip 的任何依赖，全部改为脚本内置实现

## [1.0] - 2026-11-17

### 新增
- 首个可用版本
- hook `URL.createObjectURL` / `img.src` / `createImageBitmap` / `drawImage` 抓取前端解密后的原图 Blob
- 自动滚动整话触发懒加载，按 canvas 页序导出
- 内置 ZIP（STORE + CRC32）与 PDF（DCTDecode）生成器
- 右上角导出按钮与进度面板
