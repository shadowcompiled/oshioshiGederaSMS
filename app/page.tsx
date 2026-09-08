import Image from "next/image";
import Logo from "./Logo";
import VIPForm from "./VIPForm";

// Numbers, not icons. A chopsticks emoji beside the words "members-only deals"
// tells the reader nothing they did not already have from the words; a numeral
// tells them how many things there are and where they are in the list.
const BENEFITS = [
  {
    title: "מבצעים לחברים בלבד",
    text: "דילים ומבצעי 1+1 מגיעים אליכם ב-SMS לפני כולם.",
  },
  {
    title: "מתנה ביום ההולדת",
    text: "בכל שנה, בחודש יום ההולדת, מחכה לכם מתנה במסעדה.",
  },
  {
    title: "בלי אפליקציה ובלי כרטיס",
    text: "ההרשמה לוקחת פחות מדקה. אין מה להוריד ואין מה לשאת בארנק.",
  },
];

export default function HomePage() {

  return (
    <main className="sheet" id="main-content">
      {/* Letterhead: one still photograph at the top edge, dimmed and faded into
          the ground, then done with. In the middle of the page it interrupted
          the only thing the page is for — reading down to the form. It is
          decorative, so the alt text is empty and it is skipped by a screen
          reader rather than described. */}
      <div className="sheet-plate">
        <Image
          src="/hero/bg7.jpg"
          alt=""
          aria-hidden="true"
          width={1400}
          height={400}
          sizes="100vw"
          quality={70}
          priority
        />
      </div>

      <Logo />

      <p className="sheet-label">מועדון הלקוחות · גדרה</p>
      <h1>הטבות שמגיעות אליכם ב-SMS</h1>
      <p className="sheet-lede">
        ההרשמה קצרה וללא עלות. מכאן והלאה המבצעים וההטבות מגיעים אליכם, וגם מתנה
        בחודש יום ההולדת.
      </p>

      <section className="sheet-section" aria-labelledby="benefits-heading">
        <h2 id="benefits-heading" className="sr-only">
          מה מקבלים חברי המועדון
        </h2>
        <ol className="sheet-list">
          {BENEFITS.map((b, i) => (
            <li key={b.title}>
              <span className="sheet-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h2>{b.title}</h2>
                <p>{b.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="sheet-section" aria-labelledby="join-heading">
        <h2 id="join-heading">הצטרפות למועדון</h2>
        <VIPForm />
      </section>

      <footer className="sheet-foot">
        <p>
          החברות במועדון היא ללא עלות, וניתן להסיר את ההרשמה בכל עת.
        </p>
        <a href="/terms">תקנון המועדון ומדיניות הפרטיות</a>
      </footer>
    </main>
  );
}
