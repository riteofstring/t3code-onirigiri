import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { useComposerMultilinePrompt } from "./useComposerMultilinePrompt";

function Composer({
  text,
  editorKey = "editor",
  scale = 1,
}: {
  readonly text: string;
  readonly editorKey?: string;
  readonly scale?: number;
}) {
  const [multiline, observeBody] = useComposerMultilinePrompt();
  return (
    <div style={{ transform: `scale(${String(scale)})`, transformOrigin: "0 0" }}>
      <div ref={observeBody} style={{ width: 200, height: 100, lineHeight: "20px" }}>
        <div
          key={editorKey}
          data-testid="composer-editor"
          contentEditable
          suppressContentEditableWarning
        >
          {text}
        </div>
        <output>{multiline ? "multiline" : "single line"}</output>
      </div>
    </div>
  );
}

it("notices when typing makes the prompt wrap", async () => {
  await using screen = await render(<Composer text="short" />, { router: false });
  await expect.element(screen.getByText("single line")).toBeVisible();
  await screen.rerender(<Composer text={"a long prompt that wraps ".repeat(6)} />);
  await expect.element(screen.getByText("multiline")).toBeVisible();
});

it("measures the same inside a scaled ancestor", async () => {
  await using screen = await render(<Composer text="short" scale={0.4} />, { router: false });
  await expect.element(screen.getByText("single line")).toBeInTheDocument();
  await screen.rerender(<Composer text={"a long prompt that wraps ".repeat(6)} scale={0.4} />);
  await expect.element(screen.getByText("multiline")).toBeInTheDocument();
  await screen.rerender(<Composer text="short" scale={0.4} />);
  await expect.element(screen.getByText("single line")).toBeInTheDocument();
});

it("follows a replaced editor that later wraps without a content change", async () => {
  const text = "a prompt that fits";
  await using screen = await render(<Composer text={text} />, { router: false });
  await expect.element(screen.getByText("single line")).toBeVisible();
  await screen.rerender(<Composer text={text} editorKey="replacement" />);
  await expect.element(screen.getByText("single line")).toBeVisible();
  const editor = screen.getByTestId("composer-editor").element() as HTMLElement;
  editor.style.width = "60px";
  await expect.element(screen.getByText("multiline")).toBeVisible();
});
