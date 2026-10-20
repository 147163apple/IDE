import { useCallback, useEffect, useState } from "react";

export interface WorktreeFileIO {
  read(path: string): Promise<{ content: string; writable: boolean }>;
  save(path: string, content: string): Promise<void>;
}

/** TASK-C.3：读取 / 保存编辑器文件；reloadKey 变化时重新读取（Agent 改文件后实时刷新） */
export function useWorktreeFile(
  io: WorktreeFileIO | null,
  path: string,
  reloadKey = 0,
) {
  const [content, setContent] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!io) {
      setLoading(false);
      setError("连接 Daemon 后才能打开文件");
      return;
    }
    let cancelled = false;
    setLoading(true);
    io.read(path)
      .then((f) => {
        if (cancelled) return;
        setContent(f.content);
        setSaved(f.content);
        setWritable(f.writable);
        setError(null);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [io, path, reloadKey]);

  const save = useCallback(async () => {
    if (!io) return;
    try {
      await io.save(path, content);
      setSaved(content);
      setError(null);
    } catch (err) {
      setError(`保存被拒绝：${(err as Error).message}`);
    }
  }, [io, path, content]);

  return {
    content,
    setContent,
    writable,
    loading,
    error,
    dirty: content !== saved,
    save,
  };
}
