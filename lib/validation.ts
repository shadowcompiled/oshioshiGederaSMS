const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

export function formatPhone(p: string | null | undefined): string {
  if (!p) return "";
  const clean = p.replace(/\D/g, "");
  if (clean.startsWith("05") && clean.length === 10) return "+972" + clean.slice(1);
  if (clean.startsWith("5") && clean.length === 9) return "+972" + clean; // Israeli mobile without leading 0
  if (clean.startsWith("972") && clean.length === 12) return "+" + clean;
  return clean;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isValidPhone(phone: string): boolean {
  return phone.length >= 10 && phone.startsWith("+");
}
