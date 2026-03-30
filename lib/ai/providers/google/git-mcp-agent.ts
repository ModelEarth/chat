import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { stepCountIs, streamText } from "ai";
import {
  AgentOperationCategory,
  AgentOperationType,
  AgentType,
  createCorrelationId,
  logAgentActivity,
  PerformanceTracker,
} from "@/lib/logging/activity-logger";
import type { AgentResult, GitMcpAgentConfig } from "@/lib/types";

export class GoogleGitMcpAgent {
  private readonly config: GitMcpAgentConfig;
  private githubPAT?: string;
  private modelId?: string;
  private googleProvider?: any;

  constructor(config: GitMcpAgentConfig) {
    this.config = config;
    this.validateConfig();
  }

  /**
   * Validates the agent configuration
   */
  private validateConfig(): void {
    if (!this.config.systemPrompt) {
      throw new Error("GitMcpAgent: systemPrompt is required in configuration");
    }
    if (!this.config.rateLimit) {
      throw new Error("GitMcpAgent: rateLimit is required in configuration");
    }
  }

  /**
   * Sets the GitHub Personal Access Token for authentication
   */
  setApiKey(pat: string): void {
    if (!pat || pat.trim() === "") {
      throw new Error("GitMcpAgent: GitHub PAT cannot be empty");
    }
    this.githubPAT = pat;
  }

  /**
   * Sets the model ID for the agent
   */
  setModel(modelId: string): void {
    if (!modelId || modelId.trim() === "") {
      throw new Error("GitMcpAgent: Model ID cannot be empty");
    }
    this.modelId = modelId;
  }

  /**
   * Sets the Google API key and initializes the provider
   */
  setGoogleApiKey(apiKey: string): void {
    if (!apiKey || apiKey.trim() === "") {
      throw new Error("GitMcpAgent: Google API key cannot be empty");
    }
    this.googleProvider = createGoogleGenerativeAI({ apiKey });
  }

  /**
   * Gets the configured model instance
   */
  private getModel(): any {
    if (!this.googleProvider) {
      throw new Error(
        "GitMcpAgent: Google provider not initialized. Call setGoogleApiKey first."
      );
    }
    if (!this.modelId) {
      throw new Error("GitMcpAgent: Model ID not set. Call setModel first.");
    }
    return this.googleProvider(this.modelId);
  }

  /**
   * Executes a GitHub operation via native MCP tools (@ai-sdk/mcp)
   */
  async execute(params: {
    input: string;
    userId?: string;
  }): Promise<AgentResult> {
    const { input, userId } = params;
    const correlationId = createCorrelationId();
    const tracker = new PerformanceTracker({
      correlation_id: correlationId,
      agent_type: AgentType.GIT_MCP_AGENT,
      operation_type: AgentOperationType.MCP_OPERATION,
      operation_category: AgentOperationCategory.TOOL_USE,
      user_id: userId,
    });

    console.log(`\n${"=".repeat(80)}`);
    console.log("🎯 [GIT-MCP-AGENT] EXECUTION START");
    console.log("=".repeat(80));
    console.log("📥 [USER-INPUT] Query received from Chat Agent:");
    console.log("   ", input);
    console.log("-".repeat(80));

    if (!input || input.trim() === "") {
      console.log("❌ [GIT-MCP-AGENT] Empty input error");

      await logAgentActivity({
        agent_type: AgentType.GIT_MCP_AGENT,
        operation_type: AgentOperationType.MCP_OPERATION,
        operation_category: AgentOperationCategory.TOOL_USE,
        correlation_id: correlationId,
        user_id: userId,
        success: false,
        duration_ms: tracker.getDuration(),
        error_message: "Empty input",
        operation_metadata: {
          query_length: 0,
          tool_calls_count: 0,
          mcp_connection_status: "not_attempted",
        },
      });

      return {
        output: "Error: Input query cannot be empty",
        success: false,
        error: "Empty input",
      };
    }

    if (!this.githubPAT) {
      throw new Error("GitMcpAgent: GitHub PAT not set. Call setApiKey first.");
    }

    // Use readonly mode for safety — restricts to read-only GitHub operations
    const endpoint = "https://api.githubcopilot.com/mcp/x/all/readonly";

    console.log("🔗 [MCP-CONNECTION] Connecting to GitHub MCP Server");
    console.log("   Endpoint:", endpoint);
    console.log("   Mode: readonly (read-only operations)");

    // Create the @ai-sdk/mcp client with StreamableHTTP transport
    const mcpClient = await createMCPClient({
      transport: new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${this.githubPAT}`,
            "X-MCP-Readonly": "true",
          },
        },
      }),
      name: "github-mcp-agent",
      version: "1.0.0",
    });

    console.log(
      "✅ [MCP-CONNECTION] Connected successfully via Streamable HTTP transport"
    );

    try {
      // Native tool discovery — @ai-sdk/mcp returns AI SDK-compatible tools directly
      console.log(
        "🔍 [MCP-CLIENT] Discovering available tools from MCP server..."
      );
      const tools = await mcpClient.tools();
      const toolNames = Object.keys(tools);

      console.log("✅ [MCP-CLIENT] Tool discovery complete");
      console.log("📋 [MCP-CLIENT] Available tools count:", toolNames.length);
      console.log(
        "📋 [MCP-CLIENT] Tool names:",
        toolNames.slice(0, 10).join(", "),
        "..."
      );

      // Stream text with the native MCP tools
      console.log("🤖 [GEMINI-MODEL] Starting AI model execution...");
      console.log("🎛️  [GEMINI-MODEL] Model:", this.modelId);
      console.log("🎛️  [GEMINI-MODEL] Temperature: 0.3");
      console.log("🎛️  [GEMINI-MODEL] Max steps: 5");
      console.log(
        "📝 [GEMINI-MODEL] System prompt length:",
        this.config.systemPrompt.length,
        "chars"
      );
      console.log(
        "📝 [GEMINI-MODEL] User query:",
        input.substring(0, 100) + (input.length > 100 ? "..." : "")
      );
      console.log("-".repeat(80));

      const result = streamText({
        model: this.getModel(),
        system: this.config.systemPrompt,
        prompt: input,
        tools,
        stopWhen: stepCountIs(5),
        temperature: 0.3,
      });

      // Collect the response
      console.log("📡 [STREAM] Processing model output stream...");
      let fullOutput = "";
      let stepCount = 0;
      const toolCalls: Array<{
        toolName: string;
        args: Record<string, any>;
        result: any;
      }> = [];

      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          const text = (chunk as any).textDelta || (chunk as any).text || "";
          fullOutput += text;
          if (text.length > 0) {
            const preview = text.substring(0, 50).replace(/\n/g, "↵");
            console.log(
              "💬 [MODEL-OUTPUT] Text chunk:",
              preview + (text.length > 50 ? "..." : "")
            );
          }
        } else if (chunk.type === "tool-call") {
          stepCount++;
          console.log(`\n${"─".repeat(80)}`);
          console.log(
            `🔧 [TOOL-CALL] Step ${stepCount}: Model decided to call tool`
          );
          console.log("   Tool name:", chunk.toolName);
          const args = (chunk as any).input || {};
          const argsStr = JSON.stringify(args, null, 2);
          const formattedArgs = argsStr
            .split("\n")
            .map((line: string, i: number) =>
              i === 0 ? line : `              ${line}`
            )
            .join("\n");
          console.log("   Arguments:", formattedArgs);
          console.log("─".repeat(80));
          toolCalls.push({ toolName: chunk.toolName, args, result: null });
        } else if (chunk.type === "tool-result") {
          console.log("📥 [TOOL-RESULT] Received result from MCP server");
          const output = (chunk as any).output || {};
          const resultStr = JSON.stringify(output);
          console.log(
            "   Result preview:",
            resultStr.substring(0, 200) + (resultStr.length > 200 ? "..." : "")
          );
          console.log("   Result length:", resultStr.length, "chars");
          const lastCall = toolCalls.at(-1);
          if (lastCall) {
            lastCall.result = output;
          }
        } else if (chunk.type === "start-step") {
          console.log(`\n🚀 [STEP-START] Model starting step ${stepCount + 1}`);
        } else if (chunk.type === "finish-step") {
          console.log(`✓ [STEP-FINISH] Step ${stepCount} completed`);
        }
      }

      console.log(`\n${"=".repeat(80)}`);
      console.log("✅ [GIT-MCP-AGENT] EXECUTION COMPLETE");
      console.log("=".repeat(80));
      console.log("📊 [SUMMARY] Total tool calls made:", toolCalls.length);
      console.log("📊 [SUMMARY] Total steps executed:", stepCount);
      console.log("📊 [SUMMARY] Output length:", fullOutput.length, "chars");

      if (toolCalls.length > 0) {
        console.log("📋 [SUMMARY] Tools used:");
        toolCalls.forEach((call, index) => {
          console.log(`   ${index + 1}. ${call.toolName}`);
          const argsStr = JSON.stringify(call.args || {});
          console.log(
            `      Args: ${argsStr.substring(0, 100)}${argsStr.length > 100 ? "..." : ""}`
          );
        });
      }
      console.log(`${"=".repeat(80)}\n`);

      const finalOutput =
        fullOutput.trim() || "Operation completed successfully";

      console.log("📤 [RETURN-TO-CHAT] Sending response back to Chat Agent:");
      console.log("   Output length:", finalOutput.length, "chars");
      console.log(
        "   First 200 chars:",
        finalOutput.substring(0, 200) + (finalOutput.length > 200 ? "..." : "")
      );

      await logAgentActivity({
        agent_type: AgentType.GIT_MCP_AGENT,
        operation_type: AgentOperationType.MCP_OPERATION,
        operation_category: AgentOperationCategory.TOOL_USE,
        correlation_id: correlationId,
        user_id: userId,
        success: true,
        duration_ms: tracker.getDuration(),
        operation_metadata: {
          query_length: input.length,
          tool_calls_count: toolCalls.length,
          mcp_connection_status: "connected",
          output_length: finalOutput.length,
          tools_used: toolCalls.map((tc) => tc.toolName).join(", "),
        },
      });

      return {
        output: finalOutput,
        success: true,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      console.error(`\n${"=".repeat(80)}`);
      console.error("❌ [GIT-MCP-AGENT] EXECUTION ERROR");
      console.error("=".repeat(80));
      console.error("Error details:", error);
      console.error(`${"=".repeat(80)}\n`);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await logAgentActivity({
        agent_type: AgentType.GIT_MCP_AGENT,
        operation_type: AgentOperationType.MCP_OPERATION,
        operation_category: AgentOperationCategory.TOOL_USE,
        correlation_id: correlationId,
        user_id: userId,
        success: false,
        duration_ms: tracker.getDuration(),
        error_message: errorMessage,
        operation_metadata: {
          query_length: input.length,
          tool_calls_count: 0,
          mcp_connection_status: "error",
        },
      });

      return {
        output: `Error executing GitHub operation: ${errorMessage}`,
        success: false,
        error: errorMessage,
      };
    } finally {
      // Always close the MCP client connection
      console.log("🧹 [MCP-CLIENT] Closing connection...");
      await mcpClient.close();
      console.log("✅ [MCP-CLIENT] Connection closed");
    }
  }

  /**
   * Gets the agent configuration
   */
  getConfig(): GitMcpAgentConfig {
    return this.config;
  }

  /**
   * Checks if the agent is properly configured
   */
  isReady(): boolean {
    return !!(
      this.config &&
      this.githubPAT &&
      this.modelId &&
      this.googleProvider
    );
  }
}
