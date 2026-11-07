import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@t3tools/web/src/components/ui/dialog";
import { Kbd, KbdGroup } from "@t3tools/web/src/components/ui/kbd";

export interface WorkspaceShortcut {
  readonly label: string;
  readonly detail?: string;
  readonly keys: readonly string[];
}

export function WorkspaceShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: readonly WorkspaceShortcut[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Moving around the Onirigiri workspace.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <dl className="grid gap-3 text-sm">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.label} className="flex items-start justify-between gap-4">
                <dt>
                  {shortcut.label}
                  {shortcut.detail ? (
                    <span className="block text-muted-foreground text-xs">{shortcut.detail}</span>
                  ) : null}
                </dt>
                <dd className="shrink-0">
                  <KbdGroup>
                    {shortcut.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </KbdGroup>
                </dd>
              </div>
            ))}
          </dl>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
