# BRIEF · TASK-C.11a–e Supervisor 五步体感 · 起床验收

> 合入分支：`feat/task-c11a-e-supervisor-five-steps` → `main`（见 git tip）  
> 硬标准：`docs/reports/工程决策拍板-Top7-2026-10-25.md`

## 怎么打开看效果（推荐开发态）

在仓库根目录 `/Users/tina/Desktop/1020`：

```bash
# 终端 A：Daemon（指向本仓或任意业务仓）
npx tsx bin/stagent.ts start --repo /Users/tina/Desktop/1020

# 终端 B：Vite 控制台
npm run dev
```

浏览器打开 Vite 打印的地址（常见 `http://127.0.0.1:5173` 或 `8080`），并带上 Daemon 日志里的钥匙：

```text
http://127.0.0.1:<VITE端口>/#token=<TOKEN>&base=http://127.0.0.1:<DAEMON端口>
```

也可一键（需先 `npm run build`）：

```bash
npm run build
npx tsx bin/stagent.ts open /Users/tina/Desktop/1020
```

## 五步点哪里验收

1. **C.11a 选择题**：右栏输入较长新意图（如「给系统加会员等级」）→ 出现带 **「推荐」** 徽标的选择题；点选项可推进；最多 **2 轮**。
2. **C.11b Demo**：澄清结束后自动落盘 `.stagent/prototypes/<id>/`（已在 `.gitignore`）；中间视口可试玩；点 **「确认 Demo」**。
3. **C.11c 白话合同**：确认后出现合同卡（要干什么 / 能改哪里 / 怎么算验收）；未确认时授权按钮禁用；可拒绝（Demo 保留）或改细节。
4. **C.11d 越界挂起**：施工中若 Gateway 报越界，弹出 **扩权 / 回滚**（不静默放行）。
5. **C.11e 质疑回灰**：右栏质疑且自查失败或选「新需求演进」时，图谱相关灯 **回灰**，不假绿。

## 缺口（可后补，不挡起床看 UI）

- 扩权目前是「引导回合同改 Scope 重签」的 UX 记录，未自动改写 Scope 字段。
- Impact 完整 AST / D.1e / 讨论稿升格：按约束未做。
- `assertDemoConfirmedForWrite` 已挂在 `run-worker`；UI 侧授权按钮亦受 `demo_confirmed` 门禁。
