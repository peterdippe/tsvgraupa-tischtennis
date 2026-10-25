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

📅 Anleitung: Saisonwechsel im Sommer (1-Klick-Automatik ohne Code-Änderung)
Sobald im Sommer (meist Juli/August) die neuen Staffeln für die kommende Punktspielsaison in TischtennisLive (und ggf. click-TT) veröffentlicht sind, wird der Saisonwechsel direkt im Browser durchgeführt. Es muss keine Code-Datei angefasst werden.

Schritt 1: Alte Saison abschließen & neue Saison aktivieren
Öffne [https://www.tsvgraupa-tischtennis.de/#spielbetrieb](https://www.tsvgraupa-tischtennis.de/#spielbetrieb).

Klicke oben rechts neben dem Saison-Dropdown auf den gelben Button „⚙️ Saison-Admin“ und gib dein Admin-Passwort ein.

Trage im linken Kasten („1. Aktive Hauptsaison festlegen“) das neue Startjahr ein – zum Beispiel 2027 für die Saison 2027/28.

Lass den Haken bei „Vorherige Saison vorher final in Drive sichern“ aktiviert.

Klicke auf „🚀 Saisonwechsel jetzt speichern & aktivieren“.

Was dabei automatisch im Hintergrund passiert:

Das Backend ruft ein letztes Mal den finalen Stand der alten Saison ab und friert ihn dauerhaft in dippe_tt_saison_YYYY.json auf Google Drive ein.

In der Steuerdatei dippe_tt_meta_db.json wird activeSaison auf das neue Jahr umgestellt.

Alle Saisons vor dem neuen Jahr gelten ab sofort automatisch als statisches Archiv (blitzschnelles Laden direkt aus Google Drive).

Das Saison-Dropdown erweitert sich automatisch um das neue Spieljahr und lädt es für alle Besucher als Standard-Saison.

Die neue Datei dippe_tt_saison_<NEUES_JAHR>.json wird beim ersten Abruf automatisch im Vereins-Ordner auf Google Drive angelegt.

Schritt 2: Optional – Überregionale click-TT-Mannschaft eintragen (Oberliga / Regionalliga)
Falls in der neuen Saison eine Mannschaft des TSV Graupa überregional (oberhalb der Sachsenliga, z. B. 1. Damen in der DTTB Oberliga Mitte) spielt:

Öffne im „⚙️ Saison-Admin“ den rechten Kasten („2. Überregionale click-TT-Mannschaft“).

Kopiere von mytischtennis.de/click-tt zwei Links der neuen Saison in die Felder:

Liga-Tabelle URL: den Link zur Gesamttabelle (.../tabelle/gesamt)

Mannschafts-Bilanzen URL: den Link zu den Spielerbilanzen des TSV Graupa (.../mannschaft/<ID>/TSV_Graupa/spielerbilanzen/gesamt)
(Die Links für /infos und /spiele leitet das System automatisch selbst aus der Bilanzen-URL ab.)

Klicke auf „💾 click-TT-Team speichern“.(Spielt in einer Saison keine Mannschaft überregional in click-TT, klickst du einfach auf „🗑️ Leeren“.)

Schritt 3: Optional – Neue Session in der Trainings-Challenge starten
Wechsle auf [https://www.tsvgraupa-tischtennis.de/#tt-ranking](https://www.tsvgraupa-tischtennis.de/#tt-ranking).

Klicke oben rechts auf „🔒 Admin-Modus entsperren“.

Klicke auf „🏁 Session beenden (Champion küren)“ (damit die alte Saison-Challenge samt Siegerpodest ins Archiv wandert) und anschließend auf „🆕 Neue Session starten“ (alle Spieler starten für die neue Saison wieder bei 0 Punkten).
