# 🏓 TSV Graupa e.V. – Abteilung Tischtennis (`www.tsvgraupa-tischtennis.de`)

Offizielle Informations-, Statistik- und Turnier-Plattform der Abteilung Tischtennis des TSV Graupa e.V.

---

## 1. System-Architektur & Datenfluss

Die Plattform arbeitet als schnelle Single-Page-Application (SPA) ohne eigenen kostenpflichtigen Datenbankserver. Alle Daten werden über ein eigenes Google Apps Script mit Google Drive und den offiziellen Verbandsportalen synchronisiert:

1. **DNS & Domain (`www.do.de`):**
   - Domain: `tsvgraupa-tischtennis.de`
   - 4× `A`-Records (`185.199.108.153` bis `185.199.111.153`) zeigen auf GitHub Pages.
   - `CNAME`-Record für `www` zeigt auf `peterdippe.github.io`.
2. **Frontend-Hosting (`GitHub Pages`):**
   - Repository: `tsvgraupa-tischtennis` (Branch `main`, Root `/`).
   - Die Datei `CNAME` im Hauptverzeichnis bindet die Custom Domain `www.tsvgraupa-tischtennis.de` an.
   - Die Datei `404.html` fängt direkte Pfad-Aufrufe ab und leitet sie an den Hash-Router (`#spielbetrieb`, `#tt-ranking` etc.) weiter.
3. **Backend & Scraper (`Google Apps Script` -> `TSV-Graupa-TT-Backend`):**
   - Dient als CORS-fähige Schnittstelle zwischen Browser, Google Drive und den Verbandsportalen.
   - Führt für geschützte Seiten auf **TischtennisLive** (`dresden.tischtennislive.de`) automatisch den ASP.NET-Formular-Login und das Lösen der Bot-Weiche durch (Cookies werden im `CacheService` / `PropertiesService` zwischengespeichert).
   - Ruft für überregionale Ligen (ab Oberliga aufwärts, z. B. 1. Damen) automatisch die Tabellen, Bilanzen, Spielpläne und Halleninfos von **myTischtennis.de / click-TT** ab.
4. **Datenbank-Dateien (`Google Drive`):**
   - `dippe_tt_saison_YYYY.json` (für jedes Jahr von `2009` bis `2026`): Speichert das komprimierte HTML der Saisonübersicht sowie alle bereits abgerufenen Mannschafts-Detailseiten (eigene Teams und angeklickte Liga-Gegner).
   - `dippe_tt_ranking_db.json`: Speichert die Abteilungs-Mitgliederliste (`L2P=870`, `L3P=1740`), die aktuellen LivePZ-Werte sowie die gecachten 100-Spiele-Verläufe (`EntwicklungTTR`) und Analyse-Daten (`Analyse`).
   - `dippe_tt_challenge_db.json`: Speichert die laufende Session sowie das Archiv der Graupaer Trainings-Challenge.
   - `dippe_turniere_db.json`: Speichert alle angelegten Turniere des Turnierplaners.

---

## 2. Verzeichnis- & Dateistruktur

```text
├── index.html               # App-Rahmen, Sidebar-Navigation & Passwort-Modal
├── 404.html                 # Deep-Link-Weiterleitung für GitHub Pages
├── CNAME                    # Domain-Zuordnung (www.tsvgraupa-tischtennis.de)
├── css/
│   └── style.css            # Komplettes Design (Smaragd-Gold-Theme & Mobile-Tabellen)
├── js/
│   ├── config.js            # Enthält die Web-App-URL des TSV-Graupa-TT-Backend
│   ├── core.js              # Hash-Router (#home, #spielbetrieb, #tt-ranking, ...), Teilen-Funktion
│   ├── tischtennis.js       # Spielbetrieb-Parser (TTLive + click-TT), Liga-Inspektor
│   ├── tt-ranking.js        # LivePZ-Rangliste, 100-Spiele-Canvas-Chart, 9 Donuts, Trainings-Challenge
│   ├── tt-news.js           # News-Feed & YouTube-Video-Highlights
│   ├── turnierplaner.js     # Turniersystem (Gruppen, K.o., Doppel-K.o., ExcelJS-Export)
│   └── zaehlboard.js        # Digitales Touch-Zählgerät am Tisch (lokal im Browser)
└── views/
    ├── home.html            # Startseite, Abteilungsvorstellung, Wegweiser & Hallenkarte
    ├── spielbetrieb.html    # Punktspielbetrieb & Ligen-Ansicht
    ├── tt-ranking.html      # TT-Ranking & Trainings-Challenge
    ├── tt-news.html         # TT-News & Videos
    ├── turnierplaner.html   # Turnierplaner-Oberfläche
    ├── zaehlboard.html      # Digitales Zählboard
    └── impressum.html       # Impressum (§ 5 DDG), Gewährleistungs-Disclaimer & DSGVO
