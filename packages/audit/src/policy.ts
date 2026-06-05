import type { SideEffectPolicy } from "./types.js";

export function isIrreversibleEffect(policy: SideEffectPolicy) {
  if (policy.sideEffect === "external_effect") {
    return {
      irreversible: true,
      reason: "external_effect"
    };
  }
  if (policy.action && /notify|publish|send|external|webhook/iu.test(policy.action)) {
    return {
      irreversible: true,
      reason: "external_action"
    };
  }
  return {
    irreversible: false
  };
}

export function shouldAskGate(policy: SideEffectPolicy) {
  return isIrreversibleEffect(policy).irreversible;
}
