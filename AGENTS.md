<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- 工作台是 Cursor / VS Code 式单页骨架，实现在 src/components/WorkspaceLayout.tsx：顶栏（项目 / 分支 / 模式 + 唯一操作「新建需求」）│ 左侧 ActivityBar + 文件树（可折叠、可拖宽）│ 中栏标签页与编辑器 │ 右侧 AI 对话（可折叠、可拖宽），底栏是可收起的 SmartTerminal 抽屉。src/routes/index.tsx 的 `Console()` 持有全部状态，只通过 props 插槽把内容注入布局，布局内部不取数。Why: 布局只管排布，数据只有一处来源。
- 系统面板都是「按需打开的可关闭 Tab」，不是常驻栏：`STUDIO_TAB_ID`（合同操作台）、`SUPERVISOR_TAB_ID`（工程审阅）、`SETTINGS_TAB_ID`（连接 / 诊断 / 开关）由 ActivityBar 触发。首屏是空编辑区 + components/layout/WelcomePane.tsx 欢迎态，页面已不再传 `defaultOpenStudio`。Why: 首屏不预设任务，避免把调试面板当成默认工作区。
- 顶栏只放状态（仓库名 / 基线分支 / 运行模式 / 已锁 N 处）；连接、Token、流诊断、网关受控等控制项全部下沉到 components/settings/SettingsTab.tsx。Why: 控制项常驻顶栏会让主路径每一屏都被调试信息挤占。
- 组件归位约定：布局骨架与纯排布件放 components/layout/（ActivityBar、WelcomePane、CollapsibleSection、OpenProjectEntry、useResizablePanel）；业务面板按域分目录——components/supervisor/、components/settings/；编辑区与对话等大面板留在 components/ 顶层（FileTree、MonacoEditorPane、AgentChatPane、StructuredTerminal、SupervisorStudioPane）。Why: 先按「排布 / 领域」分层，加逻辑时不用搬家。
- 前后端边界：前端只经 src/lib/daemon-api.ts 调本机 daemon 的 HTTP 接口（带 session token），不直接读写磁盘；daemon 路由在 daemon/server.ts，合同落盘在 daemon/pipeline/contract-store.ts（`.stagent/contracts/<id>.json`）。`POST /api/supervisor/draft` 是只读草案接口：零落盘、不建 Worktree、预算独立记账，失败按 402 / 409 显式返回，不静默降级。Why: 证据必须来自真实文件与真实命令，前端不得自造。
- 浏览器侧只保存少量 UI 偏好（use-agent-session 选中的助手会话、保护建议的「不再提示」）；工作区文件与合同状态一律以 daemon + `.stagent/` 为准。Why: 用 localStorage 存工作区文件的旧写法已废弃。
- 测试归位：UI 用例在 tests/ui/，集成用例在 tests/integration/，daemon 用例在 tests/daemon/，src/tests/ 只放路由与客户端用例。Why: 按被测层次分目录，跑门禁时能精确定位失败面。
