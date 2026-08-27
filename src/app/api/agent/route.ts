import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { AITools } from '@/lib/ai/tools';
import { z } from 'zod';

const omniroute = createOpenAI({
  baseURL: 'http://localhost:20128/v1',
  apiKey: 'sk-66f9c133a5ec1bf0-db8fba-ea45293c',
});

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = streamText({
      model: omniroute('auto'),
      system: `You are an autonomous quantitative research agent. 
      You write trading strategies in a custom Pine-style language.
      You MUST follow this rigorous scientific loop:
      1. Formulate a specific, testable hypothesis for improvement.
      2. Write or modify the Pine-style code. (Do NOT use Python/JS).
      3. Use run_backtest to evaluate the code.
      4. Use run_out_of_sample_test to check for overfitting.
      5. Compare the results against previous iterations.
      6. Accept or reject the hypothesis based on the composite robustness score, NOT just raw profit.
      7. Iterate until a robust strategy is found or you run out of steps.
      8. Once you have accepted a robust hypothesis, output a comprehensive Markdown tear-sheet summarizing the strategy's logic, parameters, and key metrics.`,
      messages,
      tools: {
        validate_strategy: tool({
          description: 'Validate Pine-style source code',
          parameters: z.object({
            sourceCode: z.string().describe('The Pine-style source code to validate'),
          }),
          execute: async ({ sourceCode }) => {
            return await AITools.validate_strategy({ sourceCode });
          },
        }),
        run_backtest: tool({
          description: 'Run a backtest on the provided source code',
          parameters: z.object({
            sourceCode: z.string().describe('The Pine-style source code to backtest'),
            symbol: z.string().optional().describe('Asset symbol, e.g., XAUUSD'),
            timeframe: z.string().optional().describe('Timeframe, e.g., 1h, 15m'),
            days: z.number().optional().describe('Number of historical days to test'),
          }),
          execute: async ({ sourceCode, symbol, timeframe, days }) => {
            return await AITools.run_backtest({ sourceCode, symbol, timeframe, days });
          },
        }),
        run_out_of_sample_test: tool({
          description: 'Run an Out-Of-Sample (OOS) robustness test to check for overfitting.',
          parameters: z.object({
            sourceCode: z.string().describe('The Pine-style source code to backtest'),
            symbol: z.string().optional().describe('Asset symbol, e.g., XAUUSD'),
            timeframe: z.string().optional().describe('Timeframe, e.g., 1h, 15m'),
            days: z.number().optional().describe('Number of historical days to test'),
          }),
          execute: async ({ sourceCode, symbol, timeframe, days }) => {
            return await AITools.run_out_of_sample_test({ sourceCode, symbol, timeframe, days });
          },
        }),
        run_monte_carlo_analysis: tool({
          description: 'Run a Monte Carlo simulation to determine the Risk of Ruin and expected drawdown distribution.',
          parameters: z.object({
            sourceCode: z.string().describe('The Pine-style source code to test'),
            symbol: z.string().optional().describe('Asset symbol, e.g., XAUUSD'),
            timeframe: z.string().optional().describe('Timeframe, e.g., 1h, 15m'),
            days: z.number().optional().describe('Number of historical days to test'),
          }),
          execute: async ({ sourceCode, symbol, timeframe, days }) => {
            return await AITools.run_monte_carlo_analysis({ sourceCode, symbol, timeframe, days });
          },
        }),
        create_strategy: tool({
          description: 'Save a new strategy to the database.',
          parameters: z.object({
            name: z.string(),
            description: z.string(),
            sourceCode: z.string(),
          }),
          execute: async (args) => AITools.create_strategy(args),
        }),
        update_strategy: tool({
          description: 'Save a new iteration or version of an existing strategy.',
          parameters: z.object({
            strategyId: z.number(),
            sourceCode: z.string(),
            hypothesis: z.string(),
          }),
          execute: async (args) => AITools.update_strategy(args),
        }),
        list_strategies: tool({
          description: 'List all saved strategies.',
          parameters: z.object({}),
          execute: async () => AITools.list_strategies(),
        }),
        get_strategy_details: tool({
          description: 'Retrieve details for a specific strategy.',
          parameters: z.object({ strategyId: z.number() }),
          execute: async (args) => AITools.get_strategy_details(args),
        }),
        get_market_data_info: tool({
          description: 'Get available asset symbols and timeframes.',
          parameters: z.object({}),
          execute: async () => AITools.get_market_data_info(),
        }),
        run_parameter_optimization: tool({
          description: 'Run parameter optimization grid search.',
          parameters: z.object({
            sourceCode: z.string(),
            paramRanges: z.any().optional(),
          }),
          execute: async (args) => AITools.run_parameter_optimization(args),
        }),
        run_walk_forward_analysis: tool({
          description: 'Run walk forward analysis for rolling OOS testing.',
          parameters: z.object({ sourceCode: z.string() }),
          execute: async (args) => AITools.run_walk_forward_analysis(args),
        }),
        generate_tear_sheet: tool({
          description: 'Generate markdown documentation for the strategy.',
          parameters: z.object({
            strategyId: z.number(),
            markdown: z.string(),
          }),
          execute: async (args) => AITools.generate_tear_sheet(args),
        }),
        delete_strategy: tool({
          description: 'Delete a strategy.',
          parameters: z.object({ strategyId: z.number() }),
          execute: async (args) => AITools.delete_strategy(args),
        }),
      },
      maxSteps: 5, // Allow the agent to call tools and respond iteratively
    });

    // @ts-ignore
    return result.toDataStreamResponse();
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
