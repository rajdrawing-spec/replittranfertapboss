import { describe, it, expect } from "vitest"
import { calcItem, round2, type LineItem } from "./invoice-form"

/**
 * Regression tests for invoice line-item math: amounts, discounts, tax,
 * the taxType="none" exemption, and the CGST/SGST split shown in the
 * Tax Breakdown sidebar (each half of the GST amount).
 */

function item(overrides: Partial<LineItem> = {}): LineItem {
  return {
    _id: "t",
    description: "Test item",
    hsnCode: "",
    quantity: 1,
    rate: 0,
    discountPercent: 0,
    taxType: "gst",
    taxRate: 18,
    amount: 0,
    taxAmount: 0,
    lineTotal: 0,
    ...overrides,
  }
}

describe("calcItem line-item math", () => {
  it("computes amount, tax and line total for a plain GST item", () => {
    const it2 = calcItem(item({ quantity: 2, rate: 100, taxRate: 18 }))
    expect(it2.amount).toBe(200)
    expect(it2.taxAmount).toBe(36)
    expect(it2.lineTotal).toBe(236)
  })

  it("applies percentage discount before tax", () => {
    const it2 = calcItem(item({ quantity: 2, rate: 100, discountPercent: 10, taxRate: 18 }))
    expect(it2.amount).toBe(180) // 200 - 10%
    expect(it2.taxAmount).toBe(32.4) // 18% of 180
    expect(it2.lineTotal).toBe(212.4)
  })

  it("charges zero tax when taxType is 'none' even if a tax rate is set", () => {
    const it2 = calcItem(item({ quantity: 1, rate: 500, taxType: "none", taxRate: 18 }))
    expect(it2.taxAmount).toBe(0)
    expect(it2.lineTotal).toBe(500)
  })

  it("rounds monetary values to 2 decimals", () => {
    const it2 = calcItem(item({ quantity: 3, rate: 33.33, taxRate: 18 }))
    expect(it2.amount).toBe(round2(99.99))
    expect(it2.taxAmount).toBe(round2(99.99 * 0.18))
    expect(it2.lineTotal).toBe(round2(it2.amount + it2.taxAmount))
  })
})

describe("GST CGST/SGST split", () => {
  it("splits the GST amount into two equal halves at half the rate", () => {
    const it2 = calcItem(item({ quantity: 1, rate: 1000, taxType: "gst", taxRate: 18 }))
    const half = it2.taxAmount / 2
    expect(half).toBe(90) // CGST 9% = 90
    expect(half * 2).toBe(it2.taxAmount)
    expect(it2.taxRate / 2).toBe(9)
  })

  it("keeps IGST as a single amount (no split)", () => {
    const it2 = calcItem(item({ quantity: 1, rate: 1000, taxType: "igst", taxRate: 18 }))
    expect(it2.taxAmount).toBe(180)
  })
})

describe("invoice totals across items", () => {
  it("sums subtotal, discount, tax and grand total the way the form does", () => {
    const items = [
      calcItem(item({ quantity: 2, rate: 100, discountPercent: 10, taxRate: 18 })), // amt 180, tax 32.4
      calcItem(item({ quantity: 1, rate: 50, taxType: "none", taxRate: 18 })), // amt 50, tax 0
    ]
    const discountTotal = items.reduce((s, it2) => s + (it2.quantity * it2.rate - it2.amount), 0)
    const taxTotal = items.reduce((s, it2) => s + it2.taxAmount, 0)
    const grandTotal = items.reduce((s, it2) => s + it2.lineTotal, 0)
    expect(discountTotal).toBe(20)
    expect(taxTotal).toBe(32.4)
    expect(grandTotal).toBe(262.4)
  })
})
