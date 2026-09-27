import Logo from "@/app/Logo";

/**
 * What a customer sees after a valid opt-out link. Shared by the short
 * /u/:phone/:token route and the long /unsubscribe/:phone?token= one, so the
 * two can never drift into telling people different things.
 */
export default function UnsubscribedNotice() {
  return (
    <main className="sheet sheet-narrow" id="main-content">
      <Logo />
      <p className="sheet-label">הסרה מהדיוור</p>
      <h1>הוסרתם מרשימת התפוצה</h1>
      <p className="sheet-lede">
        לא נשלח לכם עוד הודעות. אם זו הייתה טעות, אפשר להצטרף שוב בכל רגע.
      </p>
      <div className="success-actions">
        <a className="btn-ghost" href="/">
          הצטרפות מחדש למועדון
        </a>
      </div>
    </main>
  );
}
