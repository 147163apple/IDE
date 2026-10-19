export const PROTECTED_BRANCHES = [
  "main",
  "master",
  "prod",
  "production",
  "release",
  "staging",
] as const;

export class BranchGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BranchGuardError";
  }
}

/**
 * Clean and format contract ID into a safe branch identifier.
 */
export function cleanBranchIdentifier(contractId: string): string {
  return contractId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Generate standardized task branch name for contract isolation.
 * Strictly adheres to `task/{contract_id}` pattern.
 */
export function generateTaskBranch(contractId: string): string {
  const cleanId = cleanBranchIdentifier(contractId);
  return `task/${cleanId}`;
}

/**
 * Check if branch name matches the isolation task branch format.
 */
export function isValidTaskBranch(branchName: string): boolean {
  return /^task\/[a-zA-Z0-9_-]+$/.test(branchName);
}

/**
 * Check if branch is a protected system/trunk branch.
 */
export function isProtectedBranch(branchName: string): boolean {
  const normalized = branchName.trim().toLowerCase();
  if (
    PROTECTED_BRANCHES.some(
      (p) => normalized === p || normalized.startsWith(`${p}/`),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Validate that a target branch can be safely created/operated upon by Stagent Worker.
 */
export function validateTaskBranchOperation(branchName: string): void {
  if (isProtectedBranch(branchName)) {
    throw new BranchGuardError(
      `Branch '${branchName}' is a protected trunk branch. Direct execution on protected branches is strictly prohibited.`,
    );
  }
  if (!isValidTaskBranch(branchName)) {
    throw new BranchGuardError(
      `Branch '${branchName}' violates Stagent naming policy. Task branches must follow 'task/{contract_id}'.`,
    );
  }
}
