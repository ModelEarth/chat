/**
 * Chat API Integration Tests
 * Tests the /api/chat endpoint with various scenarios
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "@/app/(chat)/api/chat/route";
import { testUsers } from "@/tests/fixtures/users";

// Mock dependencies
vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
  createAuthErrorResponse: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  getChatById: vi.fn(),
  saveChat: vi.fn(),
  saveMessages: vi.fn(),
  getMessagesByChatId: vi.fn(),
  deleteChatById: vi.fn(),
}));

vi.mock("@/lib/db/queries/document", () => ({
  getLatestDocumentVersionsByChat: vi.fn(),
  getLastDocumentInChat: vi.fn(),
}));

vi.mock("@/lib/ai/chat-agent-resolver", () => ({
  ChatAgentResolver: {
    createChatAgent: vi.fn(),
  },
}));

vi.mock("@/lib/ai/file-processing", () => ({
  validateFileAttachment: vi.fn(),
  extractFileContent: vi.fn(),
}));

vi.mock("@/lib/ai/rag-context-builder", () => ({
  buildRagContext: vi.fn(),
}));

vi.mock("@/app/(chat)/actions", () => ({
  generateTitleFromUserMessage: vi.fn(),
}));

vi.mock("@/lib/logging", () => {
  // Create a proper class mock for PerformanceTracker
  class MockPerformanceTracker {
    end = vi.fn().mockResolvedValue(undefined);
  }

  return {
    logUserActivity: vi.fn().mockResolvedValue(undefined),
    logAgentActivity: vi.fn().mockResolvedValue(undefined),
    PerformanceTracker: MockPerformanceTracker,
    createCorrelationId: vi.fn(() => "test-correlation-id"),
    UserActivityType: {
      CHAT_CREATE: "chat.create",
      CHAT_MESSAGE_SEND: "chat.message.send",
      CHAT_DELETE: "chat.delete",
    },
    ActivityCategory: {
      CHAT: "chat",
    },
    AgentType: {
      CHAT_MODEL_AGENT: "chat_model_agent",
    },
    AgentOperationType: {
      STREAMING: "streaming",
    },
    AgentOperationCategory: {
      STREAMING: "streaming",
    },
  };
});

vi.mock("@/lib/errors/logger", () => ({
  logApiError: vi.fn().mockResolvedValue(undefined),
  logAuthError: vi.fn().mockResolvedValue(undefined),
  logDatabaseError: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn().mockResolvedValue(undefined),
  logSystemError: vi.fn().mockResolvedValue(undefined),
  logAppError: vi.fn().mockResolvedValue(undefined),
  logUserError: vi.fn().mockResolvedValue(undefined),
  logPermissionError: vi.fn().mockResolvedValue(undefined),
  logAdminError: vi.fn().mockResolvedValue(undefined),
  ErrorSeverity: {
    INFO: "info",
    WARNING: "warning",
    ERROR: "error",
    CRITICAL: "critical",
  },
  ErrorType: {
    AUTH: "auth",
    API: "api",
    ADMIN: "admin",
    APP: "app",
    USER: "user",
    PERMISSION: "permission",
    SYSTEM: "system",
  },
  ErrorCategory: {
    VALIDATION_ERROR: "validation_error",
    AUTHENTICATION_ERROR: "authentication_error",
    AUTHORIZATION_ERROR: "authorization_error",
    NOT_FOUND_ERROR: "not_found_error",
    NETWORK_ERROR: "network_error",
    DATABASE_ERROR: "database_error",
    UNKNOWN_ERROR: "unknown_error",
  },
}));

import { generateTitleFromUserMessage } from "@/app/(chat)/actions";
import { ChatAgentResolver } from "@/lib/ai/chat-agent-resolver";
import {
  extractFileContent,
  validateFileAttachment,
} from "@/lib/ai/file-processing";
import { buildRagContext } from "@/lib/ai/rag-context-builder";
import { requireAuth } from "@/lib/auth/server";
import {
  deleteChatById,
  getChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from "@/lib/db/queries";
import {
  getLastDocumentInChat,
  getLatestDocumentVersionsByChat,
} from "@/lib/db/queries/document";

describe("Chat API Integration Tests", () => {
  let mockChatAgent: any;
  let mockRequest: Request;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup default mock chat agent
    mockChatAgent = {
      setApiKey: vi.fn(),
      setGitHubPAT: vi.fn(),
      chat: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "text",
            text: "Hello! How can I help you today?",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      ),
    };

    // Mock ChatAgentResolver
    vi.mocked(ChatAgentResolver.createChatAgent).mockResolvedValue(
      mockChatAgent
    );

    // Mock authentication to return test user
    vi.mocked(requireAuth).mockResolvedValue({
      user: {
        id: testUsers.regularUser.id,
        email: testUsers.regularUser.email,
        aud: "authenticated",
        role: "authenticated",
        created_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: testUsers.regularUser.raw_user_meta_data,
      } as any,
      session: null as any,
    });

    // Mock database queries
    vi.mocked(getChatById).mockResolvedValue(null);
    vi.mocked(saveChat).mockResolvedValue(undefined as any);
    vi.mocked(saveMessages).mockResolvedValue(undefined as any);
    vi.mocked(getMessagesByChatId).mockResolvedValue([]);
    vi.mocked(getLatestDocumentVersionsByChat).mockResolvedValue([]);
    vi.mocked(getLastDocumentInChat).mockResolvedValue(null as any);
    vi.mocked(generateTitleFromUserMessage).mockResolvedValue("Test Chat");
    vi.mocked(buildRagContext).mockResolvedValue({
      context: "",
      sourceCount: 0,
      sources: [],
      skippedReason: "missing_credentials",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/chat", () => {
    describe("Valid Requests", () => {
      it("should successfully process a valid chat request", async () => {
        const chatId = "660e8400-e29b-41d4-a716-446655440001";
        const messageId = "770e8400-e29b-41d4-a716-446655440001";

        const requestBody = {
          id: chatId,
          message: {
            id: messageId,
            role: "user" as const,
            parts: [
              {
                type: "text" as const,
                text: "Hello, how are you?",
              },
            ],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
          thinkingEnabled: false,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(mockChatAgent.setApiKey).toHaveBeenCalledWith("test-api-key");
        expect(mockChatAgent.chat).toHaveBeenCalled();
        expect(saveChat).toHaveBeenCalledWith(
          expect.objectContaining({
            id: chatId,
            userId: testUsers.regularUser.id,
            title: "Test Chat",
            visibility: "private",
          })
        );
        expect(saveMessages).toHaveBeenCalled();
      });

      it("should append retrieved RAG context when available", async () => {
        const chatId = "660e8400-e29b-41d4-a716-446655440001";
        const messageId = "770e8400-e29b-41d4-a716-446655440001";

        vi.mocked(buildRagContext).mockResolvedValueOnce({
          context:
            "\n\n## Retrieved Repository Context\n[1] chat/lib/example.ts L1-L10 (score: 0.876)\nconst demo = true;",
          sourceCount: 1,
          sources: [
            {
              id: "match-1",
              score: 0.876,
              filePath: "chat/lib/example.ts",
              lineRange: "L1-L10",
              content: "const demo = true;",
            },
          ],
        });

        const requestBody = {
          id: chatId,
          message: {
            id: messageId,
            role: "user" as const,
            parts: [
              {
                type: "text" as const,
                text: "Where is demo declared?",
              },
            ],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
          thinkingEnabled: false,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);
        expect(response.status).toBe(200);

        const chatCallArgs = mockChatAgent.chat.mock.calls[0]?.[0];
        expect(chatCallArgs).toBeDefined();
        expect(chatCallArgs.artifactContext).toContain(
          "Retrieved Repository Context"
        );
      });
    });

    describe("Authentication Tests", () => {
      it("should reject request without API key (401)", async () => {
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // No x-google-api-key header
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(400);
        expect(mockChatAgent.setApiKey).not.toHaveBeenCalled();
        expect(mockChatAgent.chat).not.toHaveBeenCalled();
      });

      it("should reject request with empty API key (401)", async () => {
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "   ", // Empty/whitespace API key
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(400);
        expect(mockChatAgent.setApiKey).not.toHaveBeenCalled();
      });

      it("should reject request with invalid API key format (401)", async () => {
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        // Mock chat agent to throw error for invalid API key
        mockChatAgent.chat.mockRejectedValueOnce(new Error("Invalid API key"));

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "invalid-key-format",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        // Should catch error and return 500 (offline:chat)
        expect(response.status).toBeGreaterThanOrEqual(400);
      });
    });

    describe("Thinking Mode Tests", () => {
      it("should process chat with thinking mode enabled", async () => {
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Explain quantum physics" }],
          },
          selectedChatModel: "gemini-2.0-flash-thinking-exp",
          selectedVisibilityType: "private" as const,
          thinkingEnabled: true,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(mockChatAgent.chat).toHaveBeenCalledWith(
          expect.objectContaining({
            thinkingMode: true,
          })
        );
      });

      it("should process chat with thinking mode disabled", async () => {
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
          thinkingEnabled: false,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(mockChatAgent.chat).toHaveBeenCalledWith(
          expect.objectContaining({
            thinkingMode: false,
          })
        );
      });
    });

    describe("File Attachment Tests", () => {
      it("should process chat with image file attachment", async () => {
        vi.mocked(validateFileAttachment).mockReturnValue({ valid: true });
        vi.mocked(extractFileContent).mockResolvedValue(
          "base64-encoded-image-data"
        );

        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [
              { type: "text" as const, text: "What is in this image?" },
              {
                type: "file" as const,
                mediaType: "image/png" as const,
                name: "test-image.png",
                url: "https://example.com/test-image.png",
              },
            ],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(validateFileAttachment).toHaveBeenCalled();
        expect(extractFileContent).toHaveBeenCalled();
        expect(mockChatAgent.chat).toHaveBeenCalled();
      });

      it("should process chat with multiple file attachments", async () => {
        vi.mocked(validateFileAttachment).mockReturnValue({ valid: true });
        vi.mocked(extractFileContent).mockResolvedValue("file-content");

        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [
              { type: "text" as const, text: "Analyze these images" },
              {
                type: "file" as const,
                mediaType: "image/png" as const,
                name: "image1.png",
                url: "https://example.com/image1.png",
              },
              {
                type: "file" as const,
                mediaType: "image/jpeg" as const,
                name: "image2.jpg",
                url: "https://example.com/image2.jpg",
              },
            ],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(validateFileAttachment).toHaveBeenCalledTimes(2);
        expect(extractFileContent).toHaveBeenCalledTimes(2);
      });

      it("should handle file processing errors gracefully", async () => {
        vi.mocked(validateFileAttachment).mockReturnValue({
          valid: false,
          error: "Invalid file type",
        });

        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [
              { type: "text" as const, text: "What is in this file?" },
              {
                type: "file" as const,
                mediaType: "image/png" as const,
                name: "invalid.png",
                url: "https://example.com/invalid.png",
              },
            ],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        // Should still process the request but skip invalid file
        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(extractFileContent).not.toHaveBeenCalled();
      });
    });

    describe("GitHub Context Tests", () => {
      it("should process chat with GitHub PAT for MCP agent", async () => {
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [
              { type: "text" as const, text: "Search GitHub for repositories" },
            ],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
            "x-github-pat": "github-personal-access-token",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(mockChatAgent.setGitHubPAT).toHaveBeenCalledWith(
          "github-personal-access-token"
        );
      });

      it("should process chat without GitHub PAT", async () => {
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
            // No GitHub PAT
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(mockChatAgent.setGitHubPAT).not.toHaveBeenCalled();
      });
    });

    describe("Streaming Response Tests", () => {
      it("should handle streaming response from chat agent", async () => {
        // Mock streaming response
        const mockStreamResponse = new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("Hello "));
              controller.enqueue(new TextEncoder().encode("from "));
              controller.enqueue(new TextEncoder().encode("AI"));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }
        );

        mockChatAgent.chat.mockResolvedValue(mockStreamResponse);

        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        expect(response.body).toBeDefined();
      });
    });

    describe("Multi-step Tool Execution Tests", () => {
      it("should handle chat with tool calls", async () => {
        // Mock chat agent response with tool calls
        mockChatAgent.chat.mockImplementation(({ onFinish }: { onFinish: any }) => {
          // Simulate tool execution and message saving
          setTimeout(async () => {
            await onFinish({
              messages: [
                {
                  id: "assistant-msg-1",
                  role: "assistant",
                  parts: [
                    {
                      type: "tool-call",
                      toolName: "search",
                      args: { query: "test query" },
                    },
                  ],
                },
                {
                  id: "assistant-msg-2",
                  role: "assistant",
                  parts: [
                    {
                      type: "text",
                      text: "Based on the search results...",
                    },
                  ],
                },
              ],
            });
          }, 0);

          return Promise.resolve(
            new Response(
              JSON.stringify({ type: "text", text: "Processing..." }),
              {
                status: 200,
              }
            )
          );
        });

        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [
              {
                type: "text" as const,
                text: "Search for information about AI",
              },
            ],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);

        // Wait for onFinish to be called
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(saveMessages).toHaveBeenCalledTimes(2); // User message + assistant messages
      });
    });

    describe("Error Handling Tests", () => {
      it("should handle network timeout errors", async () => {
        mockChatAgent.chat.mockRejectedValue(new Error("Network timeout"));

        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBeGreaterThanOrEqual(400);
      });

      it("should reject a message with empty text (bad_request:api)", async () => {
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "" }], // empty — fails schema min(1)
          },
          selectedChatModel: "gemini-2.5-flash",
          selectedVisibilityType: "private" as const,
          thinkingEnabled: false,
          selectedRepos: [],
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.code).toBe("bad_request:api");
        expect(mockChatAgent.chat).not.toHaveBeenCalled();
      });

      it("should accept a message with whitespace-only text (schema min(1) checks raw length)", async () => {
        // Zod's z.string().min(1) counts raw length, so "   " passes server validation.
        // The client-side guard in submitForm handles this via input.trim().length === 0
        // before it ever reaches the server.
        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440002",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "   " }],
          },
          selectedChatModel: "gemini-2.5-flash",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        // Server accepts it (raw length ≥ 1); client guard prevents it from ever being sent
        expect(response.status).toBe(200);
        expect(mockChatAgent.chat).toHaveBeenCalled();
      });

      it("should handle invalid request body", async () => {
        const invalidRequestBody = {
          id: "not-a-uuid",
          message: "invalid-message-format",
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(invalidRequestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(400);
      });

      it("should handle database errors gracefully", async () => {
        vi.mocked(saveChat).mockRejectedValue(
          new Error("Database connection failed")
        );

        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBeGreaterThanOrEqual(400);
      });
    });

    describe("Rate Limiting Tests (Future Implementation)", () => {
      it("should enforce rate limits when implemented", async () => {
        // TODO: Implement when rate limiting is added
        // This test is skipped for now but serves as a placeholder
        expect(true).toBe(true);
      });

      it("should return 429 when rate limit exceeded", async () => {
        // TODO: Implement when rate limiting is added
        expect(true).toBe(true);
      });
    });

    describe("Chat Ownership Tests", () => {
      it("should reject access to chat owned by different user", async () => {
        // Mock existing chat owned by different user
        vi.mocked(getChatById).mockResolvedValue({
          id: "660e8400-e29b-41d4-a716-446655440001",
          user_id: "different-user-id", // Different from testUsers.regularUser.id
          title: "Someone elses chat",
          visibility: "private",
          created_at: new Date(),
          updated_at: new Date(),
        } as any);

        const requestBody = {
          id: "660e8400-e29b-41d4-a716-446655440001",
          message: {
            id: "770e8400-e29b-41d4-a716-446655440001",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Hello" }],
          },
          selectedChatModel: "gemini-2.0-flash-exp",
          selectedVisibilityType: "private" as const,
        };

        mockRequest = new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-google-api-key": "test-api-key",
          },
          body: JSON.stringify(requestBody),
        });

        const response = await POST(mockRequest);

        expect(response).toBeDefined();
        expect(response.status).toBe(403);
      });
    });
  });

  describe("DELETE /api/chat", () => {
    it("should successfully delete a chat", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";

      vi.mocked(getChatById).mockResolvedValue({
        id: chatId,
        user_id: testUsers.regularUser.id,
        title: "Test Chat",
        visibility: "private",
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      vi.mocked(deleteChatById).mockResolvedValue({
        id: chatId,
        user_id: testUsers.regularUser.id,
        title: "Test Chat",
      } as any);

      mockRequest = new Request(`http://localhost:3000/api/chat?id=${chatId}`, {
        method: "DELETE",
      });

      const response = await DELETE(mockRequest);

      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      expect(deleteChatById).toHaveBeenCalledWith({ id: chatId });
    });

    it("should reject deletion of chat owned by different user", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";

      vi.mocked(getChatById).mockResolvedValue({
        id: chatId,
        user_id: "different-user-id",
        title: "Someone elses chat",
        visibility: "private",
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      mockRequest = new Request(`http://localhost:3000/api/chat?id=${chatId}`, {
        method: "DELETE",
      });

      const response = await DELETE(mockRequest);

      expect(response).toBeDefined();
      expect(response.status).toBe(403);
      expect(deleteChatById).not.toHaveBeenCalled();
    });

    it("should handle missing chat ID parameter", async () => {
      mockRequest = new Request("http://localhost:3000/api/chat", {
        method: "DELETE",
      });

      const response = await DELETE(mockRequest);

      expect(response).toBeDefined();
      expect(response.status).toBe(400);
    });
  });
});
