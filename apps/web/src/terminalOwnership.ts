/**
 * Terminals whose id starts with this prefix belong to a host's own pane, such
 * as a spatial workspace's terminal pane. The thread's terminal drawer leaves
 * them alone, so one session is never shown by two viewports.
 */
export const PANE_TERMINAL_ID_PREFIX = "pane-";

export function isPaneTerminalId(terminalId: string): boolean {
  return terminalId.startsWith(PANE_TERMINAL_ID_PREFIX);
}
