import postgres from "postgres";
import { loadEnvironment } from "../env-loader";

loadEnvironment();

type VerificationResult = {
  category: string;
  passed: boolean;
  details: string[];
};

const verifyMigration = async (): Promise<void> => {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not defined");
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const results: VerificationResult[] = [];

  console.log("🔍 Starting Database Verification...");
  console.log("");

  try {
    // 1. Verify Tables
    console.log("Checking tables...");
    const expectedTables = [
      "Chat",
      "Message_v2",
      "Vote_v2",
      "Document",
      "Suggestion",
      "Stream",
      "admin_config",
      "model_config",
      "usage_logs",
      "rate_limit_tracking",
      "github_repositories",
      "error_logs",
    ];

    const tableResult: VerificationResult = {
      category: "Tables",
      passed: true,
      details: [],
    };

    for (const table of expectedTables) {
      try {
        const result = await connection`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = ${table}
          )
        `;

        if (!result[0]?.exists) {
          tableResult.passed = false;
          tableResult.details.push(`❌ Table "${table}" is missing`);
        }
      } catch (error) {
        tableResult.passed = false;
        tableResult.details.push(
          `❌ Error checking table "${table}": ${error}`
        );
      }
    }

    if (tableResult.passed && tableResult.details.length === 0) {
      tableResult.details.push("✅ All expected tables exist");
    }
    results.push(tableResult);

    // 2. Verify Functions
    console.log("Checking functions...");
    const expectedFunctions = [
      "get_user_role",
      "validate_user_id",
      "handle_auth_user_deletion",
      "get_current_user_usage_summary",
      "is_current_user_admin",
      "update_admin_config_timestamp",
      "update_model_config_timestamp",
      "ensure_single_default_model_per_provider",
      "validate_admin_config_data",
    ];

    const functionResult: VerificationResult = {
      category: "Functions",
      passed: true,
      details: [],
    };

    for (const func of expectedFunctions) {
      try {
        const result = await connection`
          SELECT EXISTS (
            SELECT FROM information_schema.routines 
            WHERE routine_schema = 'public' 
            AND routine_name = ${func}
          )
        `;

        if (!result[0]?.exists) {
          functionResult.passed = false;
          functionResult.details.push(`❌ Function "${func}" is missing`);
        }
      } catch (error) {
        functionResult.passed = false;
        functionResult.details.push(
          `❌ Error checking function "${func}": ${error}`
        );
      }
    }

    if (functionResult.passed && functionResult.details.length === 0) {
      functionResult.details.push("✅ All expected functions exist");
    }
    results.push(functionResult);

    // 3. Verify Indexes
    console.log("Checking indexes...");
    const expectedIndexes = [
      "idx_chat_user_id",
      "idx_chat_user_created",
      "idx_message_chat",
      "idx_document_user_id",
      "idx_usage_logs_user_id",
      "idx_usage_logs_user_timestamp",
      "idx_rate_limit_user_agent",
      "idx_github_repos_user_id",
      "idx_error_logs_user_id",
      "idx_admin_config_key",
      "idx_model_config_model_id",
      "idx_model_config_provider",
    ];

    const indexResult: VerificationResult = {
      category: "Indexes",
      passed: true,
      details: [],
    };

    for (const index of expectedIndexes) {
      try {
        const result = await connection`
          SELECT EXISTS (
            SELECT FROM pg_indexes 
            WHERE schemaname = 'public' 
            AND indexname = ${index}
          )
        `;

        if (!result[0]?.exists) {
          indexResult.passed = false;
          indexResult.details.push(`❌ Index "${index}" is missing`);
        }
      } catch (error) {
        indexResult.passed = false;
        indexResult.details.push(
          `❌ Error checking index "${index}": ${error}`
        );
      }
    }

    if (indexResult.passed && indexResult.details.length === 0) {
      indexResult.details.push("✅ All expected indexes exist");
    }
    results.push(indexResult);

    // 4. Verify Triggers
    console.log("Checking triggers...");
    const expectedTriggers = [
      { table: "Chat", trigger: "validate_chat_user_id" },
      { table: "Document", trigger: "validate_document_user_id" },
      { table: "admin_config", trigger: "trigger_admin_config_updated_at" },
      { table: "model_config", trigger: "trigger_model_config_updated_at" },
      { table: "model_config", trigger: "trigger_ensure_single_default_model" },
    ];

    const triggerResult: VerificationResult = {
      category: "Triggers",
      passed: true,
      details: [],
    };

    for (const { table, trigger } of expectedTriggers) {
      try {
        const result = await connection`
          SELECT EXISTS (
            SELECT FROM information_schema.triggers 
            WHERE event_object_schema = 'public' 
            AND event_object_table = ${table}
            AND trigger_name = ${trigger}
          )
        `;

        if (!result[0]?.exists) {
          triggerResult.passed = false;
          triggerResult.details.push(
            `❌ Trigger "${table}.${trigger}" is missing`
          );
        }
      } catch (error) {
        triggerResult.passed = false;
        triggerResult.details.push(
          `❌ Error checking trigger "${table}.${trigger}": ${error}`
        );
      }
    }

    if (triggerResult.passed && triggerResult.details.length === 0) {
      triggerResult.details.push("✅ All expected triggers exist");
    }
    results.push(triggerResult);

    // 5. Verify RLS Policies
    console.log("Checking RLS policies...");
    const expectedPolicies = [
      { table: "Chat", policy: "Users can read own chats" },
      { table: "admin_config", policy: "Admins can read admin_config" },
      {
        table: "model_config",
        policy: "Authenticated users can read model_config",
      },
      { table: "usage_logs", policy: "Users can read own usage_logs" },
      { table: "error_logs", policy: "System can insert error_logs" },
    ];

    const policyResult: VerificationResult = {
      category: "RLS Policies",
      passed: true,
      details: [],
    };

    for (const { table, policy } of expectedPolicies) {
      try {
        const result = await connection`
          SELECT EXISTS (
            SELECT FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename = ${table}
            AND policyname = ${policy}
          )
        `;

        if (!result[0]?.exists) {
          policyResult.passed = false;
          policyResult.details.push(
            `❌ Policy "${policy}" missing on "${table}"`
          );
        }
      } catch (error) {
        policyResult.passed = false;
        policyResult.details.push(
          `❌ Error checking policy "${policy}" on "${table}": ${error}`
        );
      }
    }

    if (policyResult.passed && policyResult.details.length === 0) {
      policyResult.details.push("✅ All expected RLS policies exist");
    }
    results.push(policyResult);

    // 6. Verify Seed Data
    console.log("Checking seed data...");
    const seedResult: VerificationResult = {
      category: "Seed Data",
      passed: true,
      details: [],
    };

    try {
      const configCount = await connection`
        SELECT COUNT(*) as count FROM admin_config
      `;

      const count = Number.parseInt(configCount[0]?.count || "0", 10);
      if (count === 0) {
        seedResult.passed = false;
        seedResult.details.push("❌ No admin configurations found");
      } else {
        seedResult.details.push(`✅ Found ${count} admin configurations`);

        // Check for app_settings
        const appSettings = await connection`
          SELECT EXISTS (
            SELECT FROM admin_config 
            WHERE config_key = 'app_settings'
          )
        `;

        if (appSettings[0]?.exists) {
          seedResult.details.push("✅ App settings configuration exists");
        } else {
          seedResult.passed = false;
          seedResult.details.push("❌ App settings configuration missing");
        }

        // Check for provider configs (agents only, not model configs)
        const googleConfigs = await connection`
          SELECT COUNT(*) as count FROM admin_config
          WHERE config_key LIKE '%_agent_google'
        `;

        const googleCount = Number.parseInt(googleConfigs[0]?.count || "0", 10);
        const expectedGoogleConfigs = 6; // chat_model, provider_tools, document, python, mermaid, git_mcp

        if (googleCount === expectedGoogleConfigs) {
          seedResult.details.push(
            `✅ Found ${googleCount} Google provider configurations`
          );
        } else {
          seedResult.passed = false;
          seedResult.details.push(
            `❌ Expected ${expectedGoogleConfigs} Google configs, found ${googleCount}`
          );
        }

        // Check for specific Google agent configs
        const expectedGoogleAgents = [
          "chat_model_agent_google",
          "provider_tools_agent_google",
          "document_agent_google",
          "python_agent_google",
          "mermaid_agent_google",
          "git_mcp_agent_google",
        ];

        for (const agentKey of expectedGoogleAgents) {
          const exists = await connection`
            SELECT EXISTS (
              SELECT FROM admin_config
              WHERE config_key = ${agentKey}
            )
          `;

          if (!exists[0]?.exists) {
            seedResult.passed = false;
            seedResult.details.push(
              `❌ Missing Google agent config: ${agentKey}`
            );
          }
        }

        // Verify document_agent_google has new structure
        const documentAgentConfig = await connection`
          SELECT config_data FROM admin_config
          WHERE config_key = 'document_agent_google'
        `;

        if (documentAgentConfig.length > 0) {
          const configData = documentAgentConfig[0].config_data as any;

          // Check for new tools-based structure
          if (
            configData.tools?.create &&
            configData.tools.update &&
            configData.tools.suggestion &&
            configData.tools.revert
          ) {
            seedResult.details.push(
              "✅ Document agent has new tools structure (create, update, suggestion, revert)"
            );
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ Document agent missing new tools structure"
            );
          }

          // Check for tool-specific prompts
          if (
            configData.tools?.create?.systemPrompt &&
            configData.tools?.update?.systemPrompt
          ) {
            seedResult.details.push(
              "✅ Document agent tools have systemPrompts"
            );
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ Document agent tools missing systemPrompts"
            );
          }

          // Check for rateLimit
          if (
            configData.rateLimit?.perMinute &&
            configData.rateLimit.perHour &&
            configData.rateLimit.perDay
          ) {
            seedResult.details.push(
              "✅ Document agent has rateLimit configuration"
            );
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ Document agent missing rateLimit configuration"
            );
          }
        }

        // Verify python_agent_google has new structure
        const pythonAgentConfig = await connection`
          SELECT config_data FROM admin_config
          WHERE config_key = 'python_agent_google'
        `;

        if (pythonAgentConfig.length > 0) {
          const configData = pythonAgentConfig[0].config_data as any;

          // Check for new tools-based structure
          if (
            configData.tools?.create &&
            configData.tools.update &&
            configData.tools.fix &&
            configData.tools.explain &&
            configData.tools.generate &&
            configData.tools.revert
          ) {
            seedResult.details.push(
              "✅ Python agent has new tools structure (create, update, fix, explain, generate, revert)"
            );
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ Python agent missing new tools structure"
            );
          }

          // Check for rateLimit
          if (configData.rateLimit) {
            seedResult.details.push(
              "✅ Python agent has rateLimit configuration"
            );
          }
        }

        // Verify mermaid_agent_google has new structure
        const mermaidAgentConfig = await connection`
          SELECT config_data FROM admin_config
          WHERE config_key = 'mermaid_agent_google'
        `;

        if (mermaidAgentConfig.length > 0) {
          const configData = mermaidAgentConfig[0].config_data as any;

          // Check for new tools-based structure
          if (
            configData.tools?.create &&
            configData.tools.update &&
            configData.tools.fix &&
            configData.tools.generate &&
            configData.tools.revert
          ) {
            seedResult.details.push(
              "✅ Mermaid agent has new tools structure (create, update, fix, generate, revert)"
            );
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ Mermaid agent missing new tools structure"
            );
          }

          // Check for rateLimit
          if (configData.rateLimit) {
            seedResult.details.push(
              "✅ Mermaid agent has rateLimit configuration"
            );
          }
        }

        // Verify git_mcp_agent_google has structure
        const gitMcpAgentConfig = await connection`
          SELECT config_data FROM admin_config
          WHERE config_key = 'git_mcp_agent_google'
        `;

        if (gitMcpAgentConfig.length > 0) {
          const configData = gitMcpAgentConfig[0].config_data as any;

          // Check for tools structure
          if (
            configData.tools?.repos &&
            configData.tools.issues &&
            configData.tools.pull_requests
          ) {
            seedResult.details.push("✅ GitHub MCP agent has tools structure");
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ GitHub MCP agent missing tools structure"
            );
          }

          // Check for systemPrompt and rateLimit
          if (configData.systemPrompt && configData.rateLimit) {
            seedResult.details.push(
              "✅ GitHub MCP agent has systemPrompt and rateLimit"
            );
          }
        }

        // Verify chat_model_agent_google has new tool structure
        const chatAgentConfig = await connection`
          SELECT config_data FROM admin_config
          WHERE config_key = 'chat_model_agent_google'
        `;

        if (chatAgentConfig.length > 0) {
          const configData = chatAgentConfig[0].config_data as any;

          // Check for all agent tools
          if (
            configData.tools?.providerToolsAgent &&
            configData.tools?.documentAgent &&
            configData.tools?.pythonAgent &&
            configData.tools?.mermaidAgent &&
            configData.tools?.gitMcpAgent
          ) {
            seedResult.details.push(
              "✅ Chat agent has all specialized agent tools"
            );
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ Chat agent missing some specialized agent tools"
            );
          }

          // Check for documentAgent operation/instruction structure
          if (
            configData.tools?.documentAgent?.tool_input?.operation &&
            configData.tools?.documentAgent?.tool_input?.instruction
          ) {
            seedResult.details.push(
              "✅ Chat agent documentAgent tool has operation + instruction structure"
            );
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ Chat agent documentAgent tool missing operation/instruction structure"
            );
          }

          // Check for pythonAgent operation/instruction structure
          if (
            configData.tools?.pythonAgent?.tool_input?.operation &&
            configData.tools?.pythonAgent?.tool_input?.instruction
          ) {
            seedResult.details.push(
              "✅ Chat agent pythonAgent tool has operation + instruction structure"
            );
          }

          // Check for systemPrompt
          if (configData.systemPrompt && configData.systemPrompt.length > 100) {
            seedResult.details.push(
              "✅ Chat agent has comprehensive systemPrompt"
            );
          }
        }

        // Verify provider_tools_agent_google structure
        const providerToolsConfig = await connection`
          SELECT config_data FROM admin_config
          WHERE config_key = 'provider_tools_agent_google'
        `;

        if (providerToolsConfig.length > 0) {
          const configData = providerToolsConfig[0].config_data as any;

          if (
            configData.tools?.googleSearch &&
            configData.tools?.urlContext &&
            configData.tools?.codeExecution
          ) {
            seedResult.details.push(
              "✅ Provider tools agent has all tools (googleSearch, urlContext, codeExecution)"
            );
          } else {
            seedResult.passed = false;
            seedResult.details.push(
              "❌ Provider tools agent missing some tools"
            );
          }
        }
      }
    } catch (error) {
      seedResult.passed = false;
      seedResult.details.push(`❌ Error checking seed data: ${error}`);
    }

    // Check model_config seed data
    try {
      const modelCount = await connection`
        SELECT COUNT(*) as count FROM model_config
      `;

      const count = Number.parseInt(modelCount[0]?.count || "0", 10);
      if (count === 0) {
        seedResult.passed = false;
        seedResult.details.push("❌ No model configurations found");
      } else {
        seedResult.details.push(`✅ Found ${count} model configurations`);

        // Check for each provider
        const googleModels = await connection`
          SELECT COUNT(*) as count FROM model_config WHERE provider = 'google'
        `;
        const openaiModels = await connection`
          SELECT COUNT(*) as count FROM model_config WHERE provider = 'openai'
        `;
        const anthropicModels = await connection`
          SELECT COUNT(*) as count FROM model_config WHERE provider = 'anthropic'
        `;

        seedResult.details.push(
          `✅ Google models: ${googleModels[0]?.count || 0}`
        );
        seedResult.details.push(
          `✅ OpenAI models: ${openaiModels[0]?.count || 0}`
        );
        seedResult.details.push(
          `✅ Anthropic models: ${anthropicModels[0]?.count || 0}`
        );
      }
    } catch (error) {
      seedResult.passed = false;
      seedResult.details.push(`❌ Error checking model_config data: ${error}`);
    }

    results.push(seedResult);
  } catch (error) {
    console.error("❌ Verification failed:", error);
    throw error;
  } finally {
    await connection.end();
  }

  // Print Results
  console.log("");
  console.log("============================================================");
  console.log("📊 VERIFICATION RESULTS");
  console.log("============================================================");
  console.log("");

  let allPassed = true;

  for (const result of results) {
    const status = result.passed ? "✅ PASSED" : "❌ FAILED";
    console.log(`${status} - ${result.category}`);
    console.log("------------------------------------------------------------");

    for (const detail of result.details) {
      console.log(`  ${detail}`);
    }
    console.log("");

    if (!result.passed) {
      allPassed = false;
    }
  }

  console.log("============================================================");
  if (allPassed) {
    console.log("✅ ALL CHECKS PASSED - Database is ready!");
  } else {
    console.log("❌ SOME CHECKS FAILED - Please review errors above");
  }
  console.log("============================================================");
  console.log("");

  if (!allPassed) {
    throw new Error("Database verification failed");
  }
};

if (require.main === module) {
  verifyMigration().catch((err) => {
    console.error("❌ Verification failed:", err.message);
    process.exit(1);
  });
}

export { verifyMigration };
