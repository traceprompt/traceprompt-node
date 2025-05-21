/**
 * @module redactor
 * @description High-performance PII redaction module that masks sensitive data patterns:
 * - Email addresses
 * - Social Security Numbers (SSN)
 * - Credit card numbers
 * - Phone numbers (international formats)
 *
 * Designed for sub-millisecond performance with minimal regex patterns.
 * Safe for use in high-throughput logging scenarios.
 */

/**
 * Masks sensitive PII data in text using regex patterns.
 * Replaces matches with standardized placeholder tokens.
 *
 * Masked patterns:
 * - Emails → "***EMAIL***"
 * - SSN → "***SSN***"
 * - Credit Cards → "***CARD***"
 * - Phone Numbers → "***PHONE***"
 *
 * @param {string} text - Input text to mask
 * @returns {string} Text with PII replaced by placeholders
 *
 * @example
 * ```typescript
 * mask("Contact: john@example.com, CC: 4242-4242-4242-4242")
 * // Returns: "Contact: ***EMAIL***, CC: ***CARD***"
 * ```
 */
export function mask(text: string): string {
  return text
    .replace(emailRx, "***EMAIL***")
    .replace(ssnRx, "***SSN***")
    .replace(cardRx, "***CARD***")
    .replace(phoneRx, "***PHONE***");
}

/* Regex Patterns */

/**
 * Email address pattern
 * Matches: username@domain.tld
 * Examples: john.doe@example.com, user+tag@sub.domain.co.uk
 */
const emailRx = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/**
 * US Social Security Number pattern
 * Format: XXX-XX-XXXX
 * Example: 123-45-6789
 */
const ssnRx = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * Credit card number pattern
 * Matches 13-16 digit numbers, with optional spaces or hyphens
 * Examples: 4242424242424242, 4242-4242-4242-4242
 */
const cardRx = /\b(?:\d[ -]*?){13,16}\b/g;

/**
 * International phone number pattern
 * Matches formats:
 * - Optional country code (+1, +44, etc.)
 * - Area code with optional parentheses
 * - Local number with optional separators
 * Examples: +1 (555) 123-4567, 555.123.4567, (555) 123 4567
 */
const phoneRx =
  /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
