import type { User } from "@/lib/auth/types";
// Import simple chat agent resolver
import { ChatAgentResolver } from "@/lib/ai/chat-agent-resolver";
import { buildRagContext } from "@/lib/ai/rag-context-builder";
import {
  extractFileContent,
  validateFileAttachment,
} from "@/lib/ai/file-processing";
import {
  buildFileContext,
  getFileContextSummary,
} from "@/lib/ai/file-context-builder";
import {
  createAuthErrorResponse,
  getCurrentUser,
  isAuthRequired,
  requireAuth,
} from "@/lib/auth/server";
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
import type { DBMessage } from "@/lib/db/drizzle-schema";
import { ChatSDKError } from "@/lib/errors";
import {
  ActivityCategory,
  AgentOperationCategory,
  AgentOperationType,
  AgentType,
  createCorrelationId,
  logUserActivity,
  PerformanceTracker,
  UserActivityType,
} from "@/lib/logging";
import {
  buildArtifactContext,
  convertToUIMessages,
  generateUUID,
} from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

export async function POST(request: Request) {
  // Create correlation ID for request tracking
  const correlationId = createCorrelationId();
  const _requestStartTime = Date.now();
  let requestBody: PostRequestBody;
  let user: User | undefined;
  let chat: Awaited<ReturnType<typeof getChatById>> | undefined;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_error) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  // Track when DB operations have failed so we skip downstream persistence.
  let dbAvailable = true;

  try {
    const t0 = Date.now();

    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
      thinkingEnabled = false,
      selectedRepos = [],
      ragDisabled = false,
    } = requestBody;

    console.log(`[RAG] ragDisabled=${ragDisabled} selectedRepos=${JSON.stringify(selectedRepos)}`);

    // Authenticate user. If Supabase Auth is unreachable we still allow the
    // request through so the user can interact with models without DB.
    try {
      const authResult = await requireAuth();
      user = authResult.user;
    } catch (authError) {
      console.warn(
        "Auth unavailable, attempting to continue without DB persistence:",
        authError
      );
      try {
        user = (await getCurrentUser()) ?? undefined;
      } catch {
        // Ignore — we'll proceed unauthenticated.
      }
    }

    // Reject unauthenticated requests when this host (or REQUIRE_AUTH) demands
    // a logged-in user. On localhost without REQUIRE_AUTH, anonymous use is
    // allowed so the model can still respond without DB persistence.
    if (!user && (await isAuthRequired(request.headers))) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    // Chat management — DB-backed; tolerate failures.
    if (user) {
      try {
        chat = await getChatById({ id });
        if (chat) {
          if (chat.user_id !== user.id) {
            return new ChatSDKError("forbidden:chat").toResponse();
          }
        } else {
          const title = await generateTitleFromUserMessage({ message });
          await saveChat({
            id,
            userId: user.id,
            title,
            visibility: selectedVisibilityType,
          });
        }
      } catch (dbError) {
        console.warn("Chat lookup/save failed (DB offline?):", dbError);
        dbAvailable = false;
      }
    } else {
      dbAvailable = false;
    }

    // Get messages and process files (best-effort)
    let messagesFromDb: DBMessage[] = [];
    if (dbAvailable) {
      try {
        messagesFromDb = await getMessagesByChatId({ id });
      } catch (dbError) {
        console.warn("Failed to load prior messages:", dbError);
        dbAvailable = false;
      }
    }
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    // Fetch all artifacts in the conversation (best-effort)
    let allArtifacts: Awaited<ReturnType<typeof getLatestDocumentVersionsByChat>> = [];
    let lastDocument: Awaited<ReturnType<typeof getLastDocumentInChat>> | null = null;
    if (dbAvailable) {
      try {
        allArtifacts = await getLatestDocumentVersionsByChat({ chatId: id });
        lastDocument = await getLastDocumentInChat({ chatId: id });
      } catch (dbError) {
        console.warn("Failed to load artifacts:", dbError);
      }
    }
    const artifactContext = buildArtifactContext(allArtifacts, lastDocument);

    // Build file context (storage-backed; safe to skip on DB outage)
    let fileContext = "";
    if (dbAvailable && user) {
      try {
        fileContext = await buildFileContext(messagesFromDb, id, user.id);
      } catch (fileErr) {
        console.warn("Failed to build file context:", fileErr);
      }
    }

    // Build retrieval-augmented context from vector index using latest user text
    const latestUserText = message.parts
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text || "")
      .join("\n")
      .trim();

    // RAG retrieval credentials may come from the browser via headers
    // (x-pinecone-api-key / x-voyage-api-key, plus their `-enc` RSA-encrypted
    // variants). Server `.env` always wins inside buildRagContext.
    let pineconeApiKeyOverride =
      request.headers.get("x-pinecone-api-key") ?? undefined;
    let voyageApiKeyOverride =
      request.headers.get("x-voyage-api-key") ?? undefined;
    const pineconeApiKeyEnc = request.headers.get("x-pinecone-api-key-enc");
    const voyageApiKeyEnc = request.headers.get("x-voyage-api-key-enc");
    if (
      (!pineconeApiKeyOverride && pineconeApiKeyEnc) ||
      (!voyageApiKeyOverride && voyageApiKeyEnc)
    ) {
      const { decryptWithServerKey } = await import("@/lib/server-crypto");
      if (!pineconeApiKeyOverride && pineconeApiKeyEnc) {
        pineconeApiKeyOverride =
          decryptWithServerKey(pineconeApiKeyEnc, "pinecone") ?? undefined;
      }
      if (!voyageApiKeyOverride && voyageApiKeyEnc) {
        voyageApiKeyOverride =
          decryptWithServerKey(voyageApiKeyEnc, "voyage") ?? undefined;
      }
    }

    const ragStartMs = ragDisabled ? undefined : Date.now() - t0;
    const ragContextResult = ragDisabled
      ? {
          context: "",
          sourceCount: 0,
          sources: [],
          skippedReason: "disabled" as const,
        }
      : await buildRagContext({
          queryText: latestUserText,
          limitToRepoNames:
            selectedRepos.length > 0 ? selectedRepos : undefined,
          pineconeApiKey: pineconeApiKeyOverride,
          voyageApiKey: voyageApiKeyOverride,
        });
    const ragEndMs = ragDisabled ? undefined : Date.now() - t0;

    const ragContext = ragContextResult.context;

    // Get file summary for logging
    const fileSummary = getFileContextSummary(messagesFromDb);

    // Process new file attachments in current message
    const fileContexts: string[] = [];
    const fileParts = message.parts.filter((part) => part.type === "file");

    for (const filePart of fileParts) {
      try {
        const attachment = {
          name: filePart.name ?? "file",
          url: filePart.url,
          mediaType: filePart.mediaType,
        };

        const validation = validateFileAttachment(attachment);
        if (validation.valid) {
          const fileContent = await extractFileContent(attachment);
          fileContexts.push(
            `File: ${attachment.name}\nContent:\n${fileContent}`
          );
        }
      } catch (error) {
        console.error(
          `Failed to process file ${filePart.name ?? "file"}:`,
          error
        );
      }
    }

    // Combine new files with existing file context
    const newFileContext =
      fileContexts.length > 0
        ? `\n\nNewly Attached Files:\n${fileContexts.join("\n\n")}`
        : "";

    // Get API key and validate.
    // x-google-api-key: plaintext (from the session's in-memory cache).
    // x-google-api-key-enc: RSA-encrypted blob (only server can decrypt).
    const rawApiKey = request.headers.get("x-google-api-key");
    const rawApiKeyEnc = request.headers.get("x-google-api-key-enc");
    let apiKey = rawApiKey;
    if (!apiKey && rawApiKeyEnc) {
      const { decryptWithServerKey } = await import("@/lib/server-crypto");
      apiKey = decryptWithServerKey(rawApiKeyEnc, "google");
    }
    const serverApiKey =
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY;

    if (!apiKey?.trim() && !serverApiKey?.trim()) {
      return new ChatSDKError(
        "bad_request:api",
        "Missing Google AI API key. Add one in Settings > API Keys or set GOOGLE_GENERATIVE_AI_API_KEY on the server."
      ).toResponse();
    }

    // Get GitHub PAT (optional - for GitHub MCP agent)
    const githubPAT = request.headers.get("x-github-pat");

    // Extract file attachments for database storage
    const fileAttachments = fileParts.map((filePart: any) => ({
      url: filePart.url,
      name: filePart.name ?? "file",
      contentType: filePart.mediaType ?? "application/octet-stream",
      size: 0, // Size not available from filePart
      uploadedAt: new Date().toISOString(),
      storagePath: filePart.storagePath || "", // Use storagePath if provided
    }));

    // Save user message (best-effort)
    if (dbAvailable) {
      try {
        await saveMessages({
          messages: [
            {
              chatId: id,
              id: message.id,
              role: "user",
              parts: message.parts,
              attachments: fileAttachments,
              createdAt: new Date(),
              modelUsed: null,
              inputTokens: null,
              outputTokens: null,
              cost: null,
            },
          ],
        });
      } catch (dbError) {
        console.warn("Failed to persist user message:", dbError);
        dbAvailable = false;
      }
    }

    // Log user activity - chat message sent (skip when unauthenticated)
    if (user) {
      await logUserActivity({
        user_id: user.id,
        correlation_id: correlationId,
        activity_type: chat
          ? UserActivityType.CHAT_MESSAGE_SEND
          : UserActivityType.CHAT_CREATE,
        activity_category: ActivityCategory.CHAT,
        activity_metadata: {
          chat_id: id,
          model_selected: selectedChatModel,
          thinking_enabled: thinkingEnabled,
          file_count: fileParts.length,
          total_files_in_context: fileSummary.fileCount,
          total_file_size: fileSummary.totalSize,
          message_length: message.parts
            .filter((p: any) => p.type === "text")
            .reduce((sum: number, p: any) => sum + (p.text?.length || 0), 0),
          has_artifact_context: allArtifacts.length > 0,
          has_file_context: fileSummary.fileCount > 0,
          has_rag_context: ragContextResult.sourceCount > 0,
          rag_source_count: ragContextResult.sourceCount,
          rag_skipped_reason: ragContextResult.skippedReason || null,
        },
        resource_id: id,
        resource_type: "chat",
        request_path: request.url,
        request_method: "POST",
        success: true,
      });
    }

    // Create performance tracker for AI operation
    const aiTracker = new PerformanceTracker({
      user_id: user?.id,
      correlation_id: correlationId,
      agent_type: AgentType.CHAT_MODEL_AGENT,
      operation_type: AgentOperationType.STREAMING,
      operation_category: AgentOperationCategory.STREAMING,
      model_id: selectedChatModel,
      thinking_mode: thinkingEnabled,
      resource_id: id,
      resource_type: "chat",
    });

    // Create chat agent using simple resolver
    const chatAgent = await ChatAgentResolver.createChatAgent();
    if (apiKey?.trim()) {
      chatAgent.setApiKey(apiKey);
    } else if (serverApiKey?.trim()) {
      chatAgent.setApiKey(serverApiKey);
    }

    // Set GitHub PAT only when no CodeChat sources are selected (ragDisabled = true).
    // When sources are checked, RAG handles code context — GitHub MCP should not compete.
    if (githubPAT?.trim() && ragDisabled) {
      chatAgent.setGitHubPAT(githubPAT);
      console.log("🐙 [GITHUB-PAT] GitHub PAT provided for MCP agent");
    }

    const baseMessages = uiMessages.map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant" | "system",
      content: msg.parts
        .map((part: any) => (part.type === "text" ? part.text : ""))
        .join("\n"),
    }));

    if (newFileContext && baseMessages.length > 0) {
      const lastIndex = baseMessages.length - 1;
      baseMessages[lastIndex] = {
        ...baseMessages[lastIndex],
        content: baseMessages[lastIndex].content + newFileContext,
      };
    }

    const messagesForAgent = baseMessages.filter(
      (msg) => msg.content && msg.content.trim().length > 0
    );

    console.log(
      "🧪 [/api/chat] messages passed into chatAgent.chat:",
      JSON.stringify(messagesForAgent, null, 2)
    );

    if (ragContextResult.sourceCount > 0) {
      console.log(
        `[RAG] Retrieved ${ragContextResult.sourceCount} vector sources for chat ${id}`
      );
    } else if (ragContextResult.skippedReason) {
      console.log(
        `[RAG] Skipped retrieval (${ragContextResult.skippedReason}) for chat ${id}`
      );
    }

    // Use chat agent to generate streaming response with all provider-specific logic
    const response = await chatAgent.chat({
      chatId: id,
      modelId: selectedChatModel,
      messages: messagesForAgent,
      artifactContext: artifactContext + fileContext + ragContext,
      thinkingMode: thinkingEnabled,
      user,
      generateId: generateUUID,
      ragStatus: {
        skippedReason: ragContextResult.skippedReason,
        sourceCount: ragContextResult.sourceCount,
        sources: ragContextResult.sources,
      },
      timingData: {
        t0,
        ragStartMs,
        ragEndMs,
        ragSourceCount: ragContextResult.sourceCount,
      },
      onFinish: async ({ messages }) => {
        // Save all assistant messages to database
        const assistantMessages = messages.filter(
          (msg) => msg.role === "assistant"
        );

        if (assistantMessages.length > 0 && dbAvailable) {
          console.log(
            "🔍 [FINISH] Processing",
            assistantMessages.length,
            "assistant messages"
          );

          try {
          await saveMessages({
            messages: assistantMessages.map((msg) => {
              console.log("🔍 [FINISH] Message has", msg.parts.length, "parts");

              const hasMeaningfulPart = msg.parts && msg.parts.some((part: any) => {
                if (part.type === "text") return (part.text ?? "").trim().length > 0;

                return true;
              });

              let parts = msg.parts;

              if (!hasMeaningfulPart) {
                const text = thinkingEnabled ? "The selected model does not support thinking mode. Please choose a different model or disable thinking mode."
                : "The model was unable to generate a response. Please try again with a different prompt or model.";

                console.warn(
                  "🔍 [FINISH] Replacing empty assistant message with fallback text:",
                  text
                );

                parts = [
                  {
                    type: "text",
                    text,
                  } as any
                ]
              }

              // Log message parts for debugging
              msg.parts.forEach((part: any, index: number) => {
                console.log(`🔍 [FINISH] Part ${index}: type=${part.type}`);

                if (part.type === "tool-documentAgent") {
                  const output = (part as any).output;
                  console.log(
                    "🔍 [FINISH] documentAgent output:",
                    JSON.stringify(output)
                  );
                }
              });

              return {
                id: msg.id,
                chatId: id,
                role: "assistant",
                parts: parts,
                attachments: [],
                createdAt: new Date(),
                modelUsed: selectedChatModel,
                inputTokens: null,
                outputTokens: null,
                cost: null,
              };
            }),
          });
          } catch (dbError) {
            console.warn("Failed to persist assistant messages:", dbError);
          }
        }

        // Log agent activity completion (Note: Token counts not available from chat agent interface)
        await aiTracker.end({
          success: true,
          operation_metadata: {
            message_count: assistantMessages.length,
            parts_count: assistantMessages.reduce(
              (sum, msg) => sum + msg.parts.length,
              0
            ),
          },
        });
      },
    });

    return response;
  } catch (error) {
    // Log failed user activity
    if (user) {
      await logUserActivity({
        user_id: user.id,
        correlation_id: correlationId,
        activity_type: chat
          ? UserActivityType.CHAT_MESSAGE_SEND
          : UserActivityType.CHAT_CREATE,
        activity_category: ActivityCategory.CHAT,
        success: false,
        error_message: error instanceof Error ? error.message : "Unknown error",
      });
    }

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    console.error("Unhandled error in chat API:", error);
    return new ChatSDKError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const correlationId = createCorrelationId();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  // Authenticate user with Supabase
  let user: User;
  try {
    const authResult = await requireAuth();
    user = authResult.user;
  } catch (error) {
    return createAuthErrorResponse(error as Error);
  }

  const chat = await getChatById({ id });

  if (chat && chat.user_id !== user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  try {
    const deletedChat = await deleteChatById({ id });

    // Log successful chat deletion
    await logUserActivity({
      user_id: user.id,
      correlation_id: correlationId,
      activity_type: UserActivityType.CHAT_DELETE,
      activity_category: ActivityCategory.CHAT,
      resource_id: id,
      resource_type: "chat",
      request_path: request.url,
      request_method: "DELETE",
      success: true,
    });

    return Response.json(deletedChat, { status: 200 });
  } catch (error) {
    // Log failed deletion
    await logUserActivity({
      user_id: user.id,
      correlation_id: correlationId,
      activity_type: UserActivityType.CHAT_DELETE,
      activity_category: ActivityCategory.CHAT,
      success: false,
      error_message: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
