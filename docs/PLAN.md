# 开瓶器 Bottlecap · 实施计划

> 配套文档：[DESIGN.md](./DESIGN.md)
> 依据：qishui-pipeline.md（已跑通记录）+ 本机实测（2026-11-09）
> 估算按单人全职，单位：工作日。

---

## 0. 本轮实测结论（影响计划）

| 项 | 结果 | 对计划的影响 |
|---|---|---|
| 本机客户端 | 3.5.1，`bdms.node` 存在 | 可继续 |
| 本机 sessionid | 32 位可读，但 `/luna/pc/me` 返回 1000016「登录状态已失效」 | 必须先做扫码登录；现有 cookie 不能用于验收 |
| 签名 | `X-Helios / X-Medusa` 正常生成，track_v2 返回 200 + 24KB JSON | 签名链路可用 |
| 曲目质量 | 失效态只返回 30.047s / AAC 68k、132k | 需完整登录账号才能验证 FLAC |
| 扫码端点 | `GET api.qishui.com/passport/web/get_qrcode/` 返回 200，data 含 `qrcode`(data URL)、`token`、`expire_time` | **扫码登录可行**，无需逆向 passport |
| 轮询端点 | `POST /passport/web/check_qrconnect/`，token + 固定参数；sessionid 来自 Set-Cookie | 计划按此实现 |
| 歌单接口 | `/luna/pc/me/playlist`、`/luna/pc/playlist/detail`（需登录后验证字段） | M0 验证 |
| 离线样本 | `D:\Fabric_Dev\qishui-lab\enc.flac.mp4`（32MB）+ `out.flac`（32MB） | 解密逻辑可离线回归 |

> 说明：PopDownloader 只做登录/歌单，不做签名，其 track_v2 必然空 body。
> 本项目 = PopDownloader 的登录 + 文档的签名解密 + 自研 UI。

---

## 1. v1 验收标准

1. 首次启动可在应用内扫码登录，登录后展示昵称/头像/会员状态，并自动列出「我创建的」「我收藏的」全部歌单。
2. 粘贴 19 位 track_id / 分享短链 / 分享文案，能解析出曲目并显示封面、歌手、时长、可用音质。
3. 有效会员账号下，FLAC 曲目可完整下载并解密为可播放 FLAC；试听片段必须被识别并拒绝。
4. 输出格式可选「原格式 / FLAC / MP3 / WAV」，转码成功后 ffprobe 校验通过。
5. 封面、标题、歌手、专辑、歌词写入文件；可选生成同名 `.lrc`。
6. 队列并发 ≥ 2，支持暂停/取消/重试/移除；重启应用后历史仍在。
7. 所有失败都有阶段 + 可读原因 + 重试入口；不出现"转圈无响应"。
8. 窗口 1280×820 与 1024×680 下均无布局破损；键盘可完成核心操作。

---

## 2. 里程碑

### M0 · 技术验证（2 天）— 先证明能跑，再写 UI

| # | 任务 | 产出 / 验收 |
|---|---|---|
| 0.1 | electron-vite + React 19 骨架跑通 | `pnpm dev` 出窗口 |
| 0.2 | **Electron 主进程加载 bdms.node**（注入 PATH，init did） | 成功：主进程直跑；失败：spawn 系统 Node ≥22.5；再失败：随包 `node.exe` |
| 0.3 | 扫码登录全流程（get_qrcode → 轮询 → sessionid → `/luna/pc/me`） | 真实扫码一次，昵称/会员字段入库 |
| 0.4 | 有效账号下 track_v2 拿 FLAC 变体 + 试听判定 | 记录变体、时长、码率 |
| 0.5 | 离线解密回归：enc.flac.mp4 → 32,043,005 字节 FLAC，MD5/ffprobe 一致 | 单元测试通过 |
| 0.6 | AAC 变体解密可行性 + ADTS 组装 + ffmpeg 转码（用试听样本） | 产出可播 mp3/flac 或明确否决 |
| 0.7 | 歌单接口字段与分页（我创建 / 我收藏） | 字段表写入 docs/api-notes.md |
| 0.8 | ffmpeg 封面/歌词/标签写入验证 | 一条命令模板定稿 |

**M0 出口**：一个 Node CLI `scripts/spike.ts` 能输出 `{ me, playlistCount, track, variants, outFlac }`，
并附一页 `docs/api-notes.md`。若 0.6 失败，降级为"仅 FLAC，AAC 提示不支持"。

> 风险最高的是 0.2 与 0.4：0.2 决定要不要带 Node 运行时；0.4 需要有效会员账号做一次真实拉取。

---

### M1 · 工程骨架与设计系统（2 天）

- 目录、TS 配置、ESLint/Prettier、路径别名、环境变量。
- 设计 token（CSS 变量）+ Tailwind v4 主题；纸纹、字体、细线、印刷阴影。
- 自绘标题栏（最小化/最大化/关闭 + 拖拽区）、侧边栏、页面容器、路由。
- 基础组件：Button、IconButton、Input、Segmented、Switch、Select、ProgressLine、Tooltip、Dialog、Toast、Skeleton、EmptyState、DataTable。
- 5 个页面的空框架与三态（空/加载/错误），全部 mock 数据。

**验收**：无业务逻辑下，导航、空态、弹窗、Toast、键盘焦点全部可用；视觉稿 `docs/mockup.html` 对得上。

---

### M2 · 核心下载链路（3.5 天）

- 输入解析：19 位 ID、`qishui.douyin.com/s/...`、分享文案、H5 链接。
- 身份：读 DeviceV1、生成/持久化设备号、客户端版本探测。
- 签名客户端：URL + headers 严格序，一次一签；错误映射。
- track_v2：变体列表、FLAC 优先、试听判定、会员字段解析。
- 下载：stream 写 `.part`，进度/速度/ETA，取消/断点清理。
- 解密：spade_key → AES-CTR 逐样本 → `fLaC + dfLa[4:] + samples`。
- 命名与落盘：模板、非法字符、同名去重（`(2)`）、原子重命名。
- IPC + 事件推送 + 错误码；Inspector 详情/日志。

**验收**：单曲 FLAC 端到端 < 20s（不含转码）；断网/取消/无权限/试听四类错误文案正确。

---

### M3 · 队列、历史、设置（2.5 天）

- 调度器：并发 1–4（默认 2）、FIFO、每任务状态机、重试退避（1/2/4s）。
- 暂停/恢复/取消/移除；应用重启恢复未完成任务（标记为已暂停）。
- 历史：持久化（原子写 JSON）、按日期分组、打开文件/文件夹、重新下载、删除记录。
- 设置：输出目录、格式、MP3 码率、并发、命名模板（实时预览）、元数据开关、ffmpeg 路径、客户端目录。
- 窗口状态、托盘（显示/退出）、关闭行为。

**验收**：并发 2 下 5 首批量任务稳定；强退重启后历史与设置不丢。

---

### M4 · 登录、歌单、搜索（3 天）

- 扫码登录窗口：二维码 data URL、倒计时、已扫描/已确认/过期/失败、自动刷新、取消。
- 本机登录态：一键读取 + 失效提示 + 重新读取。
- 歌单：我创建 + 我收藏（分页/去重）、歌单详情分页、全选/反选、批量入队。
- 搜索：`/luna/pc/search/track`（签名），关键字/游标分页，音质徽章，直接下载。
- 账号卡片：头像、昵称、会员状态、退出登录。

**验收**：扫码一次成功；100 首歌单可完整拉取并批量入队；搜索无结果/未登录有空态。

---

### M5 · 转码、元数据、歌词（2.5 天）

- AAC → ADTS → ffmpeg 封装 m4a / 转 FLAC / MP3 / WAV；转码进度映射。
- MP3：libmp3lame 320k（可设 128/192/256/320）；WAV：pcm_s16le。
- 元数据：标题/歌手/专辑/年份/曲目号 + 封面（attached_pic）+ 歌词。
- 歌词：QRC 解析 → LRC（行级）+ 纯文本兜底；`.lrc` 可选。
- ffprobe 校验时长/编码；失败不给"完成"状态。
- 磁盘空间预检（≥ 150MB）。

**验收**：四种输出格式各出一首；Windows 资源管理器显示封面；歌词与音频对齐。

---

### M6 · 打磨、打包、QA（2.5 天）

- 动效与骨架屏统一；`prefers-reduced-motion`；aria 与焦点顺序。
- 日志（脱敏）、崩溃兜底、错误上报到本地文件。
- electron-builder NSIS 安装包；应用图标；版本信息；首次启动引导。
- 全量回归清单 + 3 个真实账号/曲目场景（FLAC、仅 AAC、试听）。

**验收**：干净 Windows 机器安装后可扫码登录并下载；卸载不留垃圾（保留用户数据可选）。

---

## 3. 任务总表（按依赖排序）

| ID | 任务 | 预估 | 依赖 |
|---|---|---|---|
| T01 | bdms 加载 spike（主进程 / 子进程 / node.exe） | 0.5d | — |
| T02 | 扫码登录 spike | 0.5d | — |
| T03 | 签名 + FLAC 真机拉取 | 0.5d | T02 |
| T04 | 离线解密回归 fixture | 0.5d | — |
| T05 | AAC 解密/ADTS spike | 0.5d | T03 |
| T06 | 歌单字段调研 | 0.5d | T02 |
| T07 | 工程骨架 + 设计 token | 1d | — |
| T08 | 基础组件库 | 1d | T07 |
| T09 | 自绘标题栏 + 侧栏 + 路由 | 0.5d | T07 |
| T10 | 输入解析 + 身份/签名模块 | 1d | T01,T03 |
| T11 | track_v2 + 变体选择 + 错误码 | 0.5d | T10 |
| T12 | 下载流 + 进度 + 临时文件 | 1d | T10 |
| T13 | spade + MP4 + AES + FLAC 重组 | 1.5d | T04 |
| T14 | 命名/落盘/去重 | 0.5d | T13 |
| T15 | 队列调度器 | 1.5d | T12 |
| T16 | 历史/设置持久化 | 1d | T15 |
| T17 | 扫码登录 UI + 本机登录 | 1d | T02 |
| T18 | 歌单列表/详情 + 批量入队 | 1.5d | T06,T15 |
| T19 | 搜索页 | 1d | T11 |
| T20 | ffmpeg 转码管线 | 1d | T05,T13 |
| T21 | 标签/封面/歌词 | 1d | T20 |
| T22 | ffprobe 校验 + 空间预检 | 0.5d | T20 |
| T23 | 动效/骨架/无障碍 | 1d | T08 |
| T24 | 打包 + 图标 + 安装测试 | 1d | 全部 |
| T25 | 回归 + 缺陷修复 | 1.5d | 全部 |

---

## 4. 工程结构

```
qsdownloader/
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.json
├─ docs/            DESIGN.md · PLAN.md · mockup.html · api-notes.md
├─ resources/       icon.ico · bin/(ffmpeg? node?)
├─ src/
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ windows/{main,login}.ts
│  │  ├─ ipc/register.ts
│  │  ├─ qishui/{identity,cookie,signer,track,search,playlist,auth}.ts
│  │  ├─ media/{spade,mp4,aac,download,transcode,tags,lyrics,naming,verify}.ts
│  │  ├─ queue/{scheduler,state}.ts
│  │  └─ store/{settings,history,atomic}.ts
│  ├─ preload/index.ts
│  ├─ renderer/
│  │  ├─ index.html
│  │  └─ src/{app,pages,components,features,hooks,lib,styles}
│  └─ shared/{types,ipc,errors,constants}.ts
├─ tests/{unit,integration,fixtures}
└─ scripts/{spike.ts,make-fixtures.mjs}
```

### 依赖（2026-11 实际最新）

```
electron 45.2.3            electron-vite 6.0.0      electron-builder 26.18.0
react 19.3.1               react-router-dom 7.18.5  vite 8.3.6
typescript 7.0.2           tailwindcss 4.3.5        framer-motion 14.10.1
zustand 5.1.0              @tanstack/react-query 5.107.1
@phosphor-icons/react 2.1.10   zod 4.6.7
```

> Tailwind v4 用 `@tailwindcss/vite`，不写 postcss 插件；TS 7 需确认 electron-vite 6 的兼容性（M0 验证，必要时锁 5.9）。

---

## 5. 运行时与打包策略

| 方案 | 体积 | 体验 | 建议 |
|---|---|---|---|
| A. 全内置（node.exe + ffmpeg + ffprobe） | 安装包 ~260MB | 双击即用，零依赖 | 首选发布版 |
| B. 仅内置 ffmpeg，Node 用 Electron 自带 | ~180MB | 若主进程能加载 bdms 则最优 | 若 M0 0.2 成功 |
| C. 全部依赖系统 | ~120MB | 需用户装 Node 22+ 与 ffmpeg | 开发/极简版 |

- `asarUnpack`：不需要；bdms.node 从客户端目录加载，不随包分发（许可证+版本绑定）。
- 图标：纸感唱片套 + 开瓶器简笔；ICO 16–256。
- 不自动更新；提供"检查客户端版本"提示。

---

## 6. 测试计划

**单元（vitest）**
- `spadeKey`：固定 spade_a → 32 位 hex；异常输入返回空。
- MP4 解析：stsz/senc/mdat 偏移；box 64 位头。
- 文件名模板：非法字符、超长、去重。
- QRC→LRC：行切分、毫秒取整。

**集成（node）**
- 离线 fixture 解密（enc.flac.mp4 → out.flac，大小/MD5 对比）。
- ffmpeg 转码 + ffprobe 校验（MP3/FLAC/WAV/M4A）。
- 歌单分页合并与去重（mock JSON）。

**端到端（Playwright for Electron）**
- 首次启动 → 扫码登录（mock 后端）→ 歌单 → 批量入队 → 完成 → 历史可见。
- 错误注入：空 body、试听、磁盘满、ffmpeg 缺失。

**真机验收（人工）**
- 有效会员：FLAC 完整曲、仅 AAC 曲、试听曲各一首。
- 并发 3、暂停/恢复、强退重启。

fixture 不提交仓库（32MB）：`scripts/make-fixtures.mjs` 从 `D:\Fabric_Dev\qishui-lab` 复制，或在 M0 重新拉取。

---

## 7. 风险登记册

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | Electron 45 的 Node ABI 无法加载 bdms.node | 中 | 高 | 子进程系统 Node；随包 node.exe；M0 首日验证 |
| R2 | sessionid 频繁失效 / 扫码风控 | 中 | 高 | 登录态检测、自动提示重扫、保留本机登录兜底 |
| R3 | 歌单接口需要签名或字段变动 | 中 | 中 | 复用签名器；M0 记录字段；空态可回退本机登录 |
| R4 | AAC 加密结构不同（senc/esds） | 中 | 中 | M0 用试听 AAC 验证；失败则首版仅 FLAC |
| R5 | 客户端更新导致 UA/version_code 失配 | 高（长期） | 高 | 版本探测 + 设置项覆盖 + 错误提示升级客户端 |
| R6 | 账号无会员导致只能试听 | 高 | 中 | 明确文案，不假装成功 |
| R7 | ffmpeg 体积/许可证 | 低 | 低 | LGPL 构建或检测系统；设置可指定路径 |
| R8 | 合规与账号风险 | 中 | 高 | 仅本机、个人使用声明、不内置分享/分发功能 |

---

## 8. 待确认（不阻塞 M0）

1. **视频**：是否需要下载 MV / 视频并提取音频？（当前设计只做音频，工作量 +3 天）
2. **打包体积**：接受 ~260MB 全内置安装包，还是做"轻量版 + 首次使用下载 ffmpeg"？
3. **默认格式**：默认「原格式」还是「FLAC」？目录默认 `音乐\Bottlecap` 可以吗？
4. **歌词**：嵌入文件 + 生成 `.lrc` 都做，还是只要嵌入？

---

## 9. 时间线（建议）

```
第 1 周  M0 验证 + M1 骨架
第 2 周  M2 核心链路
第 3 周  M3 队列 + M4 登录/歌单
第 4 周  M5 转码/元数据 + M6 打磨打包 + 回归
```

约 18 个工作日；M0 若 R1/R4 触发，追加 1–2 天。
