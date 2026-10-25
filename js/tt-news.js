// ===================================================================
// TT-NEWS: SZENE-TICKER, RSS-FEEDS & YOUTUBE-HIGHLIGHTS (js/tt-news.js)
// ===================================================================

const DEFAULT_TT_NEWS = [
    { source: 'myTischtennis.de', title: 'WTT Champions & TTBL: Die aktuellen Top-Duelle im Überblick', desc: 'Spannende Fünfsatz-Krimis in der Bundesliga und internationale Highlights der WTT-Serie.', link: 'https://www.mytischtennis.de/public/home/' },
    { source: 'TTVSA / Bezirk Dresden', title: 'Punktspielsaison 2026/27: Alle Tabellen & LivePZ-Werte des TSV Graupa', desc: 'Direkter Durchgriff auf alle Ligen, Einzelbilanzen und Spielpläne unserer Mannschaften.', link: 'https://dresden.tischtennislive.de/?L1=Public&L2=Verein&L2P=870&Page=Spielbetrieb&Sportart=96&Page2=Tabellen&Saison=2026' },
    { source: 'Material & Technik', title: '8-Eck-Hölzer, Hybrid-Beläge & Plastikball-Rotation im Check', desc: 'Wie moderne Schlägergeometrien den Sweetspot vergrößern und welche Beläge maximalen Spin erzeugen.', link: 'https://tt-spin.de/' },
    { source: 'TSV Graupa TT', title: 'Abteilungs-News & Heimspiel-Wochenenden in der Grundschule Graupa', desc: 'Aktuelle Berichte, Nachwuchsarbeit und Termine unserer Tischtennis-Abteilung.', link: 'https://www.tsv-graupa.de/index.php?s=Tischtennis&c=TT_Start' }
];

const DEFAULT_TT_VIDEOS = [
    { channel: 'World Table Tennis (WTT)', title: 'Top 10 Unbelievable Rallies · WTT Star Contender & Champions', url: 'https://www.youtube.com/@WTTGlobal/videos', badge: '🔥 WTT Highlights' },
    { channel: 'TableTennisDaily', title: 'Pro vs Amateur & Equipment Review · Spin, Speed & Cybershape', url: 'https://www.youtube.com/@TableTennisDaily/videos', badge: '🏓 Equipment & Action' },
    { channel: 'Tischtennis Deutschland', title: 'DTTB-Nationalteam · Beste Ballwechsel & Turnier-Specials', url: 'https://www.youtube.com/@tischtennisdeutschland/videos', badge: '🇩🇪 DTTB Team' },
    { channel: 'Adam Bobrow', title: 'The Snake, Around the Net & Crazy Exhibition Points!', url: 'https://www.youtube.com/@AdamBobrow/videos', badge: '⚡ Viral TT' }
];

let ttNewsInitialized = false;

function decodeHtmlEntities(str) {
    if (!str) return '';
    const txt = document.createElement('textarea');
    txt.innerHTML = String(str);
    return txt.value;
}

function initTTNewsIfNeeded() {
    if (!ttNewsInitialized) {
        ttNewsInitialized = true;
        renderTTNewsAndVideos(DEFAULT_TT_NEWS, DEFAULT_TT_VIDEOS);
        loadTTNewsFeed(false);
    }
}

function renderTTNewsAndVideos(newsList, videoList) {
    const nBox = document.getElementById('tt-news-container');
    if (nBox) {
        nBox.innerHTML = newsList.map(n => `
            <a href="${domEsc(n.link)}" target="_blank" rel="noopener" class="tt-news-item">
                <div style="display:flex; justify-content:space-between; font-size:10.5px; color:#fbbf24; font-weight:800; text-transform:uppercase;">
                    <span>${domEsc(decodeHtmlEntities(n.source))}</span><span>Artikel öffnen ↗</span>
                </div>
                <div style="font-weight:800; font-size:13.8px; margin:3px 0 4px; color:#fff;">${domEsc(decodeHtmlEntities(n.title))}</div>
                <div style="font-size:12px; color:var(--text-muted); line-height:1.45;">${domEsc(decodeHtmlEntities(n.desc))}</div>
            </a>
        `).join('');
    }

    const yBox = document.getElementById('tt-yt-container');
    if (yBox) {
        yBox.innerHTML = videoList.map(v => `
            <a href="${domEsc(v.url)}" target="_blank" rel="noopener" class="tt-yt-card">
                ${v.thumb
                    ? `<img src="${domEsc(v.thumb)}" alt="${domEsc(decodeHtmlEntities(v.title))}" class="tt-yt-thumb">`
                    : `<div class="tt-yt-thumb" style="display:flex; flex-direction:column; align-items:center; justify-content:center; background:linear-gradient(135deg,#0f2922,#1e1b4b); padding:8px; text-align:center;">
                        <span style="font-size:26px;">▶️</span>
                        <span style="font-size:10.5px; color:#fbbf24; font-weight:800; margin-top:2px;">${domEsc(v.badge || 'YouTube')}</span>
                       </div>`
                }
                <div style="padding:8px 10px;">
                    <div style="font-size:10.5px; color:#34d399; font-weight:700;">${domEsc(decodeHtmlEntities(v.channel))}</div>
                    <div style="font-size:12px; font-weight:700; line-height:1.35; margin-top:2px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${domEsc(decodeHtmlEntities(v.title))}</div>
                </div>
            </a>
        `).join('');
    }
}

async function loadTTNewsFeed() {
    const url = (CONFIG.pinnwandCloudUrl || '').trim();
    if (!url || !url.startsWith('https://script.google.com/')) return;
    try {
        const res = await fetch(url + '?kind=tt_news&t=' + Date.now());
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.ok) {
            const news = (data.news && data.news.length) ? data.news : DEFAULT_TT_NEWS;
            const vids = (data.videos && data.videos.length) ? data.videos : DEFAULT_TT_VIDEOS;
            renderTTNewsAndVideos(news, vids);
        }
    } catch (e) {}
}