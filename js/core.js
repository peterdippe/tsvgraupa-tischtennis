// ===================================================================
// CORE: ROUTER, DEEP-LINKS & HELFER FÜR TSVGRAUPA-TISCHTENNIS.DE (js/core.js)
// ===================================================================

const domEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const domNum = (n, d = 0) => n == null ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: d }).format(n);
const domNorm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const ALL_VIEWS = [
    'home',
    'spielbetrieb',
    'tt-ranking',
    'tt-news',
    'turnierplaner',
    'zaehlboard',
    'impressum'
];

const PAGE_TITLES = {
    'home':          'TSV Graupa · Tischtennis | Home & Abteilung',
    'spielbetrieb':  '🏓 Spielbetrieb, Tabellen & Bilanzen | TSV Graupa TT',
    'tt-ranking':    '📈 TT-Ranking & Trainings-Challenge | TSV Graupa TT',
    'tt-news':       '📰 TT-News & Videos | TSV Graupa TT',
    'turnierplaner': '🏆 Turnierplaner | TSV Graupa TT',
    'zaehlboard':    '🔢 Digitales Zählboard | TSV Graupa TT',
    'impressum':     '⚖️ Impressum & Rechtliches | TSV Graupa TT'
};

let currentActivePageId = 'home';

// ===================================================================
// GLOBALER MASKIERTER PASSWORT-DIALOG
// ===================================================================
let _pwdModalResolver = null;

function askPasswordModal(title, subtitle) {
    return new Promise((resolve) => {
        const modal = document.getElementById('pwd-modal');
        const inp = document.getElementById('pwd-modal-input');
        const tEl = document.getElementById('pwd-modal-title');
        const sEl = document.getElementById('pwd-modal-sub');
        if (!modal || !inp) {
            resolve(null);
            return;
        }
        if (tEl) tEl.textContent = title || 'Admin-Passwort';
        if (sEl) sEl.textContent = subtitle || 'Bitte gib das Passwort ein (Eingabe erfolgt verdeckt):';
        inp.value = '';
        _pwdModalResolver = resolve;
        modal.classList.add('open');
        setTimeout(() => inp.focus(), 60);
    });
}

function submitPasswordModal(e) {
    if (e) e.preventDefault();
    const inp = document.getElementById('pwd-modal-input');
    const val = inp ? inp.value.trim() : '';
    closePasswordModal(val || null);
}

function closePasswordModal(resultVal) {
    const modal = document.getElementById('pwd-modal');
    const inp = document.getElementById('pwd-modal-input');
    if (inp) inp.value = '';
    if (modal) modal.classList.remove('open');
    if (_pwdModalResolver) {
        const fn = _pwdModalResolver;
        _pwdModalResolver = null;
        fn(resultVal);
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('pwd-modal')?.classList.contains('open')) {
        closePasswordModal(null);
    }
});

// ===================================================================
// DEEP-LINK ROUTING & TEILEN-FUNKTION
// ===================================================================
function normalizePageAlias(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (s === 'tischtennis' || s === 'punktspiele' || s === 'ligen') return 'spielbetrieb';
    if (s === 'ranking' || s === 'challenge') return 'tt-ranking';
    if (s === 'news') return 'tt-news';
    if (ALL_VIEWS.includes(s)) return s;
    return null;
}

function resolvePageIdFromUrl() {
    const redirected = sessionStorage.getItem('graupa_tt_redirect');
    if (redirected) {
        sessionStorage.removeItem('graupa_tt_redirect');
        const normRedir = normalizePageAlias(redirected);
        if (normRedir) return normRedir;
    }

    const rawHash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    const normHash = normalizePageAlias(rawHash);
    if (normHash) return normHash;

    const params = new URLSearchParams(window.location.search);
    const normQuery = normalizePageAlias(params.get('p') || params.get('page'));
    if (normQuery) return normQuery;

    const pathSeg = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/').pop();
    const normPath = normalizePageAlias(pathSeg);
    if (normPath) return normPath;

    return 'home';
}

function getShareableUrlForPage(pageId) {
    const base = window.location.origin + window.location.pathname.replace(/index\.html$/i, '');
    if (!pageId || pageId === 'home') return base;
    return `${base}#${pageId}`;
}

async function shareCurrentPage(customPageId) {
    const pid = customPageId || currentActivePageId || 'home';
    const url = getShareableUrlForPage(pid);
    const title = PAGE_TITLES[pid] || 'TSV Graupa · Tischtennis';

    if (navigator.share) {
        try {
            await navigator.share({ title, url });
            return;
        } catch (e) {}
    }
    try {
        await navigator.clipboard.writeText(url);
        showQuickToast(`🔗 Direktlink kopiert: ${url}`);
    } catch (e) {
        prompt('Direktlink zu dieser Seite kopieren:', url);
    }
}

function showQuickToast(msg) {
    let t = document.getElementById('pi-quick-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'pi-quick-toast';
        t.style.cssText = 'position:fixed; bottom:22px; right:22px; background:#06281e; color:#34d399; border:1.5px solid #34d399; padding:10px 16px; border-radius:12px; font-weight:800; font-size:13px; box-shadow:0 12px 30px rgba(0,0,0,0.5); z-index:9999; transition:opacity 0.25s;';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2600);
}

function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('open');
}

// Entfernt automatisch alle alten Schnellwahl-Seitenbuttons aus den oberen Seitenköpfen (.section-header)
function cleanSectionHeaderNavigationButtons() {
    document.querySelectorAll('.section-header button[onclick*="switchPage"]').forEach(btn => {
        btn.remove();
    });
}

let viewsLoadedPromise = null;

async function ensureAllViewsLoaded() {
    if (viewsLoadedPromise) return viewsLoadedPromise;
    viewsLoadedPromise = (async () => {
        const main = document.getElementById('app-main');
        if (!main) return;
        const snippets = await Promise.all(ALL_VIEWS.map(async (viewName) => {
            try {
                let res = await fetch(`views/${viewName}.html`);
                // Falls spielbetrieb.html noch tischtennis.html heißt, automatisch als Fallback laden:
                if (!res.ok && viewName === 'spielbetrieb') {
                    res = await fetch('views/tischtennis.html');
                }
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return await res.text();
            } catch (err) {
                console.error(`View views/${viewName}.html konnte nicht geladen werden:`, err);
                return `<section id="page-${viewName}" class="page-section"><div class="sand-card"><h3>Ansicht "${viewName}" konnte nicht geladen werden (bitte prüfen, ob views/${viewName}.html existiert).</h3></div></section>`;
            }
        }));
        main.innerHTML = snippets.join('\n');

        // Falls Fallback views/tischtennis.html geladen wurde, ID sauber auf page-spielbetrieb normieren
        const oldTtSec = document.getElementById('page-tischtennis');
        if (oldTtSec && !document.getElementById('page-spielbetrieb')) {
            oldTtSec.id = 'page-spielbetrieb';
        }

        cleanSectionHeaderNavigationButtons();

        if (typeof tpInitTurnierplaner === 'function') tpInitTurnierplaner();
        if (typeof initTTHubIfNeeded === 'function') {
            ttHubInitialized = false;
            initTTHubIfNeeded();
        }
        if (typeof initTTNewsIfNeeded === 'function') {
            initTTNewsIfNeeded();
        }
    })();
    return viewsLoadedPromise;
}

async function switchPage(pageId, skipHistoryPush = false) {
    await ensureAllViewsLoaded();
    const normId = normalizePageAlias(pageId) || 'home';
    currentActivePageId = normId;

    if (!skipHistoryPush) {
        const targetHash = normId === 'home' ? window.location.pathname : `#${normId}`;
        if (window.location.hash !== `#${normId}` && !(normId === 'home' && !window.location.hash)) {
            history.pushState({ pageId: normId }, PAGE_TITLES[normId] || 'TSV Graupa TT', targetHash);
        }
    }
    document.title = PAGE_TITLES[normId] || 'TSV Graupa · Tischtennis';

    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

    const target = document.getElementById('page-' + normId);
    if (target) target.classList.add('active');

    const nav = document.getElementById('nav-' + normId);
    if (nav) nav.classList.add('active');

    document.getElementById('sidebar')?.classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (normId === 'spielbetrieb' && typeof initTTHubIfNeeded === 'function') {
        setTimeout(() => initTTHubIfNeeded(), 60);
    }
    if (normId === 'tt-news' && typeof initTTNewsIfNeeded === 'function') {
        setTimeout(() => initTTNewsIfNeeded(), 60);
    }
    if (normId === 'tt-ranking' && typeof initTTRankingIfNeeded === 'function') {
        setTimeout(() => initTTRankingIfNeeded(), 60);
    }
}

window.addEventListener('popstate', () => {
    switchPage(resolvePageIdFromUrl(), true);
});
window.addEventListener('hashchange', () => {
    const pid = resolvePageIdFromUrl();
    if (pid !== currentActivePageId) switchPage(pid, true);
});

window.addEventListener('DOMContentLoaded', async () => {
    await ensureAllViewsLoaded();
    const initialPage = resolvePageIdFromUrl();
    switchPage(initialPage, true);
});