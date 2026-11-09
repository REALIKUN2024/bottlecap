# 开瓶器 Bottlecap · 汽水音乐下载器
## 产品与界面设计规范 v1（2026-11-09）

> 依据：`D:\Fabric_Dev\DangoMusic-main\docs\qishui-pipeline.md` 已验证链路。
> 仅用于下载自己有权播放的内容，不做二次分发。

---

## 0. 一句话

把汽水音乐里的整曲，以唱片内页的质感，安静地落到本地磁盘。

---

## 1. 已确认决策

| 维度 | 决策 |
|---|---|
| 形态 | Electron + React + Vite + TypeScript |
| 视觉 | 浅色纸感（暖白纸 + 墨色 + 单一松墨绿） |
| 功能 | 单曲链接/ID、歌单与推荐浏览、队列（并发/重试/历史）、元数据写入 |
| 登录 | 应用内 passport 二维码（已实测可取码）+ 本机客户端登录态，登录后展示全部歌单 |
| 输出 | 原格式 / FLAC / MP3 / WAV 四选一，AAC 曲目同样支持 |
| 平台 | Windows 优先（macOS 预留） |

---

## 2. 边界（写进产品文案，不藏着）

- 必须在**本机安装汽水音乐客户端**并登录（签名模块 `bdms.node` 只能来自客户端）。
- 签名与 `device_id` 绑定；换客户端版本可能需要更新 UA / version_code。
- 会员曲目是否返回整曲取决于账号权限；返回试听片段时界面明确报"试听片段"。
- AAC 曲目无 FLAC 时走 AAC 解密 + ffmpeg 转码，**不是**无损来源。
- 不内置代理、不绕过账号权限、不上传任何数据。

---

## 3. 设计概念：唱片内页（Liner Notes）

不是"下载器工具面板"，而是一张**唱片内页**：纸的底、墨的字、细线分栏、封面像一张印刷品。

- **纸**：暖白 `#F6F2E9`，不是灰白；带 3% 纸纹噪点（固定层，pointer-events: none）。
- **墨**：近黑 `#1B1A17`，三级文字灰度；所有分隔用 1px 细线，不堆卡片。
- **一点颜色**：松墨绿 `#2F5D4E`，只用于进度、选中、主操作，占比 < 8%。
- **数字用等宽**：时长、码率、采样率、字节数、样本数，全部 `Geist Mono`，像唱片背面的技术参数。
- **标题用衬线**：编辑式大标题，只出现在页面 Hero，不用于表格与控件。
- **动效克制**：像翻纸，不像霓虹。弹簧 1 次，列表 40ms 错峰，尊重 `prefers-reduced-motion`。

---

## 4. 视觉系统

### 4.1 色彩

| Token | 值 | 用途 |
|---|---|---|
| `--paper` | `#F6F2E9` | 应用底色 |
| `--paper-raised` | `#FCFAF5` | 浮层 / 输入框 / 选中行 |
| `--paper-sunken` | `#EFEAE0` | 进度槽、占位图底 |
| `--ink` | `#1B1A17` | 主文字、标题 |
| `--ink-2` | `#4E4A43` | 次级文字 |
| `--muted` | `#8A8378` | 说明、时间戳、空状态 |
| `--rule` | `rgba(27,26,23,.12)` | 细线分隔 |
| `--rule-strong` | `rgba(27,26,23,.22)` | 输入框、选中描边 |
| `--accent` | `#2F5D4E` | 主操作、进度、活动点 |
| `--accent-soft` | `#E2E9E1` | 进度槽底色、徽章底 |
| `--danger` | `#A33B2A` | 错误、失败徽章 |
| `--warn` | `#8A6A2F` | 试听/降级提示 |

对比度：正文 ink/paper ≥ 12:1，muted/paper ≥ 4.6:1，accent/paper ≥ 6:1。

### 4.2 字体

```css
--font-ui: "Geist", "MiSans", "PingFang SC", "Microsoft YaHei UI", sans-serif;
--font-mono: "Geist Mono", "JetBrains Mono", "Cascadia Mono", monospace;
--font-display: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;
```

| 层级 | 字号/行高 | 字重 | 用途 |
|---|---|---|---|
| Display | 44–56 / 1.15 | 600 | 页面 Hero 标题（衬线） |
| Title | 20 / 1.35 | 600 | 区块标题、曲目名 |
| Body | 14 / 1.65 | 400 | 正文、说明 |
| Meta | 12 / 1.5 | 500 | 技术参数（等宽） |
| Micro | 11 / 1.4 | 600 + 0.08em 字距 | 标签、阶段名 |

### 4.3 间距与圆角

- 4px 基准：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64。
- 页面内边距 32–40；区块间距 40–56（留白是主角）。
- 圆角：输入/按钮 8px，封面 6px，浮层 14px；**不做全站胶囊**，仅状态徽章用 999px。
- 阴影：暖色、低透明度、大扩散，像纸压在桌上
  `0 18px 40px -24px rgba(60,50,35,.35)`；不发光、不描彩边。

### 4.4 图标与纹理

- `@phosphor-icons/react`，统一 `weight="regular"`，尺寸 16/20，颜色随文字层级。
- 纸纹：SVG `feTurbulence` 固定覆盖层，opacity .035，不随滚动重绘。
- 封面：一律 6px 圆角 + 1px 内描边 `rgba(0,0,0,.08)` + 印刷阴影；无封面时用色块 + 首字母。

### 4.5 动效

| 场景 | 规格 |
|---|---|
| 页面切换 | opacity + translateY(6px)，320ms `cubic-bezier(.16,1,.3,1)` |
| 列表进入 | 子项 stagger 40ms，最多前 12 项 |
| 按钮 | hover 抬 1px，active `scale(.985)`，spring stiffness 320 damping 26 |
| 进度条 | 宽度用 transform scaleX；1px 高、accent 实色，无光效 |
| 管线阶段 | 当前节点呼吸（opacity 1↔.55，2.4s），完成打勾描边动画 |

---

## 5. 信息架构

```
┌───────────────────────────────────────────────────────────────┐
│ ◇ 开瓶器      |  面包屑 / 页面标题            [状态] [设置]   │
│ Bottlecap     │                                               │
│               │  主内容区（max 1180，左对齐，非居中）          │
│ 下载          │                                               │
│ 歌单          │                                               │
│ 搜索          │                                               │
│ 历史          │                                               │
│               │                                               │
│ ─────────     │                                               │
│ 账号 / 客户端  │                                               │
└───────────────┴───────────────────────────────────────────────┘
                     ↑ 需要时右侧滑出 Inspector（320px）
```

- **左侧栏 232px**：品牌、四个导航、底部账号卡（头像/昵称/客户端版本 + 连接状态点）。
- **主区**：单列编辑式布局；表格用细线，行高 64。
- **右侧栏 320px**：常驻「输出设置」（格式 / 目录 / 元数据 / 并发）；选中任务时 Inspector 以同宽抽屉覆盖，显示封面、变体、阶段耗时、日志与"在文件夹中显示"，Esc 关闭。窗口宽度 < 1180px 时折叠为顶部按钮。
- 窗口：默认 1280×820，最小 1024×680；标题栏自绘（Windows 用 `titleBarStyle: 'hidden'` + 自绘拖拽区）。

---

## 6. 页面设计

### 6.1 首次启动 · 连接账号

全屏纸面，左侧大标题「先连上你的汽水」，右侧两个入口（不是并排三卡片）：

1. **使用本机客户端（推荐）** — 自动读取 Cookie + DeviceV1，展示版本、设备号（打码）、登录状态；失败时给可读原因与"重试"。
2. **扫码登录** — 主进程直接调 `GET https://api.qishui.com/passport/web/get_qrcode/` 取二维码 data URL，界面内渲染；每 2s 轮询 `check_qrconnect/`，从 `Set-Cookie` 取 `sessionid`。已实测可取码，无需内嵌网页、无需逆向 passport。

底部一行小字：sessionid 只留在主进程，不写日志、不回传渲染层。

### 6.2 下载页（默认）

**Hero（不对称 7/5）**
- 左：衬线大标题「把汽水里的歌，装进唱片内页。」+ 一行说明；下方是粘贴框（支持 19 位 ID、`qishui.douyin.com/s/...` 短链、H5 链接），Enter 解析。
- 右：当前曲目的"唱片"预览——320px 封面、印刷阴影、细线参数栏（FLAC / 863 kbps / 44.1 kHz / 297.240 s）。

**当前任务（如果有）**
- 96px 封面 + 曲名/歌手/专辑；右侧 5 段管线：`解析 → 签名 → 取流 → 解密 → 封装`（转码时追加 `转码`、`写入标签`）。
- 进度：1px 线 + 等宽百分比 + 速度 + 剩余时间；可暂停/取消。
- 失败态：管线停在失败节点，显示错误码与一句话原因，主按钮「重试」，次按钮「查看详情」。

**队列**
- 表头：曲目 / 规格 / 阶段 / 进度 / 操作；行间 1px 细线，无卡片。
- 行内阶段用 Micro 标签 + 小圆点；完成行右侧出现「在文件夹中显示」。
- 支持多选、批量暂停/重试/移除；并发数在设置里（默认 2）。

**空状态**
- 不放大插画：一张"空唱片套"线稿 + 一句「还没有任务。粘一条链接，或去歌单里挑几首。」+ 两个文字按钮。

### 6.3 歌单页

- 两栏：左 300px 歌单索引（全部歌单，含"我喜欢"、自建、收藏；数量用等宽），右曲目表。
- 顶部：歌单封面 + 名称 + 曲目数 + 「全部下载」。
- 曲目行：勾选、序号、标题/歌手、时长、音质徽章（FLAC / AAC）、单曲下载。
- 歌单为空 / 未登录 / 接口失败分别有空态与重试。

### 6.4 搜索页

- 顶部大搜索框（`/luna/pc/search/track`，签名），结果行同歌单曲目表。
- 未登录时提示"搜索需要登录"并提供连接入口。
- 搜索结果若只有 AAC，徽章为 `AAC 320k`，hover 提示"将按设置转码"。

### 6.5 历史页

- 按日期分组（今天 / 昨天 / 更早），行内显示格式、大小、完成时间。
- 操作：打开文件、打开所在文件夹、重新下载、从历史移除（不删文件）。
- 顶部统计：本周下载数 / 总大小（等宽数字）。

### 6.6 设置

- **输出**：目录（选择器）、格式（原格式 / FLAC / MP3 / WAV）、MP3 码率、文件名模板（`{artist} - {title}`，实时预览）、并发数（1–4）。
- **元数据**：写入封面、写入歌词、同时生成 `.lrc`、封面最大边（500/1000/原始）。
- **账号**：当前账号、设备号（打码）、重新连接、扫码登录、清除凭据。
- **高级**：客户端目录（自动探测）、bdms 路径覆盖、ffmpeg 路径、打开日志目录。
- 所有改动即时保存；危险操作二次确认。

### 6.7 Inspector（右侧抽屉）

封面、曲名、歌手、专辑、时长、码率、采样率、样本数、AES key（默认隐藏，点"显示"才出现，带说明）、变体列表（codec/bitrate/size）、阶段日志（等宽、可复制）、错误详情。

---

## 7. 管线与状态机

```
queued → resolving → signing → fetching → downloading → decrypting
       → packaging → [transcoding] → [tagging] → done
                     ↘ failed / canceled / paused
```

- 每个阶段有 `startedAt/finishedAt`，Inspector 展示耗时；UI 只读主进程事件，不自己算。
- 下载进度按字节流（fetch body reader），节流 100ms 推给渲染层。
- 失败必须带 `code + stage + 可读消息`，例如：

| code | 文案 |
|---|---|
| `AUTH_MISSING` | 没找到登录态，请先连接汽水客户端或扫码登录 |
| `SIGN_EMPTY` | 签名未被接受（客户端版本可能变了），试试更新客户端后重连 |
| `PREVIEW_ONLY` | 只返回了试听片段，这个账号没有该曲目的完整权限 |
| `NO_VARIANT` | 没有可用音频变体 |
| `MP4_STRUCTURE` | 音频容器结构异常（stsz/senc/mdat 不匹配） |
| `BAD_KEY` | 解密密钥无效（spade_a 异常） |
| `FFMPEG_MISSING` | 找不到 ffmpeg，请在设置里指定路径 |
| `DISK_FULL` | 磁盘空间不足，至少需要 120 MB |

---

## 8. 技术架构

```
┌──────────── Renderer (React 19, sandboxed) ────────────┐
│ 下载 / 歌单 / 搜索 / 历史 / 设置   zustand + TanStack  │
└───────────────▲────────────────────────────────────────┘
                │ typed IPC (contextBridge, zod 校验)
┌───────────────┴──────────── Main (Electron) ───────────┐
│ Queue scheduler · Store(JSON) · ffmpeg · 窗口/托盘       │
│                    │                                    │
│        ┌───────────┴────────────┐                       │
│        │  Qishui runtime         │  ← 若 Electron 主进程 │
│        │  cookie/device/signer   │    加载 bdms.node 失败 │
│        │  track_v2/variants      │    则 spawn 系统 Node  │
│        │  spade/MP4/AES/AAC      │    作为 bridge 子进程  │
│        └─────────────────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

**关键点**
- 渲染层无 Node 权限；`contextIsolation: true`, `nodeIntegration: false`。
- sessionid 永不进渲染层、永不写日志；IPC 只返回 `loggedIn` 与打码设备号。
- 签名与请求严格使用同一 URL/头；每个请求现签。
- 下载先写 `.part` 临时文件，成功后原子重命名；失败清理。
- 默认输出目录 `%USERPROFILE%\Music\Bottlecap`；文件名非法字符替换。
- 历史与设置存 `%APPDATA%\Bottlecap\state.json`（原子写）；任务队列持久化，重启可续。

**输出管线**
- FLAC 源：解密 → `fLaC + dfLa[4:] + samples` → 原格式直接落盘；选 MP3/WAV 则 ffmpeg 转码。
- AAC 源：解密样本 → 按 `esds` 的 AudioSpecificConfig 生成 ADTS 头 → 原始 `.aac` → ffmpeg 封装 `.m4a`（原格式）或转 FLAC/MP3/WAV。
- 标签：统一交给 ffmpeg（Vorbis/ID3/MP4 元数据 + 封面 attached_pic + 歌词 `LYRICS`），避免自己写容器格式；`.lrc` 另存同目录。
- 所有产物完成后校验：文件大小 > 0、ffprobe 可读、时长与 track.duration 误差 < 2s（可设置里关闭）。

**数据模型（shared/types.ts）**
```ts
type Stage = "queued"|"resolving"|"signing"|"fetching"|"downloading"
           |"decrypting"|"packaging"|"transcoding"|"tagging"|"done"|"failed"|"paused"|"canceled";
interface Track { id: string; name: string; artists: string[]; album?: string;
  durationMs: number; coverUrl?: string; lyric?: string }
interface Variant { codec: "flac"|"aac"; bitrate: number; sampleRate?: number; size?: number; url: string; spadeA: string }
interface Task { id: string; track: Track; variant?: Variant; format: "original"|"flac"|"mp3"|"wav";
  stage: Stage; progress: number; bytesDone: number; bytesTotal: number; speedBps: number;
  error?: { code: string; message: string; stage: Stage }; outputPath?: string; createdAt: number; finishedAt?: number }
```

**IPC 面（预定义，zod 校验）**
`auth.status / auth.connectLocal / auth.startQr / auth.logout`
`track.resolve / track.info / search / playlists.list / playlists.detail`
`downloads.enqueue / pause / resume / cancel / retry / remove / reveal`
`settings.get / settings.update / history.list / history.remove`
事件：`queue.updated / task.progress / auth.changed / app.toast`

---

## 9. 交互与无障碍

- 快捷键：`Ctrl+V`（页面内粘贴即解析）、`Ctrl+K` 搜索、`Ctrl+Enter` 下载当前解析结果、`Esc` 关闭抽屉。
- 焦点：2px accent 外环 + 2px offset；所有图标按钮有 `aria-label`。
- 进度用 `role="progressbar"` + `aria-valuenow`；阶段变化经 `aria-live="polite"`。
- 动效降级：`prefers-reduced-motion` 下取消呼吸、滑动与 stagger。
- 空/加载/错误三态每个页面都实现；加载用与行高一致的骨架条，不用转圈。

---

## 10. 风险与开放问题

1. **Electron 主进程能否加载 bdms.node**：文档只验证了系统 Node。M0 先实测；不行就打包 `node.exe` 作 bridge（+80MB，或提示安装 Node）。
2. **扫码登录**：取码端点已实测可用；剩余风险是轮询拿到 sessionid 后，与客户端 did 组合是否触发风控。M0 用真实账号走通一次。
3. **歌单接口**：`/luna/pc/me/playlist` 分页与字段需实测；匿名 `/luna/playlist/detail` 可作详情兜底。
4. **AAC 解密路径**：需实测 `enca` 样本、`esds` ASC、senc 是否与 FLAC 一致；不一致则降级"仅 FLAC"。
5. **歌词**：QRC 逐字格式转 LRC 的换行规则需样本验证；失败时至少保留纯文本。
6. **ffmpeg 分发**：体积与许可证；发布版优先内置（约 +80MB），设置里可覆盖路径，缺失时明确报错而不是静默失败。

---

## 11. 与"现代化"相关的取舍

- 不用玻璃拟态、不发光的渐变、不堆卡片：纸感靠材质（噪点、细线、印刷阴影）而不是特效。
- 不用 Inter / 紫蓝渐变 / 三列等宽卡片。
- 用一个颜色、两种字体家族、一条 1px 线，撑起整站。

---

## 12. 本轮实测记录（2026-11-09）

| 项 | 结论 |
|---|---|
| 客户端 | 3.5.1，`bdms.node` 可加载，设备号 3858…0567（已打码） |
| 现有 sessionid | 已失效（`/luna/pc/me` → 1000016），只能拿到 30s / 60s 试听 AAC |
| 签名 | X-Helios / X-Medusa 正常，track_v2 返回 200 + 24KB JSON |
| 扫码取码 | 200，返回 `qrcode`(data:image/png base64)、`token`、`expire_time`、`qrcode_index_url` |
| 歌单接口 | `/luna/pc/me/playlist`、`/luna/pc/playlist/detail`；登录后按签名请求验证字段 |
| 离线样本 | `qishui-lab\enc.flac.mp4` + `out.flac` 可用于解密回归 |

> 当前机器要完成 FLAC 验收，需要先在应用内扫码登录一个有效会员账号。

## 13. 视觉稿

单文件高保真稿：`docs/mockup.html`（可直接用浏览器打开）。
截图：`docs/mockup.png`。实现时以该稿的间距、字阶、细线与颜色为准，不另起风格。

---

## 14. 设计自查

- [x] 浅色纸感，不用玻璃拟态、不用发光、不用紫蓝渐变
- [x] 单一强调色（松墨绿），只用于主操作/进度/选中
- [x] 无卡片堆叠：队列与曲目用 1px 细线 + 留白
- [x] 不对称 Hero（7/5），非居中
- [x] 空 / 加载 / 错误三态均有定义
- [x] 键盘焦点、aria、reduced-motion
- [x] 数据用等宽字体，标题用衬线，控件用无衬线
