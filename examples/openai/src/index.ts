import { config } from "dotenv";
import { init, wrap } from "traceprompt-node";
import OpenAI from "openai";

config();

async function main() {
  try {
    await init();

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

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

    const response = await wrappedOpenAI("Hello! Can you tell me a joke?");
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
  }
}

main();
