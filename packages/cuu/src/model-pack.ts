import {
  allCuuMotionHints,
  createCuuBehaviorManifest,
  cuuDefaultLive2DRendererStateForClip,
  type CuuBehaviorManifest,
  type CuuBehaviorModelPackId,
  type CuuMotionClipState
} from "./motion.js";
import { cuuIdleMicroActionSpecs, type CuuIdleMicroAction } from "./idle-scheduler.js";

export type CuuModelPackRuntimeKind = "live2d_cubism";

export type CuuModelPackDefaultStatus = "approved_default" | "experimental" | "blocked";

export type CuuModelPackAssetKind = "live2d_cubism";

export type CuuModelPackSupportLevel = "supported" | "planned" | "unsupported";

export type CuuModelPackWindowAffordance =
  | "transparent_window"
  | "always_on_top"
  | "draggable"
  | "pass_through"
  | "scale"
  | "opacity"
  | "hide_on_hover"
  | "keep_in_screen";

export type CuuModelPackComponent =
  | "body"
  | "head"
  | "ears"
  | "eyes"
  | "tail"
  | "paws";

export type CuuModelPackVisualGate = {
  low_uncanny: boolean;
  no_experimental_default: boolean;
  full_body_visible: boolean;
  stable_identity: boolean;
  no_ai_artifact: boolean;
  alive_motion: boolean;
};

export type CuuModelPackAsset = {
  kind: CuuModelPackAssetKind;
  path?: string;
  note: string;
  default_candidate: boolean;
};

export type CuuModelPackMotionBinding = {
  state: CuuMotionClipState;
  renderer_state: string;
  loop: boolean;
  min_visible_components: CuuModelPackComponent[];
};

export type CuuModelPackManifest = {
  version: 1;
  character: "Cuu";
  pack_id: string;
  display_name: string;
  runtime_kind: CuuModelPackRuntimeKind;
  default_policy: {
    allow_as_default: boolean;
    status: CuuModelPackDefaultStatus;
    reason: string;
  };
  visual_gate: CuuModelPackVisualGate;
  source: {
    inspiration: string;
    reference_url?: string;
    assets: CuuModelPackAsset[];
  };
  components: CuuModelPackComponent[];
  motions: Partial<Record<CuuMotionClipState, CuuModelPackMotionBinding>>;
  behavior_manifest_version: 1;
  behavior_manifest: CuuBehaviorManifest;
  window_affordances: Partial<Record<CuuModelPackWindowAffordance, CuuModelPackSupportLevel>>;
};

export type CuuModelPackValidationOptions = {
  require_default_ready?: boolean;
  require_full_motion_coverage?: boolean;
  require_idle_micro_action_coverage?: boolean;
};

export type CuuModelPackChoiceStatus = "default_ready" | "experimental_locked" | "blocked";

export type CuuModelPackChoice = {
  pack_id: string;
  display_name: string;
  runtime_kind: CuuModelPackRuntimeKind;
  default_status: CuuModelPackDefaultStatus;
  selected: boolean;
  can_be_default: boolean;
  can_select_in_settings: boolean;
  status: CuuModelPackChoiceStatus;
  reason: string;
  visual_gate: CuuModelPackVisualGate;
  reference_url?: string;
  issues: CuuModelPackIssue[];
};

export type CuuModelPackSelectionReason =
  | "registry_default"
  | "requested_default_ready"
  | "unknown_requested_pack";

export type CuuModelPackSelection = {
  requested_pack_id?: string;
  active_pack: CuuModelPackManifest;
  requested_pack?: CuuModelPackManifest;
  fallback_pack?: CuuModelPackManifest;
  reason: CuuModelPackSelectionReason;
  issues: CuuModelPackIssue[];
};

export type CuuModelPackIssue = {
  code:
    | "invalid_version"
    | "invalid_character"
    | "missing_pack_id"
    | "default_blocked"
    | "default_not_approved"
    | "visual_gate_failed"
    | "missing_component"
    | "missing_motion"
    | "missing_behavior_manifest"
    | "behavior_manifest_mismatch"
    | "missing_behavior_state"
    | "missing_window_affordance";
  path: string;
  message: string;
};

export const requiredCuuDefaultModelComponents: CuuModelPackComponent[] = [
  "body",
  "head",
  "eyes",
  "tail",
  "paws"
];

export const requiredCuuDefaultWindowAffordances: CuuModelPackWindowAffordance[] = [
  "transparent_window",
  "always_on_top",
  "draggable",
  "pass_through",
  "scale",
  "opacity",
  "hide_on_hover",
  "keep_in_screen"
];

export const cuuDefaultModelPackVisualGate: CuuModelPackVisualGate = {
  low_uncanny: true,
  no_experimental_default: true,
  full_body_visible: true,
  stable_identity: true,
  no_ai_artifact: true,
  alive_motion: true
};

export const defaultCuuBlackCatLive2DModelPack = createCuuCatLive2DModelPack({
  pack_id: "cuu-hijiki-live2d-cubism2",
  display_name: "Cuu black cat Live2D",
  inspiration: "Original Hijiki black cat Live2D model, used as the default Cuu desktop-pet identity.",
  reference_url: "https://github.com/imuncle/live2d/tree/master/model/hijiki",
  path: "apps/desktop-webview/public/cuu/live2d/hijiki/cuu-hijiki.model.json",
  reason: "User-approved original black cat Live2D model is the current Cuu default for the desktop pet concept phase."
});

export const defaultCuuWhiteCatLive2DModelPack = createCuuCatLive2DModelPack({
  pack_id: "cuu-tororo-live2d-cubism2",
  display_name: "Cuu white cat Live2D",
  inspiration: "Original Tororo white cat Live2D model, kept as the only alternate Cuu desktop-pet identity.",
  reference_url: "https://github.com/imuncle/live2d/tree/master/model/tororo",
  path: "apps/desktop-webview/public/cuu/live2d/tororo/cuu-tororo.model.json",
  reason: "User-approved white cat Live2D option is selectable in Cuu desktop pet preferences."
});

export const cuuModelPackRegistry = [
  defaultCuuBlackCatLive2DModelPack,
  defaultCuuWhiteCatLive2DModelPack
] as const satisfies readonly CuuModelPackManifest[];

export type CuuApprovedCatModelPackId =
  | "cuu-hijiki-live2d-cubism2"
  | "cuu-tororo-live2d-cubism2";

export type CuuModelPackId = CuuApprovedCatModelPackId;

export type CuuModelPackIdCandidate = CuuApprovedCatModelPackId | (string & {});

export function listCuuModelPacks(): CuuModelPackManifest[] {
  return [...cuuModelPackRegistry];
}

export function getCuuModelPack(packId: string | null | undefined): CuuModelPackManifest | undefined {
  const normalized = String(packId ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  return cuuModelPackRegistry.find((pack) => pack.pack_id === normalized);
}

export function describeCuuModelPackChoices(input: { selected_pack_id?: string | null | undefined } = {}): CuuModelPackChoice[] {
  const selection = input.selected_pack_id === undefined
    ? resolveCuuVisibleModelPack()
    : resolveCuuVisibleModelPack({ requested_pack_id: input.selected_pack_id });
  return cuuModelPackRegistry.map((pack) => {
    const issues = defaultReadinessIssues(pack);
    const canBeDefault = issues.length === 0;
    return {
      pack_id: pack.pack_id,
      display_name: pack.display_name,
      runtime_kind: pack.runtime_kind,
      default_status: pack.default_policy.status,
      selected: pack.pack_id === selection.active_pack.pack_id,
      can_be_default: canBeDefault,
      can_select_in_settings: canBeDefault,
      // L#71：status 从就绪度推导，保持与 can_select_in_settings 一致，而不是恒为 default_ready。
      status: canBeDefault
        ? "default_ready"
        : pack.default_policy.status === "blocked"
          ? "blocked"
          : "experimental_locked",
      reason: pack.default_policy.reason,
      visual_gate: pack.visual_gate,
      ...(pack.source.reference_url ? { reference_url: pack.source.reference_url } : {}),
      issues
    };
  });
}

export function normalizeCuuSelectableModelPackId(packId: unknown): CuuModelPackId | undefined {
  const pack = getCuuModelPack(String(packId ?? ""));
  if (!pack || defaultReadinessIssues(pack).length > 0) {
    return undefined;
  }
  return pack.pack_id as CuuModelPackId;
}

export function resolveCuuVisibleModelPack(input: { requested_pack_id?: string | null | undefined } = {}): CuuModelPackSelection {
  const defaultPack = defaultCuuBlackCatLive2DModelPack;
  const requestedPackId = String(input.requested_pack_id ?? "").trim() || undefined;
  const requestedPack = getCuuModelPack(requestedPackId);

  if (!requestedPackId) {
    return {
      active_pack: defaultPack,
      reason: "registry_default",
      issues: defaultReadinessIssues(defaultPack)
    };
  }

  if (!requestedPack) {
    return {
      requested_pack_id: requestedPackId,
      active_pack: defaultPack,
      fallback_pack: defaultPack,
      reason: "unknown_requested_pack",
      issues: []
    };
  }

  return {
    requested_pack_id: requestedPackId,
    active_pack: requestedPack,
    requested_pack: requestedPack,
    reason: "requested_default_ready",
    issues: defaultReadinessIssues(requestedPack)
  };
}

export function validateCuuModelPackManifest(
  manifest: CuuModelPackManifest,
  options: CuuModelPackValidationOptions = {}
): CuuModelPackIssue[] {
  const issues: CuuModelPackIssue[] = [];
  if (manifest.version !== 1) {
    issues.push({ code: "invalid_version", path: "version", message: "Cuu model pack manifest version must be 1." });
  }
  if (manifest.character !== "Cuu") {
    issues.push({ code: "invalid_character", path: "character", message: "Cuu model pack must describe Cuu." });
  }
  if (!manifest.pack_id.trim()) {
    issues.push({ code: "missing_pack_id", path: "pack_id", message: "Cuu model pack needs a stable pack id." });
  }

  const defaultReady = options.require_default_ready || manifest.default_policy.allow_as_default;
  if (defaultReady) {
    validateDefaultReady(issues, manifest);
  }

  if (options.require_full_motion_coverage || defaultReady) {
    for (const state of requiredBusinessMotionStates()) {
      if (!manifest.motions[state]) {
        issues.push({
          code: "missing_motion",
          path: `motions.${state}`,
          message: `Default Cuu model pack must cover business motion ${state}.`
        });
      }
    }
  }

  if (options.require_idle_micro_action_coverage || defaultReady) {
    for (const state of Object.keys(cuuIdleMicroActionSpecs) as CuuIdleMicroAction[]) {
      if (!manifest.motions[state]) {
        issues.push({
          code: "missing_motion",
          path: `motions.${state}`,
          message: `Default Cuu model pack must cover idle micro action ${state}.`
        });
      }
    }
  }

  return issues;
}

export function assertCuuModelPackCanBeDefault(manifest: CuuModelPackManifest): void {
  const issues = validateCuuModelPackManifest(manifest, {
    require_default_ready: true,
    require_full_motion_coverage: true,
    require_idle_micro_action_coverage: true
  });
  if (issues.length) {
    throw new Error(`Cuu model pack cannot be default: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
}

export function requiredCuuModelPackMotionStates(): CuuMotionClipState[] {
  return [...new Set([...requiredBusinessMotionStates(), ...(Object.keys(cuuIdleMicroActionSpecs) as CuuIdleMicroAction[])])];
}

function createCuuCatLive2DModelPack(input: {
  pack_id: CuuModelPackIdCandidate;
  display_name: string;
  inspiration: string;
  reference_url: string;
  path: string;
  reason: string;
}): CuuModelPackManifest {
  return {
    version: 1,
    character: "Cuu",
    pack_id: input.pack_id,
    display_name: input.display_name,
    runtime_kind: "live2d_cubism",
    default_policy: {
      allow_as_default: true,
      status: "approved_default",
      reason: input.reason
    },
    visual_gate: cuuDefaultModelPackVisualGate,
    source: {
      inspiration: input.inspiration,
      reference_url: input.reference_url,
      assets: [
        {
          kind: "live2d_cubism",
          path: input.path,
          note: "Cubism 2 .moc/.mtn cat model. Commercial release needs rights clearance or an original replacement model.",
          default_candidate: true
        }
      ]
    },
    components: ["body", "head", "ears", "eyes", "tail", "paws"],
    motions: createCatLive2DMotionBindings(),
    behavior_manifest_version: 1,
    behavior_manifest: createCuuBehaviorManifest({
      model_pack_id: input.pack_id as CuuBehaviorModelPackId,
      coverage: "partial"
    }),
    window_affordances: {
      transparent_window: "supported",
      always_on_top: "supported",
      draggable: "supported",
      pass_through: "supported",
      scale: "supported",
      opacity: "supported",
      hide_on_hover: "supported",
      keep_in_screen: "supported"
    }
  };
}

function validateDefaultReady(issues: CuuModelPackIssue[], manifest: CuuModelPackManifest) {
  if (!manifest.default_policy.allow_as_default) {
    issues.push({
      code: "default_blocked",
      path: "default_policy",
      message: "Blocked or non-default Cuu model packs cannot be used as the visible default."
    });
  }
  if (manifest.default_policy.status !== "approved_default") {
    issues.push({
      code: "default_not_approved",
      path: "default_policy.status",
      message: "Default Cuu model packs must be explicitly approved."
    });
  }
  for (const [key, passed] of Object.entries(manifest.visual_gate) as [keyof CuuModelPackVisualGate, boolean][]) {
    if (!passed) {
      issues.push({
        code: "visual_gate_failed",
        path: `visual_gate.${key}`,
        message: `Cuu default visual gate ${key} did not pass.`
      });
    }
  }
  for (const component of requiredCuuDefaultModelComponents) {
    if (!manifest.components.includes(component)) {
      issues.push({
        code: "missing_component",
        path: `components.${component}`,
        message: `Default Cuu model pack must include ${component}.`
      });
    }
  }
  for (const affordance of requiredCuuDefaultWindowAffordances) {
    if (manifest.window_affordances[affordance] !== "supported") {
      issues.push({
        code: "missing_window_affordance",
        path: `window_affordances.${affordance}`,
        message: `Default Cuu model pack requires supported window affordance ${affordance}.`
      });
    }
  }
  validateBehaviorManifest(issues, manifest);
}

function requiredBusinessMotionStates(): CuuMotionClipState[] {
  return [...new Set(allCuuMotionHints().map((hint) => hint.sprite_state))];
}

function defaultReadinessIssues(manifest: CuuModelPackManifest): CuuModelPackIssue[] {
  return validateCuuModelPackManifest(manifest, {
    require_default_ready: true,
    require_full_motion_coverage: true,
    require_idle_micro_action_coverage: true
  });
}

function createCatLive2DMotionBindings(): Partial<Record<CuuMotionClipState, CuuModelPackMotionBinding>> {
  const motions: Partial<Record<CuuMotionClipState, CuuModelPackMotionBinding>> = {};
  for (const state of requiredCuuModelPackMotionStates()) {
    motions[state] = {
      state,
      renderer_state: catLive2DRendererStateForCuuState(state),
      loop: state !== "idle_blink" && state !== "tap_bubble" && state !== "wave_hello" && state !== "celebrating_jump",
      min_visible_components: ["body", "head", "eyes", "tail", "paws"]
    };
  }
  return motions;
}

function catLive2DRendererStateForCuuState(state: CuuMotionClipState): string {
  return cuuDefaultLive2DRendererStateForClip(state);
}

function validateBehaviorManifest(issues: CuuModelPackIssue[], manifest: CuuModelPackManifest) {
  if (manifest.behavior_manifest_version !== 1 || manifest.behavior_manifest.version !== 1) {
    issues.push({
      code: "missing_behavior_manifest",
      path: "behavior_manifest",
      message: "Default Cuu model pack must expose behavior manifest version 1."
    });
    return;
  }
  if (manifest.behavior_manifest.model_pack_id !== manifest.pack_id) {
    issues.push({
      code: "behavior_manifest_mismatch",
      path: "behavior_manifest.model_pack_id",
      message: "Cuu behavior manifest must belong to the same model pack."
    });
  }
  for (const hint of allCuuMotionHints()) {
    const behavior = manifest.behavior_manifest.states[hint.state];
    if (!behavior?.loop.length) {
      issues.push({
        code: "missing_behavior_state",
        path: `behavior_manifest.states.${hint.state}`,
        message: `Cuu behavior manifest must cover state ${hint.state}.`
      });
      continue;
    }
    const loopMotion = behavior.loop[0]?.motion;
    if (loopMotion && !manifest.motions[loopMotion]) {
      issues.push({
        code: "missing_behavior_state",
        path: `behavior_manifest.states.${hint.state}.loop`,
        message: `Cuu behavior state ${hint.state} points at missing motion ${loopMotion}.`
      });
    }
    // L#72：enter/exit 过场动作也必须绑定到 manifest.motions，否则进入/离开该状态时会请求一个不存在的动作。
    for (const slot of ["enter", "exit"] as const) {
      const slotMotion = behavior[slot]?.motion;
      if (slotMotion && !manifest.motions[slotMotion]) {
        issues.push({
          code: "missing_behavior_state",
          path: `behavior_manifest.states.${hint.state}.${slot}`,
          message: `Cuu behavior state ${hint.state} ${slot} points at missing motion ${slotMotion}.`
        });
      }
    }
  }
  if (!manifest.behavior_manifest.idle_random.length) {
    issues.push({
      code: "missing_behavior_state",
      path: "behavior_manifest.idle_random",
      message: "Cuu behavior manifest must define idle random micro actions."
    });
  }
}
