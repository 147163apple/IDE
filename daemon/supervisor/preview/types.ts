/** 真机预览端口区间（与 Demo 4100–4110 错开） */
export const REAL_PREVIEW_PORT_RANGE = { start: 4200, end: 4210 } as const;

export const REAL_PREVIEW_ENTRY = "index.html" as const;

export const MAX_REAL_PREVIEW_FILE_BYTES = 2 * 1024 * 1024;

export interface RealPreviewHandle {
  readonly url: string;
  readonly port: number;
  readonly contract_id: string;
  /** attach 模式无自建进程时为 null */
  readonly owned: boolean;
}
