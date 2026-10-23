# 桌面 AI Agent 应用性能分析、治理基线与架构演进报告 (v3.2 治理与反空转终版)

**编制日期**：2026-10-21  
**依据材料**：macOS 真实进程采样快照（PID 48272）、代码基线（HEAD `5f4e2cd`）、v1.3.3 规范体系、事实核对附录  
**术语与规范代号约定**：
- **规范 A**：`docs/Stagent_System_Architecture_Specification_v1.3.3.md`
- **规范 B**：`docs/Stagent_v0.1_Development_Tasks_Specification_v1.3.3.md`
- **规范 C**：`docs/Stagent_v0.2_Architecture_Evolution_RFC.md`（状态 DEFERRED）
- **G-16**：出自《Stagent v1.2.1 第二轮交叉一致性复审报告》的 Finding 编号，指代“全仓扫描收敛至 `src/**`”

---

## 一、背景与问题综述

在 macOS 桌面端使用 AI 辅助开发工具时，不同架构设计的产品在体感响应和硬件能耗上表现出显著差异：
- **Cursor**：交互响应敏捷，闲置与运行期间系统温度和能耗控制平稳。
- **Workbuddy 现场表现**：同等任务下偶发出现严重卡顿，机身剧烈发热、风扇高转。
- **DeepSeek Harness (`dsh`)**：开源 Agent 运行基座，待机服务轻巧，跑测试时有正常的阶段性计算开销。

通过采集运行期操作系统进程快照（`ps aux`），并对照 Stagent 现行代码（HEAD `5f4e2cd`）与 v1.3.3 规范，本报告系统厘清工程实现的成因、已实现的基线成果，并明确真实存在的性能瓶颈与演进边界。

---

## 二、运行机制与分工边界澄清

### 1. 云端 GPU 与本地 CPU 的分工真相
- **大模型思考与代码推理 100% 在云端完成**：本地不承载任何模型权重计算，本地显卡与 NPU 的推理负载为 0。
- **本地 CPU 纯属“跑腿调度”**：包含文件读写、Grep 搜索、命令行测试执行、网络请求打包与终端流式渲染。
- **结论**：本地发热不是“大模型在本地算代码”，而是**本地宿主程序陷入了高频 I/O、无休止子进程调度、频繁垃圾回收（GC）或主线程事件循环阻塞**。

### 2. 核心逻辑采用 Rust vs Node.js 的客观损益
| 维度 | Node.js / Electron 体系 | Rust 原生重写 |
| :--- | :--- | :--- |
| **常驻内存 (RSS)** | 150MB ~ 300MB+，存在 V8 GC 波动 | 10MB ~ 30MB，无 GC，内存开销极低 |
| **I/O 与文件扫描** | 单线程 Event Loop 易被打满 | 可跑满多核 CPU，高吞吐并发（类似 ripgrep） |
| **进程与信号控制** | 跨平台子进程与管道处理偶有死锁/残留 | 原生操作系统级别控制（PGID 杀树极其精准） |
| **迭代与维护成本** | **低**，适合 v0.1 协议快速演进与业务验证 | **极高**，借用所有权模型导致重构成本高 |

---

## 三、现场取证证据与发热成因分析

### 1. 现场采样数据（PID 48272）
```text
USER   PID   %CPU  %MEM  VSZ         RSS(KB)   TIME     COMMAND
tina   48272 103.8 4.0   1890551472  2016048   9:17.04  /Applications/WorkBuddy.app/Contents/MacOS/Electron
       .../cli/bin/codebuddy --serve --session-id ... --permission-mode bypassPermissions
       --tools ... (50+ 工具)
       --settings {"sandbox":{"enabled":true},"hooks":{"PreToolUse":[...]}}
       --enabledPlugins { ... (20+ 插件) }
       --mcp-config { ... (connector-proxy, agent-mail, genie-baas, space-library, weixinpay, sheetagent) }
       --strict-mcp-config ...
```

### 2. 取证口径与证据力澄清（方法论归一）
- **VSZ 与物理内存澄清（N-2 修正）**：
  - VSZ 约 1.76 TB 是 macOS 64 位 Electron 应用虚拟地址空间的常规保留，不代表物理内存消耗。
  - `ps aux` 的 RSS 列单位为 **KB**，`2,016,048 KB` 严格换算为 **1,968 MB（约 1.92 GiB / 1.97 GB）**。单点高驻留说明存在大上下文常驻，需结合多时间点堆快照确认是否有持续内存泄漏。
- **%CPU 与 CPU 占空比归一**：
  - BSD/macOS 的 `%CPU` 是衰减加权平均值，单点 103.8% 表明采样瞬时处于高计算状态。
  - 单纯看累计 `TIME 9:17.04` 无法独立定性为“持续高负载”：`TIME` 是生命周期累计值，若进程已运行数小时以上，其实际 CPU 占空比可能极低（例如若已开机运行 12 小时即 43,200 秒，557s / 43200s 折算占空比仅约 1.3%）。
  - **严谨取证判据**：必须采用 `ps -o pid,etime,time,%cpu,rss,command -p <PID>` 补充已运行墙钟时间（`ELAPSED` / `etime`）。计算占空比 `Duty Cycle = TIME / ELAPSED`，**仅当占空比 > 50% 且多次间隔采样稳定高位时**，方可严格定性为“持续高负载/死锁”。
- **伴生浏览器进程归因**：现场观察到带 `--remote-debugging-port=9333` 的 Headless Edge 进程，由于单次快照缺少 `PPID`，未形成严格父子依赖链，需通过 `ps -o pid,ppid,command` 或 `lsof -i :9333` 进一步确认调用源头。

### 3. 四大深层成因分析
1. **驻留内存偏高（RSS ~1.97 GB）与 V8 频繁 GC 压力**：命令行守护进程吃掉近 2GB 物理内存，大量的状态缓存与超大上下文长期滞留堆内存，迫使 V8 引擎持续触发高能耗垃圾回收。
2. **“大包大揽”式多 MCP 挂载**：单进程预先挂载近 10 个 MCP 服务与 50+ 个工具，维持多条长连接与心跳轮询，导致主事件循环空闲时间严重不足。
3. **Argv 启动参数膨胀反模式**：将数千字符的权限黑白名单与 Prompt 变量塞入命令行参数中，引发跨进程高频序列化与内存碎片化。
4. **办公全生态追求“零冷启动延迟”的架构权衡**：为了随时响应文档、表格、支付等泛办公需求而全部常驻预热，未实施闲置自动释放（TTL Eviction）。

---

## 四、Stagent 现行工程基线校核（已实现项确认）

经核对 Stagent 代码（HEAD `5f4e2cd`），以下治理措施**在当前项目中已经落地实现**，应作为回归基线固化，避免重复立项：

| 治理维度 | 现行代码实现位置 | 状态 |
| :--- | :--- | :--- |
| **独立 PGID 与整树回收** | `daemon/runner/command-runner.ts` L451（`detached: true`）；`daemon/runner/process-tree.ts` L57（`process.kill(-pid)`） | ✅ **已实现** |
| **三级级联优雅停机** | `daemon/worker/cli-host/process-host.ts` L91–99：`SIGINT(700ms)` → `SIGTERM(600ms)` → 树 `SIGKILL`，总预算 1.8s（对齐打断后 2s 内停机指标，且给 CLI 留出 flush 会话时间） | ✅ **已实现** |
| **配置单次落盘与用完即焚** | `daemon/worker/cli-host/claude-code-adapter.ts` L117 `fs.mkdtempSync`（默认 `0700`）→ L152 写配置 → 传文件路径 → L250 `finally` 中 `fs.rmSync` 递归删除 | ✅ **已实现** |
| **规避 Argv 膨胀** | 同上：黑白名单落盘传递；采用 `--setting-sources ""` 防止绕过 hooks | ✅ **已实现** |
| **Supervisor 零工具回归守卫（AST 依赖扫描）** | `tests/unit/supervisor-zero-tool-lint.test.ts` 通过 AST 传递依赖扫描强制 Supervisor 零工具调用 | ✅ **已实现并有回归守卫** |
| **Path Jail 符号链接拦截** | `daemon/mcp/path-resolver.ts` 与 `daemon/worker/threat-guard.ts` 执行规范化 realpath 校验 | ✅ **已实现** |
| **空闲零 I/O 抖动硬忽略** | `daemon/watcher/fs-watcher.ts` L14–24 显式硬忽略 9 项高频目录（`.git`、`.stagent`、`node_modules`、`dist`、`.output`、`.next`、`.turbo`、`.cache`、`coverage`）+ `shouldIgnore()` 路径段匹配 + L54 `awaitWriteFinish` 稳定判定 + L45 60ms 批量防抖 | ✅ **已实现** |

---

## 五、反空转纪律失守的三种形态与重大缺口

审查表明，Stagent 在规范文档层面严格主张“反无谓空转与反发热”，但在**实际代码层面存在三种典型的失守形态**：

| 规范文档纪律 | 实际代码现状 | 影响分析 |
| :--- | :--- | :--- |
| **1. Supervisor 侧听轮询默认关闭**（规范 A §2.2 L203） | `daemon/supervisor/` 目录下**不存在 `throttler.ts`**，TASK-S.1 增量状态为 `[PARTIAL]` | L0/L1 规则优先引擎与节流器代码未落地，“VIBE 下 30 分钟连续会话 Supervisor 调用 = 0”尚无代码回归守卫。 |
| **2. 架构雷达全量计算推迟 v0.2+**（规范 B §3.5 TASK-B.1，D4 已确认） | `src/routes/index.tsx` 建连时**无条件**请求 `/api/arch/graph`，触发全仓同步解析 | 1486 个文件无缓存同步 AST 递归解析，直接冻结 Daemon 主线程事件循环（**一号卡顿源**）。 |
| **3. 严禁无谓定时轮询**（性能底线原则） | `src/routes/index.tsx` L404–417 **硬编码 3 秒常驻轮询** `/api/protection`（**新发现 N-1**） | 只要 WS 连接建立，不论应用空闲还是执行中，每 3 秒必打一次保护端点，常驻消耗网络与 CPU。 |

### 澄清：代码与规范中“3s 机制”的三处独立语义（N-4 澄清）
1. **Supervisor 侧听节流**：规范 B §1.1 L25 与 A §2.2 中用于限制模型评估触发频次的 3s Debounce（当前待在 Sprint 4 落地 `throttler.ts`）；
2. **Monaco 编辑器防抖**：规范 A 版本头第 4 条声明的服务端 403 校验与 3s Debounce（防输入抖动）；
3. **前端保护状态常驻轮询**：`index.tsx` L408 硬编码的 `setInterval(..., 3000)`（属于应当优化的反模式）。

---

## 六、两大卡顿与发热源的治理方案与量化判据

### 1. 一号卡顿源治理：阻断 Daemon 主线程同步全仓 AST 解析
- **问题链路**：前端建连调用 `fetchArchGraph` → `/api/arch/graph` → `buildDependencyGraph` 同步解析全仓约 1486 个文件。
- **量化验收判据（PASS/FAIL）**：
  1. **请求路径时延阈值（N-3 收窄）**：Daemon 主线程在**请求处理路径上的任意单次同步计算必须 ≤ 50ms**（若将来 v0.2+ 恢复 B.1 冷启动分析，必须放入 `worker_threads` 或进行异步分片 yield，严禁阻塞请求主线程）。
  2. **双重缓存与范围收敛**：`/api/arch/graph` 必须满足**增量缓存（按 mtime 失效）**且**扫描收敛至 `src/**`（G-16）**，缺一即判 FAIL。
  3. **前端主动调用阻断**：移除前端建连自动调用，改为显式按钮触发。**回归断言**：UI 建连后 30 秒内，`/api/arch/graph` 请求次数严格为 0。

### 2. 二号空转源治理：前端常驻 3 秒轮询的事件化改造（N-1 落地）
- **改造原则**：由于该轮询原本是为了让 P.1 待审批卡“立刻出现（AI 被拦在原地）”，因此**不可简单粗暴删除，而应走低开销事件化改造**：
  1. **WS 帧推送替代常驻轮询**：当 Daemon 发生保护状态或待审批事件时，主动推送广播帧；轮询仅作为断线重连后的兜底（间隔拉长到 ≥30s 或降级模式）；
  2. **页面可见性联动**：监听 `document.visibilitychange`，标签页切入后台/不可见时立刻挂起轮询；
  3. **空闲态自适应降频**：当无活跃合同且保护清单未发生变更时，自动降频至 60 秒以上。

### 3. 响应性硬指标：TTFT ≤ 1s 流式输出
- 严格遵循 TASK-C.6 验收指标：**首 token 可见延迟 ≤ 1s（本地测量）；用户打断后 2s 内 Agent 进程必须完全停止输出**。

---

## 七、总结与行动路线

1. **固化 7 大工程基线**：PGID 整树回收、1.8s 级联优雅退场、配置落盘用完即焚、Argv 瘦身、Supervisor 零工具守卫、Path Jail 越界防护，以及 9 项目录硬忽略防抖已全面受控。
2. **切断两大前端空转源**：
   - 彻底阻断建连时无条件的全仓 AST 解析（消灭一号主线程死锁源）；
   - 将前端 `/api/protection` 3s 硬轮询改造为 WS 推送 + 页面隐藏休眠（消灭二号空转唤醒源）。
3. **补齐服务端两大缺失**：
   - 在 Sprint 4 落地 `daemon/supervisor/throttler.ts`，兑现空闲 30 分钟零模型调用的承诺；
   - 在 Daemon 启动期补齐 `stagent-claude-*` 历史临时目录崩溃 GC。
