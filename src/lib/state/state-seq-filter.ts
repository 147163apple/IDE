/**
 * TASK-C.12b：客户端按 (session_epoch, state_seq) 去重、拒倒流。
 * 纯函数，可在浏览器与单测共用。
 */

export interface ClientSeqCursor {
  session_epoch: number;
  state_seq: number;
}

export function shouldApplyStateChanged(
  incoming: { session_epoch?: number; state_seq?: number },
  last: ClientSeqCursor | null,
): { apply: boolean; next: ClientSeqCursor | null } {
  const epoch = incoming.session_epoch;
  const seq = incoming.state_seq;
  // 旧 Daemon 无序列字段：兼容放行，但不推进游标
  if (typeof epoch !== "number" || typeof seq !== "number") {
    return { apply: true, next: last };
  }
  if (!last) {
    return { apply: true, next: { session_epoch: epoch, state_seq: seq } };
  }
  if (epoch > last.session_epoch) {
    return { apply: true, next: { session_epoch: epoch, state_seq: seq } };
  }
  if (epoch < last.session_epoch) {
    return { apply: false, next: last };
  }
  if (seq <= last.state_seq) {
    return { apply: false, next: last };
  }
  return { apply: true, next: { session_epoch: epoch, state_seq: seq } };
}
