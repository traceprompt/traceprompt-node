import { config } from "dotenv";
import { init, wrap, wrapTool, wrapAgent } from "traceprompt-node";
import OpenAI from "openai";

config();

// Example tool function
async function searchDatabase(query: string): Promise<string[]> {
  // Simulate database search
  console.log(`🔍 Searching database for: ${query}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  return [`Result 1 for ${query}`, `Result 2 for ${query}`];
}

// Example agent function - takes the wrapped functions as parameters
async function customerServiceAgent(
  customerQuery: string,
  searchFn: (query: string) => Promise<string[]>,
  llmFn: (prompt: string) => Promise<any>
): Promise<string> {
  console.log(`🤖 Agent processing: ${customerQuery}`);

  // Step 1: Search knowledge base (creates ToolCall span)
  const searchResults = await searchFn(customerQuery);

  // Step 2: Generate response (creates ModelCall span)
  const response = await llmFn(
    `Based on these search results: ${searchResults.join(", ")}, 
     answer the customer query: ${customerQuery}`
  );

  return response.choices[0]?.message?.content || "No response";
}

async function main() {
  try {
    await init();

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Basic LLM wrapper (creates ModelCall spans)
    const wrappedOpenAI = wrap(
      async (prompt: string) => {
        return await openai.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "gpt-4o-mini",
        });
      },
      {
        modelVendor: "openai",
        modelName: "gpt-4o-mini",
        userId: "example-user-123",
      }
    );

    // Advanced: Tool and agent wrappers
    const trackedSearch = wrapTool(searchDatabase, "database_search", "1.0");

    // Create an agent wrapper that uses config defaults
    // Agent metadata is read from .tracepromptrc.yml or environment variables
    const trackedAgent = wrapAgent(
      async (customerQuery: string) =>
        customerServiceAgent(customerQuery, trackedSearch, wrappedOpenAI)
      // No explicit agent name or options - will use config defaults
    );

    console.log("🚀 Starting Traceprompt OpenAI examples...\n");

    // Example 1: Basic LLM call
    console.log("1. Basic LLM call:");
    const basicResponse = await wrappedOpenAI("Hello! Can you tell me a joke?");
    console.log("✅ Response:", basicResponse.choices[0]?.message?.content);
    console.log("");

    // Example 2: Tool call tracing
    console.log("2. Tool call tracing:");
    const toolResults = await trackedSearch("customer orders");
    console.log("✅ Tool results:", toolResults);
    console.log("");

    // Example 3: Full agent workflow with tracing
    console.log("3. Agent workflow with full tracing:");
    // This will create a trace with:
    // - AgentRun span for the overall agent execution
    // - ToolCall span for the database search
    // - ModelCall span for the LLM response generation
    const agentResult = await trackedAgent("What are your business hours?");
    console.log("✅ Agent response:", agentResult);
    console.log("📊 All spans are automatically traced and encrypted!");
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
  }
}

main();
