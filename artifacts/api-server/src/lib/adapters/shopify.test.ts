import { describe, it, expect } from "vitest";
import { mapOrderStatus } from "./shopify";

// The mapping is accounting-critical: only "delivered" recognises revenue
// downstream, so it must require BOTH a paid financial state and full
// fulfillment. These tests lock that contract.
describe("shopify mapOrderStatus", () => {
  it("recognises revenue only when paid AND fulfilled", () => {
    expect(mapOrderStatus({ financial_status: "paid", fulfillment_status: "fulfilled" })).toBe("delivered");
    expect(mapOrderStatus({ financial_status: "partially_refunded", fulfillment_status: "fulfilled" })).toBe("delivered");
  });

  it("does NOT recognise revenue when fulfilled but unpaid", () => {
    expect(mapOrderStatus({ financial_status: "pending", fulfillment_status: "fulfilled" })).toBe("shipped");
    expect(mapOrderStatus({ financial_status: "authorized", fulfillment_status: "fulfilled" })).toBe("shipped");
    expect(mapOrderStatus({ financial_status: null, fulfillment_status: "fulfilled" })).toBe("shipped");
  });

  it("treats a full refund as refunded and a cancellation as cancelled", () => {
    expect(mapOrderStatus({ financial_status: "refunded", fulfillment_status: "fulfilled" })).toBe("refunded");
    expect(mapOrderStatus({ cancelled_at: "2026-01-01T00:00:00Z", financial_status: "paid", fulfillment_status: "fulfilled" })).toBe("cancelled");
  });

  it("maps in-progress states without recognising revenue", () => {
    expect(mapOrderStatus({ financial_status: "paid", fulfillment_status: null })).toBe("confirmed");
    expect(mapOrderStatus({ financial_status: "paid", fulfillment_status: "partial" })).toBe("shipped");
    expect(mapOrderStatus({ financial_status: "pending", fulfillment_status: null })).toBe("processing");
  });
});
