## v1.2 — 详情页一键下载全本

### 这个版本能干什么

打开作品详情页（`https://manga.bilibili.com/detail/mcXXXX`），「追漫」按钮旁边会多出一个蓝色 **「⬇ 下载全本 ZIP」**：

1. 点按钮 → 面板先告诉你这本共几章、其中几章可下载（需购买 / APP 解锁的章节自动跳过，结束时报告跳过数量）
2. 可选是否同时打包每章的**图片 ZIP**：勾上 → 每章出一份 PDF + 一份图片 ZIP；取消勾选 → 只出 PDF，体积减半
3. 点「开始」，脚本在后台用**隐藏 iframe** 逐章加载章节页、采集原图、转码、打包，全程不离开详情页，进度条实时显示「第 3/41 章 · 转码 12/56」
4. 结束后自动下载一个 `<书名>.zip`，内含每章的 PDF（以及可选的图片 ZIP）：

```
好徒儿你就饶了为师伐.zip
├── 楔子.pdf
├── 楔子.zip
├── 第1话.pdf
├── 第1话.zip
└── ...
```

可随时点「取消」中断。

### 实现要点

- **章节列表**：从详情页 Vue 组件的响应式状态（`__vueParentComponent._scope.effects[*].value`）里读，带 `isLocked` 标记，不做任何接口调用
- **逐章采集**：每章放进一个隐藏 iframe（`opacity:0.01` + 视口内定位，保证 IntersectionObserver 正常触发懒加载），借 iframe 里同一份脚本的采集能力
- **流式打包**：大 ZIP 用 Blob 引用拼接（`new Blob([header, blob, ...])`），不把整包读进内存；CRC32 分块计算，峰值内存只有单章大小
- **修复**：iframe 处于 `about:blank` 阶段时会沿原型链拿到父窗口的 `__bmExport`（那份函数绑的是详情页 document，必然找不到 `.image-item`），改为检查 `location.href` 命中章节 URL 且 `.image-item` 已渲染

### 实测

2 章试跑：产出一个 52.7 MB 的 ZIP，内含 `楔子.pdf`(10.4MB) / `楔子.zip`(10.3MB) / `第1话.pdf`(14.8MB) / `第1话.zip`(14.8MB)；外层与内层 ZIP 的 CRC 全部通过，内层 PDF 34 页、图片 ZIP 34 张。40 页一章约 45～60 秒，41 章整本约 25～35 分钟。

**Full Changelog**: https://github.com/mdy114514mdy/bili-manga-downloader/compare/v1.1...v1.2
