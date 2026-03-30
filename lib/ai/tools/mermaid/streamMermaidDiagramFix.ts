import "server-only";

import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import type { User } from "@supabase/supabase-js";
import type { UIMessageStreamWriter } from "ai";
import { streamObject } from "ai";
import { z } from "zod";
import { getDocumentById, saveDocument } from "@/lib/db/queries";
import {
  AgentOperationCategory,
  AgentOperationType,
  AgentType,
  createCorrelationId,
  PerformanceTracker,
} from "@/lib/logging/activity-logger";
import type { ChatMessage } from "@/lib/types";

/**
 * Validate Mermaid syntax (basic validation)
 */
function validateMermaidSyntax(diagram: string): boolean {
  const trimmed = diagram.trim();

  // Check for common Mermaid diagram types
  const validTypes = [
    "graph",
    "flowchart",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "erDiagram",
    "journey",
    "gantt",
    "pie",
    "gitgraph",
    "mindmap",
    "timeline",
    "sankey",
  ];

  const firstLine = trimmed.split("\n")[0].toLowerCase();
  const hasValidType = validTypes.some((type) =>
    firstLine.includes(type.toLowerCase())
  );

  // Basic syntax checks
  const hasContent = trimmed.length > 0;
  const notEmpty = trimmed !== "";

  return hasValidType && hasContent && notEmpty;
}

/**
 * Stream Mermaid diagram fix in real-time using AI SDK's streamObject
 * Fixes syntax errors in existing diagram
 */
export async function streamMermaidDiagramFix(params: {
  diagramId: string;
  errorInfo: string; // Error information from render failure
  systemPrompt: string; // System prompt from database config
  userPromptTemplate: string; // User prompt template from database config
  dataStream: UIMessageStreamWriter<ChatMessage>;
  user?: User | null;
  chatId?: string;
  modelId: string;
  apiKey?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  const {
    diagramId,
    errorInfo,
    systemPrompt,
    userPromptTemplate,
    dataStream,
    user,
    chatId,
    modelId,
    apiKey,
    metadata = {},
  } = params;

  const correlationId = createCorrelationId();
  const performanceTracker = new PerformanceTracker({
    correlation_id: correlationId,
    agent_type: AgentType.MERMAID_AGENT,
    operation_type: AgentOperationType.DIAGRAM_GENERATION,
    operation_category: AgentOperationCategory.GENERATION,
    user_id: user?.id,
  });

  console.log("🎨 [STREAM-FIX] Starting real-time diagram fix");
  console.log("🎨 [STREAM-FIX] Diagram ID:", diagramId);
  console.log("🎨 [STREAM-FIX] Model:", modelId);
  console.log("🎨 [STREAM-FIX] Correlation ID:", correlationId);

  // Get the current diagram document
  const currentDocument = await getDocumentById({ id: diagramId });
  if (!currentDocument) {
    throw new Error(`Diagram with id ${diagramId} not found`);
  }

  console.log(
    "🎨 [STREAM-FIX] Current version:",
    currentDocument.version_number
  );
  console.log(
    "🎨 [STREAM-FIX] Current content length:",
    currentDocument.content?.length || 0
  );

  // Write artifact metadata to inform UI
  dataStream.write({
    type: "data-kind",
    data: "mermaid code",
    transient: true,
  });

  dataStream.write({
    type: "data-id",
    data: diagramId,
    transient: true,
  });

  dataStream.write({
    type: "data-title",
    data: currentDocument.title || "Untitled Diagram",
    transient: true,
  });

  dataStream.write({
    type: "data-clear",
    data: null,
    transient: true,
  });

  console.log("🎨 [STREAM-FIX] Metadata written, starting LLM generation");

  // Get the Google model instance with proper API key handling
  let model;
  if (apiKey) {
    const googleProvider = createGoogleGenerativeAI({ apiKey });
    model = googleProvider(modelId);
  } else {
    model = google(modelId); // Fallback to environment variable
  }

  // Build the prompt for diagram fix using template from config
  const prompt = userPromptTemplate
    .replace("{currentContent}", currentDocument.content || "")
    .replace("{errorInfo}", errorInfo);

  try {
    // Use streamObject for structured diagram fixes (migrate to streamText output:object post-install)
    const { partialObjectStream } = streamObject({
      model,
      system: systemPrompt,
      prompt,
      schema: z.object({
        diagram: z
          .string()
          .describe(
            "Fixed Mermaid diagram with valid syntax and proper formatting"
          ),
      }),
    });

    console.log("🎨 [STREAM-FIX] LLM streaming started");

    // Accumulate content as it streams
    let fixedContent = "";
    let chunkCount = 0;

    // Stream content in real-time as LLM generates it
    for await (const partialObject of partialObjectStream) {
      if (partialObject.diagram) {
        fixedContent = partialObject.diagram;
        chunkCount++;

        // Write each delta immediately to the client
        dataStream.write({
          type: "data-codeDelta",
          data: fixedContent, // Replace entire content
          transient: true,
        });
      }
    }

    console.log("🎨 [STREAM-FIX] LLM generation complete");
    console.log("🎨 [STREAM-FIX] Fixed content length:", fixedContent.length);
    console.log("🎨 [STREAM-FIX] Total chunks streamed:", chunkCount);

    // Validate Mermaid syntax before saving
    if (!validateMermaidSyntax(fixedContent)) {
      throw new Error("Fixed diagram still contains invalid Mermaid syntax");
    }

    // Save fixed diagram as new version
    if (user?.id) {
      console.log("🎨 [STREAM-FIX] Saving to database as new version");
      await saveDocument({
        id: diagramId,
        title: currentDocument.title || "Untitled Diagram",
        content: fixedContent,
        kind: "mermaid code",
        userId: user.id,
        chatId,
        parentVersionId: currentDocument.id,
        metadata: {
          ...metadata,
          updateType: "fix",
          agent: "GoogleMermaidAgentStreaming",
          fixedAt: new Date().toISOString(),
          modelUsed: modelId,
          previousVersion: currentDocument.version_number,
          errorFixed: errorInfo,
        },
      });
      console.log("✅ [STREAM-FIX] Saved to database");
    } else {
      console.log("⚠️ [STREAM-FIX] No user provided, skipping database save");
    }

    // Signal streaming complete
    dataStream.write({
      type: "data-finish",
      data: null,
      transient: true,
    });

    console.log("✅ [STREAM-FIX] Diagram fix completed successfully");

    // Log success
    await performanceTracker.end({
      success: true,
      model_id: modelId,
      resource_id: diagramId,
      resource_type: "diagram",
      operation_metadata: {
        operation_type: "fix",
        instruction_length: errorInfo.length,
        streaming: true,
        tool_name: "streamMermaidDiagramFix",
        chat_id: chatId,
        output_length: fixedContent.length,
        chunk_count: chunkCount,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("❌ [STREAM-FIX] Fix failed:", errorMessage);

    // Log failure
    await performanceTracker.end({
      success: false,
      error_message: errorMessage,
      error_type: error instanceof Error ? error.name : "UnknownError",
      model_id: modelId,
      resource_id: diagramId,
      resource_type: "diagram",
      operation_metadata: {
        operation_type: "fix",
        instruction_length: errorInfo.length,
        streaming: true,
        tool_name: "streamMermaidDiagramFix",
        chat_id: chatId,
      },
    });

    // Write error to stream
    dataStream.write({
      type: "data-finish",
      data: null,
      transient: true,
    });

    throw new Error(`Failed to fix diagram: ${errorMessage}`);
  }
}
