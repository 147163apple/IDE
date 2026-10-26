/**
 * 负载度量：给「性能 SLA」类断言提供与机器状况挂钩的余量。
 *
 * 背景：8 fork 并发时进程会被整段饿死，一个 0ms 定时器实际要等几百毫秒
 * 甚至上千毫秒。此时任何绝对毫秒阈值都会把「机器卡了」误报成「产品变慢」，
 * 而放宽阈值又会失去守门意义。
 *
 * 用法：断言写成 `实测 < SLA + k × 本值`。机器健康时本值≈0，等价于原始 SLA；
 * 机器被拖垮时余量随之放大，但仍在断言，不静默放过。
 */

/**
 * 测量本机此刻的调度延迟（毫秒）：一个 0ms 定时器实际等了多久。
 *
 * 取多次采样的中位数，避开单次尖峰——偶发的一次长阻塞不该代表整轮状况。
 */
export async function measureSchedulingStallMs(samples = 3): Promise<number> {
  const costs: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const startedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 0));
    costs.push(performance.now() - startedAt);
  }
  costs.sort((a, b) => a - b);
  return costs[Math.floor(costs.length / 2)] ?? 0;
}
