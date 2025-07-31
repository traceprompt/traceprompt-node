// Checksum validation functions for national IDs

export function dniCheck(num: string): boolean {
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  const n = parseInt(num.slice(0, 8), 10);
  return num[8] === letters[n % 23];
}

export function inseeCheck(num: string): boolean {
  const clean = num.replace(/\s/g, "");
  const key = parseInt(clean.slice(-2), 10);
  const body = parseInt(clean.slice(0, -2), 10);
  return 97 - (body % 97) === key;
}

export function beEidCheck(num: string): boolean {
  const clean = num.replace(/[-.]/g, "");
  const base = parseInt(clean.slice(0, 9), 10);
  const chk = parseInt(clean.slice(9), 10);
  return 97 - (base % 97) === chk;
}

export function luhn10(num: string): boolean {
  const clean = num.replace(/\D+/g, "");
  const digits = clean.split("").map(Number).reverse();
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = digits[i];
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function nhsMod11(num: string): boolean {
  const digits = num.replace(/\D/g, "").slice(0, 9);
  if (digits.length !== 9) return false;
  const sum = [...digits].reduce((acc, d, i) => acc + Number(d) * (10 - i), 0);
  const chk = 11 - (sum % 11);
  const expectedCheck = chk === 11 ? 0 : chk;
  return expectedCheck === Number(num.replace(/\D/g, "")[9]);
}

export function svnrMod11(num: string): boolean {
  const digits = num.replace(/\D/g, "").slice(0, 10);
  if (digits.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (2 + i);
  }
  const chk = sum % 11;
  return chk === Number(num.replace(/\D/g, "").slice(-1));
}

export function imeiLuhn(num: string): boolean {
  return luhn10(num);
}

export function npiLuhn(num: string): boolean {
  return luhn10(num);
}
