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
import { ChatSDKError } from "@/lib/errors";
import { storage } from "@/lib/storage";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "./artifact";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "sonner";
import type { VisibilityType } from "./visibility-selector";

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
  initialLastContext?: AppUsage;
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
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  // RAG repo selection state — persists across sessions
  const [ragSelectedRepos, setRagSelectedRepos] = useLocalStorage<string[]>(
    "rag-selected-repos",
    []
  );
  const ragSelectedReposRef = useRef(ragSelectedRepos);

  useEffect(() => {
    ragSelectedReposRef.current = ragSelectedRepos;
  }, [ragSelectedRepos]);

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
        // Get Google API key from localStorage
        const googleApiKey = storage.apiKeys.get("google");

        // Get GitHub PAT from localStorage (for GitHub MCP agent)
        const githubPAT = storage.github.getToken();

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
          ...request.body,
        };

        // Send API keys in headers for security
        const headers: Record<string, string> = {};
        if (googleApiKey) {
          headers["x-google-api-key"] = googleApiKey;
        }
        if (githubPAT) {
          headers["x-github-pat"] = githubPAT;
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

      if (error instanceof ChatSDKError) {
        if (error.message?.includes("AI Gateway requires a valid credit card")) {
          setShowCreditCardAlert(true);
        } else {
          toast.error(error.message);
        }
      } else if (error instanceof Error) {
        if (error.message?.includes("Google API key is required")) {
          toast.error("Please configure your Google API key in Settings to use the chat.");
        } else {
          toast.error(error.message || "An unexpected error occurred");
        }
      } else {
        toast.error(messageText || "An unexpected error occurred");
      }

      setDataStream([]);
      clearError();
    },
  });

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
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
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

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              availableRepos={availableRepos}
              availableReposLoading={reposLoading}
              chatId={id}
              githubPAT={storage.github.getToken() || undefined}
              input={input}
              messages={messages}
              onModelChange={setCurrentModelId}
              onRagSelectedReposChange={setRagSelectedRepos}
              ragSelectedRepos={ragSelectedRepos}
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
