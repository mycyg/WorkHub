import type { BudgetDecision } from "./types.js";

export type ModelRouteCandidate = {
  provider: string;
  model: string;
  inputCost: number;
  outputCost: number;
};

export function chooseModelRoute(
  candidates: readonly ModelRouteCandidate[],
  options: { risk?: "low" | "medium" | "high"; budgetRatio?: number } = {}
): BudgetDecision["modelRoute"] {
  const fallback = candidates[0];
  if (!fallback) {
    throw new Error("At least one model route candidate is required");
  }

  const shouldPreferCheap = options.risk === "low" || (options.budgetRatio ?? 0) >= 0.95;
  if (!shouldPreferCheap) {
    return { provider: fallback.provider, model: fallback.model, reason: "default" };
  }

  const cheapest = [...candidates].sort(
    (left, right) => left.inputCost + left.outputCost - (right.inputCost + right.outputCost)
  )[0] as ModelRouteCandidate;
  return {
    provider: cheapest.provider,
    model: cheapest.model,
    reason: options.budgetRatio && options.budgetRatio >= 0.95 ? "near_budget_downgrade" : "low_risk_cheaper"
  };
}
