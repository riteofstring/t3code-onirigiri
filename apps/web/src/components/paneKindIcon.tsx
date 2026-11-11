import {
  FileDiff,
  Files,
  GitFork,
  Globe2,
  MessagesSquare,
  Smartphone,
  SquareDashed,
  SquarePen,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";

const PANE_KIND_ICONS: Readonly<Record<string, LucideIcon>> = {
  chat: SquarePen,
  preview: Globe2,
  terminal: TerminalSquare,
  files: Files,
  file: Files,
  diff: FileDiff,
  "pull-request": PullRequestGlyph.pullRequest,
  "pull-requests": PullRequestGlyph.link,
  lineage: GitFork,
  device: Smartphone,
  "side-chat": MessagesSquare,
};

/** The icon the "Open a surface" list gives a pane kind; an unknown kind gets the empty-pane icon. */
export function PaneKindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = PANE_KIND_ICONS[kind] ?? SquareDashed;
  return <Icon aria-hidden className={className} />;
}
