// Angaben für Impressum und Datenschutzerklärung. Solange hier "[…]" steht, zeigen die Seiten einen Hinweis.
export const OPERATOR = {
  name: "[Vor- und Nachname]",
  street: "[Straße und Hausnummer]",
  city: "[PLZ Ort]",
  country: "Deutschland",
  email: "[E-Mail-Adresse]",
};

export const legalComplete = !Object.values(OPERATOR).some((v) => v.startsWith("["));
