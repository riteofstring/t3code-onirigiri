export const PANE_TERMINAL_ID_PREFIX = "pane-";

export function isPaneTerminalId(terminalId: string): boolean {
  return terminalId.startsWith(PANE_TERMINAL_ID_PREFIX);
}
