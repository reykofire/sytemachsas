import assert from "node:assert/strict";
import test from "node:test";

import { shippingCop, usdFromCop } from "../src/currency.js";

test("converts COP totals to a two-decimal PayPal USD amount", () => {
  assert.equal(usdFromCop(3_879_909, 4_000), "969.98");
  assert.equal(usdFromCop(25_000, 4_000), "6.25");
});

test("waives shipping only when every product is marked for free shipping", () => {
  assert.equal(shippingCop([{ specifications: { shipping: "free" } }]), 0);
  assert.equal(shippingCop([{ specifications: { shipping: "free" } }, { specifications: {} }]), 25_000);
  assert.equal(shippingCop([]), 25_000);
});