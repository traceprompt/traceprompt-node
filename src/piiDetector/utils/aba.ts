
export function abaValid(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const weights = [3,7,1];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (+routing[i]) * weights[i % 3];
  }
  return sum % 10 === 0;
}
