import type { ScopedWorktreeGateway } from "../mcp/gateway";
import type { MCPToolCallResult } from "../mcp/types";
import {
  WORKER_MCP_TOOLS,
  WORKER_STANDARD_TOOLS,
  type WorkerCoreTool,
  type WorkerStandardTool,
} from "./session-task-injector";

/**
 * Worker 侧 MCP 工具挂载层（TASK-W.2 目标 1/2）。
 *
 * 设计要点：
 * 1. **按授权挂载**：只挂载 `resolveExposedTools()` 给出的工具；合同未授权
 *    命令执行时 `stagent_exec_command` 根本不实例化，调用即抛
 *    `WorkerToolNotMountedError`——「没挂载」比「挂载后再判断」更难被绕过。
 * 2. **零直连**：所有方法只转发到 `ScopedWorktreeGateway.callTool()`，
 *    本层不碰 `fs`、不拼接命令行、不持有执行句柄。
 * 3. **参数最小化**：每个方法只暴露规范定义的字段，`expected_hash` 走独立
 *    可选参数，避免 Worker 传入任意对象绕过 Schema。
 */

/** 调用了未挂载（未授权 / 未启用）的工具 */
export class WorkerToolNotMountedError extends Error {
  readonly tool: string;
  constructor(tool: string) {
    super(
      `[E_UNAUTHORIZED_COMMAND] Tool '${tool}' is not mounted for this contract; ` +
        `it was either not authorized or disabled by the contract scope`,
    );
    this.name = "WorkerToolNotMountedError";
    this.tool = tool;
  }
}

export interface WorkerToolset {
  /** 实际挂载的工具名（可供 UI 展示与测试断言） */
  readonly exposed: readonly WorkerStandardTool[];
  /** 五大核心工具中实际挂载的子集 */
  readonly mounted_core_tools: readonly WorkerCoreTool[];
  has(tool: WorkerStandardTool): boolean;
  readFile(path: string): Promise<MCPToolCallResult>;
  writeFile(
    path: string,
    content: string,
    expectedHash?: string | undefined,
  ): Promise<MCPToolCallResult>;
  listDirectory(
    path?: string | undefined,
    options?: { recursive?: boolean } | undefined,
  ): Promise<MCPToolCallResult>;
  deleteFile(path: string): Promise<MCPToolCallResult>;
  execCommand(
    commandAlias: string,
    args?: readonly string[] | undefined,
  ): Promise<MCPToolCallResult>;
  declareComplete(input?: {
    summary?: string | undefined;
    touched_paths?: string[] | undefined;
  }): Promise<MCPToolCallResult>;
}

export interface MountWorkerToolsOptions {
  gateway: ScopedWorktreeGateway;
  /** 通常来自 `buildWorkerTaskInstruction().exposed_tools` */
  exposedTools: readonly string[];
}

export function mountWorkerTools(
  options: MountWorkerToolsOptions,
): WorkerToolset {
  const { gateway } = options;
  const known = new Set<string>(WORKER_STANDARD_TOOLS);
  for (const name of options.exposedTools) {
    if (!known.has(name)) {
      throw new WorkerToolNotMountedError(name);
    }
  }

  const exposed = [...options.exposedTools] as WorkerStandardTool[];
  const exposedSet = new Set<string>(exposed);

  const assertMounted = (tool: WorkerStandardTool): void => {
    if (!exposedSet.has(tool)) throw new WorkerToolNotMountedError(tool);
  };

  return {
    exposed,
    mounted_core_tools: WORKER_MCP_TOOLS.filter((tool) =>
      exposedSet.has(tool),
    ) as WorkerCoreTool[],
    has: (tool) => exposedSet.has(tool),

    readFile: async (path) => {
      assertMounted("stagent_read_file");
      return gateway.callTool("stagent_read_file", { path });
    },

    writeFile: async (path, content, expectedHash) => {
      assertMounted("stagent_write_file");
      return gateway.callTool("stagent_write_file", {
        path,
        content,
        ...(expectedHash === undefined ? {} : { expected_hash: expectedHash }),
      });
    },

    listDirectory: async (path = ".", listOptions) => {
      assertMounted("stagent_list_directory");
      return gateway.callTool("stagent_list_directory", {
        path,
        ...(listOptions?.recursive === undefined
          ? {}
          : { recursive: listOptions.recursive }),
      });
    },

    deleteFile: async (path) => {
      assertMounted("stagent_delete_file");
      return gateway.callTool("stagent_delete_file", { path });
    },

    execCommand: async (commandAlias, args) => {
      assertMounted("stagent_exec_command");
      return gateway.callTool("stagent_exec_command", {
        command_alias: commandAlias,
        ...(args === undefined ? {} : { args: [...args] }),
      });
    },

    declareComplete: async (input = {}) => {
      assertMounted("stagent_declare_complete");
      return gateway.callTool("stagent_declare_complete", input);
    },
  };
}
