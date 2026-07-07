// Central finance thresholds for TAPBOSS.
//
// Fund allocations (parent → subsidiary) and equity changes at or above this
// amount require director approval before they execute. Below it, an allocation
// without an equity change executes immediately. Any equity change always
// requires approval regardless of amount. Adjust to your governance policy.
export const FUND_APPROVAL_THRESHOLD = 100000; // ₹1,00,000
