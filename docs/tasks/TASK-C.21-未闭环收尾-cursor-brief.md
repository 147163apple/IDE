# TASK-C.21 收尾：两条未闭环测试问题（Cursor 执行指令）

> 直接整段粘给 Cursor。仓库根：`/Users/tina/Desktop/1020`。
> 前置：`git log --oneline -1` 应看到 `61b905b fix(baseline): 沙箱起不来时不得凭空生成断网证据`。

## 背景

上一轮已把「端口段互斥 / WS 延迟断言相对化 / OS 沙箱假证据」三件事做完并提交。全量仍剩两类失败，都与功能无关，但会掩盖真实回归，需要收尾。

最近一次全量读数（本机，`npx vitest run`）：

```
1549 条 / 1532 过 / 7 失败 / 10 跳过（199 文件：194 过 / 4 失败 / 1 跳过）
```

7 条失败 = 任务 A 的 6 条 + 任务 B 的 1 条。

---

## 任务 A：临时目录清理要容忍 safe-delete 拒绝（6 条）

### 现象

全量跑时，靠后执行的几个文件会在清理临时目录时抛错：

```
Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
{"count":50,"threshold":50,"scope":"turn","targets":["/…/.tmp/unit-c17-debug/repo-xxxx"],"targetCount":1}
```

受影响用例（最近一轮）：

- `tests/unit/task-c17-debug-log.test.ts` —— 4 条（轮转 / journey 读回 / WORKER_LOG 脱敏 / client-events）
- `tests/unit/real-preview-server.test.ts` —— 1 条（stub 页在 4200–4210 可访问）
- `tests/unit/supervisor-draft-view-model.test.ts` —— 1 条（命中保护清单时……）

### 已知事实（不要再验证，直接用）

1. 这不是仓库代码。`SAFE_DELETE_BULK_CONFIRM_REQUIRED` 只出现在
   `tests/unit/deadlock-call-sites.test.ts:35` 的注释里，是**执行环境的
   safe-delete 垫片**：同一轮内累计 50 次删除后，拒绝后续删除调用。你的终端
   大概率没有这个垫片，所以**本地可能一次都复现不出来**——这不是「问题不存在」，
   而是环境差异。用 `git grep` 确认它不在 `src/` `daemon/` 里即可。
2. 仓库已有现成先例：`tests/unit/deadlock-call-sites.test.ts` 的
   `diskDeleteBlocked()`（约 40–70 行）。它探测「删除是否被环境拒绝」，
   被拒时把**盘上断言**降级为跳过并写明原因，而不是让用例红。

### 要做的事

1. 新建 `tests/helpers/tmp.ts`，导出：
   - `safeRmSync(target: string): boolean` —— 包一层 `fs.rmSync(target, { recursive: true, force: true })`，
     `try/catch` 吞掉「删除被环境拒绝」这一类错误（判据：错误信息里含
     `SAFE_DELETE_`），**其余错误照常抛出**（不要 `catch {}` 全吞，那会掩盖真实 bug）。
     返回是否删成功，便于调用方决定要不要降级断言。
   - `diskDeleteBlocked(): boolean` —— 把 `deadlock-call-sites.test.ts` 里的探测逻辑
     抽出来复用（探针写在 `.tmp/` 下，删不掉即判定被拒），让原文件改为 import 它。
2. 把上述 3 个文件（以及任何 `afterEach` / `finally` 里直接 `fs.rmSync(tmpDir…)` 的
   测试文件，用 `grep -rn "fs.rmSync(.*\\.tmp" tests/` 找）改为调用 `safeRmSync`。
3. 只有当用例**断言的内容就是「盘上文件已消失」**时，才按先例降级为跳过
   （`if (diskDeleteBlocked()) { ctx.skip(); }` 或等价写法）并在用例名/注释写明原因。
   其余情况（断言的是日志内容、HTTP 响应等）只把清理改成 `safeRmSync` 即可，
   **不许因此跳过断言**。

### 验收

```bash
npx vitest run tests/unit/task-c17-debug-log.test.ts \
               tests/unit/real-preview-server.test.ts \
               tests/unit/supervisor-draft-view-model.test.ts \
               tests/unit/deadlock-call-sites.test.ts
# 期望：全绿；在会被 safe-delete 拦截的环境里，最多出现「因 diskDeleteBlocked 跳过」的条目

npx tsc --noEmit   # 期望仍是 13 条基线错误，不新增
```

---

## 任务 B：`supervisor-draft-wiring` 全量偶红（1 条）

### 现象

```
FAIL  dom  tests/ui/supervisor-draft-wiring.test.tsx
      > 新建需求 → 草案端点 → Supervisor Tab / Studio 装载
      > 方案工作台单页挂载草案表单；C.18 无合同审阅视口的 rationale 列表
Error: expect(element).toHaveValue(src/components/**, src/routes/**, src/**, package.json,
       tsconfig.json, tsconfig.*.json, vitest.config.*, vite.config.*, *.config.ts,
       *.config.mjs, *.config.js, index.html, tests/**, **/*.test.ts, **/*.test.tsx, **/*.spec.ts)
```

### 已知事实

1. **单跑必绿**：`npx vitest run tests/ui/supervisor-draft-wiring.test.tsx` → 5/5 通过（实测 672ms）。
2. 只有全量跑（`dom` project，`maxWorkers=2`）才偶红。同一轮里 `node` project 先跑完。
3. 出错断言在 `tests/ui/supervisor-draft-wiring.test.tsx:217-222`：

   ```ts
   expect(screen.getByTestId("intent-title")).toHaveValue(
     draftResponse.draft.contract.intent.title,
   );
   expect(screen.getByTestId("intent-paths")).toHaveValue(
     draftResponse.draft.plan.writable_paths.join(", "),
   );
   ```

4. 报错里打印的「期望值」正是那 14 条**绿野脚手架种子**
   （`GREENFIELD_NPM_WRITABLE_DEFAULTS`，见 `src/lib/writable-scope-grade.ts`）。
   也就是说夹具里的 `writable_paths` 是按「绿野」判定生成的。
5. 组件侧 `intent-paths` 在 `src/routes/index.tsx:3461`。

### 假设（按可能性排序，先取证再改）

- **H1（最可能）异步刷新覆盖预填**：表单先按草案预填一次，随后某个 refresh /
  scope 重算又写了一次，且这次的结果是**非绿野**版本（仓库有 `package.json`）。
  全量下进程被拖慢，第二次写入恰好在断言之前落地 → 实际值 ≠ 期望值。
- **H2 夹具与真实判定不一致**：夹具的 `writable_paths` 是绿野种子，
  但组件在某些时序下走的是真实端点推导（非绿野）。
- **H3 共享夹具目录**：`dom` project 两个文件并发，某个文件创建/删除了
  `package.json`，导致 `isGreenfieldRepo` 在两次调用间翻转。

### 取证要求（先做，别直接改断言）

1. 在断言前把实际值打印出来（`screen.getByTestId("intent-paths").getAttribute("value")`
   或 `(el as HTMLInputElement).value`），跑**全量**复现一次，确认实际值到底是什么。
2. `grep -n "intent-paths" -A 5 -B 20 src/routes/index.tsx` 看清这个 input 的
   `value` 来自哪个 state，以及该 state 被赋值的地方有几处（重点找 `useEffect` /
   refresh / `setScope` 类调用）。
3. 确认 `isGreenfieldRepo` 在该 UI 测试里是否被真实调用（看 mock 边界：
   `generateSupervisorDraft` 被 mock 了，但 scope 重算可能没 mock）。

### 改动要求

- **不许**用 `retry`、`waitFor` 无脑兜、或放宽断言来掩盖。要先说清「谁第二次写了这个字段」。
- 如果是 H1：要么让第二次写入不再覆盖用户可见的预填（产品行为更正确），
  要么把断言改成「预填这一刻的值」——即断言紧跟在 `draft-ready` 之后并
  显式 `waitFor` 期望值，同时在测试名/注释里写明「此处不校验后续刷新」。
- 如果是 H2/H3：修夹具，让 `writable_paths` 与真实判定同源，不要硬编码种子列表。
- 改完补一条回归断言：同一文件里再断言一次「刷新后仍是该值」或「刷新会更新为 X」，
  把这条时序固化下来，避免下次又靠运气。

### 验收

```bash
npx vitest run tests/ui/supervisor-draft-wiring.test.tsx   # 5/5
npx vitest run                                              # 该条不再失败
```

---

## 通用约束

- 不要用 `git commit --no-verify`；hooks 失败就修根因。
- 不要为了变绿而 `it.skip` 掉承载真实断言的用例（环境性降级必须带探测 + 原因注释）。
- 提交信息沿用仓库风格：`test(infra): …` / `fix(ui): …`，正文说清「为什么」而不是「改了什么」。
- 两个任务分开提交，便于回滚。
- 完成后回报：全量读数（条数/通过/失败/跳过）、`npx tsc --noEmit` 错误数、两条失败各自的最终归因。
