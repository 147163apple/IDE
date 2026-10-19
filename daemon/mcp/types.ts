import { z } from "zod";

/**
 * Scoped MCP 工具协议类型（Daemon 侧唯一事实源）。
 * 浏览器端内存网关已随 M5 双轨消解删除（审计 D7）。
 */

export const StagentReadFileSchema = z.object({
  path: z.string().min(1, "Path cannot be empty"),
});
export type StagentReadFileInput = z.infer<typeof StagentReadFileSchema>;

export const StagentWriteFileSchema = z.object({
  path: z.string().min(1, "Path cannot be empty"),
  content: z.string(),
});
export type StagentWriteFileInput = z.infer<typeof StagentWriteFileSchema>;

export const StagentExecCommandSchema = z
  .object({
    command: z.string().min(1).optional(),
    executable: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
  })
  .refine(
    (value) =>
      (value.command !== undefined && value.command.length > 0) ||
      (value.executable !== undefined && value.executable.length > 0),
    { message: "command or executable is required" },
  );
export type StagentExecCommandInput = z.infer<typeof StagentExecCommandSchema>;

export const StagentListDirSchema = z.object({
  path: z.string().default("."),
});
export type StagentListDirInput = z.infer<typeof StagentListDirSchema>;

/** 第 5 个工具：由服务端依据实际 Scope / 预算 / 测试结果判定是否可进入审计 */
export const StagentDeclareCompleteSchema = z.object({
  summary: z.string().max(2000).optional(),
  touched_paths: z.array(z.string()).optional(),
});
export type StagentDeclareCompleteInput = z.infer<
  typeof StagentDeclareCompleteSchema
>;

export interface DeclareCompleteBlocker {
  code: string;
  message: string;
}

export interface DeclareCompleteResult {
  ready_for_audit: boolean;
  blockers: DeclareCompleteBlocker[];
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCallResult<T = unknown> {
  isError?: boolean;
  content: Array<{
    type: "text";
    text: string;
  }>;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AuditLogEntry {
  timestamp: string;
  tool: string;
  input: unknown;
  outcome: "SUCCESS" | "BLOCKED" | "FAILED";
  violationCode?: string;
  details?: string;
}
