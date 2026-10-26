import { describe, expect, it } from "vitest";
import {
  isDeliveredLifecycle,
  pickDefaultContractId,
} from "../../src/lib/contract-selection";

describe("pickDefaultContractId", () => {
  it("keeps current when still present", () => {
    expect(
      pickDefaultContractId(
        [
          { contract_id: "a", lifecycle_state: "MERGED" },
          { contract_id: "b", lifecycle_state: "DRAFT" },
        ],
        "b",
      ),
    ).toBe("b");
  });

  it("auto-picks the sole contract", () => {
    expect(
      pickDefaultContractId(
        [{ contract_id: "only", lifecycle_state: "DRAFT" }],
        null,
      ),
    ).toBe("only");
  });

  it("prefers MERGED among many", () => {
    expect(
      pickDefaultContractId(
        [
          {
            contract_id: "draft",
            lifecycle_state: "DRAFT",
            updated_at: "2026-10-26T14:00:00.000Z",
          },
          {
            contract_id: "merged",
            lifecycle_state: "MERGED",
            updated_at: "2026-10-26T12:00:00.000Z",
          },
        ],
        null,
      ),
    ).toBe("merged");
  });

  it("does not auto-pick among multiple drafts", () => {
    expect(
      pickDefaultContractId(
        [
          { contract_id: "a", lifecycle_state: "DRAFT" },
          { contract_id: "b", lifecycle_state: "PENDING_APPROVAL" },
        ],
        null,
      ),
    ).toBeNull();
  });
});

describe("isDeliveredLifecycle", () => {
  it("recognizes MERGED/AUDITED", () => {
    expect(isDeliveredLifecycle("MERGED")).toBe(true);
    expect(isDeliveredLifecycle("AUDITED")).toBe(true);
    expect(isDeliveredLifecycle("EXECUTING")).toBe(false);
  });
});
