/* ------------------------------------------------------------------
 * types.ts · shared primitive types for @traceprompt/sdk
 * ------------------------------------------------------------------ */

/**
 * @module types
 * @description Core type definitions for the Traceprompt SDK.
 * These types are used throughout the SDK for:
 * - JSON serialization/canonicalization
 * - PII redaction
 * - Cryptographic hashing
 * - Data validation
 */

/**
 * Represents any valid JSON-serializable value.
 * This type recursively defines the JSON data model, allowing:
 * - Primitive values (string, number, boolean, null)
 * - Arrays of JSON values
 * - Objects with string keys and JSON values
 *
 * Used for:
 * - Canonical JSON serialization in the hasher
 * - PII redaction in sensitive data
 * - Type-safe WAL entries
 * - HTTP payload validation
 *
 * @example
 * ```typescript
 * // Simple values
 * const str: JSONValue = "hello";
 * const num: JSONValue = 42;
 * const bool: JSONValue = true;
 * const nil: JSONValue = null;
 *
 * // Arrays
 * const arr: JSONValue = [1, "two", { three: true }];
 *
 * // Nested objects
 * const obj: JSONValue = {
 *   string: "value",
 *   number: 123,
 *   nested: {
 *     array: [1, 2, 3],
 *     null: null
 *   }
 * };
 * ```
 *
 * @remarks
 * This type explicitly excludes:
 * - undefined
 * - Functions
 * - Symbols
 * - BigInt
 * - Circular references
 *
 * These restrictions ensure safe serialization and deterministic hashing.
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
