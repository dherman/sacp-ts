/**
 * Example 1: Inline Schema with schemaOf<T>() Helper
 *
 * This example demonstrates the simplest pattern for using SchemaProvider:
 * passing a raw JSON Schema inline with the schemaOf helper.
 *
 * Best for:
 * - Quick prototyping
 * - Simple schemas
 * - When you don't want additional dependencies
 */

import { schemaOf } from "@dherman/patchwork";
import type { JsonSchema, SchemaProvider } from "@dherman/sacp";

// Define your TypeScript interface
interface Summary {
  title: string;
  points: string[];
  wordCount: number;
}

// Create a SchemaProvider using schemaOf<T>()
// The type parameter links the schema to the TypeScript type
export const SummarySchema: SchemaProvider<Summary> = schemaOf<Summary>({
  type: "object",
  properties: {
    title: { type: "string", description: "A brief title for the summary" },
    points: {
      type: "array",
      items: { type: "string" },
      description: "Key points from the content",
    },
    wordCount: {
      type: "number",
      description: "Approximate word count of the original content",
    },
  },
  required: ["title", "points", "wordCount"],
});

// More complex nested example
interface AnalysisResult {
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
  topics: Array<{
    name: string;
    relevance: number;
  }>;
}

export const AnalysisResultSchema: SchemaProvider<AnalysisResult> =
  schemaOf<AnalysisResult>({
    type: "object",
    properties: {
      sentiment: {
        type: "string",
        enum: ["positive", "negative", "neutral"],
        description: "Overall sentiment of the content",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence score between 0 and 1",
      },
      topics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            relevance: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["name", "relevance"],
        },
        description: "Topics identified in the content",
      },
    },
    required: ["sentiment", "confidence", "topics"],
  });

/**
 * Example usage (requires a running conductor):
 *
 * ```typescript
 * import { connect } from "@dherman/patchwork";
 * import { SummarySchema, AnalysisResultSchema } from "./01-inline-schema.js";
 *
 * const patchwork = await connect(["sacp-conductor", "--agent", "claude"]);
 *
 * // The result is typed as Summary
 * const summary = await patchwork
 *   .think(SummarySchema)
 *   .text("Summarize this document:")
 *   .display(documentContents)
 *   .run();
 *
 * console.log(summary.title);       // string
 * console.log(summary.points);      // string[]
 * console.log(summary.wordCount);   // number
 *
 * // The result is typed as AnalysisResult
 * const analysis = await patchwork
 *   .think(AnalysisResultSchema)
 *   .text("Analyze the sentiment and topics:")
 *   .display(articleText)
 *   .run();
 *
 * console.log(analysis.sentiment);  // "positive" | "negative" | "neutral"
 * console.log(analysis.confidence); // number
 * console.log(analysis.topics);     // Array<{ name: string; relevance: number }>
 *
 * patchwork.close();
 * ```
 */
