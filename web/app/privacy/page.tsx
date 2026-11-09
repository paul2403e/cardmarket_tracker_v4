import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { OPERATOR } from "@/lib/legal";

export const metadata: Metadata = { title: "Datenschutz" };

export default function Privacy() {
  return (
    <LegalPage title="Datenschutzerklärung">
      <h2>1. Verantwortlicher</h2>
      <p>{OPERATOR.name}, {OPERATOR.street}, {OPERATOR.city}, {OPERATOR.country} – E-Mail: {OPERATOR.email}</p>

      <h2>2. Aufruf der Website</h2>
      <p>
        Die Website wird bei Vercel Inc. (USA) gehostet. Beim Aufruf verarbeitet Vercel technisch notwendige Daten wie
        IP-Adresse, Zeitpunkt und aufgerufene Seite, um die Seite auszuliefern und vor Missbrauch zu schützen
        (Art. 6 Abs. 1 lit. f DSGVO). Die Marktdaten liegen bei Cloudflare (R2) und enthalten keine personenbezogenen Daten.
        Es gibt keine Werbung, kein Tracking und keine Analyse-Werkzeuge.
      </p>

      <h2>3. Nutzerkonto</h2>
      <p>
        Wer ein Konto anlegt, gibt eine E-Mail-Adresse und ein Passwort an. Gespeichert werden die E-Mail-Adresse, das
        Passwort ausschließlich verschlüsselt (gehasht), der Zeitpunkt der Registrierung und Anmeldung sowie die
        Anzeige-Einstellungen; später auch selbst eingetragene Depots und Transaktionen. Zweck ist die Bereitstellung des
        Kontos (Art. 6 Abs. 1 lit. b DSGVO). Anbieter ist Supabase Inc.; die Daten liegen in einem Rechenzentrum in
        Frankfurt am Main. Für die Bestätigungs- und Passwort-Mails nutzt Supabase einen E-Mail-Versanddienst.
      </p>

      <h2>4. Cookies und lokaler Speicher</h2>
      <p>
        Für die Anmeldung setzt die Website ein technisch notwendiges Cookie mit der Sitzung. Anzeige-Einstellungen (z. B.
        „EU only“) werden im lokalen Speicher des Browsers abgelegt. Beides ist für die Funktion nötig
        (§ 25 Abs. 2 TDDDG); eine Einwilligung ist dafür nicht erforderlich.
      </p>

      <h2>5. Speicherdauer und Löschung</h2>
      <p>
        Die Kontodaten bleiben gespeichert, bis das Konto gelöscht wird. Das geht jederzeit selbst unter „Account“ →
        „Delete account“; dabei werden alle zugehörigen Daten sofort gelöscht.
      </p>

      <h2>6. Ihre Rechte</h2>
      <ul>
        <li>Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung (Art. 15–18 DSGVO)</li>
        <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
        <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)</li>
        <li>Beschwerde bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO)</li>
      </ul>
      <p>Anfragen bitte per E-Mail an {OPERATOR.email}.</p>
    </LegalPage>
  );
}
