import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";

import { ThreadCard } from "./ThreadCard";

vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShell: () => ({
    projectId: "p1",
    title: "Fix the release",
    branch: "release/cleanup",
    updatedAt: "2026-11-09T00:00:00.000Z",
    runtime: { status: "running" },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
  }),
  useProject: () => ({ title: "Onirigiri" }),
}));
vi.mock("@t3tools/web/src/components/ProjectFavicon", () => ({
  ProjectFavicon: () => <img alt="Project icon" />,
}));
vi.mock("@t3tools/web/src/components/ui/spinner", () => ({
  Spinner: () => <i data-spinner="" />,
}));

const render = (variant: "title" | "summary" | "loading") =>
  renderToStaticMarkup(
    <ThreadCard environmentId={"e" as never} threadId={"t" as never} variant={variant} />,
  );
const text = (markup: string) => markup.replace(/<[^>]*>/g, "");

it("shows only the icon, project and thread title in the title variant", () => {
  const markup = render("title");
  expect(markup).toContain('alt="Project icon"');
  expect(text(markup)).toBe("OnirigiriFix the release");
  expect(markup).not.toContain("data-spinner");
});

it.each([
  ["summary", false],
  ["loading", true],
] as const)(
  "adds status details in the %s variant, with a spinner only while loading",
  (variant, spinner) => {
    const markup = render(variant);
    expect(text(markup)).toContain("Working");
    expect(text(markup)).toContain("release/cleanup");
    expect(text(markup)).toContain("Updated");
    expect(markup.includes("data-spinner")).toBe(spinner);
  },
);
