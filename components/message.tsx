"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { motion } from "framer-motion";
import { memo, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { Vote } from "@/lib/db/drizzle-schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { CollapsibleAnswer } from "./collapsible-answer";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./elements/tool";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  isLast,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  isLast: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");

  // Same key the Sources sidebar writes. When repos are selected, the normal
  // chat answer is shown as a labelled, collapsible block so it stacks under
  // the "From repo docs" panel (see repo-docs-panel.tsx). RepoDocsPanel is
  // only rendered once, for the latest turn (chat.tsx), so this only applies
  // to the last message too — otherwise every prior assistant answer in
  // scrollback gets retroactively collapsed as soon as Sources is enabled.
  // initializeWithValue false keeps server and first client render identical
  // (no hydration diff).
  const [ragSelectedRepos] = useLocalStorage<string[]>("rag-selected-repos", [], {
    initializeWithValue: false,
  });
  const stackAnswer =
    message.role === "assistant" &&
    isLast &&
    ragSelectedRepos.length > 0 &&
    !isLoading;

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={message.role}
      data-testid={`message-${message.role}`}
      initial={{ opacity: 0 }}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn("flex flex-col", {
            "gap-2 md:gap-4": message.parts?.some(
              (p) => p.type === "text" && p.text?.trim()
            ),
            "min-h-96": message.role === "assistant" && requiresScrollPadding,
            "w-full":
              (message.role === "assistant" &&
                message.parts?.some(
                  (p) => p.type === "text" && p.text?.trim()
                )) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]":
              message.role === "user" && mode !== "edit",
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {message.parts?.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === "reasoning" && part.text?.trim().length > 0) {
              // Find the last reasoning part index
              const reasoningParts =
                message.parts?.filter((p) => p.type === "reasoning") || [];
              const isLastReasoningPart =
                reasoningParts.length > 0 && reasoningParts.at(-1) === part;

              // Only the last reasoning part should be in loading state while streaming
              // All previous reasoning parts are already complete
              const isReasoningLoading = isLoading && isLastReasoningPart;

              return (
                <MessageReasoning
                  isLoading={isReasoningLoading}
                  key={key}
                  reasoning={part.text}
                />
              );
            }

            if (type === "text") {
              if (mode === "view") {
                return (
                  <div key={key}>
                    <MessageContent
                      className={cn({
                        "w-fit break-words rounded-2xl px-3 py-2 text-right text-white":
                          message.role === "user",
                        "bg-transparent px-0 py-0 text-left":
                          message.role === "assistant",
                      })}
                      data-testid="message-content"
                      style={
                        message.role === "user"
                          ? { backgroundColor: "#006cff" }
                          : undefined
                      }
                    >
                      <CollapsibleAnswer enabled={stackAnswer} label="Chat answer">
                        <Response>{sanitizeText(part.text)}</Response>
                      </CollapsibleAnswer>
                    </MessageContent>
                  </div>
                );
              }

              if (mode === "edit") {
                return (
                  <div
                    className="flex w-full flex-row items-start gap-3"
                    key={key}
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        regenerate={regenerate}
                        setMessages={setMessages}
                        setMode={setMode}
                      />
                    </div>
                  </div>
                );
              }
            }

            // Generic tool call handling for provider tools (googleSearch, urlContext, codeExecution)
            if (type === "tool-call") {
              const { toolCallId, toolName, args } = part as any;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state="input-available" type={toolName} />
                  <ToolContent>
                    <ToolInput input={args} />
                  </ToolContent>
                </Tool>
              );
            }

            if (type === "tool-result") {
              const { toolCallId, toolName, result } = part as any;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state="output-available" type={toolName} />
                  <ToolContent>
                    <ToolOutput
                      errorText={undefined}
                      output={
                        <pre className="rounded bg-muted p-2 text-sm">
                          {JSON.stringify(result, null, 2)}
                        </pre>
                      }
                    />
                  </ToolContent>
                </Tool>
              );
            }

            // Handle documentAgent tool result - extract document info from output
            if (type === "tool-documentAgent") {
              console.log("🎨 [MESSAGE] Found tool-documentAgent part");
              const output = (part as any).output;
              console.log("🎨 [MESSAGE] Output:", JSON.stringify(output));

              // Check if output has document structure { id, title, kind }
              if (
                output &&
                typeof output === "object" &&
                output.id &&
                output.title
              ) {
                const toolCallId = output.id;
                console.log(
                  "✅ [MESSAGE] Rendering DocumentPreview with:",
                  output
                );

                // Handle error case
                if ("error" in output) {
                  return (
                    <div
                      className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                      key={toolCallId}
                    >
                      Error creating document: {String(output.error)}
                    </div>
                  );
                }

                // Render document preview for successful creation
                return (
                  <DocumentPreview
                    isReadonly={isReadonly}
                    key={toolCallId}
                    result={output}
                  />
                );
              }

              // If output is not structured, skip rendering (will be null)
              console.log(
                "⚠️ [MESSAGE] tool-documentAgent part has no valid output, returning null"
              );
              return null;
            }

            // Handle mermaidAgent tool result - extract diagram info from output
            if (type === "tool-mermaidAgent") {
              console.log("🎨 [MESSAGE] Found tool-mermaidAgent part");
              const output = (part as any).output;
              console.log("🎨 [MESSAGE] Output:", JSON.stringify(output));

              // Check if output has diagram structure { id, title, kind }
              if (
                output &&
                typeof output === "object" &&
                output.id &&
                output.title
              ) {
                const toolCallId = output.id;
                console.log(
                  "✅ [MESSAGE] Rendering DocumentPreview (Mermaid) with:",
                  output
                );

                // Handle error case
                if ("error" in output) {
                  return (
                    <div
                      className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                      key={toolCallId}
                    >
                      Error creating diagram: {String(output.error)}
                    </div>
                  );
                }

                // Render document preview for successful creation (works for mermaid too)
                return (
                  <DocumentPreview
                    isReadonly={isReadonly}
                    key={toolCallId}
                    result={output}
                  />
                );
              }

              // If output is not structured, skip rendering (will be null)
              console.log(
                "⚠️ [MESSAGE] tool-mermaidAgent part has no valid output, returning null"
              );
              return null;
            }

            // Handle pythonAgent tool result - extract code info from output
            if (type === "tool-pythonAgent") {
              console.log("🐍 [MESSAGE] Found tool-pythonAgent part");
              const output = (part as any).output;
              console.log("🐍 [MESSAGE] Output:", JSON.stringify(output));

              // Check if output has code structure { id, title, kind }
              if (
                output &&
                typeof output === "object" &&
                output.id &&
                output.title
              ) {
                const toolCallId = output.id;
                console.log(
                  "✅ [MESSAGE] Rendering DocumentPreview (Python) with:",
                  output
                );

                // Handle error case
                if ("error" in output) {
                  return (
                    <div
                      className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                      key={toolCallId}
                    >
                      Error creating Python code: {String(output.error)}
                    </div>
                  );
                }

                // Render document preview for successful creation
                return (
                  <DocumentPreview
                    isReadonly={isReadonly}
                    key={toolCallId}
                    result={output}
                  />
                );
              }

              // If output is not structured, skip rendering (will be null)
              console.log(
                "⚠️ [MESSAGE] tool-pythonAgent part has no valid output, returning null"
              );
              return null;
            }

            if (type === "tool-getWeather") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-getWeather" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={
                          <Weather weatherAtLocation={part.output as any} />
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            if (type === "tool-createDocument") {
              const { toolCallId } = part;

              if (
                part.output &&
                typeof part.output === "object" &&
                part.output !== null &&
                "error" in part.output
              ) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error creating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <DocumentPreview
                  isReadonly={isReadonly}
                  key={toolCallId}
                  result={part.output}
                />
              );
            }

            if (type === "tool-updateDocument") {
              const { toolCallId } = part;

              if (
                part.output &&
                typeof part.output === "object" &&
                part.output !== null &&
                "error" in part.output
              ) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error updating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <div className="relative" key={toolCallId}>
                  <DocumentPreview
                    args={{ ...(part.output as any), isUpdate: true }}
                    isReadonly={isReadonly}
                    result={part.output}
                  />
                </div>
              );
            }

            if (type === "tool-requestSuggestions") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-requestSuggestions" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={
                          typeof part.output === "object" &&
                          part.output !== null &&
                          "error" in part.output ? (
                            <div className="rounded border p-2 text-red-500">
                              Error: {String(part.output.error)}
                            </div>
                          ) : (
                            <DocumentToolResult
                              isReadonly={isReadonly}
                              result={part.output as any}
                              type="request-suggestions"
                            />
                          )
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            return null;
          })}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.message.id !== nextProps.message.id) {
      return false;
    }
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding) {
      return false;
    }
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }

    return false;
  }
);

export const ThinkingMessage = () => {
  const role = "assistant";

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={role}
      data-testid="message-assistant-loading"
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      initial={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <SparklesIcon size={14} />
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="p-0 text-muted-foreground text-sm">Thinking...</div>
        </div>
      </div>
    </motion.div>
  );
};
