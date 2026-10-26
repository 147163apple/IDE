/**
 * TASK-C.12b：session_epoch + 单调 state_seq（防重连乱序/倒流）。
 * epoch 递增时允许重置 seq；同 epoch 内 seq 严格递增。
 */

export interface SeqStamp {
  session_epoch: number;
  state_seq: number;
}

export class SessionSeqTracker {
  private epoch: number;
  private seq: number;

  constructor(initialEpoch = 1) {
    this.epoch = Math.max(1, initialEpoch);
    this.seq = 0;
  }

  getEpoch(): number {
    return this.epoch;
  }

  getSeq(): number {
    return this.seq;
  }

  /** 新会话世代（Daemon 重启 / 用户强制新会话）：epoch++，seq 归零后再 next */
  bumpEpoch(): number {
    this.epoch += 1;
    this.seq = 0;
    return this.epoch;
  }

  /** 下一次广播的 stamp（同 epoch 内 seq 单调 +1） */
  next(): SeqStamp {
    this.seq += 1;
    return { session_epoch: this.epoch, state_seq: this.seq };
  }

  snapshot(): SeqStamp {
    return { session_epoch: this.epoch, state_seq: this.seq };
  }
}

/**
 * 客户端合并规则：同 epoch 忽略更小或相等 seq；更大 epoch 接受并重置本地游标。
 */
export function shouldAcceptStateSeq(
  incoming: SeqStamp,
  last: SeqStamp | null,
): boolean {
  if (!last) return true;
  if (incoming.session_epoch > last.session_epoch) return true;
  if (incoming.session_epoch < last.session_epoch) return false;
  return incoming.state_seq > last.state_seq;
}
