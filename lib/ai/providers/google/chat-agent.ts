import "server-only";

import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import {
  AgentOperationCategory,
  AgentOperationType,
  AgentType,
  createCorrelationId,
  logAgentActivity,
  PerformanceTracker,
} from "@/lib/logging/activity-logger";
import { AgentError, ErrorCodes } from "../../core/errors";
import type { ChatModelAgentConfig, ChatParams } from "../../core/types";
import { AgentConfigLoader } from "./agentConfigLoader";
import { AgentToolBuilder } from "./agentToolBuilder";

/**
 * Model configuration interface for chat agent
 */
type ModelConfig = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  isDefault?: boolean;
  thinkingEnabled?: boolean;
  supportsThinkingMode?: boolean;
  fileInputEnabled?: boolean;
  allowedFileTypes?: string[];
};

/**
 * Google Chat Agent implementation using Google AI SDK
 * Handles streaming responses with thinking mode integration
 * This is the main orchestrator agent that communicates with users
 */
export class GoogleChatAgent {
  private apiKey?: string;
  private readonly config: ChatModelAgentConfig;
  private googleProvider?: ReturnType<typeof createGoogleGenerativeAI>;
  private readonly configLoader: AgentConfigLoader;
  private readonly toolBuilder: AgentToolBuilder;

  constructor(config: ChatModelAgentConfig) {
    this.config = config;
    this.configLoader = new AgentConfigLoader();
    this.toolBuilder = new AgentToolBuilder(config, this.configLoader);
    this.validateConfig();
  }

  /**
   * Set the Google API key for this agent instance
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.googleProvider = createGoogleGenerativeAI({
      apiKey,
    });
    this.configLoader.setApiKey(apiKey);
  }

  /**
   * Load provider tools agent configuration
   * Public method so it can be called before building tools
   */
  async loadProviderToolsConfig() {
    return this.configLoader.loadProviderToolsConfig();
  }

  /**
   * Load document agent configuration
   * Public method so it can be called before building tools
   */
  async loadDocumentAgentConfig() {
    return this.configLoader.loadDocumentAgentConfig();
  }

  /**
   * Load mermaid agent configuration
   * Public method so it can be called before building tools
   */
  async loadMermaidAgentConfig() {
    return this.configLoader.loadMermaidAgentConfig();
  }

  /**
   * Load python agent configuration
   * Public method so it can be called before building tools
   */
  async loadPythonAgentConfig() {
    return this.configLoader.loadPythonAgentConfig();
  }

  /**
   * Load GitHub MCP agent configuration
   * Public method so it can be called before building tools
   */
  async loadGitMcpAgentConfig() {
    return this.configLoader.loadGitMcpAgentConfig();
  }

  /**
   * Set GitHub Personal Access Token for MCP agent
   * Call this to enable GitHub operations
   */
  setGitHubPAT(pat: string) {
    this.configLoader.setGitHubPAT(pat);
  }

  /**
   * Set the model for provider tools agent
   * Call this before building tools to ensure provider tools use the same model
   */
  setProviderToolsModel(modelId: string) {
    this.configLoader.setProviderToolsModel(modelId);
  }

  /**
   * Set the model for document agent
   * Call this before building tools to ensure document agent uses the same model
   */
  setDocumentAgentModel(modelId: string) {
    this.configLoader.setDocumentAgentModel(modelId);
  }

  /**
   * Set the model for mermaid agent
   * Call this before building tools to ensure mermaid agent uses the same model
   */
  setMermaidAgentModel(modelId: string) {
    this.configLoader.setMermaidAgentModel(modelId);
  }

  /**
   * Set the model for python agent
   * Call this before building tools to ensure python agent uses the same model
   */
  setPythonAgentModel(modelId: string) {
    this.configLoader.setPythonAgentModel(modelId);
  }

  /**
   * Set the model for GitHub MCP agent
   * Call this before building tools to ensure GitHub MCP agent uses the same model
   */
  setGitMcpAgentModel(modelId: string) {
    this.configLoader.setGitMcpAgentModel(modelId);
  }

  /**
   * Generate streaming chat response using AI SDK
   * This method handles all provider-specific logic including:
   * - Loading specialized agents
   * - Building tools
   * - Configuring thinking mode
   * - Creating UI message stream
   */
  async chat(
    params: ChatParams & {
      chatId: string;
      onFinish?: (event: { messages: any[] }) => Promise<void>;
      generateId?: () => string;
    }
  ) {
    const correlationId = createCorrelationId();
    const tracker = new PerformanceTracker({
      correlation_id: correlationId,
      agent_type: AgentType.CHAT_MODEL_AGENT,
      operation_type: AgentOperationType.STREAMING,
      operation_category: AgentOperationCategory.STREAMING,
      user_id: params.user?.id,
    });

    try {
      const {
        streamText,
        createUIMessageStream,
        JsonToSseTransformStream,
        stepCountIs,
      } = await import("ai");

      // Load specialized agent configurations
      await this.loadProviderToolsConfig();
      await this.loadDocumentAgentConfig();
      await this.loadMermaidAgentConfig();
      await this.loadPythonAgentConfig();
      await this.loadGitMcpAgentConfig();

      // Set the selected model for specialized agents (same model as chat)
      this.setProviderToolsModel(params.modelId);
      this.setDocumentAgentModel(params.modelId);
      this.setMermaidAgentModel(params.modelId);
      this.setPythonAgentModel(params.modelId);
      this.setGitMcpAgentModel(params.modelId);

      // Check if thinking mode is supported by the selected model
      const modelSupportsThinking = this.supportsThinking(params.modelId);
      const shouldEnableThinking = params.thinkingMode && modelSupportsThinking;

      // Log chat operation start
      await logAgentActivity({
        agent_type: AgentType.CHAT_MODEL_AGENT,
        operation_type: AgentOperationType.STREAMING,
        operation_category: AgentOperationCategory.STREAMING,
        correlation_id: correlationId,
        user_id: params.user?.id,
        duration_ms: tracker.getDuration(),
        operation_metadata: {
          model_id: params.modelId,
          thinking_mode: shouldEnableThinking,
          message_count: params.messages.length,
          tools_enabled: true,
          chat_id: params.chatId,
        },
      });

      // Create proper UI message stream using AI SDK
      const stream = createUIMessageStream({
        execute: ({ writer: dataStream }) => {
          // Use streamText directly with Google model from chat agent
          const model = this.getModel(params.modelId);

          // Use system prompt directly from config (all tool descriptions are in database)
          const systemPrompt = this.config.systemPrompt;

          // Build tools from chat agent (includes provider tools and document agent if enabled)
          const tools = this.toolBuilder.buildTools(
            dataStream,
            params.user,
            params.chatId
          );

          // Add artifact context to the first user message if available
          const messages = params.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }));

          // Inject artifact context into the latest user message
          if (params.artifactContext && messages.length > 0) {
            const lastMessage = messages.at(-1);
            if (lastMessage && lastMessage.role === "user") {
              lastMessage.content += params.artifactContext;
            }
          }

          // Configure stream with Google's thinking config if enabled
          const streamConfig: any = {
            model,
            system: systemPrompt,
            messages,
            temperature: 0.7,
            maxRetries: 0, // Fail immediately on quota/rate-limit errors instead of retrying
          };

          // Add tools if available
          if (tools) {
            streamConfig.tools = tools;
            // Enable multi-step execution with stopWhen - this allows the model to:
            // 1. Call tools
            // 2. Receive tool results
            // 3. Generate a final response using those results
            streamConfig.stopWhen = stepCountIs(5); // Stop after 5 steps (tool calls + responses)
            console.log(
              "🔧 [CHAT-AGENT] Multi-step execution enabled with stopWhen"
            );
          }

          // Add Google-specific thinking configuration
          if (shouldEnableThinking) {
            streamConfig.providerOptions = {
              google: {
                thinkingConfig: {
                  thinkingBudget: 8192,
                  includeThoughts: true,
                },
              },
            };
          }

          console.log(
            "🚀 [CHAT-AGENT] Starting streamText with tools:",
            tools ? Object.keys(tools) : "none"
          );
          console.log(
            "🚀 [CHAT-AGENT] Thinking mode enabled:",
            shouldEnableThinking
          );

          const result = streamText(streamConfig);

          // Merge the AI stream into the UI message stream with reasoning enabled
          // The AI SDK will handle tool execution and streaming automatically
          dataStream.merge(
            result.toUIMessageStream({
              sendReasoning: shouldEnableThinking,
            })
          );
        },
        generateId: params.generateId,
        onFinish: async (event) => {
          if (params.onFinish) {
            await params.onFinish({ messages: event.messages });
          }
        },
        onError: (error) => {
          const msg = error instanceof Error ? error.message : String(error);
          if (
            msg.includes("429") ||
            msg.toLowerCase().includes("quota") ||
            msg.toLowerCase().includes("resource_exhausted") ||
            msg.toLowerCase().includes("rate limit")
          ) {
            return "Google AI quota exceeded. Please try again later or upgrade your plan.";
          }
          return msg || "Oops, an error occurred!";
        },
      });

      // Return direct streaming response
      return new Response(stream.pipeThrough(new JsonToSseTransformStream()), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, x-google-api-key",
        },
      });
    } catch (error) {
      console.error("Google Chat Agent error:", error);

      // Log chat operation failure
      await tracker.end({
        success: false,
        error_message: error instanceof Error ? error.message : String(error),
        operation_metadata: {
          model_id: params.modelId,
          thinking_mode: params.thinkingMode,
          message_count: params.messages.length,
          chat_id: params.chatId,
        },
      });

      throw error;
    }
  }

  /**
   * Get the appropriate Google model instance
   */
  getModel(modelId: string): LanguageModel {
    if (this.googleProvider) {
      return this.googleProvider(modelId);
    }

    // Fallback to environment variable if no API key is set
    return google(modelId);
  }

  /**
   * Get model configuration by ID
   */
  private getModelConfig(modelId: string): any | undefined {
    return this.config.availableModels?.find((model) => model.id === modelId);
  }

  /**
   * Check if a model supports thinking mode
   */
  supportsThinking(modelId: string): boolean {
    const modelConfig = this.getModelConfig(modelId);
    return (
      modelConfig?.thinkingEnabled || modelConfig?.supportsThinkingMode || false
    );
  }

  /**
   * Validate the agent configuration
   */
  private validateConfig(): void {
    if (!this.config) {
      throw new AgentError(
        "google-chat",
        ErrorCodes.INVALID_CONFIGURATION,
        "Chat agent configuration is required"
      );
    }

    if (!this.config.enabled) {
      throw new AgentError(
        "google-chat",
        ErrorCodes.AGENT_DISABLED,
        "Google chat agent is disabled"
      );
    }

    // Validate that at least one model is enabled (if availableModels is provided)
    if (this.config.availableModels) {
      const enabledModels = this.config.availableModels.filter(
        (model) => model.enabled
      );
      if (enabledModels.length === 0) {
        throw new AgentError(
          "google-chat",
          ErrorCodes.INVALID_CONFIGURATION,
          "No enabled models found for Google chat agent"
        );
      }
    }
  }

  /**
   * Get available models for this agent
   */
  getAvailableModels(): ModelConfig[] {
    if (!this.config.availableModels) {
      return [];
    }
    return this.config.availableModels.filter(
      (model) => model.enabled
    ) as ModelConfig[];
  }

  /**
   * Get the default model for this agent
   */
  getDefaultModel(): ModelConfig | null {
    const availableModels = this.getAvailableModels();
    return (
      availableModels.find((model) => model.isDefault) ||
      availableModels[0] ||
      null
    );
  }

  /**
   * Check if file input is supported
   */
  supportsFileInput(modelId?: string): boolean {
    if (modelId) {
      const modelConfig = this.getModelConfig(modelId);
      if (modelConfig?.fileInputEnabled !== undefined) {
        return modelConfig.fileInputEnabled;
      }
    }

    // Fall back to provider-level settings (use optional chaining for AgentConfig)
    return (
      (this.config as any).fileInputEnabled ||
      (this.config as any).capabilities?.fileInput ||
      false
    );
  }

  /**
   * Get allowed file types
   */
  getAllowedFileTypes(modelId?: string): string[] {
    if (modelId) {
      const modelConfig = this.getModelConfig(modelId);
      if (modelConfig?.allowedFileTypes) {
        return modelConfig.allowedFileTypes;
      }
    }

    // Fall back to provider-level settings (use type assertion for optional properties)
    const configWithExtras = this.config as any;

    if (configWithExtras.allowedFileTypes) {
      return configWithExtras.allowedFileTypes;
    }

    // Extract from fileInputTypes structure
    if (configWithExtras.fileInputTypes) {
      const allowedTypes: string[] = [];

      Object.entries(configWithExtras.fileInputTypes).forEach(
        ([category, types]: [string, any]) => {
          if (category === "images" && types.enabled) {
            allowedTypes.push("image/*");
          } else if (category === "pdf" && types.enabled) {
            allowedTypes.push("application/pdf");
          } else if (typeof types === "object" && types !== null) {
            Object.entries(types).forEach(([ext, config]: [string, any]) => {
              if (config.enabled) {
                allowedTypes.push(ext);
              }
            });
          }
        }
      );

      return allowedTypes;
    }

    return [];
  }
}
