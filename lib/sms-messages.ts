/**
 * All outbound SMS texts live here. The opt-out footer is appended
 * automatically by /api/send_sms_task (via lib/sms-render.ts).
 *
 * These messages deliberately do NOT repeat the restaurant's name in the body.
 * Every message is sent from the alphanumeric sender id `OSHI GEDERA` (see
 * SMS_019_SOURCE), which the handset shows as the sender, so a body that
 * opened with "Oshi Oshi Gedera:" printed the name twice — and in two
 * different forms, because 019 caps a sender id at 11 characters and one
 * "Oshi" had to be dropped from it.
 *
 * Note for whoever revisits this: Israeli Spam Law §30A(e)(2) requires a
 * promotional message to identify the advertiser. The sender id carries that
 * name to the recipient, but it is not part of the message body, and whether
 * that satisfies the section on its own is a question for the club's lawyer —
 * the same review /terms is still marked as awaiting. Removing the in-body
 * name was the owner's explicit decision, taken with that flagged.
 */
export function welcomeSms(name: string): string {
  return `היי ${name}, איזה כיף שהצטרפת אלינו! 🍣 מחכה לך מתנת הצטרפות במסעדה, תקף בהזמנה הבאה, ומעכשיו המבצעים, ההטבות וה-1+1 מגיעים ישירות אליך.`;
}

export function welcomeBackSms(name: string): string {
  return `היי ${name}, איזה כיף שחזרת אלינו! 🍣 מעכשיו המבצעים, ההטבות וה-1+1 שוב מגיעים ישירות אליך.`;
}

export function birthdaySms(name: string): string {
  return `היי ${name}, חוגג/ת יום הולדת החודש? 🎂 מזל טוב! מחכה לך מתנת יום הולדת במסעדה. בואו לחגוג איתנו! 🍣`;
}

export function anniversarySms(name: string): string {
  return `היי ${name}, חוגגים יום נישואין החודש? 💍 מזל טוב! מחכה לכם מתנת יום נישואין במסעדה. נשמח לחגוג איתכם! 🍣`;
}

/**
 * Verification code for club signup. This is a transactional message, not a
 * "davar pirsomet" under §30A, so it carries no marketing content and the
 * opt-out footer is deliberately not appended to it.
 */
export function verificationSms(code: string, ttlMinutes: number): string {
  return `${code} הוא קוד האימות שלך להצטרפות למועדון. הקוד תקף ל-${ttlMinutes} דקות. אם לא ביקשת קוד, אפשר להתעלם מהודעה זו.`;
}
