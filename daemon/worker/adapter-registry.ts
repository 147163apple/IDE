import {
  validateAdapterCapability,
  type AdapterCapabilityDeclaration,
  type AdapterControlMode,
  type AdapterRejectionCode,
  type CodingWorkerAdapter,
} from "./worker-adapter.interface";

/**
 * 适配器注册中心（TASK-W.1 目标 4 / B PASS 判据）。
 *
 * 默认拒绝：未声明能力、声明直连文件系统 / 无限制 Shell、或无法拦截工具调用的
 * 适配器，**不能**以 `GATEWAY_ENFORCED` 注册；只允许登记为
 * `UNCONTROLLED_EXTERNAL`（用户自管，产物不得作为受控执行证据）。
 *
 * 注册中心不持有执行能力，也不调用适配器。
 */

export type AdapterRegistrationRejection =
  AdapterRejectionCode | "ADAPTER_ID_DUPLICATED";

export class AdapterRegistrationError extends Error {
  readonly rejection: AdapterRegistrationRejection;
  constructor(rejection: AdapterRegistrationRejection, message: string) {
    super(message);
    this.name = "AdapterRegistrationError";
    this.rejection = rejection;
  }
}

export interface RegisteredAdapter {
  adapter: CodingWorkerAdapter;
  control_mode: AdapterControlMode;
  declaration: AdapterCapabilityDeclaration;
}

export class AdapterRegistry {
  private readonly entries = new Map<string, RegisteredAdapter>();

  /**
   * 注册适配器。
   *
   * @param controlMode 默认 `GATEWAY_ENFORCED`（严格校验）；
   *   仅当调用方明确声明 `UNCONTROLLED_EXTERNAL` 时放宽。
   */
  register(
    adapter: CodingWorkerAdapter,
    controlMode: AdapterControlMode = "GATEWAY_ENFORCED",
  ): RegisteredAdapter {
    const declaration = adapter.declaration;
    const adapterId = declaration?.adapter_id;

    if (typeof adapterId === "string" && this.entries.has(adapterId)) {
      throw new AdapterRegistrationError(
        "ADAPTER_ID_DUPLICATED",
        `adapter already registered: ${adapterId}`,
      );
    }

    const validation = validateAdapterCapability(declaration, controlMode);
    if (!validation.ok) {
      throw new AdapterRegistrationError(
        validation.code,
        `[${validation.code}] adapter ${adapterId ?? "<unknown>"} rejected for ${controlMode}: ${validation.reason}`,
      );
    }

    const entry: RegisteredAdapter = {
      adapter,
      control_mode: controlMode,
      declaration,
    };
    this.entries.set(adapterId, entry);
    return entry;
  }

  get(adapterId: string): RegisteredAdapter | undefined {
    return this.entries.get(adapterId);
  }

  /** 取受控适配器；非受控或不存在时抛错，避免误把外部助手当执行者 */
  requireControlled(adapterId: string): CodingWorkerAdapter {
    const entry = this.entries.get(adapterId);
    if (!entry) {
      throw new AdapterRegistrationError(
        "ADAPTER_ID_INVALID",
        `adapter not registered: ${adapterId}`,
      );
    }
    if (entry.control_mode !== "GATEWAY_ENFORCED") {
      throw new AdapterRegistrationError(
        "TOOL_INTERCEPTION_UNSUPPORTED",
        `adapter ${adapterId} is registered as ${entry.control_mode}; it cannot be used for controlled execution`,
      );
    }
    return entry.adapter;
  }

  list(): RegisteredAdapter[] {
    return [...this.entries.values()];
  }

  has(adapterId: string): boolean {
    return this.entries.has(adapterId);
  }

  clear(): void {
    this.entries.clear();
  }
}
