export function countTokens(text: string): number {
  return Math.ceil(text.split(/\s+/g).length * 1.33); // rough words→tokens
}
