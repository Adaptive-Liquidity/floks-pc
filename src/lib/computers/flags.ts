/**
 * Feature flags for flok-node-runtime.
 * Defaults are deliberately safe / disabled.
 * Nexus and Graph memory stay hard-locked until Gate G0.
 */

export const FLAGS = {
  /** Master switch for the computer system */
  FLOK_COMPUTERS_ENABLED: false,

  /** Active provider: "fake" | "docker-dev" | "daytona" | "kata" */
  FLOK_COMPUTER_PROVIDER: "fake" as const,

  /** Whether the MCP computer tools are registered */
  FLOK_MCP_COMPUTERS_ENABLED: false,

  /**
   * HARD LOCK — must remain false until Gate G0 (standalone Flok Computer
   * full acceptance) has been marked PASSED in PHASES.md.
   */
  FLOK_NEXUS_IQ_ENABLED: false,

  /**
   * Graph memory (Graphiti) is only enabled after Nexus core is integrated.
   */
  FLOK_GRAPH_MEMORY_ENABLED: false,
} as const;

export type ComputerProviderName = typeof FLAGS.FLOK_COMPUTER_PROVIDER;

/** Runtime assertion used by Gate C0 and later smoke checks */
export function assertNexusDisabled(): void {
  if (FLAGS.FLOK_NEXUS_IQ_ENABLED) {
    throw new Error(
      "FLOK_NEXUS_IQ_ENABLED must be false until Gate G0 has passed. " +
        "See PHASES.md.",
    );
  }
  if (FLAGS.FLOK_GRAPH_MEMORY_ENABLED) {
    throw new Error(
      "FLOK_GRAPH_MEMORY_ENABLED must be false until after Nexus core integration.",
    );
  }
}
