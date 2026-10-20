/**
 * 命令别名参数策略（TASK-W.3 目标 3 / 回应 TASK-W.2 残留风险）。
 *
 * 背景：`stagent_exec_command` 允许 Worker 为合同别名追加 `args`，而
 * 子进程以 argv 直传、`shell:false` 启动只能阻止 *shell* 注入，无法阻止
 * 「把解释器本身当代码执行器」——例如向 `node` 传 `-e`、向 `python` 传 `-c`，
 * 或以选项形式注入 `--config=/etc/passwd`。本模块在网关层对**Worker 追加参数**
 * 施加两条硬规则：
 *
 * 1. 解释器别名禁止动态求值参数（`-e` / `--eval` / `-c` / `-p` / `--import`
 *    等），也禁止用 `-` 从 stdin 读脚本；
 * 2. 任何别名都不接受以 `-` 开头的追加参数（禁止选项注入），
 *    只允许位置参数；选项只能来自合同固定模板。
 *
 * 合同模板本身是用户审批过的内容（例如 `node -e process.exit(0)`），
 * 不在校验范围内；此处只校验 Worker 运行期追加的部分。
 */

export const E_UNAUTHORIZED_COMMAND = "E_UNAUTHORIZED_COMMAND";

export type AliasArgumentViolation =
  "INTERPRETER_EVAL_FLAG" | "INTERPRETER_STDIN_SCRIPT" | "OPTION_INJECTION";

export class CommandPolicyError extends Error {
  readonly code = E_UNAUTHORIZED_COMMAND;
  readonly violation: AliasArgumentViolation;
  readonly argument: string;

  constructor(violation: AliasArgumentViolation, argument: string) {
    super(
      `[${E_UNAUTHORIZED_COMMAND}] ${describeViolation(violation)}: ${JSON.stringify(argument)}`,
    );
    this.name = "CommandPolicyError";
    this.violation = violation;
    this.argument = argument;
  }
}

function describeViolation(violation: AliasArgumentViolation): string {
  switch (violation) {
    case "INTERPRETER_EVAL_FLAG":
      return "Interpreter dynamic-evaluation flag is not allowed in worker-supplied args";
    case "INTERPRETER_STDIN_SCRIPT":
      return "Reading an interpreter script from stdin is not allowed";
    case "OPTION_INJECTION":
      return "Worker-supplied args must be positional; option injection is not allowed";
  }
}

/** 解释器/运行时：这些可执行文件能用特定参数直接执行任意代码 */
const INTERPRETER_EXECUTABLES = new Set([
  "node",
  "nodejs",
  "python",
  "python2",
  "python3",
  "ruby",
  "perl",
  "php",
  "bash",
  "sh",
  "zsh",
  "fish",
  "deno",
  "bun",
  "pwsh",
  "powershell",
  "lua",
  "rscript",
]);

/** 动态求值参数（含常见长短形式） */
const EVAL_FLAGS = new Set([
  "-e",
  "--eval",
  "-c",
  "--command",
  "-p",
  "--print",
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-i",
  "--interactive",
]);

const EVAL_FLAG_PREFIXES = ["--eval=", "--command=", "--print=", "--import="];

/** 取可执行文件名（去掉目录与 Windows 扩展名），用于解释器判定 */
export function normalizeExecutableName(executable: string): string {
  const base = executable.split(/[\\/]/).pop() ?? executable;
  return base.toLowerCase().replace(/\.exe$/, "");
}

export function isInterpreterExecutable(executable: string): boolean {
  return INTERPRETER_EXECUTABLES.has(normalizeExecutableName(executable));
}

function isEvalFlag(argument: string): boolean {
  if (EVAL_FLAGS.has(argument)) return true;
  return EVAL_FLAG_PREFIXES.some((prefix) => argument.startsWith(prefix));
}

/**
 * 校验 Worker 追加参数；违规抛 `CommandPolicyError`（码 `E_UNAUTHORIZED_COMMAND`）。
 */
export function assertAliasExtraArgsAllowed(params: {
  executable: string;
  extraArgs: readonly string[];
}): void {
  const interpreter = isInterpreterExecutable(params.executable);

  for (const argument of params.extraArgs) {
    if (interpreter && isEvalFlag(argument)) {
      throw new CommandPolicyError("INTERPRETER_EVAL_FLAG", argument);
    }
    if (interpreter && argument === "-") {
      throw new CommandPolicyError("INTERPRETER_STDIN_SCRIPT", argument);
    }
    if (argument.startsWith("-") && argument !== "-") {
      throw new CommandPolicyError("OPTION_INJECTION", argument);
    }
  }
}
