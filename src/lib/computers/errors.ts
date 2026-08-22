/**
 * Typed domain errors. Fail closed.
 */

export class ComputerError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ComputerError";
    this.code = code;
    this.details = details;
  }
}

export class IllegalStateTransition extends ComputerError {
  constructor(from: string, to: string) {
    super(
      "ILLEGAL_STATE_TRANSITION",
      `Cannot transition computer from "${from}" to "${to}"`,
      { from, to },
    );
    this.name = "IllegalStateTransition";
  }
}

export class ComputerNotFound extends ComputerError {
  constructor(id: string) {
    super("COMPUTER_NOT_FOUND", `Computer not found: ${id}`, { id });
    this.name = "ComputerNotFound";
  }
}

export class CapabilityRevoked extends ComputerError {
  constructor(capabilityId?: string) {
    super("CAPABILITY_REVOKED", "Capability has been revoked or is invalid", {
      capabilityId,
    });
    this.name = "CapabilityRevoked";
  }
}

export class PairCodeInvalid extends ComputerError {
  constructor(reason: string) {
    super("PAIR_CODE_INVALID", `Pair code invalid: ${reason}`, { reason });
    this.name = "PairCodeInvalid";
  }
}

export class ProviderUnavailable extends ComputerError {
  constructor(provider: string, cause?: string) {
    super(
      "PROVIDER_UNAVAILABLE",
      `Provider "${provider}" unavailable${cause ? `: ${cause}` : ""}`,
      { provider, cause },
    );
    this.name = "ProviderUnavailable";
  }
}

export class PathEscape extends ComputerError {
  constructor(path: string) {
    super(
      "PATH_ESCAPE",
      `Path escapes allowed workspace root: ${path}`,
      { path },
    );
    this.name = "PathEscape";
  }
}

export class DuplicateComputer extends ComputerError {
  constructor(birdId: string) {
    super(
      "DUPLICATE_COMPUTER",
      `A computer already exists for bird_id ${birdId}`,
      { birdId },
    );
    this.name = "DuplicateComputer";
  }
}

export class QuotaExceeded extends ComputerError {
  constructor(resource: string) {
    super("QUOTA_EXCEEDED", `Quota exceeded for ${resource}`, { resource });
    this.name = "QuotaExceeded";
  }
}

export class IdempotencyConflict extends ComputerError {
  constructor(key: string) {
    super(
      "IDEMPOTENCY_CONFLICT",
      `Idempotency key already used with different payload: ${key}`,
      { key },
    );
    this.name = "IdempotencyConflict";
  }
}
