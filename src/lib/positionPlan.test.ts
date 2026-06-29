import { describe, expect, it } from "vitest";
import { bookPctLabel, describePlan, planHeadline, planPosition } from "./positionPlan";
import type { Investability } from "./investability";

const inv = (over: Partial<Investability> = {}): Investability => ({
  status: over.status ?? "ok",
  tradable: over.tradable ?? true,
  affordable: over.affordable,
  sharePriceDkk: over.sharePriceDkk,
  budgetDkk: over.budgetDkk ?? 5000,
  exchange: over.exchange ?? "NASDAQ",
  fxApprox: over.fxApprox ?? false,
  reason: over.reason,
  note: over.note ?? "",
});

describe("planPosition", () => {
  it("sizes whole shares to the slot and reports the rounding remainder", () => {
    // DKK 1,200 a share, 5,000 slot → 4 shares = 4,800 (200 unused).
    const plan = planPosition(inv({ sharePriceDkk: 1200 }), 50000);
    expect(plan).toBeDefined();
    expect(plan!.status).toBe("fits");
    expect(plan!.shares).toBe(4);
    expect(plan!.costDkk).toBe(4800);
    expect(plan!.budgetUse).toBeCloseTo(0.96, 5);
    expect(plan!.bookFraction).toBeCloseTo(4800 / 50000, 5);
    expect(plan!.fxApprox).toBe(false);
  });

  it("flags a name whose single share already overshoots the slot", () => {
    // ASML-like: ~12,500 DKK a share against a 5,000 slot.
    const plan = planPosition(inv({ status: "above_budget", sharePriceDkk: 12500, fxApprox: true }), 40000);
    expect(plan!.status).toBe("over");
    expect(plan!.shares).toBe(0);
    expect(plan!.costDkk).toBe(12500);
    expect(plan!.slotMultiple).toBeCloseTo(2.5, 5);
    expect(plan!.bookFraction).toBeCloseTo(12500 / 40000, 5);
  });

  it("returns no plan for a market the broker can't trade", () => {
    // SK hynix case: priced, but off-platform — there is no position to size.
    expect(planPosition(inv({ status: "not_tradable", tradable: false, sharePriceDkk: 800 }), 40000)).toBeUndefined();
  });

  it("returns no plan when no share price is known yet", () => {
    expect(planPosition(inv({ status: "unknown", sharePriceDkk: undefined }), 40000)).toBeUndefined();
  });

  it("omits the book fraction when the book value is unknown", () => {
    const plan = planPosition(inv({ sharePriceDkk: 1000 }), 0);
    expect(plan!.shares).toBe(5);
    expect(plan!.bookFraction).toBeUndefined();
  });

  it("handles a cheap share filling the slot exactly", () => {
    const plan = planPosition(inv({ sharePriceDkk: 250 }), 50000);
    expect(plan!.shares).toBe(20);
    expect(plan!.costDkk).toBe(5000);
    expect(plan!.budgetUse).toBe(1);
  });
});

describe("bookPctLabel", () => {
  it("never renders a non-zero sliver as a bare 0%", () => {
    expect(bookPctLabel(0.004)).toBe("<1%");
    expect(bookPctLabel(0.094)).toBe("9%");
    expect(bookPctLabel(undefined)).toBeUndefined();
  });
});

describe("planHeadline", () => {
  it("reads as a concrete buy line when it fits", () => {
    const plan = planPosition(inv({ sharePriceDkk: 1200 }), 50000)!;
    expect(planHeadline(plan)).toBe("≈ 4 shares · DKK 4,800");
  });

  it("uses the singular for a single share and marks approximate FX", () => {
    const plan = planPosition(inv({ sharePriceDkk: 4000, fxApprox: true }), 50000)!;
    expect(planHeadline(plan)).toBe("≈ 1 share · DKK 4,000 (approx)");
  });

  it("leads with the single share for an over-budget name", () => {
    const plan = planPosition(inv({ status: "above_budget", sharePriceDkk: 12500 }), 40000)!;
    expect(planHeadline(plan)).toBe("1 share ≈ DKK 12,500");
  });
});

describe("describePlan", () => {
  it("explains the unused remainder honestly", () => {
    const plan = planPosition(inv({ sharePriceDkk: 1200 }), 50000)!;
    expect(describePlan(plan)).toContain("DKK 200 of the slot unused");
    expect(describePlan(plan)).toContain("10% of your current book");
  });

  it("explains how far an over-budget name overshoots", () => {
    const plan = planPosition(inv({ status: "above_budget", sharePriceDkk: 12500 }), 40000)!;
    expect(describePlan(plan)).toContain("2.5× your DKK 5,000 slot");
    expect(describePlan(plan)).toContain("overshoots");
  });
});
