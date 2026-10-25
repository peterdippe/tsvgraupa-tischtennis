// ===================================================================
// TISCHTENNIS-HUB: TTLIVE + CLICK-TT (OBERLIGA/REGIONALLIGA),
// LIVE-REFERENZ-ABGLEICH & KLICKBARE LIGA-GEGNER (js/tischtennis.js)
// ===================================================================
const TTLIVE_BASE = 'https://dresden.tischtennislive.de/';
const CLICKTT_BASE = 'https://www.mytischtennis.de';
const TTLIVE_OVERVIEW_URL = 'https://dresden.tischtennislive.de/?L1=Public&L2=Verein&L2P=870&Page=Spielbetrieb&Sportart=96&Page2=Tabellen&Saison=2026';

let ttCurrentSaison = '2026';
let ttTeamsList = [];
let ttTeamDetailsCache = {};
let activeGraupaTeamId = null;
let inspectedSubTeam = null; // { teamKey, teamName, teamUrl, isOwnGraupaTeam, sourcePortal }
let ttHubInitialized = false;
let ttPreloadGen = 0;

function initTTSaisonSelect() {
    const sel = document.getElementById('tt-saison-select');
    if (!sel || sel.children.length > 0) return;
    const years = [];
    for (let y = 2026; y >= 2009; y--) {
        const nextShort = String(y + 1).slice(-2);
        years.push(`<option value="${y}"${y === 2026 ? ' selected' : ''}>${y}/${nextShort}</option>`);
    }
    sel.innerHTML = years.join('');
}

function changeTTSaison(newSaison) {
    ttCurrentSaison = String(newSaison);
    ttPreloadGen++;
    ttTeamsList = [];
    ttTeamDetailsCache = {};
    activeGraupaTeamId = null;
    inspectedSubTeam = null;

    const eb = document.getElementById('tt-saison-eyebrow');
    if (eb) {
        eb.textContent = `Saison ${newSaison}/${String(+newSaison + 1).slice(-2)} · Punktspielbetrieb · Klicke in der Tabelle auf beliebige Vereine für deren Details`;
    }

    loadAllGraupaTeamsFromTTLive(false);
}

function initTTHubIfNeeded() {
    if (!ttHubInitialized) {
        ttHubInitialized = true;
        initTTSaisonSelect();
        loadAllGraupaTeamsFromTTLive(false);
    }
}

function setTTLiveSyncBadge(text, bg, color, borderColor) {
    const b = document.getElementById('tt-live-sync-badge');
    if (!b) return;
    b.textContent = text;
    if (bg) b.style.background = bg;
    if (color) b.style.color = color;
    if (borderColor) b.style.borderColor = borderColor;
}

function resolveTTLiveHref(href, baseOrigin) {
    if (!href) return '';
    const clean = href.replace(/&amp;/g, '&').trim();
    if (clean.startsWith('http')) return clean;
    if (baseOrigin && baseOrigin.includes('mytischtennis.de')) {
        return CLICKTT_BASE + (clean.startsWith('/') ? '' : '/') + clean;
    }
    if (clean.startsWith('?')) return TTLIVE_BASE + 'default.aspx' + clean;
    return TTLIVE_BASE + clean.replace(/^\/+/, '');
}

function isHtmlValidTTLive(html) {
    if (!html || html.length < 300) return false;
    if (/Ich bin ein Mensch/i.test(html) || /<form[^>]+Token=/i.test(html)) return false;
    if (/benötigt Ihre Nutzeranmeldung/i.test(html) || /Benutzeranmeldung/i.test(html)) return false;
    return /TSV\s+Graupa|Position|Einzel|Doppel|Spielplan|Heimmannschaft|L3=Mannschaft|click-tt|Oberliga/i.test(html);
}

function hasValidParsedDetails(d) {
    if (!d || d.error) return false;
    const hasSingles = d.singlesTable && Array.isArray(d.singlesTable.rows) && d.singlesTable.rows.length > 0;
    const hasSchedule = d.scheduleTable && Array.isArray(d.scheduleTable.rows) && d.scheduleTable.rows.length > 0;
    return Boolean(hasSingles || hasSchedule);
}

// ===================================================================
// INTELLIGENTER VEREINSNAMEN-ABGLEICH FÜR DEN SPIELPLAN
// Erkennt zuverlässig "SV Dresden-Mitte 1950" == "SV Dresden-Mitte",
// "TSV Elektronik Gornsdorf" == "TSV Elekt. Gornsdorf",
// "LTTV Leutzscher Füchse 1990" == "Leutzscher Füchse" usw.
// ===================================================================
function extractTeamNumberSuffix(name) {
    const m = String(name || '').trim().match(/\s+(\d+|[IVX]+)$/i);
    if (!m) return '1';
    return romanToArabicTeamNum(m[1]);
}

function normalizeTeamCoreTokens(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/\b(18\d\d|19\d\d|20\d\d)\b/g, ' ') // Gründungsjahre wie 1950, 1947, 1990, 2007 entfernen
        .replace(/\b(\d+|[ivx]+)\s*$/i, ' ')         // Mannschaftsnummer am Ende separat prüfen
        .replace(/\b(tsv|ttc|ttv|ttsv|lttv|sv|sg|sc|bsv|esv|post|vfl|tus|fc|ev|e\.v\.|abteilung)\b/gi, ' ')
        .replace(/[^a-zäöüß0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .filter(w => w.length >= 3);
}

function isSameTTTeamName(cellText, targetTeamName) {
    if (!cellText || !targetTeamName) return false;
    const a = cellText.trim();
    const b = targetTeamName.trim();
    if (a.toLowerCase() === b.toLowerCase()) return true;

    // Mannschaftsnummer am Ende muss übereinstimmen (z. B. "TTC Holzhausen 2" vs "TTC Holzhausen")
    const numA = extractTeamNumberSuffix(a);
    const numB = extractTeamNumberSuffix(b);
    if (numA !== numB) return false;

    if (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase())) {
        return true;
    }

    const tokA = normalizeTeamCoreTokens(a);
    const tokB = normalizeTeamCoreTokens(b);
    if (!tokA.length || !tokB.length) return false;

    // Prüfen, ob alle Kern-Anfänge des kürzeren Namens im längeren vorkommen (z.B. "elekt" in "elektronik", "gornsdorf" in "gornsdorf")
    const shorter = tokA.length <= tokB.length ? tokA : tokB;
    const longer  = tokA.length <= tokB.length ? tokB : tokA;

    const matches = shorter.filter(sw => {
        const prefix = sw.slice(0, 4);
        return longer.some(lw => lw.startsWith(prefix) || sw.startsWith(lw.slice(0, 4)));
    });
    return matches.length >= Math.max(1, Math.ceil(shorter.length * 0.65));
}

// ===================================================================
// SCHRITT A: ABRUF AUS CLOUD (MIT LIVE-VERIFIZIERUNG)
// ===================================================================
async function fetchTTLiveHtmlCascade(kind, targetUrl, teamKey, forceRefresh) {
    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();

    if (cloudUrl && cloudUrl.startsWith('https://script.google.com/')) {
        try {
            const gasUrl = kind === 'overview'
                ? `${cloudUrl}?kind=tt_overview&saison=${ttCurrentSaison}${forceRefresh ? '&force=1' : ''}&t=${Date.now()}`
                : `${cloudUrl}?kind=tt_team&saison=${ttCurrentSaison}&url=${encodeURIComponent(targetUrl)}${forceRefresh ? '&force=1' : ''}&t=${Date.now()}`;
            const res = await fetch(gasUrl, { redirect: 'follow' });
            if (res.ok) {
                const data = await res.json();
                if (data && data.ok && isHtmlValidTTLive(data.html)) {
                    return {
                        html: data.html,
                        infosHtml: data.infosHtml || '',
                        spieleHtml: data.spieleHtml || '',
                        sourcePortal: data.sourcePortal || (targetUrl.includes('mytischtennis.de') ? 'click-tt' : 'ttlive'),
                        clickTTTeams: data.clickTTTeams || [],
                        cachedTeams: data.cachedTeams || null,
                        verifiedLive: Boolean(data.verifiedLive),
                        cachedMode: data.cached || 'live',
                        fetchedAt: data.fetchedAt || new Date().toISOString()
                    };
                }
            }
        } catch (e) {}
    }

    // Browser-Proxy-Fallback
    const proxies = [
        {
            name: 'CodeTabs',
            buildUrl: u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
            extract: async r => await r.text()
        },
        {
            name: 'AllOrigins-JSON',
            buildUrl: u => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u) + '&t=' + Date.now(),
            extract: async r => { const j = await r.json(); return (j && j.contents) ? j.contents : ''; }
        }
    ];

    for (const p of proxies) {
        try {
            const res = await fetch(p.buildUrl(targetUrl));
            if (!res.ok) continue;
            const html = await res.extract(res);
            if (isHtmlValidTTLive(html)) {
                return {
                    html,
                    infosHtml: '',
                    sourcePortal: targetUrl.includes('mytischtennis.de') ? 'click-tt' : 'ttlive',
                    clickTTTeams: [],
                    cachedTeams: null,
                    verifiedLive: true,
                    cachedMode: 'proxy-live',
                    fetchedAt: new Date().toISOString()
                };
            }
        } catch (e) {}
    }

    throw new Error('Abruf erfordert aktuellen Google-Script-Login (Neue Version bereitstellen)');
}

async function loadAllGraupaTeamsFromTTLive(forceRefresh) {
    const cont = document.getElementById('tt-team-content');
    const mySaison = ttCurrentSaison;
    const isCurrentSeason = Number(mySaison) >= 2026;

    if (forceRefresh) {
        ttTeamDetailsCache = {};
        try {
            localStorage.removeItem('dippe_tt_overview_v7_' + mySaison);
            localStorage.removeItem('dippe_tt_details_v7_' + mySaison);
        } catch (e) {}
    }

    initTTSaisonSelect();
    const saisonLabel = `${mySaison}/${String(+mySaison + 1).slice(-2)}`;
    const overviewUrl = `https://dresden.tischtennislive.de/?L1=Public&L2=Verein&L2P=870&Page=Spielbetrieb&Sportart=96&Page2=Tabellen&Saison=${mySaison}`;

    const directLink = document.getElementById('tt-team-direct-link');
    if (directLink) directLink.href = overviewUrl;

    // 1. Sofort-Anzeige aus lokalem Cache (0 ms), ABER bei aktueller Saison immer mit ehrlichem Hinweis "Prüfe Live-Stand..."
    if (!ttTeamsList.length && !forceRefresh) {
        try {
            const cachedOverview = localStorage.getItem('dippe_tt_overview_v7_' + mySaison);
            const cachedDetails = localStorage.getItem('dippe_tt_details_v7_' + mySaison);
            if (cachedOverview) {
                const parsedCache = JSON.parse(cachedOverview);
                if (Array.isArray(parsedCache) && parsedCache.length) {
                    ttTeamsList = parsedCache;
                    if (cachedDetails) {
                        const rawDet = JSON.parse(cachedDetails) || {};
                        Object.keys(rawDet).forEach(k => {
                            if (hasValidParsedDetails(rawDet[k])) ttTeamDetailsCache[k] = rawDet[k];
                        });
                    }
                    activeGraupaTeamId = ttTeamsList[0].id;
                    renderGraupaTeamTabs();
                    selectGraupaTeamTab(activeGraupaTeamId, false);

                    const allDetailsPresent = ttTeamsList.every(t => hasValidParsedDetails(ttTeamDetailsCache[t.id] || ttTeamDetailsCache[t.teamKey]));
                    if (!isCurrentSeason && allDetailsPresent) {
                        setTTLiveSyncBadge(`📦 Drive-Archiv · Saison ${saisonLabel} (Abgeschlossen · ${ttTeamsList.length} Teams)`, '#e0f2fe', '#0369a1', '#7dd3fc');
                        return;
                    } else {
                        setTTLiveSyncBadge(`⚡ Cache geladen · 🔄 Prüfe Live-Stand bei TTLive & click-TT …`, '#fef3c7', '#92400e', '#fcd34d');
                    }
                }
            }
        } catch (e) {}
    }

    if (!ttTeamsList.length) {
        setTTLiveSyncBadge(`⏳ Verbinde mit TTLive & click-TT (Saison ${saisonLabel}) …`, '#fef3c7', '#92400e', '#fcd34d');
        if (cont) {
            cont.innerHTML = `<div class="tp-section-card" style="grid-column:1/-1; text-align:center; padding:28px;">
                <div style="font-size:28px; margin-bottom:8px;">🏓</div>
                <h4 style="font-size:18px; font-weight:800;">Lade TSV Graupa Saison ${saisonLabel} …</h4>
                <p class="tp-help" style="margin-top:6px;">Quellen: dresden.tischtennislive.de & mytischtennis.de/click-tt</p>
            </div>`;
        }
    }

    try {
        const result = await fetchTTLiveHtmlCascade('overview', overviewUrl, 'overview_' + mySaison, forceRefresh);
        if (ttCurrentSaison !== mySaison) return;

        let parsedTeams = parseTTLiveOverviewHtml(result.html);

        // Falls click-TT-Teams (wie 1. Damen in der Oberliga Mitte) vom Backend mitgeliefert wurden:
        // Ersetze einen evtl. unvollständigen TTLive-Eintrag der 1. Damen oder füge das click-TT-Team prominent ein!
        if (Array.isArray(result.clickTTTeams) && result.clickTTTeams.length > 0) {
            result.clickTTTeams.forEach(ct => {
                const parsedClickTeam = parseClickTTOverviewTeam(ct);
                if (parsedClickTeam) {
                    const existingIdx = parsedTeams.findIndex(t => t.tabName.toLowerCase() === parsedClickTeam.tabName.toLowerCase());
                    if (existingIdx !== -1) {
                        parsedTeams[existingIdx] = parsedClickTeam;
                    } else {
                        // Direkt nach den Herren-Top-Teams oder vor Nachwuchs einsortieren
                        parsedTeams.push(parsedClickTeam);
                    }
                }
            });
        }

        if (!parsedTeams.length) throw new Error('Keine Graupa-Tabellen im HTML gefunden');

        ttTeamsList = parsedTeams;
        try { localStorage.setItem('dippe_tt_overview_v7_' + mySaison, JSON.stringify(ttTeamsList)); } catch (e) {}

        if (result.cachedTeams && typeof result.cachedTeams === 'object') {
            Object.keys(result.cachedTeams).forEach(tKey => {
                const rawHtml = result.cachedTeams[tKey];
                if (isHtmlValidTTLive(rawHtml)) {
                    const parsedDet = parseTTLiveTeamDetailHtml(rawHtml);
                    if (hasValidParsedDetails(parsedDet)) {
                        ttTeamDetailsCache[tKey] = parsedDet;
                        ttTeamsList.forEach(tm => {
                            if (tm.teamKey === tKey || tm.id === tKey) {
                                ttTeamDetailsCache[tm.id] = parsedDet;
                            }
                        });
                    }
                }
            });
            try { localStorage.setItem('dippe_tt_details_v7_' + mySaison, JSON.stringify(ttTeamDetailsCache)); } catch (e) {}
        }

        if (!activeGraupaTeamId || !ttTeamsList.some(t => t.id === activeGraupaTeamId)) {
            activeGraupaTeamId = ttTeamsList[0].id;
        }

        const timeStr = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        if (result.verifiedLive) {
            setTTLiveSyncBadge(`✅ Live abgeglichen mit TTLive & click-TT · ${ttTeamsList.length} Teams (${timeStr} Uhr)`, '#d1fae5', '#065f46', '#6ee7b7');
        } else if (!isCurrentSeason) {
            setTTLiveSyncBadge(`📦 Drive-Archiv · Saison ${saisonLabel} (${ttTeamsList.length} Teams)`, '#e0f2fe', '#0369a1', '#7dd3fc');
        } else {
            setTTLiveSyncBadge(`☁️ Drive-Backup · Saison ${saisonLabel} (Stand ${timeStr})`, '#fef3c7', '#92400e', '#fcd34d');
        }

        renderGraupaTeamTabs();
        // Bei aktueller Saison das aktiv ausgewählte Team im Hintergrund frisch verifizieren!
        await selectGraupaTeamTab(activeGraupaTeamId, isCurrentSeason ? true : forceRefresh);

        preloadRemainingSeasonTeams(mySaison);
    } catch (err) {
        console.warn('Live-Abruf Hinweis:', err);
        if (ttTeamsList.length) {
            setTTLiveSyncBadge(`⚠️ Offline-Backup · Letzter bekannter Stand (${ttTeamsList.length} Teams)`, '#fee2e2', '#b91c1c', '#fca5a5');
        } else {
            setTTLiveSyncBadge('⚠️ Abruf-Fehler', '#fee2e2', '#b91c1c', '#fca5a5');
        }
    }
}

async function preloadRemainingSeasonTeams(saisonForRun) {
    const gen = ++ttPreloadGen;
    for (const team of ttTeamsList) {
        if (gen !== ttPreloadGen || ttCurrentSaison !== saisonForRun) return;
        const existing = ttTeamDetailsCache[team.id] || ttTeamDetailsCache[team.teamKey];
        if (hasValidParsedDetails(existing)) continue;

        await new Promise(r => setTimeout(r, 750));
        if (gen !== ttPreloadGen || ttCurrentSaison !== saisonForRun) return;

        try {
            const result = await fetchTTLiveHtmlCascade('team', team.teamUrl, team.teamKey, false);
            if (gen !== ttPreloadGen || ttCurrentSaison !== saisonForRun) return;
            const details = team.sourcePortal === 'click-tt'
                ? parseClickTTTeamDetailHtml(result.html, result.infosHtml, result.spieleHtml, team)
                : parseTTLiveTeamDetailHtml(result.html);
            if (hasValidParsedDetails(details)) {
                details._verifiedLive = result.verifiedLive;
                details._fetchedAt = result.fetchedAt;
                ttTeamDetailsCache[team.id] = details;
                ttTeamDetailsCache[team.teamKey] = details;
                try { localStorage.setItem('dippe_tt_details_v7_' + saisonForRun, JSON.stringify(ttTeamDetailsCache)); } catch (e) {}
                if (activeGraupaTeamId === team.id && (!inspectedSubTeam || inspectedSubTeam.isOwnGraupaTeam)) {
                    renderGraupaTeamLayout(team, details, false);
                }
            }
        } catch (e) {}
    }
}

// ===================================================================
// PARSER FÜR CLICK-TT (OBERLIGA MITTE / REGIONALLIGA SÜD)
// Wandelt myTischtennis.de/click-tt Tabellen nahtlos in unser Design um!
// ===================================================================
function parseClickTTOverviewTeam(ctObj) {
    if (!ctObj || !ctObj.tabelleHtml) return null;
    const doc = sanitizeTTLiveDom(ctObj.tabelleHtml);
    const tables = Array.from(doc.querySelectorAll('table'));

    // Suche die Liga-Tabelle, in der "TSV Graupa" vorkommt
    const leagueTbl = tables.find(t => /TSV\s+Graupa/i.test(t.textContent) && /Mannschaft|Begegnungen|Spiele|Punkte/i.test(t.textContent));
    if (!leagueTbl) return null;

    const rows = getDirectRows(leagueTbl);
    let standingsHeaders = [];
    const standingsRows = [];

    rows.forEach(r => {
        const rawCells = Array.from(r.children).filter(el => el.tagName === 'TD' || el.tagName === 'TH');
        const texts = rawCells.map(c => c.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());
        const nonEmpty = texts.filter(Boolean);
        if (nonEmpty.length < 4) return;

        if (!standingsHeaders.length && r.querySelector('th') && /Mannschaft/i.test(nonEmpty.join(' '))) {
            // Erste leere Auf-/Abstiegs-Spalte von click-TT überspringen, falls nötig
            standingsHeaders = texts.filter(x => x !== '');
            return;
        }
        if (/Mannschaft/i.test(nonEmpty[0]) || /Mannschaft/i.test(nonEmpty[1] || '')) return;

        // Link zur jeweiligen Mannschaft in click-TT (/mannschaft/<id>/...)
        const anchor = Array.from(r.querySelectorAll('a')).find(a => /\/mannschaft\/\d+\//i.test(a.getAttribute('href') || ''));
        let rowTeamUrl = anchor ? resolveTTLiveHref(anchor.getAttribute('href'), 'mytischtennis.de') : '';
        if (rowTeamUrl && !/spielerbilanzen/i.test(rowTeamUrl)) {
            rowTeamUrl = rowTeamUrl.replace(/\/+$/, '') + '/spielerbilanzen/gesamt';
        }
        const mIdMatch = rowTeamUrl.match(/\/mannschaft\/(\d+)\//i);
        const rowTeamKey = mIdMatch ? ('team_clicktt_' + mIdMatch[1]) : '';
        const rowTeamName = anchor ? anchor.textContent.replace(/\s+/g, ' ').trim() : '';

        // Bereinige führende Tendenz-Pfeile von click-TT, sodass Spalte 0 der Rang ("1", "2"...) und Spalte 1 der Mannschaftsname ist
        let cleanCells = nonEmpty.slice();
        const rankIdx = cleanCells.findIndex(c => /^\d+\.?$/.test(c));
        if (rankIdx > 0 && rankIdx <= 2) {
            cleanCells = cleanCells.slice(rankIdx);
        }

        const isGraupa = /TSV\s+Graupa/i.test(cleanCells.join(' '));
        standingsRows.push({
            cells: cleanCells,
            isGraupa: isGraupa,
            isCurrentTeam: isGraupa,
            rowTeamUrl: rowTeamUrl,
            rowTeamKey: rowTeamKey || (isGraupa ? ctObj.teamKey : ''),
            rowTeamName: rowTeamName || cleanCells[1] || '',
            sourcePortal: 'click-tt'
        });
    });

    if (!standingsRows.length) return null;
    const colCount = standingsRows[0].cells.length;
    if (standingsHeaders.length !== colCount) {
        if (colCount === 10) standingsHeaders = ['Pl.', 'Mannschaft', 'Beg.', 'S', 'U', 'N', 'Spiele', 'Sätze', '+/-', 'Punkte'];
        else if (colCount === 9) standingsHeaders = ['Pl.', 'Mannschaft', 'Beg.', 'S', 'U', 'N', 'Spiele', '+/-', 'Punkte'];
        else if (colCount === 8) standingsHeaders = ['Pl.', 'Mannschaft', 'Beg.', 'S', 'U', 'N', 'Spiele', 'Punkte'];
        else standingsHeaders = Array.from({ length: colCount }, (_, i) => i === 0 ? 'Pl.' : i === 1 ? 'Mannschaft' : i === colCount - 1 ? 'Punkte' : '');
    }

    return {
        id: ctObj.id,
        teamKey: ctObj.teamKey,
        tabName: ctObj.tabName,
        fullTeamName: ctObj.fullTeamName,
        league: ctObj.league,
        sourcePortal: 'click-tt',
        teamUrl: ctObj.bilanzenUrl,
        tabelleUrl: ctObj.tabelleUrl,
        infosUrl: ctObj.infosUrl,
        standingsHeaders,
        standingsRows
    };
}

function parseClickTTTeamDetailHtml(bilanzenHtml, infosHtml, spieleHtml, targetTeam) {
    if (targetTeam === undefined && typeof spieleHtml === 'object') {
        targetTeam = spieleHtml;
        spieleHtml = '';
    }

    const doc = sanitizeTTLiveDom(bilanzenHtml || '');
    const tables = Array.from(doc.querySelectorAll('table')).filter(t => !t.querySelector('table'));

    let singlesTable = null;
    let doublesTable = null;
    let scheduleTable = null;
    const captainInfo = {};
    const venueInfo = {};
    let ballInfo = '';

    tables.forEach(tbl => {
        const rows = getDirectRows(tbl);
        if (rows.length < 2) return;
        const headText = rows.slice(0, 2).map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | ');

        // 1. EINZEL- & DOPPEL-BILANZEN TRENNEN
        if (!singlesTable && (/Rang|Pos|Einsätze/i.test(headText) && /Name|Spieler|Gesamt|PK1/i.test(headText))) {
            const hCells = getCleanRowCells(rows[0]);
            const singleRows = [];
            const doubleRows = [];
            let mode = 'singles';

            rows.slice(1).forEach(r => {
                const cells = getCleanRowCells(r);
                if (cells.length < 2) return;
                const firstCell = (cells[0] || '').trim();

                if (/^Einzel$/i.test(firstCell)) {
                    singleRows.push({
                        cells: ['Gesamt', 'Einzel gesamt', '', '', '', cells[1] || ''],
                        isTotal: true
                    });
                    mode = 'doubles';
                    return;
                }

                if (/^Doppel$/i.test(firstCell)) {
                    doubleRows.push({
                        cells: ['Gesamt', '', '', cells[1] || ''],
                        isTotal: true
                    });
                    mode = 'done';
                    return;
                }

                if (/^Gesamt$/i.test(firstCell)) {
                    if (mode === 'singles') {
                        singleRows.push({
                            cells: ['Gesamt', '', '', '', '', cells[cells.length - 1] || ''],
                            isTotal: true
                        });
                    }
                    return;
                }

                if (firstCell.includes(' / ') || mode === 'doubles') {
                    mode = 'doubles';
                    const pairParts = firstCell.split(/\s*\/\s*/);
                    const p1 = pairParts[0] || firstCell;
                    const p2 = pairParts[1] || '';
                    const einsaetze = cells[1] || '';
                    const bilanz = cells[cells.length - 1] || '';
                    doubleRows.push({
                        cells: [p1, p2, einsaetze, bilanz],
                        isTotal: false
                    });
                    return;
                }

                if (mode === 'singles') {
                    singleRows.push({
                        cells: [
                            cells[0] || '',
                            cells[1] || '',
                            cells[2] || '',
                            cells[3] || '',
                            cells[4] || '',
                            cells[5] || cells[cells.length - 1] || ''
                        ],
                        isTotal: false
                    });
                }
            });

            if (singleRows.length) {
                singlesTable = {
                    headers: hCells.length === 6 ? hCells : ['Rang', 'Spieler', 'Einsätze', 'PK1', 'PK2', 'Gesamt'],
                    rows: singleRows
                };
            }
            if (doubleRows.length) {
                doublesTable = {
                    headers: ['Spielerin 1', 'Spielerin 2', 'Einsätze', 'Bilanz'],
                    rows: doubleRows
                };
            }
            return;
        }

        // 2. Spielplan-Tabelle direkt auf der Seite
        if (!scheduleTable && (/Heim/i.test(headText) || /Gast/i.test(headText) || /Begegnung/i.test(headText)) && /\d{2}\.\d{2}\.\d{2,4}/.test(tbl.textContent)) {
            scheduleTable = extractClickTTScheduleFromTable(rows);
        }
    });

    // 3. SPIELPLAN AUS spieleHtml EXTRAHIEREN
    if (!scheduleTable && spieleHtml) {
        if (/TischtennisLive/i.test(spieleHtml) && !/mytischtennis/i.test(spieleHtml)) {
            const parsedFallback = parseTTLiveTeamDetailHtml(spieleHtml);
            if (parsedFallback && parsedFallback.scheduleTable) {
                scheduleTable = parsedFallback.scheduleTable;
            }
            if (parsedFallback && parsedFallback.ballInfo && !ballInfo) {
                ballInfo = parsedFallback.ballInfo;
            }
        } else {
            const sDoc = sanitizeTTLiveDom(spieleHtml);
            const sTables = Array.from(sDoc.querySelectorAll('table')).filter(t => !t.querySelector('table'));
            for (const stbl of sTables) {
                const sRows = getDirectRows(stbl);
                if (sRows.length >= 2 && /\d{2}\.\d{2}\.\d{2,4}/.test(stbl.textContent)) {
                    const extr = extractClickTTScheduleFromTable(sRows);
                    if (extr && extr.rows.length) {
                        scheduleTable = extr;
                        break;
                    }
                }
            }
        }
    }

    // 4. INFOS-SEITE PARSEN (100% frei von <script>-JSON-Fragmenten!)
    if (infosHtml) {
        // A) Zuerst prüfen, ob Next.js JSON-Felder ("team_contact" / "playing_locations" / "gyms") im HTML stecken:
        const tcBlock = infosHtml.match(/"team_contact"\s*:\s*\{([\s\S]{1,800}?)\}/i);
        if (tcBlock) {
            const tc = tcBlock[1];
            const fn = (tc.match(/"first_?name"\s*:\s*"([^"]+)"/i) || [])[1] || '';
            const ln = (tc.match(/"last_?name"\s*:\s*"([^"]+)"/i) || [])[1] || '';
            const fullN = (tc.match(/"name"\s*:\s*"([^"]+)"/i) || [])[1] || '';
            if (fn || ln) captainInfo.name = `${fn} ${ln}`.trim();
            else if (fullN) captainInfo.name = fullN.trim();

            const em = (tc.match(/"email[^"]*"\s*:\s*"([^"]+@[^"]+)"/i) || [])[1];
            if (em) captainInfo.email = em.trim();

            const ph = (tc.match(/"(?:phone|mobile|tel)[^"]*"\s*:\s*"([^"]+)"/i) || [])[1];
            if (ph) captainInfo.phone = ph.trim();
        }

        // B) Jetzt im völlig skriptfreien DOM nach "Mannschaftskontakt" und "Spiellokal 1" suchen:
        const iDoc = sanitizeTTLiveDom(infosHtml); // sanitizeTTLiveDom entfernt alle <script>-Tags!
        iDoc.querySelectorAll('footer, nav, header, [class*="footer"], [id*="footer"]').forEach(el => el.remove());

        // Hilfsfunktion: fügt vor jedem Block/Zeilen-Tag einen echten Zeilenumbruch ein, bevor Tags entfernt werden
        const htmlToCleanLines = (el) => {
            if (!el) return [];
            const clone = el.cloneNode(true);
            clone.querySelectorAll('br, p, div, li, tr, h1, h2, h3, h4, h5, h6, dt, dd').forEach(node => {
                node.insertAdjacentText('beforebegin', '\n');
                node.insertAdjacentText('afterend', '\n');
            });
            return (clone.textContent || '')
                .split(/\r?\n/)
                .map(s => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
                .filter(s => s.length >= 2 && !/^\{"|^","|":null|"\$undefined"/i.test(s));
        };

        const allLines = htmlToCleanLines(iDoc.body);

        // Mannschaftskontakt im sichtbaren Text finden
        const mkIdx = allLines.findIndex(l => /^Mannschaftskontakt$/i.test(l));
        if (mkIdx !== -1) {
            const mkSlice = [];
            for (let k = mkIdx + 1; k < Math.min(allLines.length, mkIdx + 12); k++) {
                if (/^Spiellokal|^Mannschafts|^Verein|^Ligen/i.test(allLines[k])) break;
                mkSlice.push(allLines[k]);
            }
            if (!captainInfo.name && mkSlice[0]) {
                captainInfo.name = mkSlice[0];
            }
            const mailLine = mkSlice.find(l => /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(l));
            if (mailLine && !captainInfo.email) {
                captainInfo.email = (mailLine.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/) || [mailLine])[0];
            }
            const phoneLine = mkSlice.find(l => /(?:0\d{2,4}|\+49)[\s\/\-]*\d[\d\s\/\-]{4,}/.test(l));
            if (phoneLine && !captainInfo.phone) {
                captainInfo.phone = (phoneLine.match(/(?:0\d{2,4}|\+49)[\s\/\-]*\d[\d\s\/\-]{4,}/) || [phoneLine])[0].trim();
            }
        }

        // Spiellokal 1 im sichtbaren Text finden
        const slIdx = allLines.findIndex(l => /^Spiellokal\s*1?$/i.test(l));
        if (slIdx !== -1) {
            const slSlice = [];
            for (let k = slIdx + 1; k < Math.min(allLines.length, slIdx + 12); k++) {
                if (/^Spiellokal\s*[23]|^Mannschaftskontakt|^Verein/i.test(allLines[k])) break;
                if (!/^www\.|^http/i.test(allLines[k])) slSlice.push(allLines[k]);
            }
            const plzIdx = slSlice.findIndex(l => /^\d{5}\s+[A-ZÄÖÜa-zäöüß]/.test(l));
            if (plzIdx !== -1) {
                venueInfo.city = slSlice[plzIdx];
                if (plzIdx >= 2) {
                    venueInfo.name = slSlice[0];
                    venueInfo.street = slSlice[plzIdx - 1];
                } else if (plzIdx === 1) {
                    venueInfo.name = slSlice[0];
                }
            } else if (slSlice.length >= 2) {
                venueInfo.name = slSlice[0];
                venueInfo.street = slSlice[1];
                if (slSlice[2] && /^\d{5}/.test(slSlice[2])) venueInfo.city = slSlice[2];
            }
            const vPhone = slSlice.find(l => /(?:0\d{2,4}|\+49)[\s\/\-]*\d[\d\s\/\-]{4,}/.test(l));
            if (vPhone) {
                venueInfo.phone = (vPhone.match(/(?:0\d{2,4}|\+49)[\s\/\-]*\d[\d\s\/\-]{4,}/) || [vPhone])[0].trim();
            }
        }
    }

    // WICHTIG: Fallback auf Peter Kraetsch & Grundschule Graupa NUR DANN,
    // wenn es sich wirklich um unsere eigene Mannschaft (TSV Graupa) handelt!
    const teamLabel = (targetTeam && (targetTeam.teamName || targetTeam.fullTeamName)) || '';
    const isActuallyGraupa = Boolean(targetTeam && targetTeam.isOwnGraupaTeam) || /TSV\s+Graupa/i.test(teamLabel);

    if (isActuallyGraupa) {
        if (!captainInfo.name) captainInfo.name = 'Peter Kraetsch';
        if (!captainInfo.email) captainInfo.email = 'kraetschipe@web.de';
        if (!captainInfo.phone) captainInfo.phone = '0172 / 9 34 37 67';
        if (!venueInfo.name) venueInfo.name = 'Turnhalle der Grundschule Graupa';
        if (!venueInfo.street) venueInfo.street = 'Badstraße 3';
        if (!venueInfo.city) venueInfo.city = '01796 Pirna';
        if (!venueInfo.phone) venueInfo.phone = '03501 / 54 82 03';
        if (!ballInfo) ballInfo = 'Victas VP40+***';
    }

    return {
        headerTitle: teamLabel || 'Oberliga Mitte',
        sourcePortal: 'click-tt',
        ballInfo,
        captainInfo,
        venueInfo,
        singlesTable,
        doublesTable,
        scheduleTable
    };
}

function extractClickTTScheduleFromTable(rows) {
    const schRows = [];
    let matchCounter = 0;

    rows.slice(1).forEach(r => {
        const cells = getCleanRowCells(r);
        if (cells.length < 3) return;
        const dateIdx = cells.findIndex(c => /\d{2}\.\d{2}\.\d{2,4}/.test(c));
        if (dateIdx === -1) return;

        const timeIdx = cells.findIndex((c, i) => i >= dateIdx && /^\d{1,2}:\d{2}/.test(c));
        if (timeIdx === -1) return;

        matchCounter++;
        let tag = '';
        let dat = cells[dateIdx];
        // Trennt "Sa., 26.09.2026" oder "Sa. 26.09.2026" sauber in Tag ("Sa") und Datum ("26.09.26")!
        const combinedDateM = dat.match(/^([A-Za-zÄÖÜäöüß]{2})[.,]?\s*(\d{2}\.\d{2}\.\d{2,4})$/);
        if (combinedDateM) {
            tag = combinedDateM[1];
            dat = combinedDateM[2];
        } else if (dateIdx > 0 && /^[A-Za-zÄÖÜäöüß]{2}[.,]?$/.test(cells[dateIdx - 1])) {
            tag = cells[dateIdx - 1].replace(/[.,]+$/, '');
        }
        dat = dat.replace(/^[A-Za-zÄÖÜäöüß]{2}[.,]?\s*/, '').replace(/\.20(\d{2})$/, '.$1');

        const zeit = cells[timeIdx].replace(/\s+/g, ' ').trim();

        let cursor = timeIdx + 1;
        while (cursor < cells.length && (/^\(?\d\)?$|^H\d$/i.test(cells[cursor]) || !cells[cursor])) {
            cursor++;
        }

        let heim = cells[cursor] || '';
        let gast = cells[cursor + 1] || '';
        let tail = cells.slice(cursor + 2).join(' ').trim();

        const scoreInGast = gast.match(/^(.*?)\s+(\d{1,2}:\d{1,2})(?:\s+.*)?$/);
        let erg = '';
        if (scoreInGast) {
            gast = scoreInGast[1].trim();
            erg  = scoreInGast[2].trim();
        } else {
            const scoreInTail = tail.match(/(\d{1,2}:\d{1,2})/);
            if (scoreInTail) {
                erg = scoreInTail[1];
            } else if (/Vorbericht|verlegt|abgesagt|kampflos/i.test(tail)) {
                erg = (tail.match(/Vorbericht|verlegt|abgesagt|kampflos/i) || ['Vorbericht'])[0];
            } else {
                erg = tail || 'Vorbericht';
            }
        }

        const strayScore = erg.match(/^(.*?)\s+(\d{1,2}:\d{1,2})$/);
        if (strayScore && !gast) {
            gast = strayScore[1].trim();
            erg = strayScore[2].trim();
        }

        schRows.push({
            cells: [String(matchCounter), tag || 'Sa', dat, zeit, heim, gast, erg],
            isTotal: false
        });
    });

    if (!schRows.length) return null;
    return {
        headers: ['Nr.', 'Tag', 'Datum', 'Zeit', 'Heimmannschaft', 'Gastmannschaft', 'Ergebnis'],
        rows: schRows
    };
}

// ===================================================================
// STANDARD-PARSER FÜR TISCHTENNISLIVE (INKL. GEGNER-LINKS)
// ===================================================================
function sanitizeTTLiveDom(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    doc.querySelectorAll('script, style, noscript, iframe, object, embed, [id*="dialog_ical"], [id*="ical_spielplan"]').forEach(el => el.remove());
    return doc;
}

function getDirectRows(tbl) {
    const rows = [];
    Array.from(tbl.children).forEach(child => {
        if (child.tagName === 'TR') {
            rows.push(child);
        } else if (['THEAD', 'TBODY', 'TFOOT'].includes(child.tagName)) {
            Array.from(child.children).forEach(tr => {
                if (tr.tagName === 'TR') rows.push(tr);
            });
        }
    });
    return rows;
}

function getCleanRowCells(tr) {
    const DirectCells = Array.from(tr.children).filter(el => el.tagName === 'TD' || el.tagName === 'TH');
    if (DirectCells.some(c => c.querySelectorAll('tr').length > 2)) return [];

    const raw = DirectCells.map(c => c.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());

    const merged = [];
    for (let i = 0; i < raw.length; i++) {
        const cur = raw[i];
        if (!cur) continue;
        if (cur === ':' && merged.length > 0 && i + 1 < raw.length && raw[i + 1]) {
            merged[merged.length - 1] = merged[merged.length - 1] + ':' + raw[i + 1];
            i++;
        } else if (/^:\d+$/.test(cur) && merged.length > 0 && /^\d+$/.test(merged[merged.length - 1])) {
            merged[merged.length - 1] = merged[merged.length - 1] + cur;
        } else {
            merged.push(cur);
        }
    }
    return merged;
}

function findSectionHeadingAbove(tbl) {
    let node = tbl;
    while (node && node.tagName !== 'BODY') {
        let prev = node.previousElementSibling;
        while (prev) {
            const t = prev.textContent.replace(/\s+/g, ' ').trim();
            if (t.length >= 4 && t.length <= 110 && !/tischtennislive|spielbetrieb|platz\s+mannschaft/i.test(t)) {
                return t;
            }
            prev = prev.previousElementSibling;
        }
        node = node.parentElement;
    }
    return '';
}

function romanToArabicTeamNum(str) {
    const map = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10' };
    return map[String(str || '').toUpperCase()] || str || '1';
}

function deriveGraupaTabName(graupaNameInTable, leagueTitle) {
    const numMatch = graupaNameInTable.match(/TSV\s+Graupa\s+(\d+|[IVX]+)\b/i);
    const teamNum = numMatch ? romanToArabicTeamNum(numMatch[1]) : '1';
    const lt = (leagueTitle || '').toLowerCase();

    let category = 'Erwachsene';
    if (lt.includes('damen') || lt.includes('frauen') || lt.includes('mädchen')) category = 'Damen';
    else if (lt.includes('jugend 19') || lt.includes('u19') || lt.includes('jungen 19')) category = 'Jugend 19';
    else if (lt.includes('jugend 18') || lt.includes('u18') || lt.includes('jungen 18')) category = 'Jugend 18';
    else if (lt.includes('jugend 15') || lt.includes('u15') || lt.includes('schüler 15') || lt.includes('jungen 15') || lt.includes('schüler a')) category = 'Schüler 15';
    else if (lt.includes('jugend 13') || lt.includes('u13') || lt.includes('u11') || lt.includes('schüler b') || lt.includes('schüler c')) category = 'Nachwuchs';
    else if (lt.includes('schüler')) category = 'Schüler';
    else if (lt.includes('jugend') || lt.includes('jungen')) category = 'Jugend';
    else if (lt.includes('senioren') || lt.includes('altersklasse')) category = 'Senioren';

    return `${teamNum}. ${category}`;
}

function formatShortLeague(leagueTitle) {
    if (!leagueTitle) return `Saison ${ttCurrentSaison}/${String(+ttCurrentSaison + 1).slice(-2)}`;
    let s = String(leagueTitle)
        .replace(/^Kreisunion\s+Dresden\s*[,·-]?\s*/i, '')
        .replace(/^Bezirk\s+Dresden\s*[,·-]?\s*/i, '')
        .replace(/^DTTB\s+/i, '')
        .replace(/\bGruppe\s+/gi, 'Gr. ')
        .replace(/\b(Erwachsene|Herren|Damen|Frauen|Jugend\s*\d*|Jungen\s*\d*|Schüler\s*[A-C0-9]*)\b/gi, '')
        .replace(/\s+,/g, ',')
        .replace(/,\s*,/g, ',')
        .replace(/^[\s,·-]+|[\s,·-]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return s || leagueTitle;
}

function parseTTLiveOverviewHtml(htmlString) {
    const doc = sanitizeTTLiveDom(htmlString);
    const teams = [];
    const seenTableTeamPairs = new Set();
    const allTables = Array.from(doc.querySelectorAll('table'));

    const allLinks = Array.from(doc.querySelectorAll('a'));
    const graupaLinks = allLinks.filter(a => {
        const txt = a.textContent.replace(/\s+/g, ' ').trim();
        const href = a.getAttribute('href') || '';
        return /TSV\s+Graupa/i.test(txt) && /L3=Mannschaft|L3P=/i.test(href);
    });

    graupaLinks.forEach(teamAnchor => {
        const tbl = teamAnchor.closest('table');
        if (!tbl) return;

        const rawHref = teamAnchor.getAttribute('href') || '';
        const teamUrl = resolveTTLiveHref(rawHref);
        const graupaTeamName = teamAnchor.textContent.replace(/\s+/g, ' ').trim();
        const l3pMatch = teamUrl.match(/L3P=(\d+)/i);
        const l3p = l3pMatch ? l3pMatch[1] : String(teams.length + 1);
        const tblIdx = allTables.indexOf(tbl);

        const pairKey = `${tblIdx}_${l3p}`;
        if (seenTableTeamPairs.has(pairKey)) return;
        seenTableTeamPairs.add(pairKey);

        let leagueTitle = findSectionHeadingAbove(tbl);
        let standingsHeaders = [];
        const standingsRows = [];

        const rows = getDirectRows(tbl);
        rows.forEach(r => {
            const cells = getCleanRowCells(r);
            if (!cells.length) return;

            if (!standingsHeaders.length && cells.length <= 2 && cells[0].length > 4 && !/Platz|Mannschaft/i.test(cells[0])) {
                if (!leagueTitle) leagueTitle = cells[0];
                return;
            }

            if (cells.length < 4) return;
            const joined = cells.join(' ');

            if (!standingsHeaders.length && /Mannschaft/i.test(joined) && /Punkte|Pkt|Spiele|ST/i.test(joined)) {
                standingsHeaders = cells;
                return;
            }

            if (/^Platz$/i.test(cells[0]) || /^Mannschaft$/i.test(cells[1] || '')) return;

            const rowAnchor = Array.from(r.querySelectorAll('a')).find(a => /L3=Mannschaft|L3P=/i.test(a.getAttribute('href') || ''));
            const rowTeamUrl = rowAnchor ? resolveTTLiveHref(rowAnchor.getAttribute('href') || '') : '';
            const rowL3pMatch = rowTeamUrl.match(/L3P=(\d+)/i);
            const rowTeamKey = rowL3pMatch ? ('team_' + rowL3pMatch[1]) : '';
            const rowTeamName = rowAnchor ? rowAnchor.textContent.replace(/\s+/g, ' ').trim() : (cells[1] || '');

            const isGraupa = /TSV\s+Graupa/i.test(joined);
            const isCurrentTeam = r.contains(teamAnchor);
            standingsRows.push({
                cells,
                isGraupa,
                isCurrentTeam,
                rowTeamUrl,
                rowTeamKey,
                rowTeamName,
                sourcePortal: 'ttlive'
            });
        });

        if (!standingsRows.length) return;

        const colCount = standingsRows[0].cells.length;
        if (standingsHeaders.length !== colCount) {
            if (colCount === 10) standingsHeaders = ['Pl.', 'Mannschaft', 'ST', 'S', 'U', 'N', 'Ball', 'Satz', 'Spiele', 'Punkte'];
            else if (colCount === 11) standingsHeaders = ['Pl.', 'Mannschaft', 'ST', 'S', 'U', 'N', 'Ball', 'Satz', 'Spiele', '+/-', 'Punkte'];
            else if (colCount === 12) standingsHeaders = ['Pl.', 'Mannschaft', 'ST', 'S', 'U', 'N', 'Ball', 'Satz', 'Spiele', '+/-', 'Punkte', '+/-'];
            else if (colCount === 9) standingsHeaders = ['Pl.', 'Mannschaft', 'ST', 'S', 'U', 'N', 'Spiele', '+/-', 'Punkte'];
            else if (colCount === 8) standingsHeaders = ['Pl.', 'Mannschaft', 'ST', 'S', 'U', 'N', 'Spiele', 'Punkte'];
            else standingsHeaders = Array.from({ length: colCount }, (_, i) => i === 0 ? 'Pl.' : i === 1 ? 'Mannschaft' : i === colCount - 1 ? 'Pkt.' : '');
        }

        const teamKey = 'team_' + l3p;
        let id = teamKey;
        if (teams.some(t => t.id === id)) {
            id = `${teamKey}_${teams.length + 1}`;
        }

        const tabName = deriveGraupaTabName(graupaTeamName, leagueTitle);

        teams.push({
            id,
            teamKey,
            tabName,
            fullTeamName: graupaTeamName,
            league: leagueTitle || `Saison ${ttCurrentSaison}/${String(+ttCurrentSaison + 1).slice(-2)}`,
            sourcePortal: 'ttlive',
            teamUrl,
            standingsHeaders,
            standingsRows
        });
    });

    return teams;
}

function renderGraupaTeamTabs() {
    const bar = document.getElementById('tt-team-tabs');
    if (!bar) return;
    bar.innerHTML = ttTeamsList.map((t, idx) => {
        const shortLg = formatShortLeague(t.league);
        const portalTag = t.sourcePortal === 'click-tt' ? ' · 🌐 click-TT' : '';
        return `
            <button class="tt-team-tab ${t.id === activeGraupaTeamId ? 'active' : ''}"
                    onclick="selectGraupaTeamTab('${t.id}', false)"
                    title="${domEsc(t.fullTeamName + ' · ' + t.league + portalTag)}">
                <span class="tt-tab-title">🏓 ${domEsc(t.tabName || ((idx + 1) + '. Mannschaft'))}</span>
                <span class="tt-tab-sub">${domEsc(shortLg + portalTag)}</span>
            </button>
        `;
    }).join('') + `
        <button class="btn btn-sand" style="margin-left:auto; padding:6px 11px; font-size:11.5px; align-self:center;" onclick="loadAllGraupaTeamsFromTTLive(true)" title="Alle Tabellen & Bilanzen dieser Saison frisch von TTLive & click-TT abrufen">
            🔄 Live-Referenz abgleichen
        </button>
    `;
}

async function selectGraupaTeamTab(teamId, forceRefresh) {
    activeGraupaTeamId = teamId;
    const team = ttTeamsList.find(t => t.id === teamId);
    if (!team) return;

    inspectedSubTeam = {
        teamKey: team.teamKey,
        teamName: team.fullTeamName || team.tabName,
        teamUrl: team.teamUrl,
        isOwnGraupaTeam: true,
        sourcePortal: team.sourcePortal || 'ttlive'
    };
    renderGraupaTeamTabs();
    await loadAndRenderInspectedTeam(team, inspectedSubTeam, forceRefresh);
}

async function selectLeagueTableRowTeam(rowIdx, forceRefresh = false) {
    const team = ttTeamsList.find(t => t.id === activeGraupaTeamId);
    if (!team || !team.standingsRows[rowIdx]) return;
    const row = team.standingsRows[rowIdx];
    if (!row.rowTeamUrl || !row.rowTeamKey) return;

    // Eigenes Team zuverlässig erkennen (auch wenn click-TT "team_clicktt_3080673" nutzt)
    const isOwn = (row.rowTeamKey === team.teamKey) || Boolean(row.isGraupa && /TSV\s+Graupa/i.test(row.rowTeamName || ''));
    inspectedSubTeam = {
        teamKey: isOwn ? team.teamKey : row.rowTeamKey,
        teamName: row.rowTeamName || row.cells[1] || 'Mannschaft',
        teamUrl: row.rowTeamUrl,
        isOwnGraupaTeam: isOwn,
        sourcePortal: row.sourcePortal || team.sourcePortal || 'ttlive'
    };
    await loadAndRenderInspectedTeam(team, inspectedSubTeam, forceRefresh);
}

async function loadAndRenderInspectedTeam(baseGraupaTeam, subTeam, forceRefresh) {
    const directLink = document.getElementById('tt-team-direct-link');
    if (directLink && subTeam.teamUrl) {
        directLink.href = subTeam.teamUrl;
        directLink.textContent = subTeam.sourcePortal === 'click-tt'
            ? 'Original in click-TT öffnen ↗'
            : 'Original in TTLive öffnen ↗';
    }

    const tKey = subTeam.teamKey;
    const isCurrentSeason = Number(ttCurrentSaison) >= 2026;
    const cached = !forceRefresh ? (ttTeamDetailsCache[tKey] || (subTeam.isOwnGraupaTeam ? ttTeamDetailsCache[baseGraupaTeam.id] : null)) : null;
    const isValidCache = hasValidParsedDetails(cached);

    renderGraupaTeamLayout(baseGraupaTeam, isValidCache ? cached : null, !isValidCache);

    if (isValidCache && (!isCurrentSeason || cached._verifiedLiveInSession)) {
        return;
    }

    const mySaison = ttCurrentSaison;
    try {
        const result = await fetchTTLiveHtmlCascade('team', subTeam.teamUrl, tKey, Boolean(forceRefresh));
        if (ttCurrentSaison !== mySaison) return;

        // WICHTIG: Hier wird jetzt "subTeam" (das tatsächlich angeklickte Team!) übergeben!
        const details = subTeam.sourcePortal === 'click-tt'
            ? parseClickTTTeamDetailHtml(result.html, result.infosHtml, result.spieleHtml, subTeam)
            : parseTTLiveTeamDetailHtml(result.html);

        if (hasValidParsedDetails(details)) {
            details._verifiedLive = result.verifiedLive;
            details._verifiedLiveInSession = true;
            details._fetchedAt = result.fetchedAt;
            details._sourcePortal = subTeam.sourcePortal || 'ttlive';

            ttTeamDetailsCache[tKey] = details;
            if (subTeam.isOwnGraupaTeam) ttTeamDetailsCache[baseGraupaTeam.id] = details;
            try { localStorage.setItem('dippe_tt_details_v8_' + mySaison, JSON.stringify(ttTeamDetailsCache)); } catch (e) {}

            if (activeGraupaTeamId === baseGraupaTeam.id && inspectedSubTeam && inspectedSubTeam.teamKey === tKey) {
                renderGraupaTeamLayout(baseGraupaTeam, details, false);
            }
        }
    } catch (err) {
        console.warn('Fehler beim Laden der Mannschaftsdetails:', err);
        if (!isValidCache && activeGraupaTeamId === baseGraupaTeam.id && inspectedSubTeam && inspectedSubTeam.teamKey === tKey) {
            renderGraupaTeamLayout(baseGraupaTeam, { error: String(err.message || err) }, false);
        }
    }
}

function parseTTLiveTeamDetailHtml(htmlString) {
    const doc = sanitizeTTLiveDom(htmlString);
    const fullText = doc.body ? doc.body.textContent : '';

    let headerTitle = '';
    const candidates = Array.from(doc.querySelectorAll('h1, h2, h3, td, th, div, span'));
    for (const el of candidates) {
        if (el.querySelector('table')) continue;
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (/^[^,\n\r]{3,45},\s*[^,\n\r]{3,45}$/i.test(t) && /Erwachsene|Herren|Damen|Jugend|Schüler|Nachwuchs|Senioren/i.test(t)) {
            headerTitle = t.replace(/\s+(Vorrunde|Rückrunde|Gesamt)$/i, '').trim();
            break;
        }
    }

    let ballInfo = '';
    const ballMatch = fullText.match(/Die\s+Mannschaft\s+verwendet\s+Bälle\s+der\s+Marke\s+([^\n\r.!]+?)(?=Einzel|Doppel|Spielplan|$)/i);
    if (ballMatch) ballInfo = ballMatch[0].replace(/\s+/g, ' ').trim();

    const allTables = Array.from(doc.querySelectorAll('table')).filter(t => t.querySelectorAll('table').length === 0);
    const captainInfo = {};
    const venueInfo = {};
    let singlesTable = null;
    let doublesTable = null;
    let scheduleTable = null;

    allTables.forEach(tbl => {
        const rows = getDirectRows(tbl);
        if (!rows.length) return;
        const txt = tbl.textContent.replace(/\s+/g, ' ').trim();

        if (/Name/i.test(txt) && /Vertretung|Mobil|Email|Telefon/i.test(txt) && rows.length <= 12) {
            rows.forEach(r => {
                const cells = getCleanRowCells(r);
                if (cells.length >= 2) {
                    const k = cells[0].toLowerCase();
                    const v = cells.slice(1).join(' ').replace(/Erst nach Anmeldung.*/i, '').trim();
                    if (k === 'name' && !captainInfo.name && v) captainInfo.name = v;
                    else if (k.includes('vertretung') && v) captainInfo.deputy = v;
                    else if ((k.includes('mobil') || k.includes('telefon')) && v) captainInfo.phone = v;
                }
            });
            return;
        }

        if (/Bezeichnung/i.test(txt) && /Strasse|Straße|PLZ|Spieltag/i.test(txt) && rows.length <= 14) {
            rows.forEach(r => {
                const cells = getCleanRowCells(r);
                if (cells.length >= 2) {
                    const k = cells[0].toLowerCase();
                    const v = cells.slice(1).join(' ');
                    if (k.includes('bezeichnung')) venueInfo.name = v;
                    else if (k.includes('strasse') || k.includes('straße')) venueInfo.street = v;
                    else if (k.includes('plz') || k.includes('ort')) venueInfo.city = v;
                    else if (k.includes('telefon')) venueInfo.phone = v;
                    else if (k.includes('spieltag')) venueInfo.matchDay = v;
                }
            });
            return;
        }

        let headerRowIdx = -1;
        let headerJoined = '';
        for (let rIdx = 0; rIdx < Math.min(3, rows.length); rIdx++) {
            const hc = getCleanRowCells(rows[rIdx]);
            const hj = hc.join(' | ');
            if ((/Position/i.test(hj) && /Spieler/i.test(hj)) ||
                (/Spieler\s*1/i.test(hj) && /Spieler\s*2/i.test(hj)) ||
                (/Datum/i.test(hj) && (/Heim/i.test(hj) || /Gast/i.test(hj)))) {
                headerRowIdx = rIdx;
                headerJoined = hj;
                break;
            }
        }
        if (headerRowIdx === -1) return;

        if (/Position/i.test(headerJoined) && /Spieler/i.test(headerJoined)) {
            singlesTable = extractCleanDataTable(rows, headerRowIdx, 'singles');
        } else if (/Spieler\s*1/i.test(headerJoined) && /Spieler\s*2/i.test(headerJoined)) {
            doublesTable = extractCleanDataTable(rows, headerRowIdx, 'doubles');
        } else if (/Datum/i.test(headerJoined) && (/Heim/i.test(headerJoined) || /Gast/i.test(headerJoined))) {
            scheduleTable = extractCleanDataTable(rows, headerRowIdx, 'schedule');
        }
    });

    return { headerTitle, sourcePortal: 'ttlive', ballInfo, captainInfo, venueInfo, singlesTable, doublesTable, scheduleTable };
}

function extractCleanDataTable(rows, headerIdx, kind) {
    const readCellText = (el) => {
        let txt = el.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const imgs = Array.from(el.querySelectorAll('img'));
        const badges = [];
        imgs.forEach(img => {
            const alt = (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
            const src = (img.getAttribute('src') || '').toLowerCase();
            if (/^e$/i.test(alt) || /ersatz/i.test(alt) || src.includes('ersatz') || src.includes('_e.')) badges.push('E');
            else if (/^j$/i.test(alt) || /jugend|nachwuchs/i.test(alt) || src.includes('jugend') || src.includes('_j.')) badges.push('J');
            else if (/spv|sperr/i.test(alt) || src.includes('sperr')) badges.push('SPV');
        });
        const uniqBadges = [...new Set(badges)].filter(b => !new RegExp('\\b' + b + '\\b').test(txt));
        if (uniqBadges.length) {
            txt = (uniqBadges.join(' ') + (txt ? ' ' + txt : '')).trim();
        }
        return txt;
    };

    const expandRow = (tr) => {
        const directEls = Array.from(tr.children).filter(el => el.tagName === 'TD' || el.tagName === 'TH');
        if (directEls.some(c => c.querySelectorAll('tr').length > 2)) return [];
        const cols = [];
        directEls.forEach(el => {
            const span = Math.max(1, parseInt(el.getAttribute('colspan') || '1', 10));
            const txt = readCellText(el);
            cols.push(txt);
            for (let k = 1; k < span; k++) cols.push('');
        });
        return cols;
    };

    const rawHeaderCols = expandRow(rows[headerIdx]);
    const rawBodyRows = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const rCols = expandRow(rows[i]);
        if (rCols.filter(Boolean).length >= 2) {
            rawBodyRows.push(rCols);
        }
    }

    if (kind === 'schedule') {
        const headers = ['Nr.', 'Tag', 'Datum', 'Zeit', 'Heimmannschaft', 'Gastmannschaft', 'Ergebnis'];
        const bodyRows = rawBodyRows.map(rCols => {
            const nonEmpty = rCols.filter(Boolean);
            const dateIdx = nonEmpty.findIndex(c => /^\d{2}\.\d{2}\.\d{2,4}$/.test(c));
            const timeIdx = nonEmpty.findIndex((c, idx) => idx > dateIdx && /^\d{1,2}:\d{2}(\s*Uhr)?$/i.test(c));

            if (dateIdx !== -1 && timeIdx !== -1) {
                const nr  = nonEmpty[0] || '';
                const tag = dateIdx >= 2 ? nonEmpty[dateIdx - 1] : (nonEmpty[1] || '');
                const dat = nonEmpty[dateIdx] || '';
                const flags = nonEmpty.slice(dateIdx + 1, timeIdx).join(' ').trim();
                const zeit = flags ? `${flags} ${nonEmpty[timeIdx]}` : nonEmpty[timeIdx];
                const heim = nonEmpty[timeIdx + 1] || '';
                const gast = nonEmpty[timeIdx + 2] || '';
                const erg  = nonEmpty.slice(timeIdx + 3).join(' ').trim();
                return { cells: [nr, tag, dat, zeit, heim, gast, erg], isTotal: false };
            }

            const merged = [];
            for (let c = 0; c < nonEmpty.length; c++) {
                if (/^[vhtauVHTAU\s]{1,5}$/.test(nonEmpty[c]) && c + 1 < nonEmpty.length && /^\d{1,2}:\d{2}/.test(nonEmpty[c + 1])) {
                    merged.push(nonEmpty[c] + ' ' + nonEmpty[c + 1]);
                    c++;
                } else {
                    merged.push(nonEmpty[c]);
                }
            }
            return { cells: merged.slice(0, 7), isTotal: false };
        });
        return { headers, rows: bodyRows };
    }

    if (kind === 'doubles') {
        const headers = ['Spieler 1', 'Spieler 2', 'Bilanz', '+/-'];
        const bodyRows = rawBodyRows.map(rCols => {
            const nonEmpty = rCols.filter(Boolean);
            const isTotal = nonEmpty.some(c => /^Gesamt$/i.test(c));
            if (isTotal) {
                const gIdx = nonEmpty.findIndex(c => /^Gesamt$/i.test(c));
                const rest = nonEmpty.slice(gIdx + 1);
                return { cells: ['Gesamt', '', rest[0] || '', rest[1] || ''], isTotal: true };
            }
            let vals = [...nonEmpty];
            if (vals.length > 4 && /^\d+\.?$/.test(vals[0])) vals.shift();
            return {
                cells: [vals[0] || '', vals[1] || '', vals[2] || '', vals[3] || ''],
                isTotal: false
            };
        });
        return { headers, rows: bodyRows };
    }

    const maxCols = Math.max(rawHeaderCols.length, ...rawBodyRows.map(r => r.length));
    const normHeader = Array.from({ length: maxCols }, (_, s) => rawHeaderCols[s] || '');

    if (kind === 'singles') {
        const pkHeaders = [];
        normHeader.forEach(h => {
            const m = h.match(/PK\s*(\d+)/i);
            if (m) {
                const label = 'PK' + m[1];
                if (!pkHeaders.includes(label)) pkHeaders.push(label);
            }
        });
        if (pkHeaders.length === 0) pkHeaders.push('PK1', 'PK2', 'PK3');
        const pkCount = pkHeaders.length;
        const hasLpz = normHeader.some(h => /LivePZ|LPZ/i.test(h));
        const headers = ['Position', 'Spieler', 'Kz.', 'ST', ...pkHeaders, 'Gesamt', ...(hasLpz ? ['LivePZ'] : [])];

        const bodyRows = rawBodyRows.map(rCols => {
            const isTotal = rCols.some(c => /^Gesamt$/i.test(c));
            if (isTotal) {
                const nonEmpty = rCols.filter(Boolean);
                const gIdx = nonEmpty.findIndex(c => /^Gesamt$/i.test(c));
                const ratios = nonEmpty.slice(gIdx + 1);
                const cells = ['Gesamt', '', '', ''];
                for (let p = 0; p < pkCount; p++) cells.push(ratios[p] || '');
                cells.push(ratios[pkCount] || '');
                if (hasLpz) cells.push('');
                return { cells, isTotal: true };
            }

            let idxPos = rCols.findIndex(c => /^\d+\.?$|^\d+[A-Za-z]+\/\d+$/.test(c));
            if (idxPos === -1) idxPos = 0;
            const posVal = rCols[idxPos] || '';

            let idxName = -1;
            for (let k = idxPos + 1; k < rCols.length; k++) {
                if (rCols[k] && !/^\d+$/.test(rCols[k])) { idxName = k; break; }
            }
            const nameVal = idxName !== -1 ? rCols[idxName] : '';

            let idxSt = -1;
            for (let k = (idxName !== -1 ? idxName + 1 : idxPos + 1); k < rCols.length; k++) {
                if (/^\d{1,2}$/.test(rCols[k])) { idxSt = k; break; }
            }
            const stVal = idxSt !== -1 ? rCols[idxSt] : '';

            let kzVal = '';
            if (idxName !== -1 && idxSt !== -1 && idxSt > idxName + 1) {
                kzVal = rCols.slice(idxName + 1, idxSt).filter(Boolean).join(' ');
            }

            const afterSt = idxSt !== -1 ? rCols.slice(idxSt + 1) : [];
            const pkVals = [];
            for (let p = 0; p < pkCount; p++) pkVals.push(afterSt[p] || '');
            const totalVal = afterSt[pkCount] || '';
            const lpzVal = hasLpz ? (afterSt[pkCount + 1] || '') : '';

            const cells = [posVal, nameVal, kzVal, stVal, ...pkVals, totalVal, ...(hasLpz ? [lpzVal] : [])];
            return { cells, isTotal: false };
        });

        return { headers, rows: bodyRows };
    }

    const normBody = rawBodyRows.map(r => Array.from({ length: maxCols }, (_, s) => r[s] || ''));
    return { headers: normHeader, rows: normBody.map(cells => ({ cells, isTotal: false })) };
}

// ===================================================================
// SCHRITT C: ZWEISPALTIGES RENDERING (MIT QUELLEN-TRANSPARENZ & GEGNER-HIGHLIGHT)
// ===================================================================
function renderGraupaTeamLayout(team, details, isLoadingDetails) {
    const cont = document.getElementById('tt-team-content');
    if (!cont) return;

    const curSub = inspectedSubTeam || {
        teamKey: team.teamKey,
        teamName: team.fullTeamName || team.tabName,
        teamUrl: team.teamUrl,
        isOwnGraupaTeam: true,
        sourcePortal: team.sourcePortal || 'ttlive'
    };

    const isClickTT = (curSub.sourcePortal || team.sourcePortal) === 'click-tt';
    const portalName = isClickTT ? 'click-TT / myTischtennis.de' : 'TischtennisLive';
    const portalBadgeBg = isClickTT ? '#1e3a8a' : 'var(--emerald-dark)';

    const standingsHtml = `
        <div class="tp-section-card" style="margin-bottom:0;">
            <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
                <div>
                    <span class="eyebrow-dark">${domEsc(team.league)}</span>
                    <h4 style="font-size:18px; font-weight:800;">📊 Liga-Tabelle · ${domEsc(team.tabName)}</h4>
                </div>
                <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                    <span class="badge" style="background:${portalBadgeBg}; color:#fff; font-size:10.5px;">🌐 Quelle: ${portalName}</span>
                    <span class="badge" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; font-size:10.5px;">👆 Verein antippen für Details</span>
                </div>
            </div>
            <div class="tt-table-scroll" style="overflow-x:auto;">
                <table class="tt-data-table">
                    <thead>
                        <tr>${team.standingsHeaders.map(h => `<th>${domEsc(h)}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${team.standingsRows.map((r, rIdx) => {
                            const isSelectedRow = (r.rowTeamKey && r.rowTeamKey === curSub.teamKey) || (!curSub.teamKey && r.isCurrentTeam);
                            const clickableCls = r.rowTeamUrl ? 'tt-clickable-team' : '';
                            const selectedCls = isSelectedRow ? 'tt-selected-team' : '';
                            const graupaCls = r.isGraupa ? 'graupa-row' : '';
                            return `
                                <tr class="${graupaCls} ${clickableCls} ${selectedCls}"
                                    ${r.rowTeamUrl ? `onclick="selectLeagueTableRowTeam(${rIdx}, false)" title="Klicken, um Spielplan, Bilanzen & Halle von ${domEsc(r.rowTeamName || r.cells[1])} anzuzeigen"` : ''}>
                                    ${r.cells.map((c, idx) => {
                                        let prefix = '';
                                        if (idx === 1) {
                                            if (r.isGraupa) prefix = '🏓 ';
                                            else if (isSelectedRow) prefix = '🔎 ';
                                        }
                                        return `<td class="${idx === 1 ? 'tt-col-wrap' : ''}" style="${idx >= r.cells.length - 3 ? 'font-family:JetBrains Mono,monospace;font-weight:700;' : ''}">${prefix}${domEsc(c)}</td>`;
                                    }).join('')}
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const opponentBannerHtml = !curSub.isOwnGraupaTeam ? `
        <div style="background:#fef3c7; border:1.5px solid #f59e0b; color:#92400e; border-radius:12px; padding:10px 14px; display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; font-size:12.5px; font-weight:700;">
            <span>🔎 Liga-Inspektor: <b>${domEsc(curSub.teamName)}</b> (${portalName})</span>
            <button class="btn btn-emerald" style="padding:5px 11px; font-size:11.5px;" onclick="selectGraupaTeamTab('${team.id}', false)">
                🏓 Zurück zu ${domEsc(team.fullTeamName || team.tabName)}
            </button>
        </div>
    ` : '';

    let scheduleHtml = '';
    if (isLoadingDetails) {
        scheduleHtml = `<div class="tp-section-card" style="margin-bottom:0; text-align:center; padding:22px;">
            ⏳ Lade aktuellen Spielplan für <b>${domEsc(curSub.teamName)}</b> von ${portalName} …
        </div>`;
    } else if (details && details.scheduleTable && details.scheduleTable.rows.length) {
        scheduleHtml = `
            <div class="tp-section-card" style="margin-bottom:0;">
                <h4 style="font-size:18px; font-weight:800; margin-bottom:8px;">📅 Spielplan & Ergebnisse · ${domEsc(curSub.teamName)}</h4>
                <div class="tt-table-scroll" style="overflow-x:auto;">
                    <table class="tt-data-table">
                        <thead>
                            <tr>${details.scheduleTable.headers.map(h => `<th>${domEsc(h)}</th>`).join('')}</tr>
                        </thead>
                        <tbody>
                            ${details.scheduleTable.rows.map(r => {
                                return `<tr>${r.cells.map((c, idx) => {
                                    const isTeamCol = idx === 4 || idx === 5;
                                    const isGraupaCell = isTeamCol && /TSV\s+Graupa/i.test(c);
                                    // Smart-Match: Erkennt auch verkürzte Vereinsnamen wie "SV Dresden-Mitte" für "SV Dresden-Mitte 1950"!
                                    const isInspectedCell = isTeamCol && !isGraupaCell && !curSub.isOwnGraupaTeam && isSameTTTeamName(c, curSub.teamName);
                                    const highlightStyle = isGraupaCell
                                        ? 'font-weight:800;color:var(--emerald-dark);'
                                        : isInspectedCell
                                            ? 'font-weight:800;color:#d97706;'
                                            : '';
                                    const iconPrefix = isGraupaCell ? '🏓 ' : (isInspectedCell ? '🔎 ' : '');
                                    return `<td class="${isTeamCol ? 'tt-col-wrap' : ''}" style="${highlightStyle}${idx === r.cells.length - 1 ? 'font-family:JetBrains Mono,monospace;font-weight:800;' : ''}">${iconPrefix}${domEsc(c)}</td>`;
                                }).join('')}</tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    const leftCol = `<div style="display:flex; flex-direction:column; gap:16px;">${standingsHtml}${scheduleHtml}</div>`;

    let rightCol = '';
    if (isLoadingDetails) {
        rightCol = `
            <div style="display:flex; flex-direction:column; gap:16px;">
                ${opponentBannerHtml}
                <div class="tp-section-card" style="text-align:center; padding:34px;">
                    <div style="font-size:26px; margin-bottom:8px;">⏳</div>
                    <h4 style="font-size:17px; font-weight:800;">Lade Bilanzen & Metadaten für ${domEsc(curSub.teamName)} …</h4>
                </div>
            </div>
        `;
    } else if (!details || details.error) {
        rightCol = `
            <div style="display:flex; flex-direction:column; gap:16px;">
                ${opponentBannerHtml}
                <div class="tp-section-card">
                    <h4 style="font-size:17px; font-weight:800;">📊 Detail-Auswertung (${domEsc(curSub.teamName)})</h4>
                    <p class="tp-help" style="margin:8px 0 14px;">Die Detailseite konnte gerade nicht geladen werden (${domEsc(details?.error || 'Unbekannter Status')}).</p>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="btn btn-emerald" onclick="loadAndRenderInspectedTeam(ttTeamsList.find(t=>t.id==='${team.id}'), inspectedSubTeam, true)">🔄 Erneut abrufen</button>
                        <a href="${domEsc(curSub.teamUrl)}" target="_blank" rel="noopener" class="btn btn-sand">Direkt in ${portalName} öffnen ↗</a>
                    </div>
                </div>
            </div>
        `;
    } else {
        const renderParsedTable = (tblObj, emptyMsg) => {
            if (!tblObj || !tblObj.rows.length) return `<p class="tp-help">${emptyMsg}</p>`;
            return `
                <div class="tt-table-scroll" style="overflow-x:auto;">
                    <table class="tt-data-table">
                        <thead>
                            <tr>${tblObj.headers.map(h => `<th>${domEsc(h)}</th>`).join('')}</tr>
                        </thead>
                        <tbody>
                            ${tblObj.rows.map(r => `
                                <tr style="${r.isTotal ? 'background:var(--bg-sand);font-weight:800;' : ''}">
                                    ${r.cells.map((c, idx) => `<td class="${idx === 1 ? 'tt-col-wrap' : ''}" style="${idx === 1 && !r.isTotal ? 'font-weight:700;' : ''}${/^\d+:\d+$|^\[?\d{3,4}\]?$|^[+-]?\d+$/.test(c) ? 'font-family:JetBrains Mono,monospace;' : ''}">${domEsc(c)}</td>`).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        };

        const cap = details.captainInfo || {};
        const ven = details.venueInfo || {};
        const isGraupaVenue = curSub.isOwnGraupaTeam || /Graupa/i.test((ven.name || '') + ' ' + (ven.city || ''));
        const fullAddress = [ven.street || (isGraupaVenue ? 'Badstr. 3' : ''), ven.city || (isGraupaVenue ? '01796 Pirna OT Graupa' : '')].filter(Boolean).join(', ');
        const cleanBall = (details.ballInfo || '')
            .replace(/^Die\s+Mannschaft\s+verwendet\s+Bälle\s+der\s+Marke\s*/i, '')
            .trim();

        const mapSectionHtml = isGraupaVenue
            ? `<iframe title="Karte Spielstätte"
                       src="https://www.openstreetmap.org/export/embed.html?bbox=13.9165%2C50.9995%2C13.9285%2C51.0055&layer=mapnik&marker=51.0025%2C13.9225"
                       style="width:100%; height:115px; border:1px solid var(--border-sand); border-radius:10px;"></iframe>`
            : `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((ven.name ? ven.name + ', ' : '') + fullAddress)}"
                  target="_blank" rel="noopener" class="btn btn-emerald" style="width:100%; padding:10px; font-size:12.5px; margin-top:6px;">
                  🗺️ Route zur Gast-Halle in Google Maps öffnen ↗
               </a>`;

        rightCol = `
            <div style="display:flex; flex-direction:column; gap:16px;">
                ${opponentBannerHtml}
                <div class="tp-section-card" style="margin-bottom:0;">
                    <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px;">
                        <h4 style="font-size:17px; font-weight:800;">👤 Einzel-Bilanzen · ${domEsc(curSub.teamName)}</h4>
                        <a href="${domEsc(curSub.teamUrl)}" target="_blank" rel="noopener" style="font-size:11.5px; font-weight:700; color:var(--emerald-dark); text-decoration:none;">Original in ${portalName} ↗</a>
                    </div>
                    <div style="margin-bottom:16px;">
                        ${renderParsedTable(details.singlesTable, 'Noch keine Einzel-Einsätze verbucht.')}
                    </div>

                    <h4 style="font-size:17px; font-weight:800; margin-bottom:6px;">👥 Doppel-Bilanzen · ${domEsc(curSub.teamName)}</h4>
                    <div>
                        ${renderParsedTable(details.doublesTable, 'Noch keine Doppel-Einsätze verbucht.')}
                    </div>
                </div>

                <div class="grid-2" style="gap:12px;">
                    <div class="tp-section-card" style="margin-bottom:0;">
                        <span class="person-role">📋 Metadaten · ${domEsc(curSub.teamName)}</span>
                        <div style="font-size:10.5px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-top:6px;">Mannschaftsführer</div>
                        <h5 style="font-size:17px; font-weight:800; margin:1px 0 8px; color:var(--text-dark);">${domEsc(cap.name || ('Siehe ' + portalName))}</h5>
                        <div style="font-size:12.5px; color:#475569; line-height:1.75;">
                            ${cap.phone ? `<div>📞 <b>Telefon:</b> <a href="tel:${domEsc(cap.phone.replace(/[^0-9+]/g, ''))}" style="color:var(--emerald-dark); font-weight:700; text-decoration:none;">${domEsc(cap.phone)}</a></div>` : ''}
                            ${cap.email ? `<div>✉️ <b>E-Mail:</b> <a href="mailto:${domEsc(cap.email)}" style="color:var(--emerald-dark); font-weight:700; text-decoration:none;">${domEsc(cap.email)}</a></div>` : ''}
                            ${cap.deputy ? `<div>👥 <b>Vertretung:</b> ${domEsc(cap.deputy)}</div>` : ''}
                            ${ven.matchDay ? `<div>📅 <b>Heimspieltag:</b> ${domEsc(ven.matchDay)}</div>` : ''}
                            ${cleanBall ? `<div>🟡 <b>Spielball:</b> ${domEsc(cleanBall)}</div>` : ''}
                            <div style="margin-top:8px;">
                                <a href="${domEsc(curSub.teamUrl)}" target="_blank" rel="noopener" style="color:var(--emerald-dark); font-weight:700; font-size:12px;">
                                    🔗 Offizielle Seite in ${portalName} ↗
                                </a>
                            </div>
                        </div>
                    </div>

                    <div class="tp-section-card" style="margin-bottom:0;">
                        <span class="person-role">📍 Sportstätte & Anfahrt</span>
                        <h5 style="font-size:14.5px; font-weight:800; margin:4px 0 4px;">${domEsc(ven.name || (isGraupaVenue ? 'Turnhalle Grundschule Graupa' : 'Sporthalle'))}</h5>
                        <div style="font-size:12px; color:#475569; margin-bottom:8px;">
                            ${domEsc(fullAddress || ('Adresse siehe ' + portalName))}${ven.phone ? ' · Tel: ' + domEsc(ven.phone) : ''}
                        </div>
                        ${mapSectionHtml}
                    </div>
                </div>
            </div>
        `;
    }

    cont.innerHTML = leftCol + rightCol;
}

window.addEventListener('DOMContentLoaded', () => {
    initTTHubIfNeeded();
});
