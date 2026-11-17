# Changelog

本项目的所有重要变更都记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
