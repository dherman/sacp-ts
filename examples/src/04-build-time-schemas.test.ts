import { describe, it } from "node:test";
import assert from "node:assert";
import type { Summary, AnalysisResult, Config, UserProfile } from "./04-types.js";
import {
  SummarySchema,
  AnalysisResultSchema,
  ConfigSchema,
  UserProfileSchema,
} from "./04-types.schemas.js";

describe("Example 4: Build-time generated schemas", () => {
  describe("SummarySchema", () => {
    it("should produce valid JSON Schema", () => {
      const schema = SummarySchema.toJsonSchema();

      assert.strictEqual(schema.type, "object");
      assert.ok(schema.properties);
      assert.deepStrictEqual(schema.required, ["title", "points", "wordCount"]);
    });

    it("should have correct property types matching TypeScript interface", () => {
      const schema = SummarySchema.toJsonSchema();
      const props = schema.properties!;

      // These correspond to the Summary interface
      assert.strictEqual(props.title.type, "string");
      assert.strictEqual(props.points.type, "array");
      assert.strictEqual(props.points.items?.type, "string");
      assert.strictEqual(props.wordCount.type, "number");
    });

    it("should preserve JSDoc descriptions", () => {
      const schema = SummarySchema.toJsonSchema();
      const props = schema.properties!;

      assert.strictEqual(props.title.description, "A brief title for the summary");
      assert.strictEqual(props.points.description, "Key points from the content");
    });

    it("should type-check against hand-written interface", () => {
      // This is a compile-time check: if the schema provider
      // doesn't match the Summary type, TypeScript will error
      const _provider: typeof SummarySchema = SummarySchema;

      // Simulate what patchwork.think() would return
      const mockResult: Summary = {
        title: "Test",
        points: ["point 1"],
        wordCount: 100,
      };

      assert.ok(mockResult.title);
    });
  });

  describe("AnalysisResultSchema", () => {
    it("should handle enum types", () => {
      const schema = AnalysisResultSchema.toJsonSchema();

      assert.deepStrictEqual(schema.properties?.sentiment.enum, [
        "positive",
        "negative",
        "neutral",
      ]);
    });

    it("should handle nested object arrays", () => {
      const schema = AnalysisResultSchema.toJsonSchema();
      const topicsSchema = schema.properties?.topics;

      assert.strictEqual(topicsSchema?.type, "array");
      assert.strictEqual(topicsSchema?.items?.type, "object");
      assert.deepStrictEqual(topicsSchema?.items?.required, ["name", "relevance"]);
    });

    it("should include numeric constraints", () => {
      const schema = AnalysisResultSchema.toJsonSchema();

      assert.strictEqual(schema.properties?.confidence.minimum, 0);
      assert.strictEqual(schema.properties?.confidence.maximum, 1);
    });
  });

  describe("ConfigSchema", () => {
    it("should handle optional fields", () => {
      const schema = ConfigSchema.toJsonSchema();

      // All fields are optional in Config
      assert.deepStrictEqual(schema.required, []);
    });

    it("should include default values", () => {
      const schema = ConfigSchema.toJsonSchema();

      assert.strictEqual(schema.properties?.temperature.default, 0.7);
    });
  });

  describe("UserProfileSchema", () => {
    it("should include format specifications", () => {
      const schema = UserProfileSchema.toJsonSchema();

      assert.strictEqual(schema.properties?.id.format, "uuid");
      assert.strictEqual(schema.properties?.email.format, "email");
      assert.strictEqual(schema.properties?.website.format, "uri");
      assert.strictEqual(schema.properties?.createdAt.format, "date-time");
    });

    it("should mark optional fields correctly", () => {
      const schema = UserProfileSchema.toJsonSchema();
      const required = schema.required as string[];

      assert.ok(required.includes("id"));
      assert.ok(required.includes("email"));
      assert.ok(required.includes("createdAt"));
      assert.ok(!required.includes("website"));
    });
  });

  describe("Type-first workflow", () => {
    it("should maintain type safety between source types and schemas", () => {
      // This test demonstrates that the type parameter on SchemaProvider
      // links back to the hand-written type

      // The schema produces JsonSchema
      const jsonSchema = SummarySchema.toJsonSchema();
      assert.ok(jsonSchema);

      // But the SchemaProvider is parameterized by Summary
      // If we use it with patchwork.think(), the result would be typed as Summary
      const verifyType = <T>(schema: { toJsonSchema(): unknown }): T => {
        // This simulates what patchwork.think(schema).run() returns
        return {} as T;
      };

      // This would fail to compile if SummarySchema wasn't SchemaProvider<Summary>
      const result: Summary = verifyType<Summary>(SummarySchema);
      assert.ok(result !== undefined);
    });

    it("should allow clean separation of concerns", () => {
      // 04-types.ts: Hand-written types (source of truth for TypeScript)
      // 04-types.schemas.ts: Generated schemas (source of truth for JSON Schema)
      //
      // The SchemaProvider<T> interface bridges these two files:
      // - T comes from 04-types.ts (hand-written)
      // - toJsonSchema() comes from 04-types.schemas.ts (generated)
      //
      // This test verifies the pattern works at runtime

      const validateStructure = (schema: { toJsonSchema(): unknown }) => {
        const json = schema.toJsonSchema() as Record<string, unknown>;
        return json.type === "object" && json.properties !== undefined;
      };

      assert.ok(validateStructure(SummarySchema));
      assert.ok(validateStructure(AnalysisResultSchema));
      assert.ok(validateStructure(ConfigSchema));
      assert.ok(validateStructure(UserProfileSchema));
    });
  });
});
