import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { OPERATOR } from "@/lib/legal";

export const metadata: Metadata = { title: "Impressum" };

export default function Imprint() {
  return (
    <LegalPage title="Impressum">
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        {OPERATOR.name}<br />{OPERATOR.street}<br />{OPERATOR.city}<br />{OPERATOR.country}
      </p>
      <h2>Kontakt</h2>
      <p>E-Mail: {OPERATOR.email}</p>
      <h2>Verantwortlich für den Inhalt</h2>
      <p>{OPERATOR.name}, Anschrift wie oben.</p>
      <h2>Hinweis</h2>
      <p>
        Die Preise werden täglich aus öffentlich sichtbaren Angeboten auf Cardmarket berechnet und ohne Gewähr angezeigt.
        Dieses Angebot steht in keiner Verbindung zu Cardmarket.
      </p>
    </LegalPage>
  );
}
