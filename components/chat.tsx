"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useLocalStorage } from "usehooks-ts";
import { unstable_serialize } from "swr/infinite";
import { ChatHeader } from "@/components/chat-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { useRepos } from "@/hooks/use-repos";
import type { Vote } from "@/lib/db/drizzle-schema";
import type { RagSource } from "@/lib/ai/rag-context-builder";
import { ChatSDKError } from "@/lib/errors";
import { storage } from "@/lib/storage";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "./artifact";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { PromptPrivacyBanner } from "./prompt-privacy-banner";
import { RagSourcesPanel } from "./rag-sources-panel";
import { RagTimingPanel } from "./rag-timing-panel";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "sonner";
import type { VisibilityType } from "./visibility-selector";
import { PROVIDER_MAP } from "@/lib/providers";

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
  isEmailUser = false,
  hasSocialProviders = false,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
  initialLastContext?: AppUsage;
  isEmailUser?: boolean;
  hasSocialProviders?: boolean;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>("");
  const [usage, setUsage] = useState<AppUsage | undefined>(initialLastContext);
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const [ragSkippedReason, setRagSkippedReason] = useState<string | null>(null);
  const [ragSources, setRagSources] = useState<RagSource[]>([]);
  const [timingData, setTimingData] = useState<{
    ragStartMs?: number;
    ragEndMs?: number;
    llmRequestMs?: number;
    ragSourceCount?: number;
  } | null>(null);
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  // Populate the in-memory key cache so getAPIKey() returns plaintext
  // before the user sends their first message.
  useEffect(() => {
    storage.general.initCrypto().catch(console.error);
  }, []);

  // RAG repo selection state — persists across sessions
  const [ragSelectedRepos, setRagSelectedRepos] = useLocalStorage<string[]>(
    "rag-selected-repos",
    []
  );
  const ragSelectedReposRef = useRef(ragSelectedRepos);

  useEffect(() => {
    ragSelectedReposRef.current = ragSelectedRepos;
  }, [ragSelectedRepos]);

  // When the user explicitly unchecks every source, skip RAG entirely on the server.
  const [ragDisabled] = useLocalStorage<boolean>("rag-disabled", false);
  const ragDisabledRef = useRef(ragDisabled);

  useEffect(() => {
    ragDisabledRef.current = ragDisabled;
  }, [ragDisabled]);

  // Fetch available repos for the selector
  const { repos: availableRepos, isLoading: reposLoading } = useRepos();

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    clearError
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        // Get Google API key — plaintext from session cache if available,
        // otherwise the RSA-encrypted blob for server-side decryption.
        const googleApiKey = storage.apiKeys.get("google");
        const googleApiKeyEnc = !googleApiKey
          ? storage.apiKeys.getEncryptedBlob("google")
          : null;

        // Get GitHub PAT from localStorage (for GitHub MCP agent)
        const githubPAT = storage.github.getToken();

        // RAG retrieval credentials — Pinecone (vector DB) and Voyage (embeddings).
        // Fall back to RSA-encrypted blobs when the plaintext cache is empty.
        const pineconeApiKey = storage.apiKeys.get("pinecone");
        const pineconeApiKeyEnc = !pineconeApiKey
          ? storage.apiKeys.getEncryptedBlob("pinecone")
          : null;
        const voyageApiKey = storage.apiKeys.get("voyage");
        const voyageApiKeyEnc = !voyageApiKey
          ? storage.apiKeys.getEncryptedBlob("voyage")
          : null;

        // Extract thinking mode from the last message's experimental metadata
        const lastMessage = request.messages.at(-1);
        const thinkingEnabled =
          (lastMessage as any)?.experimental_providerMetadata?.thinking ||
          false;

        const requestBody = {
          id: request.id,
          message: lastMessage,
          selectedChatModel: currentModelIdRef.current,
          selectedVisibilityType: visibilityType,
          thinkingEnabled,
          selectedRepos: ragSelectedReposRef.current,
          ragDisabled: ragDisabledRef.current,
          ...request.body,
        };

        // Send API keys in headers for security
        const headers: Record<string, string> = {};
        if (googleApiKey) {
          headers["x-google-api-key"] = googleApiKey;
        } else if (googleApiKeyEnc) {
          // RSA blob — server decrypts it before calling the AI provider.
          headers["x-google-api-key-enc"] = googleApiKeyEnc;
        }
        if (githubPAT) {
          headers["x-github-pat"] = githubPAT;
        }
        if (pineconeApiKey) {
          headers["x-pinecone-api-key"] = pineconeApiKey;
        } else if (pineconeApiKeyEnc) {
          headers["x-pinecone-api-key-enc"] = pineconeApiKeyEnc;
        }
        if (voyageApiKey) {
          headers["x-voyage-api-key"] = voyageApiKey;
        } else if (voyageApiKeyEnc) {
          headers["x-voyage-api-key-enc"] = voyageApiKeyEnc;
        }

        return {
          body: requestBody,
          headers,
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      if (dataPart.type === "data-usage") {
        setUsage(dataPart.data);
      }
      if (dataPart.type === "data-rag-status") {
        const data = dataPart.data as {
          skippedReason?: string;
          sources?: RagSource[];
        } | null;
        setRagSkippedReason(data?.skippedReason ?? null);
        setRagSources(data?.sources ?? []);
      }
      if (dataPart.type === "data-timing") {
        setTimingData(
          (dataPart.data as {
            ragStartMs?: number;
            ragEndMs?: number;
            llmRequestMs?: number;
            ragSourceCount?: number;
          } | null) ?? null
        );
      }
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      console.error("💥 [DEBUG] Chat error occurred:", error);

      const messageText =
        error instanceof Error
          ? error.message
          : typeof (error as any)?.message === "string"
            ? (error as any).message
            : String(error);

      const msgLower = messageText.toLowerCase();
      const isQuotaError =
        messageText.includes("429") ||
        msgLower.includes("quota") ||
        msgLower.includes("resource_exhausted") ||
        msgLower.includes("resource exhausted") ||
        msgLower.includes("rate limit") ||
        msgLower.includes("ratelimit") ||
        (error as any)?.statusCode === 429;

      if (isQuotaError) {
        toast.error("Google AI quota exceeded. Please try again later or upgrade your plan.");
        setDataStream([]);
        clearError();
        return;
      }

      if (messageText.includes("thinking is not supported by this model")) {
        const thinkingNotSupportedMessage = "The selected model does not support thinking mode. Please choose a different model or disable thinking mode.";

        setMessages((prev) => {
          if (prev.length === 0) {
            return [
              ...prev,
              {
                id: generateUUID(),
                role: "assistant",
                parts: [{ type: "text", text: thinkingNotSupportedMessage }],
              } as ChatMessage
            ];
          }

          let idx = prev.length - 1;
          while (idx >= 0 && prev[idx].role !== "assistant") {
            idx--;
          }

          if (idx < 0) {
            return [
              ...prev,
              {
                id: generateUUID(),
                role: "assistant",
                parts: [{ type: "text", text: thinkingNotSupportedMessage }],
              } as ChatMessage
            ];
          }

          const last = prev[idx];

          const hasMeaningfulPart = last.parts && last.parts.some(
            (part: any) => {
              if (part.type === "text") {
                return (part.text ?? "").trim().length > 0;
              }

              return true;
            }
          );

          if (hasMeaningfulPart) {
            return prev;
          }

          const updatedLast: ChatMessage = {
            ...last,
            parts: [
              { type: "text", text: thinkingNotSupportedMessage },
            ]
          };

          const next = [...prev];
          next[idx] = updatedLast;
          return next;
        });
      }

      const isMissingKey =
        (msgLower.includes("missing") && msgLower.includes("api key")) ||
        (msgLower.includes("api key") && (msgLower.includes("required") || msgLower.includes("invalid"))) ||
        msgLower.includes("please check your api key") ||
        (msgLower.includes("authentication failed") && msgLower.includes("api"));

      if (isMissingKey) {
        const providerKey =
          msgLower.includes("google") || msgLower.includes("gemini") ? "google" :
          msgLower.includes("anthropic") || msgLower.includes("claude") ? "anthropic" :
          msgLower.includes("openai") || msgLower.includes("gpt") ? "openai" :
          msgLower.includes("xai") || msgLower.includes("grok") ? "xai" :
          null;

        const info = PROVIDER_MAP[providerKey ?? ""];
        const providerName = info?.name ?? "the selected AI provider";

        const keyMessage = [
          `**API key required for ${providerName}**`,
          "",
          info ? `1. [Get a ${providerName} API key](${info.getKeyUrl})` : "",
          `${info ? "2." : "1."} [Add it in Settings → API Keys](/settings)`,
        ].filter(Boolean).join("\n");

        setMessages((prev) => {
          const assistantMsg = {
            id: generateUUID(),
            role: "assistant" as const,
            parts: [{ type: "text" as const, text: keyMessage }],
          } as ChatMessage;

          if (prev.length === 0) return [assistantMsg];

          let idx = prev.length - 1;
          while (idx >= 0 && prev[idx].role !== "assistant") idx--;

          if (idx < 0) return [...prev, assistantMsg];

          const last = prev[idx];
          const hasMeaningfulPart = last.parts?.some((part: any) =>
            part.type === "text" ? (part.text ?? "").trim().length > 0 : true
          );

          if (hasMeaningfulPart) return [...prev, assistantMsg];

          const next = [...prev];
          next[idx] = { ...last, parts: [{ type: "text", text: keyMessage }] } as ChatMessage;
          return next;
        });

        setDataStream([]);
        clearError();
        return;
      }

      if (error instanceof ChatSDKError) {
        if (error.message?.includes("AI Gateway requires a valid credit card")) {
          setShowCreditCardAlert(true);
        } else {
          toast.error(error.message);
        }
      } else if (error instanceof Error) {
        toast.error(error.message || "An unexpected error occurred");
      } else {
        toast.error(messageText || "An unexpected error occurred");
      }

      setDataStream([]);
      clearError();
    },
  });

  // Clear timing panel when a new request starts
  useEffect(() => {
    if (status === "submitted") {
      setTimingData(null);
    }
  }, [status]);

  const searchParams = useSearchParams();
  const query = searchParams.get("query");
  const dataParam = searchParams.get("data");
  const targetParam = searchParams.get("target");
  const commonParam = searchParams.get("common");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);
  const [hasInjectedPrompt, setHasInjectedPrompt] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  useEffect(() => {
    if (hasInjectedPrompt) {
      return;
    }

    const normalizeList = (value: string | null) =>
      value
        ? value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [];

    const dataSources = normalizeList(dataParam);
    const targets = normalizeList(targetParam);
    const commonColumns = normalizeList(commonParam);

    if (
      dataSources.length === 0 ||
      targets.length === 0 ||
      commonColumns.length === 0
    ) {
      return;
    }

    if (input.trim().length > 0) {
      return;
    }

    const injectedPrompt =
      `I have loaded data from ${dataSources.join(",")}. ` +
      `These datasets are linked by ${commonColumns.join(",")}. ` +
      `I would like you to analyze this information to predict ${targets.join(",")}. ` +
      "Please explain your methodology before proceeding.";

    setInput(injectedPrompt);
    setHasInjectedPrompt(true);
    window.history.replaceState({}, "", `/chat/${id}`);
  }, [
    dataParam,
    targetParam,
    commonParam,
    hasInjectedPrompt,
    input,
    id,
    setInput,
  ]);

  const { data: votes } = useSWR<Vote[]>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher
  );

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  return (
    <>
      <div className="overscroll-behavior-contain flex h-[calc(100dvh-73px)] min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          selectedVisibilityType={initialVisibilityType}
        />

        <Messages
          chatId={id}
          isArtifactVisible={isArtifactVisible}
          isReadonly={isReadonly}
          messages={messages}
          regenerate={regenerate}
          selectedModelId={initialChatModel}
          setMessages={setMessages}
          status={status}
          votes={votes}
        />

        {ragSkippedReason === "missing_credentials" && !ragDisabled && (
          <div className="mx-auto w-full max-w-4xl px-[26px] pb-2 md:px-[34px]">
            <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
              Repository search is unavailable: the server is missing Pinecone
              and/or Voyage credentials, so prompts are answered without your
              indexed code.{" "}
              <a
                href="/chat/keys"
                className="underline font-medium hover:no-underline"
              >
                Add keys
              </a>{" "}
              or uncheck all sources to silence this notice.
            </div>
          </div>
        )}

        {ragSkippedReason === "unauthorized" && !ragDisabled && (
          <div className="mx-auto w-full max-w-4xl px-[26px] pb-2 md:px-[34px]">
            <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
              <span className="font-medium">Pinecone key unauthorized.</span>{" "}
              The <code className="rounded bg-amber-100 px-0.5 dark:bg-amber-900">PINECONE_API_KEY</code> in{" "}
              <code className="rounded bg-amber-100 px-0.5 dark:bg-amber-900">docker/.env</code>{" "}
              is not authorized for this index. Copy the key from{" "}
              <a
                href="https://app.pinecone.io"
                target="_blank"
                rel="noreferrer"
                className="underline font-medium hover:no-underline"
              >
                app.pinecone.io
              </a>{" "}
              → API Keys, update <code className="rounded bg-amber-100 px-0.5 dark:bg-amber-900">docker/.env</code>, and restart the server.
            </div>
          </div>
        )}

        {ragSkippedReason === "index_not_found" && !ragDisabled && (
          <div className="mx-auto w-full max-w-4xl px-[26px] pb-2 md:px-[34px]">
            <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
              <span className="font-medium">Pinecone index not found.</span>{" "}
              Create a <code className="rounded bg-amber-100 px-0.5 dark:bg-amber-900">repo-chunks</code> index
              (1024 dimensions, cosine metric) at{" "}
              <a
                href="https://app.pinecone.io"
                target="_blank"
                rel="noreferrer"
                className="underline font-medium hover:no-underline"
              >
                app.pinecone.io
              </a>
              , add <code className="rounded bg-amber-100 px-0.5 dark:bg-amber-900">PINECONE_INDEX_HOST</code> to{" "}
              <code className="rounded bg-amber-100 px-0.5 dark:bg-amber-900">docker/.env</code>, then run{" "}
              <code className="rounded bg-amber-100 px-0.5 dark:bg-amber-900">python chat/ingestion/vector_db_sync.py --reindex-all</code>{" "}
              to populate it with your repo vectors.
            </div>
          </div>
        )}

        {ragSources.length > 0 && (
          <RagSourcesPanel ragSources={ragSources} />
        )}

        {timingData && <RagTimingPanel timing={timingData} />}

        <div className="sticky bottom-0 z-1 w-full bg-background">
          {!isReadonly && (
            <div className="mx-auto w-full max-w-4xl px-[26px] md:px-[34px]">
              <PromptPrivacyBanner isEmailUser={isEmailUser} hasSocialProviders={hasSocialProviders} />
            </div>
          )}
          <div className="mx-auto flex w-full max-w-4xl gap-2 px-[26px] pb-3 md:px-[34px] md:pb-4">
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              chatId={id}
              githubPAT={storage.github.getToken() || undefined}
              input={input}
              messages={messages}
              onModelChange={setCurrentModelId}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
              usage={usage}
            />
          )}
          </div>
        </div>
      </div>

      <Artifact
        attachments={attachments}
        chatId={id}
        input={input}
        isReadonly={isReadonly}
        messages={messages}
        regenerate={regenerate}
        selectedModelId={currentModelId}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        status={status}
        stop={stop}
        votes={votes}
      />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open(
                  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                  "_blank"
                );
                window.location.href = "/";
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
