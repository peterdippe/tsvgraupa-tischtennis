// ===================================================================
// KONFIGURATION FÜR CLOUD-BACKEND & FOTO-ALBEN (js/config.js)
// ===================================================================

const CONFIG = {
    // HIER DEINE GOOGLE APPS SCRIPT WEB-APP-URL EINTRAGEN (beginnt mit https://script.google.com/macros/s/.../exec):
    pinnwandCloudUrl: "https://script.google.com/macros/s/AKfycbyE7MhfR_aSdhyaM0nXhC7XSxcYIHukQXqwr8cUvgZeKMk_qv5qtzIO5Qyc7Vbd4rvwBg/exec",
    alben: [
        {
            titel: "Familienfotos & Schnappschüsse",
            beschreibung: "Unsere schönsten Momente, Feste und Ausflüge der gesamten Familie.",
            datum: "Laufend aktualisiert",
            anbieter: "Google Drive",
            bg: "linear-gradient(135deg, #059669, #0f766e)",
            link: "https://drive.google.com/"
        },
        {
            titel: "Urlaube & Reisen",
            beschreibung: "Sammelordner für unsere gemeinsamen Urlaubsbilder zum Ansehen und Herunterladen.",
            datum: "Archiv & Aktuell",
            anbieter: "OneDrive",
            bg: "linear-gradient(135deg, #d97706, #b45309)",
            link: "https://onedrive.live.com/"
        },
        {
            titel: "Foto-Upload für Alle",
            beschreibung: "Ihr habt neue Bilder gemacht? Ladet sie hier direkt in unseren gemeinsamen Familienordner hoch!",
            datum: "Mitmach-Ordner",
            anbieter: "Google Drive / OneDrive",
            bg: "linear-gradient(135deg, #0284c7, #1d4ed8)",
            link: "https://drive.google.com/"
        }
    ]
};
