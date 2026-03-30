/**
 * MultimodalInput Component Unit Tests
 * Focused on the empty-input submit guard fix (bad_request:api prevention)
 */

import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStatus } from "ai";
import { render, screen, fireEvent } from "@/tests/helpers/test-utils";
import { MultimodalInput } from "@/components/multimodal-input";
import type { Attachment } from "@/lib/types";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

vi.mock("usehooks-ts", () => ({
  useLocalStorage: vi.fn((_, defaultValue) => [defaultValue, vi.fn()]),
  useWindowSize: vi.fn(() => ({ width: 1024, height: 768 })),
}));

vi.mock("@/hooks/use-model-capabilities", () => ({
  useModelCapabilities: vi.fn(() => ({
    modelCapabilities: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("@/hooks/use-repos", () => ({
  useRepos: vi.fn(() => ({ repos: [], isLoading: false })),
}));

vi.mock("@/lib/github-components", () => ({
  GitHubRepoModal: () => null,
  ResourceAreaSelector: () => null,
}));

vi.mock("@/components/conditional-file-input", () => ({
  ConditionalFileInput: () => null,
  createValidatedFileChangeHandler: vi.fn((_p, _m, _a, handler) => handler),
}));

vi.mock("@/components/elements/context", () => ({
  Context: () => null,
}));

vi.mock("@/components/model-selector", () => ({
  ModelSelector: () => null,
}));

vi.mock("@/components/preview-attachment", () => ({
  PreviewAttachment: ({ attachment }: { attachment: Attachment }) => (
    <div data-testid={`attachment-${attachment.name}`}>{attachment.name}</div>
  ),
}));

vi.mock("@/components/suggested-actions", () => ({
  SuggestedActions: () => null,
}));

vi.mock("@/components/thinking-mode-toggle", () => ({
  ThinkingModeToggle: () => null,
}));

vi.mock("@/components/icons", () => ({
  ArrowUpIcon: () => <span>↑</span>,
  StopIcon: () => <span>■</span>,
}));

// Render PromptInput as a plain <form> so onSubmit fires via both button click
// and fireEvent.submit (simulating Enter key)
vi.mock("@/components/elements/prompt-input", () => ({
  PromptInput: ({
    children,
    onSubmit,
    className,
  }: {
    children: React.ReactNode;
    onSubmit?: React.FormEventHandler;
    className?: string;
  }) => (
    <form className={className} data-testid="prompt-input" onSubmit={onSubmit}>
      {children}
    </form>
  ),
  PromptInputTextarea: ({
    value,
    onChange,
    placeholder,
    className,
  }: {
    value: string;
    onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
    placeholder?: string;
    className?: string;
  }) => (
    <textarea
      className={className}
      data-testid="prompt-textarea"
      onChange={onChange}
      placeholder={placeholder}
      value={value}
    />
  ),
  PromptInputSubmit: ({
    children,
    disabled,
    className,
    status,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    className?: string;
    status?: string;
  }) => (
    <button
      className={className}
      data-status={status}
      data-testid="submit-button"
      disabled={disabled}
      type="submit"
    >
      {children}
    </button>
  ),
  PromptInputToolbar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="prompt-toolbar">{children}</div>
  ),
  PromptInputTools: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="prompt-tools">{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    className,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    className?: string;
  }) => (
    <button
      className={className}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const READY: ChatStatus = "ready";
const STREAMING: ChatStatus = "streaming";
const SUBMITTED: ChatStatus = "submitted";

// Cast to any so vi.fn() satisfies the strict UseChatHelpers sendMessage signature
const baseProps: any = {
  chatId: "test-chat-id",
  input: "",
  setInput: vi.fn(),
  status: READY,
  stop: vi.fn(),
  attachments: [] as Attachment[],
  setAttachments: vi.fn(),
  messages: [],
  setMessages: vi.fn(),
  sendMessage: vi.fn(),
  selectedVisibilityType: "private",
  selectedModelId: "gemini-2.5-flash",
  onModelChange: vi.fn(),
  ragSelectedRepos: [],
  onRagSelectedReposChange: vi.fn(),
  availableRepos: [],
  availableReposLoading: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MultimodalInput — empty-input submit guard", () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Submit button disabled state ────────────────────────────────────────────

  describe("Submit button disabled state", () => {
    it("is disabled when input is empty and there are no attachments", () => {
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input=""
          sendMessage={sendMessage}
        />
      );
      expect(screen.getByTestId("submit-button")).toBeDisabled();
    });

    it("is enabled when input has text", () => {
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input="Hello"
          sendMessage={sendMessage}
        />
      );
      expect(screen.getByTestId("submit-button")).not.toBeDisabled();
    });

    it("is enabled when there are attachments even if input is empty", () => {
      const attachments: Attachment[] = [
        { url: "https://example.com/file.pdf", name: "file.pdf", contentType: "application/pdf" },
      ];
      render(
        <MultimodalInput
          {...baseProps}
          attachments={attachments}
          input=""
          sendMessage={sendMessage}
        />
      );
      expect(screen.getByTestId("submit-button")).not.toBeDisabled();
    });

    it("is disabled when input is only whitespace and no attachments", () => {
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input="   "
          sendMessage={sendMessage}
        />
      );
      expect(screen.getByTestId("submit-button")).toBeDisabled();
    });
  });

  // ── submitForm guard (button click) ────────────────────────────────────────

  describe("submitForm via button click", () => {
    it("does NOT call sendMessage when input is empty and no attachments", async () => {
      const user = userEvent.setup();
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input=""
          sendMessage={sendMessage}
        />
      );
      await user.click(screen.getByTestId("submit-button"));
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("calls sendMessage with correct payload when input has text", async () => {
      const user = userEvent.setup();
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input="Hello world"
          sendMessage={sendMessage}
        />
      );
      await user.click(screen.getByTestId("submit-button"));
      expect(sendMessage).toHaveBeenCalledOnce();
      const call = sendMessage.mock.calls[0][0];
      expect(call.role).toBe("user");
      expect(call.parts).toContainEqual(
        expect.objectContaining({ type: "text", text: "Hello world" })
      );
    });

    it("calls sendMessage when there are attachments and input is empty", async () => {
      const user = userEvent.setup();
      const attachments: Attachment[] = [
        { url: "https://example.com/img.png", name: "img.png", contentType: "image/png" },
      ];
      render(
        <MultimodalInput
          {...baseProps}
          attachments={attachments}
          input=""
          sendMessage={sendMessage}
        />
      );
      await user.click(screen.getByTestId("submit-button"));
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    it("calls sendMessage when there are attachments AND input has text", async () => {
      const user = userEvent.setup();
      const attachments: Attachment[] = [
        { url: "https://example.com/doc.pdf", name: "doc.pdf", contentType: "application/pdf" },
      ];
      render(
        <MultimodalInput
          {...baseProps}
          attachments={attachments}
          input="Summarise this"
          sendMessage={sendMessage}
        />
      );
      await user.click(screen.getByTestId("submit-button"));
      expect(sendMessage).toHaveBeenCalledOnce();
      const call = sendMessage.mock.calls[0][0];
      expect(call.parts).toContainEqual(
        expect.objectContaining({ type: "text", text: "Summarise this" })
      );
    });
  });

  // ── submitForm guard (Enter key / form onSubmit) ────────────────────────────

  describe("submitForm via Enter key (form onSubmit)", () => {
    it("does NOT call sendMessage when Enter is pressed with empty input", () => {
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input=""
          sendMessage={sendMessage}
        />
      );
      fireEvent.submit(screen.getByTestId("prompt-input"));
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("does NOT call sendMessage when Enter is pressed with whitespace-only input", () => {
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input="   "
          sendMessage={sendMessage}
        />
      );
      fireEvent.submit(screen.getByTestId("prompt-input"));
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("calls sendMessage when Enter is pressed with valid input", () => {
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input="Tell me a joke"
          sendMessage={sendMessage}
        />
      );
      fireEvent.submit(screen.getByTestId("prompt-input"));
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    it("calls sendMessage when Enter is pressed with attachments and empty input", () => {
      const attachments: Attachment[] = [
        { url: "https://example.com/img.png", name: "img.png", contentType: "image/png" },
      ];
      render(
        <MultimodalInput
          {...baseProps}
          attachments={attachments}
          input=""
          sendMessage={sendMessage}
        />
      );
      fireEvent.submit(screen.getByTestId("prompt-input"));
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    it("shows a toast and does NOT call sendMessage when pressing Enter while streaming", () => {
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input="Hello"
          sendMessage={sendMessage}
          status={STREAMING}
        />
      );
      fireEvent.submit(screen.getByTestId("prompt-input"));
      expect(sendMessage).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith(
        "Please wait for the model to finish its response!"
      );
    });

    it("shows a toast and does NOT call sendMessage when pressing Enter while submitted", () => {
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input="Hello"
          sendMessage={sendMessage}
          status={SUBMITTED}
        />
      );
      fireEvent.submit(screen.getByTestId("prompt-input"));
      expect(sendMessage).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith(
        "Please wait for the model to finish its response!"
      );
    });
  });

  // ── Message payload shape ───────────────────────────────────────────────────

  describe("Message payload", () => {
    it("sends a text part with the raw input value", async () => {
      const user = userEvent.setup();
      render(
        <MultimodalInput
          {...baseProps}
          attachments={[]}
          input="  spaces around  "
          sendMessage={sendMessage}
        />
      );
      await user.click(screen.getByTestId("submit-button"));
      const call = sendMessage.mock.calls[0][0];
      expect(call.parts[0].type).toBe("text");
      expect(call.role).toBe("user");
    });

    it("file parts appear before the text part in the payload", async () => {
      const user = userEvent.setup();
      const attachments: Attachment[] = [
        { url: "https://example.com/img.png", name: "img.png", contentType: "image/png" },
      ];
      render(
        <MultimodalInput
          {...baseProps}
          attachments={attachments}
          input="Describe this"
          sendMessage={sendMessage}
        />
      );
      await user.click(screen.getByTestId("submit-button"));
      const { parts } = sendMessage.mock.calls[0][0];
      expect(parts[0].type).toBe("file");
      expect(parts[1].type).toBe("text");
    });
  });
});
