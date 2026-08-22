/**
 * Public barrel for the computer domain.
 * After Gate G0 this becomes the surface Flok will import.
 */

export type {
  Action,
  ActionBatch,
  ActionResult,
  ActionType,
  Computer,
  ComputerAuditEvent,
  ComputerCapability,
  ComputerCheckpoint,
  ComputerHandoff,
  ComputerJob,
  ComputerJobStatus,
  ComputerJobType,
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
  Observation,
  ObserveRequest,
  OsType,
  ProviderCapabilities,
  ProviderCheckpoint,
  ProviderComputer,
  RestoreRequest,
  TakeoverGrant,
} from "./types.js";

export { LEGAL_TRANSITIONS } from "./types.js";

export {
  ActionBatchSchema,
  ActionSchema,
  ActionTypeSchema,
  ComputerJobStatusSchema,
  ComputerJobTypeSchema,
  ComputerSchema,
  ComputerSpecSchema,
  ComputerStateSchema,
  ExecRequestSchema,
  FsOperationSchema,
  FsRequestSchema,
  OsTypeSchema,
  ProviderCapabilitiesSchema,
} from "./schemas.js";

export {
  CapabilityRevoked,
  ComputerError,
  ComputerNotFound,
  DuplicateComputer,
  IdempotencyConflict,
  IllegalStateTransition,
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
export { FLAGS, assertNexusDisabled } from "./flags.js";

export {
  canTransition,
  assertTransition,
  nextStates,
  isTerminal,
} from "./state.js";

export { assertInsideRoot, getDefaultWorkspaceRoot } from "./path.js";

export {
  generatePairCode,
  hashPairCode,
  validatePairCode,
} from "./pairing.js";
export type { PairCodeMaterial, PairCodeRecord } from "./pairing.js";

export {
  issueCapability,
  hashToken,
  isCapabilityValid,
} from "./capabilities.js";
export type { CapabilityMaterial, CapabilityRecord } from "./capabilities.js";

export { ComputerService } from "./service.js";
