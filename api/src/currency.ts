export function usdFromCop(totalCop: number, copPerUsd: number) {
  return (Math.round((totalCop / copPerUsd) * 100) / 100).toFixed(2);
}

export function shippingCop(items: Array<{ specifications: unknown }>, standardShippingCop = 25_000) {
  return items.length > 0 && items.every(item => {
    const specifications = item.specifications;
    return typeof specifications === "object" && specifications !== null && "shipping" in specifications && specifications.shipping === "free";
  }) ? 0 : standardShippingCop;
}