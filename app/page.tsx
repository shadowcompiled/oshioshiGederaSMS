import Logo from "./Logo";
import VIPForm from "./VIPForm";

export default function HomePage() {
  return (
    <div className="container">
      <div className="logo-area">
        <Logo />
      </div>
      <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <div className="city-name">GEDERA</div>
      </div>
      <h2>מועדון ה-VIP שלנו</h2>
      <p>הירשמו לקבלת הטבות בלעדיות, מבצעי 1+1 ועדכונים חמים!</p>

      <VIPForm />
    </div>
  );
}
