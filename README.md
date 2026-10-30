# Nemorous Mobile

[Nemorous](https://github.com/iwangjie/Nemorous) 的手机端伴生控制台：在手机上审阅多仓改动、看 Diff、统一提交、切换分支、搜索代码。

手机只负责界面与交互，**所有 Git 命令都在电脑上执行**。仓库、凭据、AI Agent、终端始终留在电脑，手机不保存仓库副本。

---

## 来源与致谢

- 源自 [**iwangjie/Nemorous**](https://github.com/iwangjie/Nemorous)（MIT，Copyright © 2026 iwangjie）：多仓 Git 协同的产品概念、交互模型、统一提交/合并工作流与安全不变量来自该桌面项目。
- 原桌面端基于 [**egoist/mygo**](https://github.com/egoist/mygo)（MIT）构建，仅支持 macOS / Windows / Linux；本项目未复用 MyGo，手机端为独立的浏览器 PWA。
- 本项目为独立实现，**未复制原项目源代码**；Go 伴生服务与 TypeScript 客户端均为新增代码，按 MIT 发布。完整声明见 [NOTICE.md](NOTICE.md)。

---

## 调研结论：为什么不是直接移植

原项目 `iwangjie/Nemorous` 的技术事实：

- UI 基于 [MyGo Native UI](https://mygo.egoist.dev/)（v0.7.3），官方平台是 **macOS / Windows / Linux**，用 Metal / Direct3D 11 / OpenGL 绘制；发布矩阵也只有 darwin、windows、linux。**没有 iOS / Android 后端。**
- 核心能力依赖桌面进程：`git` CLI、PTY 终端、`mani` 任务、`pi` / `claude` / `codex` AI Agent、临时 `git worktree` 合并。
- iOS 沙箱不允许 App 派生子进程，因此“把桌面端 Git 流水线原样搬到手机”不可行。

所以手机端的正确形态是 **伴生服务 + 响应式客户端**：电脑运行一个 Go 服务，复用同一套 Git 语义；手机通过局域网 / Tailscale 访问。这样既覆盖所有手机，又不牺牲 Nemorous 的核心价值。

### 语言与 UI 选型

| 方案 | 支持系统 | Git 能力 | 交付成本 | 结论 |
| --- | --- | --- | --- | --- |
| **TypeScript + React PWA**（本方案） | iOS / Android / HarmonyOS / 平板，凡现代浏览器 | 调电脑端 API，完整 Git CLI | 一套代码，免安装、随服务更新；可用 Capacitor 直接上架 | **采用** |
| Flutter | iOS / Android（HarmonyOS 需移植） | 需 libgit2 FFI 才能离线操作；仍无法访问电脑上的仓库 | 双端安装包、签名、商店审核 | 无收益：Git 本来就在电脑上 |
| React Native | iOS / Android | 同上，且需要原生模块 | 同上 | 同上 |
| Kotlin Multiplatform | Android / iOS（Compose iOS） | 同上 | 学习/维护成本最高 | 不适用 |

**最终栈**：Go 伴生服务（复用 Nemorous 的 Git 语义与安全不变量）+ TypeScript / React / Vite PWA。前端构建产物嵌入 Go 二进制，单文件分发。

### 支持的系统

- **iOS 16.4+**：Safari 打开，或“添加到主屏幕”全屏运行；需要上架时用 Capacitor 包同一套前端。
- **Android 8+（Chrome 111+）**：浏览器或 PWA 安装。
- **HarmonyOS**：系统浏览器打开（PWA 能力取决于浏览器内核）；无需 Android 兼容层。
- **平板 / 折叠屏**：响应式布局，最大 760px 内容宽度。
- **桌面浏览器**：同一地址可直接使用（方便调试）。

> 局域网 `http://` 下，iOS Safari 可“添加到主屏幕”；Chrome 的安装提示通常要求 HTTPS。需要 HTTPS 时在服务前放 Caddy，或用 `tailscale serve`。

---

## 已实现

### 改动

- 多仓文件列表、`A/M/D/R/U/?` 状态、增删行数、仓库健康度、ahead/behind
- 文件级暂存 / 取消暂存、按仓库全选
- 工作区 / 暂存区双视图 Diff，行号与语法着色
- 丢弃改动（二次确认；未跟踪文件直接删除）
- 单仓拉取 / 推送；跨仓**统一提交**（可选提交后推送）
- 冲突文件标记（`U`）

### 实时

- 服务端在暂存 / 提交 / 推送 / 拉取 / 切分支 / 撤销设备后通过 SSE 广播 `invalidate`
- 所有已配对设备自动重新拉取工作区；60 秒轮询作为断线兜底
- SSE 只传“有变化”，不复制仓库数据

### 代码

- 跨仓文件名搜索（Git 索引）与内容搜索（优先 `rg`，未安装时内置扫描）
- 仓库文件树、目录懒展开、路径过滤
- 语法高亮（highlight.js 常用语言）、行号、搜索结果按行跳转并定位
- 1 MiB 文件上限，二进制文件明确提示

### 提交

- 所有仓库的提交按时间合并成“统一提交森林”，按日分组
- 提交搜索：提交信息 / 完整或短哈希 / 作者，含 RE2 正则与大小写开关
- 提交筛选：仓库、分支、只看我的提交（按仓库 `user.email`）、路径、最近 7/30/90 天；分支与路径下推到 Git 历史
- 提交详情：作者、时间、哈希、变更文件、完整补丁
- 全部拉取 / 全部推送 / 所有仓库统一切分支（可新建）
- 单仓分支列表、切换、新建、拉取、推送、刷新
- 操作结果逐仓展示 `OK / SKIP / FAIL`

### 设置

- 6 位配对码（10 分钟有效，过期自动轮换并打印到终端）
- 已配对设备列表：设备名、最近活跃、加入时间；可逐台撤销
- 主题（跟随系统 / 暗色 / 亮色）、工作区路径、仓库数、服务版本
- 安全说明

---

## 安全不变量

与桌面端保持一致：

- **绝不强制推送**：任何路径都不会出现 `--force` / `--force-with-lease`。
- **脏仓库跳过**：拉取、切分支前检查未提交改动，直接 `SKIP`，不 stash、不覆盖。
- **丢弃必须确认**：UI 二次确认 + 服务端 `confirm:true` 双重校验。
- **配对码 + 会话 Cookie**：手机用 6 位配对码换取 `HttpOnly` + `SameSite=Lax` 会话 Cookie；页面脚本读不到凭证。配对码按 IP 限制失败次数，10 分钟过期后自动轮换。
- **设备可撤销**：每个会话对应一台设备，设置页可立即撤销；会话令牌以 SHA-256 存储，泄露状态文件也无法直接使用。
- **同源写保护**：Cookie 鉴权的写请求校验 `Origin` / `Sec-Fetch-Site`，跨站请求返回 403。
- **可选 API 令牌**：`-token` 仍支持 `Authorization: Bearer`，只给脚本使用；手机端不使用长令牌。
- **路径隔离**：所有仓库相对路径做规范化与 symlink 逃逸检查，禁止访问 `.git`。
- **命令可控**：`GIT_TERMINAL_PROMPT=0`，读操作 15s、写操作 120s 超时。
- **请求体上限** 1 MiB。

> 一台已配对设备等同于工作区写权限。只在可信网络（家庭 / 公司内网 / Tailscale）中启动服务，不要把端口直接暴露到公网；手机丢失时在设置页立即撤销。

---

## 快速开始

```bash
# 1. 构建前端
cd web
npm install
npm run build

# 2. 构建单二进制（内嵌前端）
cd ..
go build -o nemorous-mobile .

# 3. 指向你的多仓工作区
./nemorous-mobile -workspace ~/code
```

终端会打印：

```text
Nemorous Mobile 0.1.0
工作区: /Users/you/code（6 个仓库）
配对码: 123456（19:42 前有效）
手机打开: http://192.168.1.5:8787/?pair=123456
```

手机与电脑处于同一网络后打开该链接即可自动配对；也可以在任意页面输入配对码。需要用二维码时，把终端里的链接交给任意二维码工具生成后再用手机扫描。配对成功后 Cookie 自动保存，地址栏里的配对码会被移除。

### 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-workspace` | 当前目录 / `$NEMOROUS_WORKSPACE` | 工作区根目录；根本身是仓库时只服务该仓库，否则扫描直接子目录 |
| `-addr` | `:8787` | 监听地址 |
| `-token` | 空 | 可选的 API Bearer 令牌（脚本 / curl）；也可用 `$NEMOROUS_TOKEN`；手机端不使用 |
| `-state` | `os.UserConfigDir()/nemorous-mobile` | 配对设备状态目录（devices.json） |
| `-web` | 空（使用内嵌资源） | 开发时从指定目录提供前端 |

配对设备保存在 `os.UserConfigDir()/nemorous-mobile/devices.json`（macOS 为 `~/Library/Application Support/`，Linux 为 `~/.config/`），权限 `0600`；只存会话令牌的 SHA-256。

### 开发

```bash
go generate ./internal/app          # 重新生成 web/src/types.ts
go test ./...                       # 后端测试（真实 git 夹具）
go run . -workspace /tmp/nemo-ws    # 后端 :8787

cd web
npm run dev                         # Vite 开发服务器，/api 代理到 :8787
npm run build                       # 类型检查 + 生产构建
```

---

## HTTP API

所有 `/api/*`（除 `health` 和 `POST /api/pair`）都需要已配对会话 Cookie，或可选的 API Bearer 令牌。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/health` | 版本探活（无鉴权） |
| POST | `/api/pair` | 用 6 位配对码换取会话 Cookie |
| GET | `/api/pair/code` | 当前配对码与过期时间（已配对设备） |
| GET | `/api/devices` | 已配对设备列表 |
| DELETE | `/api/devices/{id}` | 撤销设备；撤销当前设备会清除 Cookie |
| GET | `/api/events` | SSE：`invalidate` 事件，客户端据此重新拉取 |
| GET | `/api/workspace` | 全部仓库状态与改动文件 |
| GET | `/api/repos/{id}` | 单仓状态 + 本地/远端分支 |
| GET | `/api/repos/{id}/diff?path=&staged=` | 单文件统一 Diff |
| GET | `/api/repos/{id}/files` | 跟踪 + 未跟踪文件列表 |
| GET | `/api/repos/{id}/file?path=&rev=` | 工作区或指定版本文件内容 |
| GET | `/api/repos/{id}/commits?limit=` | 单仓提交 |
| GET | `/api/repos/{id}/commits/{hash}` | 提交详情与补丁 |
| GET | `/api/commits?limit=&q=&regex=&case=&repo=&branch=&author=&mine=&path=&days=` | 全仓合并提交森林，支持搜索与筛选 |
| GET | `/api/branches` | 各仓库本地分支（提交筛选用） |
| GET | `/api/search?q=&mode=files\|content&regex=&case=&repo=` | 跨仓搜索 |
| POST | `/api/repos/{id}/stage` · `unstage` · `discard` | 文件操作 |
| POST | `/api/repos/{id}/commit` | 单仓提交 |
| POST | `/api/repos/{id}/push` · `pull` | 单仓同步 |
| POST | `/api/repos/{id}/checkout` | 切换 / 新建分支 |
| POST | `/api/batch` | `pull` / `push` / `fetch` / `checkout` 批量执行 |
| POST | `/api/batch/commit` | 跨仓统一提交 |

仓库 `id` 为绝对路径的 SHA-1 前 12 位，刷新后保持稳定。

---

## 目录结构

```text
.
├── main.go                 # 嵌入前端、配对码、静态服务
├── internal/app
│   ├── git.go              # 仓库发现、status 解析、健康度
│   ├── ops.go              # diff / 暂存 / 提交 / 推送 / 分支 / 搜索
│   ├── auth.go             # 配对码、设备会话、Cookie、限流
│   ├── events.go           # SSE invalidate 广播
│   ├── server.go           # 路由、鉴权、CORS、请求体
│   ├── types.go            # API DTO（生成 TS 类型的源头）
│   ├── gentypes/           # Go AST → web/src/types.ts
│   └── app_test.go         # 真实 git 夹具集成测试
└── web
    ├── src
    │   ├── App.tsx         # 路由、SSE 实时刷新、配对
    │   ├── views/          # 改动 / 代码 / 提交 / 设置 / Diff
    │   └── styles.css      # 移动优先主题
    └── public              # PWA manifest、图标、service worker
```

---

## 已知限制

- **不提供手机端编辑保存**：代码查看器只读；行级微调、终端、AI 合并、`mani` 任务仍留在桌面端，手机键盘不适合这些操作。
- 文件查看上限 1 MiB、文件树 20000 条、高亮 4000 行（超出仍可纯文本查看）。
- 提交筛选最多扫描每仓 1000 条历史后再合并，避免手机端一次扫描全部历史。
- 拉取只使用 `--ff-only`，不做桌面端的 stash / pop 自动恢复。
- **Web Push 尚未实现**：需要 HTTPS（或 localhost）+ 已安装的 PWA + VAPID；当前只提供 SSE 实时刷新，手机在后台时不会收到通知。
- **Capacitor 原生壳尚未打包**：同一套 `web/dist` 可以包成 iOS / Android 应用，但需要 Xcode 签名、Android SDK 与商店配置；仓库目前只交付 PWA。
- 会话 Cookie 只支持同源；反向代理到不同域名时需要 HTTPS + 同源部署（或后续给 Capacitor 增加 Bearer 模式）。
- 多 PC / SSH、PTY 终端、AI Agent 仍不在范围内。
- iOS 不允许后台常驻服务：手机是客户端，电脑端必须在线。
- PWA 的安装入口受浏览器策略影响；需要稳定商店分发时，用 Capacitor 把 `web/dist` 包成 iOS / Android 应用，API 不变。
- HarmonyOS NEXT 没有 Android 运行时，但可通过浏览器使用本 PWA。

---

## License

MIT。本项目代码版权归 Nemorous Mobile contributors；上游来源与致谢见 [NOTICE.md](NOTICE.md)。
