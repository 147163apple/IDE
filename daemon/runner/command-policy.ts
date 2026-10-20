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
 * 2. 包启动器（npx / npm exec / pnpm dlx / yarn dlx / bunx）拒绝任何追加参数，
 *    因为位置参数本身就是要执行的包/命令；
 * 3. 任何别名都不接受以 `-` 开头的追加参数（禁止选项注入），
 *    只允许位置参数；选项只能来自合同固定模板。
 *
 * 合同模板本身是用户审批过的内容（例如 `node -e process.exit(0)`），
 * 不在校验范围内；此处只校验 Worker 运行期追加的部分。
 */

export const E_UNAUTHORIZED_COMMAND = "E_UNAUTHORIZED_COMMAND";

export type AliasArgumentViolation =
  | "INTERPRETER_EVAL_FLAG"
  | "INTERPRETER_STDIN_SCRIPT"
  | "BARE_INTERPRETER"
  | "LAUNCHER_POSITIONAL_ARGS"
  | "OPTION_INJECTION";

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
    case "BARE_INTERPRETER":
      return "Bare interpreter template accepts no worker-supplied arguments";
    case "LAUNCHER_POSITIONAL_ARGS":
      return "Package launcher templates (npx/npm exec/pnpm dlx/yarn dlx/bunx) accept no worker-supplied arguments";
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

/** 包启动器：位置参数本身就是「要运行的包/命令」，追加即任意执行 */
const LAUNCHER_EXECUTABLES = new Set(["npx", "bunx"]);
const LAUNCHER_SUBCOMMANDS: Record<string, Set<string>> = {
  npm: new Set(["exec", "x"]),
  pnpm: new Set(["dlx"]),
  yarn: new Set(["dlx"]),
};

function isLauncherTemplate(
  executable: string,
  templateArgs: readonly string[],
): boolean {
  const name = normalizeExecutableName(executable);
  if (LAUNCHER_EXECUTABLES.has(name)) return true;
  const subcommands = LAUNCHER_SUBCOMMANDS[name];
  if (!subcommands) return false;
  const first = templateArgs[0]?.toLowerCase();
  return first !== undefined && subcommands.has(first);
}

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
 *
 * `templateArgs` 是合同里该别名固定携带的参数。裸解释器（如 `node` / `python3`
 * 后面没有任何脚本或代码参数）一旦允许追加位置参数，等于允许执行任意脚本，
 * 因此直接拒绝全部追加参数。
 */
export function assertAliasExtraArgsAllowed(params: {
  executable: string;
  templateArgs?: readonly string[];
  extraArgs: readonly string[];
}): void {
  const interpreter = isInterpreterExecutable(params.executable);
  const templateArgs = params.templateArgs ?? [];
  const hasScriptArg = templateArgs.some((arg) => !arg.startsWith("-"));

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

  // 包启动器：即使追加的是位置参数，也等于改变「要运行什么」
  if (
    isLauncherTemplate(params.executable, templateArgs) &&
    params.extraArgs.length > 0
  ) {
    throw new CommandPolicyError(
      "LAUNCHER_POSITIONAL_ARGS",
      params.extraArgs[0] as string,
    );
  }

  // 裸解释器：模板里没有任何脚本/代码参数时，任何位置参数都等于指定脚本执行
  if (interpreter && !hasScriptArg && params.extraArgs.length > 0) {
    throw new CommandPolicyError(
      "BARE_INTERPRETER",
      params.extraArgs[0] as string,
    );
  }
}
