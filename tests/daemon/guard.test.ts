import { describe, it, expect } from "vitest";
import {
  LoopGuard,
  LoopCircuitBreakerError,
} from "../../daemon/guard/loop-guard";
import {
  CostMonitor,
  CostCapExceededError,
} from "../../daemon/guard/cost-monitor";

describe("Task 1.3: Loop Guard & Cost Circuit Breakers", () => {
  describe("LoopGuard", () => {
    it("should trip circuit breaker when consecutive failures reach maxRetries", () => {
      const guard = new LoopGuard({ maxRetries: 3 });
      expect(guard.isTripped()).toBe(false);

      // Attempt 1: fail
      guard.recordAttempt({ passed: false, exitCode: 1 });
      expect(guard.isTripped()).toBe(false);
      expect(guard.getConsecutiveFailures()).toBe(1);

      // Attempt 2: fail
      guard.recordAttempt({ passed: false, exitCode: 1 });
      expect(guard.isTripped()).toBe(false);
      expect(guard.getConsecutiveFailures()).toBe(2);

      // Attempt 3: fail -> trips circuit breaker
      guard.recordAttempt({ passed: false, exitCode: 1 });
      expect(guard.isTripped()).toBe(true);
      expect(guard.getConsecutiveFailures()).toBe(3);

      expect(() => guard.assertNotTripped()).toThrowError(
        LoopCircuitBreakerError,
      );
    });

    it("should reset consecutive failures counter on successful verification", () => {
      const guard = new LoopGuard({ maxRetries: 3 });
      guard.recordAttempt({ passed: false, exitCode: 1 });
      guard.recordAttempt({ passed: false, exitCode: 1 });
      expect(guard.getConsecutiveFailures()).toBe(2);

      // Pass resets counter
      guard.recordAttempt({ passed: true, exitCode: 0 });
      expect(guard.getConsecutiveFailures()).toBe(0);
      expect(guard.isTripped()).toBe(false);
      expect(guard.getTotalAttempts()).toBe(3);
    });
  });

  describe("CostMonitor", () => {
    it("should accumulate tokens and compute financial cost accurately", () => {
      const monitor = new CostMonitor({
        pricing: { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
      });

      // 10,000 input tokens = $0.03, 1,000 output tokens = $0.015 => total = $0.045
      const rec = monitor.recordUsage(10_000, 1_000);
      expect(rec.costUsd).toBeCloseTo(0.045, 4);

      const totals = monitor.getTotals();
      expect(totals.inputTokens).toBe(10_000);
      expect(totals.outputTokens).toBe(1_000);
      expect(totals.totalTokens).toBe(11_000);
      expect(totals.totalCostUsd).toBeCloseTo(0.045, 4);
      expect(totals.tripped).toBe(false);
    });

    it("should trip circuit breaker when maximum cost is reached", () => {
      const monitor = new CostMonitor({
        maxCostUsd: 1.0,
        pricing: { inputCostPerMillion: 100.0, outputCostPerMillion: 100.0 }, // $100 per 1M ($0.1 per 1k)
      });

      // 5,000 tokens = $0.50
      monitor.recordUsage(2500, 2500);
      expect(monitor.isTripped()).toBe(false);
      expect(() => monitor.assertCanConsume(1000, 1000)).not.toThrow();

      // Another 6,000 tokens = $0.60 => total $1.10 >= $1.00
      monitor.recordUsage(3000, 3000);
      expect(monitor.isTripped()).toBe(true);

      expect(() => monitor.assertCanConsume(100, 100)).toThrowError(
        CostCapExceededError,
      );
    });

    it("should trip circuit breaker when maximum tokens are reached", () => {
      const monitor = new CostMonitor({
        maxTotalTokens: 5000,
      });

      monitor.recordUsage(3000, 1000); // 4000 tokens
      expect(monitor.isTripped()).toBe(false);

      // Prospective consumption of 2000 tokens would push total to 6000 > 5000
      expect(() => monitor.assertCanConsume(1000, 1000)).toThrowError(
        CostCapExceededError,
      );
    });
  });
});
