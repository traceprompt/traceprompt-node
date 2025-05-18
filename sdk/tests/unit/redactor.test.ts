import { describe, expect, it, vi } from "vitest";
import { redact } from "../../src/redactor";

describe("redactor.ts", () => {
  describe("redact function", () => {
    describe("redaction modes", () => {
      it("should not modify input when mode is 'off'", () => {
        const input = {
          email: "john.doe@example.com",
          ssn: "123-45-6789",
          message: "Call me at 555-123-4567 about card 4111-1111-1111-1111",
        };

        const result = redact(input, "off");
        expect(result).toEqual(input);
      });

      it("should use regex redaction by default", () => {
        const input = "Email me at john.doe@example.com";
        const result = redact(input);

        expect(result).toBe("Email me at ***EMAIL***");
      });

      it("should use smart redaction when specified", () => {
        const input = "Email me at john.doe@example.com";
        const result = redact(input, "smart");

        expect(result).toBe("Email me at ***EMAIL***");
      });
    });

    describe("input types", () => {
      it("should redact strings", () => {
        const email = "Contact: john.doe@example.com";
        const ssn = "SSN: 123-45-6789";
        const card = "Card: 4111 1111 1111 1111";
        const phone = "Phone: +1 (555) 123-4567";

        expect(redact(email)).toBe("Contact: ***EMAIL***");
        expect(redact(ssn)).toBe("SSN: ***SSN***");
        expect(redact(card)).toBe("Card: ***CARD***");
        expect(redact(phone)).toContain("***PHONE***");
      });

      it("should redact arrays recursively", () => {
        const input = [
          "john.doe@example.com",
          "Hello world",
          ["nested@example.com", 123],
        ];

        const expected = ["***EMAIL***", "Hello world", ["***EMAIL***", 123]];

        expect(redact(input)).toEqual(expected);
      });

      it("should redact objects recursively", () => {
        const input = {
          email: "john.doe@example.com",
          message: "Hello world",
          nested: {
            ssn: "123-45-6789",
            value: 42,
          },
          mixedArray: [
            "Mixed with email: user@example.com",
            { phone: "555-123-4567" },
          ],
        };

        const expected = {
          email: "***EMAIL***",
          message: "Hello world",
          nested: {
            ssn: "***SSN***",
            value: 42,
          },
          mixedArray: [
            "Mixed with email: ***EMAIL***",
            { phone: "***PHONE***" },
          ],
        };

        expect(redact(input)).toEqual(expected);
      });

      it("should leave non-sensitive primitives unchanged", () => {
        expect(redact(42)).toBe(42);
        expect(redact(true)).toBe(true);
        expect(redact(null)).toBe(null);
        expect(redact(undefined)).toBe(undefined);
      });
    });

    describe("PII detection patterns", () => {
      it("should detect and mask various email formats", () => {
        const emails = [
          "simple@example.com",
          "with.dots@domain.co.uk",
          "with-dashes@domain.org",
          "with_underscores@domain.io",
          "with+plus@gmail.com",
          "UPPERCASE@EXAMPLE.COM",
        ];

        emails.forEach((email) => {
          expect(redact(email)).toBe("***EMAIL***");
        });
      });

      it("should detect and mask SSN", () => {
        const ssns = ["123-45-6789", "Text with SSN 987-65-4321 embedded"];

        expect(redact(ssns[0])).toBe("***SSN***");
        expect(redact(ssns[1])).toBe("Text with SSN ***SSN*** embedded");
      });

      it("should detect and mask credit card numbers", () => {
        const cards = [
          "4111111111111111",
          "4111-1111-1111-1111",
          "4111 1111 1111 1111",
          "Text with card 5555555555554444 embedded",
          "Text with card 5555-5555-5555-4444 embedded",
        ];

        cards.forEach((card) => {
          expect(redact(card)).toContain("***CARD***");
        });
      });

      it("should detect and mask phone numbers", () => {
        const phones = [
          "555-123-4567",
          "(555) 123-4567",
          "+1 555 123 4567",
          "5551234567",
          "+1 (555) 123-4567",
          "Text with phone 555-123-4567 embedded",
        ];

        phones.forEach((phone) => {
          expect(redact(phone)).toContain("***PHONE***");
        });
      });

      it("should mask multiple PII types in a single string", () => {
        const input =
          "Contact john.doe@example.com, SSN: 123-45-6789, Phone: 555-123-4567";
        const expected =
          "Contact ***EMAIL***, SSN: ***SSN***, Phone: ***PHONE***";

        expect(redact(input)).toBe(expected);
      });
    });

    describe("edge cases", () => {
      it("should handle empty inputs", () => {
        expect(redact("")).toBe("");
        expect(redact([])).toEqual([]);
        expect(redact({})).toEqual({});
      });

      it("should handle case variants", () => {
        expect(redact("EMAIL@EXAMPLE.COM")).toBe("***EMAIL***");
        expect(redact("email@example.com")).toBe("***EMAIL***");
      });

      it("should not redact invalid patterns", () => {
        expect(redact("invalid@email")).toBe("invalid@email");

        expect(redact("123456789")).toContain("***PHONE***");

        expect(redact("411 111")).toBe("411 111");

        expect(redact("555-123")).toBe("555-123");
      });
    });
  });
});
