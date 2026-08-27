/**
 * Public barrel for the computer domain.
 * After Gate G0 this becomes the surface Flok will import.
 */

export type {
  Action,
  ActionBatch,
  ActionResult,
  ActionType,
  CapabilityScope,
  Computer,
  ComputerAuditEvent,
  ComputerCapability,
  ComputerCheckpoint,
  ComputerHandoff,
  ComputerJob,
  ComputerJobStatus,
  ComputerJobType,
  ComputerOperationAuth,
  ComputerPairCode,
  ComputerSpec,
  ComputerState,
  ComputerStatus,
  ComputerProviderName,
  ExecRequest,
  ExecResult,
  FsOperation,
  FsRequest,
  FsResult,
  HandoffStatus,
  IssuedPairCode,
  IssuePairCodeOptions,
  NodeIdentity,
  Observation,
  ObserveRequest,
  OsType,
  PairResult,
  ProviderCapabilities,
  ProviderCheckpoint,
  ProviderComputer,
  RestoreRequest,
  SharedAccountAuth,
  TakeoverGrant,
} from "./types.js";

export { LEGAL_TRANSITIONS, CAPABILITY_SCOPES } from "./types.js";

export {
  ActionBatchSchema,
  ActionSchema,
  ActionTypeSchema,
  CapabilityScopeSchema,
  ComputerCapabilitySchema,
  ComputerJobStatusSchema,
  ComputerJobTypeSchema,
  ComputerOperationAuthSchema,
  ComputerPairCodeSchema,
  ComputerSchema,
  ComputerSpecSchema,
  ComputerStateSchema,
  ExecRequestSchema,
  FsOperationSchema,
  FsRequestSchema,
  NodeIdentitySchema,
  OsTypeSchema,
  ProviderCapabilitiesSchema,
  SharedAccountAuthSchema,
} from "./schemas.js";

export {
  CapabilityExpired,
  CapabilityInvalid,
  CapabilityMissing,
  CapabilityRevoked,
  ComputerError,
  ComputerNotFound,
  CrossNodeDenied,
  DestroyConfirmRequired,
  DestroyProviderRefMismatch,
  BetaInviteRequired,
  BetaStoreRequired,
  DuplicateComputer,
  IdempotencyConflict,
  IllegalStateTransition,
  InsufficientScope,
  InvalidScope,
  PairCodeInvalid,
  PathEscape,
  ProviderUnavailable,
  QuotaExceeded,
} from "./errors.js";

export type { ComputerProvider } from "./providers/provider.js";
export { FakeProvider } from "./providers/fake.js";
export {
  DockerDevProvider,
  DockerDevForbiddenInProduction,
  DOCKER_DEV_IMAGE,
  DOCKER_DEV_WORKSPACE_ROOT,
} from "./providers/docker-dev.js";
export {
  RunloopProvider,
  RunloopBlueprintRequired,
  ComputerUseNotAvailable,
  RUNLOOP_PROVIDER_NAME,
  RUNLOOP_WORKSPACE_ROOT,
  MemoryRunloopControlPlane,
} from "./providers/runloop.js";
export { FLAGS, assertNexusDisabled } from "./flags.js";

export {
  canTransition,
  assertTransition,
  nextStates,
  isTerminal,
} from "./state.js";

export {
  assertInsideRoot,
  canonicalizeWorkspacePath,
  getDefaultWorkspaceRoot,
  workspaceRootForProvider,
  WORKSPACE_ALIAS_PREFIXES,
} from "./path.js";

export {
  generatePairCode,
  hashPairCode,
  validatePairCode,
  PAIR_CODE_TTL_MS,
  PAIR_CODE_MAX_ATTEMPTS,
  PAIR_CODE_CHAR_COUNT,
} from "./pairing.js";
export type { PairCodeMaterial, PairCodeRecord } from "./pairing.js";

export {
  issueCapability,
  hashToken,
  isCapabilityValid,
  parseScopes,
  copyScopes,
  hasScope,
  toCapabilityRecord,
  capabilityAuth,
  sharedAccountAuth,
  sharedOperationAuth,
  extractCapabilityToken,
  NO_OPERATION_AUTH,
  DEFAULT_PAIR_SCOPES,
  DEFAULT_CAPABILITY_TTL_MS,
  CAPABILITY_SECRET_BYTES,
} from "./capabilities.js";
export type {
  CapabilityMaterial,
  CapabilityRecord,
  CapabilityExpectation,
} from "./capabilities.js";

export { digestEquals, sha256Hex } from "./digest.js";

export { ComputerService, PAIR_IDENTITY_FAILURE_LIMIT } from "./service.js";
export {
  BETA_COST_WARNING,
  BETA_LIMITATIONS,
  BetaRegistry,
  DEFAULT_BETA_IDLE_TTL_MS,
  DEFAULT_BETA_MAX_ACTIVE,
  DISABLED_BETA_POLICY,
  MemoryBetaStore,
  betaPolicyFromEnv,
  isActiveBetaComputer,
  knownLimitationsMarkdown,
} from "./beta.js";
export type { BetaPolicy, BetaRoster, BetaStore } from "./beta.js";
export {
  DEFAULT_BETA_STORE_RELATIVE,
  JsonFileBetaStore,
  betaStoreFromEnv,
} from "./beta-store.js";
export {
  JsonFileControlPlaneStore,
  MemoryControlPlaneStore,
  controlPlaneStoreFromEnv,
} from "./control-plane-store.js";
export type { ControlPlaneStore, ControlPlaneSnapshot } from "./control-plane-store.js";
export {
  InteractiveBlueprintRequired,
  resolveAgentComputerBlueprint,
  buildAgentComputerLabels,
} from "./providers/interactive-blueprint.js";
