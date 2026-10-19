import { describe, expect, it } from "vitest";
import {
  generateTaskBranch,
  isValidTaskBranch,
  isProtectedBranch,
  validateTaskBranchOperation,
  BranchGuardError,
} from "../../daemon/git/branch-guard";

describe("Task 1.2: Git Branch Guard", () => {
  it("should generate compliant task branch names", () => {
    expect(generateTaskBranch("task-123")).toBe("task/task-123");
    expect(generateTaskBranch("fix_bug_456")).toBe("task/fix_bug_456");
    expect(generateTaskBranch("contract/with/slashes")).toBe(
      "task/contract_with_slashes",
    );
  });

  it("should validate task branch format correctly", () => {
    expect(isValidTaskBranch("task/abc1234")).toBe(true);
    expect(isValidTaskBranch("task/my-task-1")).toBe(true);
    expect(isValidTaskBranch("main")).toBe(false);
    expect(isValidTaskBranch("feature/something")).toBe(false);
    expect(isValidTaskBranch("task/")).toBe(false);
  });

  it("should identify protected trunk branches", () => {
    expect(isProtectedBranch("main")).toBe(true);
    expect(isProtectedBranch("master")).toBe(true);
    expect(isProtectedBranch("release/v1.0")).toBe(true);
    expect(isProtectedBranch("production")).toBe(true);
    expect(isProtectedBranch("task/safe-task")).toBe(false);
  });

  it("should reject task operations directly on protected branches", () => {
    expect(() => validateTaskBranchOperation("main")).toThrow(BranchGuardError);
    expect(() => validateTaskBranchOperation("master")).toThrow(
      BranchGuardError,
    );
    expect(() => validateTaskBranchOperation("unprefixed-branch")).toThrow(
      BranchGuardError,
    );
    expect(() =>
      validateTaskBranchOperation("task/valid-contract"),
    ).not.toThrow();
  });
});
