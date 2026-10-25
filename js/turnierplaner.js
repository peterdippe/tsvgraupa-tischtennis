// =====================================================================
// TURNIERPLANER – APPLICATION (State + UI + Logik)
// =====================================================================
// ---- Core (getestet, siehe tp_core) ----
const TP = (function () {
    function roundRobinPairs(n) {
        const idx = []; for (let i = 0; i < n; i++) idx.push(i);
        if (n % 2 === 1) idx.push(-1);
        const m = idx.length, rounds = [], arr = idx.slice();
        for (let r = 0; r < m - 1; r++) {
            const round = [];
            for (let i = 0; i < m / 2; i++) {
                const a = arr[i], b = arr[m - 1 - i];
                if (a !== -1 && b !== -1) round.push({ a: Math.min(a, b), b: Math.max(a, b) });
            }
            rounds.push(round);
            const fixed = arr[0], rest = arr.slice(1); rest.unshift(rest.pop());
            arr.splice(0, arr.length, fixed, ...rest);
        }
        const flat = []; rounds.forEach(rd => rd.forEach(p => flat.push(p))); return flat;
    }
    function snakeSeedGroups(seeds, numGroups) {
        const groups = Array.from({ length: numGroups }, () => []);
        let g = 0, dir = 1;
        for (const p of seeds) {
            groups[g].push(p); g += dir;
            if (g === numGroups) { g = numGroups - 1; dir = -1; }
            else if (g < 0) { g = 0; dir = 1; }
        }
        return groups;
    }
    function computeStandings(playerIds, matches, winSets) {
        const st = {};
        playerIds.forEach(id => st[id] = { id, games: 0, wins: 0, losses: 0, pts: 0, setsW: 0, setsL: 0, ballsW: 0, ballsL: 0 });
        const done = matches.filter(m => m.done && m.sets && m.sets.length);
        done.forEach(m => {
            if (!(m.aId in st) || !(m.bId in st)) return;
            let sa = 0, sb = 0, ba = 0, bb = 0;
            m.sets.forEach(([x, y]) => { ba += x; bb += y; if (x > y) sa++; else if (y > x) sb++; });
            const A = st[m.aId], B = st[m.bId];
            A.games++; B.games++; A.setsW += sa; A.setsL += sb; B.setsW += sb; B.setsL += sa;
            A.ballsW += ba; A.ballsL += bb; B.ballsW += bb; B.ballsL += ba;
            if (sa > sb) { A.wins++; B.losses++; A.pts += 2; } else { B.wins++; A.losses++; B.pts += 2; }
        });
        const list = playerIds.map(id => st[id]);
        function headToHead(ids) {
            const sub = {}; ids.forEach(id => sub[id] = { id, pts: 0, setDiff: 0, ballDiff: 0 });
            done.forEach(m => {
                if (ids.includes(m.aId) && ids.includes(m.bId)) {
                    let sa = 0, sb = 0, ba = 0, bb = 0;
                    m.sets.forEach(([x, y]) => { ba += x; bb += y; if (x > y) sa++; else if (y > x) sb++; });
                    sub[m.aId].setDiff += sa - sb; sub[m.bId].setDiff += sb - sa;
                    sub[m.aId].ballDiff += ba - bb; sub[m.bId].ballDiff += bb - ba;
                    if (sa > sb) sub[m.aId].pts += 2; else sub[m.bId].pts += 2;
                }
            });
            return sub;
        }
        list.sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            const tiedIds = list.filter(x => x.pts === a.pts).map(x => x.id);
            if (tiedIds.length > 1) {
                const h = headToHead(tiedIds);
                if (h[b.id].pts !== h[a.id].pts) return h[b.id].pts - h[a.id].pts;
                if (h[b.id].setDiff !== h[a.id].setDiff) return h[b.id].setDiff - h[a.id].setDiff;
                if (h[b.id].ballDiff !== h[a.id].ballDiff) return h[b.id].ballDiff - h[a.id].ballDiff;
            }
            const sdA = a.setsW - a.setsL, sdB = b.setsW - b.setsL; if (sdB !== sdA) return sdB - sdA;
            const bdA = a.ballsW - a.ballsL, bdB = b.ballsW - b.ballsL; if (bdB !== bdA) return bdB - bdA;
            return 0;
        });
        list.forEach((s, i) => s.place = i + 1);
        return list;
    }
    function bracketSeedOrder(size) {
        let seeds = [1, 2];
        while (seeds.length < size) {
            const n = seeds.length * 2, next = [];
            seeds.forEach(s => { next.push(s); next.push(n + 1 - s); });
            seeds = next;
        }
        return seeds;
    }
    function buildKoBracket(qualifiers, size) {
        const byRank = {};
        qualifiers.forEach(q => { (byRank[q.rank] = byRank[q.rank] || []).push(q); });
        Object.keys(byRank).forEach(r => byRank[r].sort((a, b) => (a.seedStrength || 0) - (b.seedStrength || 0)));
        const ordered = [];
        Object.keys(byRank).map(Number).sort((a, b) => a - b).forEach(r => byRank[r].forEach(q => ordered.push(q)));
        const order = bracketSeedOrder(size);
        const slots = new Array(size).fill(null), slotMeta = new Array(size).fill(null);
        for (let slot = 0; slot < size; slot++) {
            const q = ordered[order[slot] - 1];
            if (q) { slots[slot] = q.playerId; slotMeta[slot] = q; }
        }
        for (let i = 0; i < size; i += 2) {
            const a = slotMeta[i], b = slotMeta[i + 1];
            if (a && b && a.group != null && a.group === b.group) {
                for (let j = 0; j < size; j += 2) {
                    if (j === i) continue;
                    const c = slotMeta[j], d = slotMeta[j + 1];
                    if (d && a.group !== d.group && (!c || c.group !== b.group)) {
                        slots[i + 1] = d.playerId; slotMeta[i + 1] = d;
                        slots[j + 1] = b.playerId; slotMeta[j + 1] = b; break;
                    }
                }
            }
        }
        return { slots };
    }
    function defaultKoSize(n) { let s = 2; while (s < n) s *= 2; return s; }
    function validateResult(sets, winSets, winPts) {
        const errors = [];
        if (!sets || !sets.length) return { ok: false, errors: ['Keine Sätze eingetragen.'], winner: null };
        let sa = 0, sb = 0;
        sets.forEach(([x, y], i) => {
            const n = i + 1;
            if (x == null || y == null || isNaN(x) || isNaN(y)) { errors.push(`Satz ${n}: Punkte fehlen.`); return; }
            if (x < 0 || y < 0) { errors.push(`Satz ${n}: negative Punkte.`); return; }
            if (x === y) { errors.push(`Satz ${n}: unentschieden ${x}:${y} unmöglich.`); return; }
            const hi = Math.max(x, y), lo = Math.min(x, y);
            if (hi < winPts) errors.push(`Satz ${n}: Gewinner braucht mind. ${winPts} Punkte (${x}:${y}).`);
            else if (hi === winPts) { if (hi - lo < 2) errors.push(`Satz ${n}: bei ${winPts} sind 2 Pkt. Vorsprung nötig (${x}:${y}).`); }
            else { if (hi - lo !== 2) errors.push(`Satz ${n}: Verlängerung muss mit genau 2 Pkt. enden (${x}:${y}).`); if (lo < winPts - 1) errors.push(`Satz ${n}: Verlängerung erst ab ${winPts - 1}:${winPts - 1} (${x}:${y}).`); }
            if (x > y) sa++; else sb++;
        });
        if (sa > winSets || sb > winSets) errors.push(`Zu viele gewonnene Sätze (max. ${winSets}).`);
        if (sa < winSets && sb < winSets) errors.push(`Noch nicht entschieden – ${winSets} Sätze nötig (Stand ${sa}:${sb}).`);
        return { ok: errors.length === 0, errors, winner: sa > sb ? 'a' : (sb > sa ? 'b' : null), setsA: sa, setsB: sb };
    }
    return { roundRobinPairs, snakeSeedGroups, computeStandings, bracketSeedOrder, buildKoBracket, defaultKoSize, validateResult };
})();

// ------------------- State -------------------
// -----------------------------------------------------------------
// ADMIN-SICHERHEIT & BERECHTIGUNGEN
// -----------------------------------------------------------------
let tpAdminMode = false;

async function tpToggleAdminMode() {
    if (tpAdminMode) {
        tpAdminMode = false;
        sessionStorage.removeItem('dippe_admin_pwd');
        document.getElementById('tp-admin-lock-btn').textContent = '🔒 Admin-Modus entsperren';
        document.getElementById('tp-admin-lock-btn').className = 'btn btn-amber';
        tpUpdateUIPermissions();
        alert('Admin-Modus gesperrt. Die Seite ist wieder im Nur-Lese-Modus.');
    } else {
        const pwd = (typeof askPasswordModal === 'function')
            ? await askPasswordModal('🏆 Turnierplaner · Admin', 'Bitte gib das Admin-Passwort ein (verdeckte Eingabe):')
            : prompt('Bitte gib das Admin-Passwort ein:');
        if (!pwd) return;
        
        // Teste das Passwort direkt mit einem leisen Check gegen Google Drive
        tpTestPassword(pwd).then(ok => {
            if (ok) {
                tpAdminMode = true;
                sessionStorage.setItem('dippe_admin_pwd', pwd);
                document.getElementById('tp-admin-lock-btn').textContent = '🔓 Admin aktiv (Sperren)';
                document.getElementById('tp-admin-lock-btn').className = 'btn btn-emerald';
                tpUpdateUIPermissions();
                alert('Admin-Modus erfolgreich entsperrt!');
            } else {
                alert('Falsches Passwort!');
            }
        });
    }
}

async function tpTestPassword(pwd) {
    if (!tpDriveReady()) return false;
    try {
        const res = await fetch(TP_DRIVE_URL, {
            method: 'POST', redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ kind: 'turnier', password: pwd, tournaments: tpReadStore() })
        });
        const j = await res.json();
        return j && j.ok === true;
    } catch (e) {
        return false;
    }
}

function tpUpdateUIPermissions() {
    const btnNew = document.getElementById('tp-btn-new');
    const btnSave = document.getElementById('tp-btn-save');
    
    if (btnNew) btnNew.classList.toggle('hidden', !tpAdminMode);
    if (btnSave) btnSave.classList.toggle('hidden', !tpAdminMode);
    
    const hint = document.getElementById('tp-save-hint');
    if (hint) hint.textContent = tpAdminMode ? '✏️ Admin-Modus aktiv' : '👁️ Nur-Lese-Modus (Gast)';
}

async function tpSaveToCloudAndLocal() {
    if (!tpAdminMode) { alert('Keine Berechtigung! Bitte erst den Admin-Modus entsperren.'); return; }
    await tpSaveLocal(true);
    await tpSaveToDrive();
}
let T = null;            // aktuelles Turnier-Objekt
let tpSortKey = 'lpz', tpSortDir = -1;  // Default: LPZ absteigend
let tpDirty = false;
const TP_LS_KEY = 'dippe_turniere_v1';
const TP_DRIVE_URL = (typeof CONFIG !== 'undefined' && CONFIG.pinnwandCloudUrl) ? CONFIG.pinnwandCloudUrl : '';

function tpUid() { return 'p' + Math.random().toString(36).slice(2, 9); }
function tpMark() { tpDirty = true; }

// ------------------- Neues Turnier -------------------
function tpNewTournament() {
    if (T && tpDirty && !confirm('Aktuelles Turnier verwerfen? Nicht gespeicherte Änderungen gehen verloren.')) return;
    T = {
        id: 't' + Date.now(), name: '', date: '', leader: '', plannedCount: 8,
        winSets: 3, winPts: 11,
        players: [],
        single: tpDefaultMode(),
        doublesEnabled: false, doubles: { teams: [], mode: tpDefaultMode() },
        womenEnabled: false, women: { mode: tpDefaultMode() },
        started: false,
        comps: {}  // wird bei Start befüllt
    };
    for (let i = 0; i < 8; i++) tpAddPlayer();
    tpDirty = false;
    tpRenderMetaPanel();
}
function tpDefaultMode() {
    return { type: 'group-ko', groupSize: 4, advance: 2, fillBest: true, allPlaces: false,
             placeScope: 'full', koSize: 0, started: false };
}
function tpAddPlayer(data) {
    T.players.push(Object.assign({ id: tpUid(), name: '', vorname: '', lpz: 0, geschlecht: 'm', verein: '' }, data || {}));
}

// ------------------- Metadaten-Panel rendern -------------------
function tpRenderMetaPanel() {
    tpUpdateUIPermissions();
    document.getElementById('tp-empty').style.display = 'none';
    document.getElementById('tp-live').style.display = 'none';
    const panel = document.getElementById('tp-meta-panel');
    panel.style.display = 'block';
    document.getElementById('tp-m-name').value = T.name;
    document.getElementById('tp-m-date').value = T.date;
    document.getElementById('tp-m-leader').value = T.leader;
    T.plannedCount = T.players.length;
    document.getElementById('tp-m-count').value = T.plannedCount;
    document.getElementById('tp-m-winsets').value = T.winSets;
    document.getElementById('tp-m-winpts').value = T.winPts;
    tpRenderPlayerTable();
    tpRenderModeConfig('single', document.getElementById('tp-mode-single'));
    document.getElementById('tp-dbl-enable').checked = T.doublesEnabled;
    document.getElementById('tp-women-enable').checked = T.womenEnabled;
    tpToggleDbl(); tpToggleWomen();
}

function tpBindMeta() {
    const map = { 'tp-m-name': 'name', 'tp-m-date': 'date', 'tp-m-leader': 'leader' };
    Object.entries(map).forEach(([id, k]) => { const e = document.getElementById(id); if (e) { e.oninput = () => { T[k] = e.value; tpMark(); }; T[k] = e.value; } });
    const ws = document.getElementById('tp-m-winsets'); if (ws) { ws.oninput = e => { T.winSets = Math.max(1, +e.target.value || 3); tpMark(); }; T.winSets = Math.max(1, +ws.value || 3); }
    const wp = document.getElementById('tp-m-winpts'); if (wp) { wp.oninput = e => { T.winPts = Math.max(1, +e.target.value || 11); tpMark(); }; T.winPts = Math.max(1, +wp.value || 11); }
}

// ------------------- Spieler-Tabelle -------------------
function tpSortedPlayers() {
    const arr = T.players.slice();
    arr.forEach((p, i) => p._origNr = i + 1);
    if (tpSortKey === 'nr') return arr;
    arr.sort((a, b) => {
        let va = a[tpSortKey], vb = b[tpSortKey];
        if (tpSortKey === 'lpz') { va = +va || 0; vb = +vb || 0; }
        else { va = ('' + va).toLowerCase(); vb = ('' + vb).toLowerCase(); }
        if (va < vb) return -1 * tpSortDir; if (va > vb) return 1 * tpSortDir; return 0;
    });
    return arr;
}
function tpRenderPlayerTable() {
    const tb = document.getElementById('tp-player-tbody'); tb.innerHTML = '';
    const list = tpSortedPlayers();
    list.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color:#94a3b8; font-weight:700;">${p._origNr}</td>
            <td><input value="${tpEsc(p.name)}" oninput="tpSetP('${p.id}','name',this.value)"></td>
            <td><input value="${tpEsc(p.vorname)}" oninput="tpSetP('${p.id}','vorname',this.value)"></td>
            <td><input type="number" style="width:70px;" value="${p.lpz}" oninput="tpSetP('${p.id}','lpz',this.value)"></td>
            <td><select onchange="tpSetP('${p.id}','geschlecht',this.value)">
                <option value="m"${p.geschlecht === 'm' ? ' selected' : ''}>m</option>
                <option value="w"${p.geschlecht === 'w' ? ' selected' : ''}>w</option></select></td>
            <td><input value="${tpEsc(p.verein)}" oninput="tpSetP('${p.id}','verein',this.value)"></td>
            <td><button class="tp-mini-btn tp-mini-del" onclick="tpDelPlayer('${p.id}')">✕</button></td>`;
        tb.appendChild(tr);
    });
    // Sort-Indikatoren
    document.querySelectorAll('#tp-player-table th[data-sort]').forEach(th => {
        const ind = th.querySelector('.sort-ind');
        ind.textContent = th.dataset.sort === tpSortKey ? (tpSortDir === 1 ? ' ▲' : ' ▼') : '';
    });
}
function tpSetP(id, k, v) { const p = T.players.find(x => x.id === id); if (!p) return; p[k] = (k === 'lpz') ? (+v || 0) : v; tpMark(); }
function tpSyncCount() { T.plannedCount = T.players.length; const el = document.getElementById('tp-m-count'); if (el) el.value = T.plannedCount; }
function tpAddPlayerRow() { tpAddPlayer(); tpSyncCount(); tpMark(); tpRenderPlayerTable(); }
function tpDelPlayer(id) { T.players = T.players.filter(p => p.id !== id); tpSyncCount(); tpMark(); tpRenderPlayerTable(); }
function tpEsc(s) { return ('' + (s == null ? '' : s)).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// ------------------- Modus-Konfiguration (single/women/doubles) -------------------
function tpRenderModeConfig(which, container) {
    const mode = which === 'single' ? T.single : which === 'women' ? T.women.mode : T.doubles.mode;
    const pfx = 'tpm-' + which;
    container.innerHTML = `
        <div class="tp-field" style="max-width:280px;">
            <label>Turniermodus</label>
            <select id="${pfx}-type" onchange="tpModeSet('${which}','type',this.value)">
                <option value="group-ko"${mode.type === 'group-ko' ? ' selected' : ''}>Gruppen + KO-Runde</option>
                <option value="ko"${mode.type === 'ko' ? ' selected' : ''}>Nur KO-Runde</option>
                <option value="round-robin"${mode.type === 'round-robin' ? ' selected' : ''}>Jeder gegen jeden (eine Gruppe)</option>
            </select>
        </div>
        <div id="${pfx}-gkconf" class="tp-conditional" style="display:${mode.type === 'group-ko' ? 'block' : 'none'};">
            <div class="tp-grid">
                <div class="tp-field"><label>Gruppengröße</label><input type="number" min="2" id="${pfx}-gs" value="${mode.groupSize}" onchange="tpModeSet('${which}','groupSize',this.value)"></div>
                <div class="tp-field"><label>Weiterkommende / Gruppe</label><input type="number" min="1" id="${pfx}-adv" value="${mode.advance}" onchange="tpModeSet('${which}','advance',this.value)"></div>
            </div>
            <label style="font-size:12.5px; display:block; margin-top:6px;"><input type="checkbox" id="${pfx}-fill" ${mode.fillBest ? 'checked' : ''} onchange="tpModeSet('${which}','fillBest',this.checked)"> Nächstbeste aus allen Gruppen auffüllen, falls Tableau nicht aufgeht</label>
        </div>
        <label style="font-size:12.5px; display:block; margin-top:8px;"><input type="checkbox" id="${pfx}-allp" ${mode.allPlaces ? 'checked' : ''} onchange="tpModeSet('${which}','allPlaces',this.checked)"> Alle Platzierungen ausspielen (Platzierungsspiele)</label>
        <div id="${pfx}-scope" class="tp-conditional" style="display:${mode.allPlaces ? 'block' : 'none'}; margin-top:6px;">
            <div class="tp-field" style="max-width:360px;">
                <label>Umfang der Platzierungsspiele</label>
                <select id="${pfx}-pscope" onchange="tpModeSet('${which}','placeScope',this.value)">
                    <option value="full"${(mode.placeScope || 'full') === 'full' ? ' selected' : ''}>Alle Plätze 1 bis N komplett ausspielen</option>
                    <option value="top4"${mode.placeScope === 'top4' ? ' selected' : ''}>Nur Plätze 1–4 (Verliererbaum bis Platz 3)</option>
                </select>
                <p class="tp-help">Gewinner steigen im Gewinnerbaum auf, Verlierer in den Verliererbaum (Doppel-K.o.).</p>
            </div>
        </div>
    `;
}
function tpModeSet(which, k, v) {
    const mode = which === 'single' ? T.single : which === 'women' ? T.women.mode : T.doubles.mode;
    if (['groupSize', 'advance'].includes(k)) v = Math.max(1, +v || 1);
    mode[k] = v; tpMark();
    if (k === 'type' || k === 'allPlaces') {
        const cont = which === 'single' ? document.getElementById('tp-mode-single')
            : which === 'women' ? document.getElementById('tp-women-config')
                : document.getElementById('tp-dbl-config');
        if (which === 'doubles') tpRenderDblConfig(); else if (which === 'women') tpRenderWomenConfig(); else tpRenderModeConfig('single', cont);
    }
}

// ------------------- Doppel-Konfiguration -------------------
function tpToggleDbl() {
    T.doublesEnabled = document.getElementById('tp-dbl-enable').checked; tpMark();
    document.getElementById('tp-dbl-config').style.display = T.doublesEnabled ? 'block' : 'none';
    if (T.doublesEnabled) tpRenderDblConfig();
}
function tpRenderDblConfig() {
    const c = document.getElementById('tp-dbl-config');
    const used = new Set(); T.doubles.teams.forEach(t => { used.add(t.p1); used.add(t.p2); });
    const chips = T.players.filter(p => p.name || p.vorname).map(p => {
        const isUsed = used.has(p.id), isSel = _dblPick.includes(p.id);
        return `<span class="tp-dbl-chip${isSel ? ' sel' : ''}${isUsed && !isSel ? ' used' : ''}" onclick="${isUsed && !isSel ? '' : `tpDblPick('${p.id}')`}">${tpEsc(p.vorname)} ${tpEsc(p.name)}</span>`;
    }).join('');
    const teamsHtml = T.doubles.teams.map((t, i) => {
        const a = T.players.find(p => p.id === t.p1), b = T.players.find(p => p.id === t.p2);
        return `<div class="tp-match"><span class="tp-match-names">Doppel ${i + 1}: ${a ? a.vorname + ' ' + a.name : '?'} / ${b ? b.vorname + ' ' + b.name : '?'}</span><button class="tp-mini-btn tp-mini-del" onclick="tpDblDel(${i})">✕</button></div>`;
    }).join('') || '<p class="tp-help">Noch keine Doppel zusammengestellt.</p>';
    c.innerHTML = `
        <p class="tp-help">Klicke zwei Spieler an → „Doppel bilden". Bereits verwendete Spieler sind ausgegraut.</p>
        <div class="tp-dbl-pick">${chips || '<span class="tp-help">Zuerst Spieler mit Namen anlegen.</span>'}</div>
        <button class="btn btn-sand" style="margin:6px 0;" onclick="tpDblMake()">➕ Doppel bilden (${_dblPick.length}/2)</button>
        <div>${teamsHtml}</div>
        <h4 style="margin-top:14px;">Modus Doppel</h4>
        <div id="tp-dbl-mode"></div>`;
    tpRenderModeConfig('doubles', document.getElementById('tp-dbl-mode'));
}
let _dblPick = [];
function tpDblPick(id) { const i = _dblPick.indexOf(id); if (i >= 0) _dblPick.splice(i, 1); else if (_dblPick.length < 2) _dblPick.push(id); tpRenderDblConfig(); }
function tpDblMake() {
    if (_dblPick.length !== 2) { alert('Bitte genau zwei Spieler auswählen.'); return; }
    T.doubles.teams.push({ id: tpUid(), p1: _dblPick[0], p2: _dblPick[1] }); _dblPick = []; tpMark(); tpRenderDblConfig();
}
function tpDblDel(i) { T.doubles.teams.splice(i, 1); tpMark(); tpRenderDblConfig(); }

// ------------------- Damen-Konfiguration -------------------
function tpToggleWomen() {
    T.womenEnabled = document.getElementById('tp-women-enable').checked; tpMark();
    document.getElementById('tp-women-config').style.display = T.womenEnabled ? 'block' : 'none';
    if (T.womenEnabled) tpRenderWomenConfig();
}
function tpRenderWomenConfig() {
    const c = document.getElementById('tp-women-config');
    const n = T.players.filter(p => p.geschlecht === 'w' && (p.name || p.vorname)).length;
    c.innerHTML = `<p class="tp-help">${n} Spielerin(nen) mit Geschlecht „w" erkannt. Modus für die Damen-Runde:</p><div id="tp-women-mode"></div>`;
    tpRenderModeConfig('women', document.getElementById('tp-women-mode'));
}

// =====================================================================
// TURNIERPLANER – ENGINE & LIVE-VIEW
// =====================================================================

// Build competition data for one mode from a given player/team id list.
// kind: 'single'|'women'|'doubles'. entrants = array of {id, label, club, lpz, seedStrength}
function tpBuildComp(kind, mode, entrants) {
    const comp = { kind, mode: JSON.parse(JSON.stringify(mode)), entrants: entrants.map(e => e.id),
        groups: [], groupMatches: [], ko: null, placementMatches: [], finished: false };
    // Setzliste nach Stärke (LPZ desc). seedStrength: kleiner = stärker.
    const sorted = entrants.slice().sort((a, b) => (b.lpz || 0) - (a.lpz || 0));
    sorted.forEach((e, i) => e.seedStrength = i + 1);

    if (mode.type === 'round-robin') {
        comp.groups = [sorted.map(e => e.id)];
        comp.groupMatches = [tpMakeGroupMatches(0, sorted.map(e => e.id))];
    } else if (mode.type === 'ko') {
        const size = TP.defaultKoSize(sorted.length);
        const qualifiers = sorted.map((e, i) => ({ playerId: e.id, group: null, rank: i + 1, seedStrength: e.seedStrength }));
        comp.ko = tpMakeKo(TP.buildKoBracket(qualifiers, size).slots, tpModePlaceValue(mode));
    } else { // group-ko
        const numGroups = Math.max(1, Math.ceil(sorted.length / mode.groupSize));
        const groups = TP.snakeSeedGroups(sorted, numGroups);
        comp.groups = groups.map(g => g.map(e => e.id));
        comp.groupMatches = groups.map((g, gi) => tpMakeGroupMatches(gi, g.map(e => e.id)));
    }
    return comp;
}
function tpMakeGroupMatches(groupIdx, ids) {
    const pairs = TP.roundRobinPairs(ids.length);
    return pairs.map((p, i) => ({ id: `g${groupIdx}_${i}`, group: groupIdx,
        aId: ids[p.a], bId: ids[p.b], sets: null, done: false, running: false, table: null }));
}
// allPlaces: false = einfaches K.o. (nur Platz 1-3), 'full' / 'top4' = Doppel-K.o.
function tpMakeKo(slots, allPlaces) {
    const size = slots.length, rounds = [];
    let cur = [];
    for (let i = 0; i < size; i += 2) {
        cur.push({ id: `ko_r0_${i / 2}`, round: 0, aId: slots[i], bId: slots[i + 1],
            sets: null, done: false, running: false, table: null, aFrom: null, bFrom: null });
    }
    rounds.push(cur);
    let count = cur.length, r = 1;
    while (count > 1) {
        const nxt = [];
        for (let i = 0; i < count; i += 2) {
            nxt.push({ id: `ko_r${r}_${i / 2}`, round: r, aId: null, bId: null,
                sets: null, done: false, running: false, table: null,
                aFrom: `ko_r${r - 1}_${i}`, bFrom: `ko_r${r - 1}_${i + 1}` });
        }
        rounds.push(nxt); count = nxt.length; r++;
    }
    const de = allPlaces && allPlaces !== false;
    const scope = (allPlaces === 'top4') ? 'top4' : (de ? 'full' : null);
    const ko = { size, rounds, allPlaces, de, scope, third: null, placement: [] };
    if (de) {
        tpBuildPlacementBrackets(ko);
    } else {
        ko.third = { id: 'ko_third', round: -1, aId: null, bId: null, sets: null, done: false, running: false, table: null, aFrom: null, bFrom: null, isThird: true };
    }
    tpKoResolveByes(ko);
    return ko;
}
// Verliererbaum / Platzierungs-Runden aufbauen.
// Modell: pro Haupt-KO-Runde fallen Verlierer in "Trostbaum"-Runden.
// placement = array von {level, label, matches:[...], placeHigh, placeLow}
// placeHigh/placeLow = Platzbereich, den diese Runde letztlich vergibt.
function tpBuildPlacementBrackets(ko) {
    const size = ko.size;
    // Fuer jede Hauptrunde r (ausser Finale) entsteht ein Loser-Pool.
    // Wir bilden pro "Platzgruppe" eine kleine Trost-KO.
    // Anzahl Hauptrunden:
    const mainRounds = ko.rounds.length; // inkl. Finale
    ko.placement = [];
    if (ko.scope === 'top4') {
        // Nur Spiel um Platz 3 (Verlierer der Halbfinals)
        ko.third = { id: 'pl_3_0', round: -1, aId: null, bId: null, sets: null, done: false, running: false, table: null, aFrom: null, bFrom: null, isThird: true, placeHigh: 3, placeLow: 4 };
        return;
    }
    // scope 'full': fuer jede Platz-Zweiergruppe (3/4, 5/8, 9/16, ...) einen vollen
    // Platzierungsbaum. Verlierer von Hauptrunde r spielen um die Plaetze
    //   [ 2^(mainRounds-1-r)+1 .. 2^(mainRounds-r) ].
    // Innerhalb des Baums steigen Sieger in den hoeheren Platzbereich auf,
    // Verlierer in den niedrigeren (rekursive Aufteilung), bis jedes Spiel
    // genau zwei benachbarte Plaetze vergibt. So werden ALLE Plaetze ausgespielt.
    ko._plSeq = 0;
    for (let r = 0; r < mainRounds - 1; r++) {
        const losersCount = ko.rounds[r].length;
        const placeHigh = Math.pow(2, mainRounds - 1 - r) + 1;
        const placeLow = Math.pow(2, mainRounds - r);
        if (losersCount === 1) {
            ko.placement.push({ placeHigh, placeLow, label: `Platz ${placeHigh}`, rounds: [], single: ko.rounds[r][0] });
            continue;
        }
        // Startquellen: die Verlierer der Hauptrunde r
        const sources = ko.rounds[r].map(m => ({ from: m.id, loser: true }));
        const rounds = [];
        tpBuildPlacementTree(ko, placeHigh, placeLow, sources, rounds);
        ko.placement.push({ placeHigh, placeLow, label: placeHigh === placeLow ? `Platz ${placeHigh}` : `Plätze ${placeHigh}–${placeLow}`, rounds });
    }
}
// Rekursiver Platzierungsbaum: teilt die Teilnehmer in Sieger (hoehere Plaetze)
// und Verlierer (niedrigere Plaetze), bis jeder Platzbereich 2 Plaetze umfasst.
// sources = array von {from, loser} (Quelle + ob Sieger/Verlierer dieser Quelle).
// rounds = flache Liste von Match-Runden (wird befuellt); matches tragen placeHigh/placeLow.
function tpBuildPlacementTree(ko, high, low, sources, rounds) {
    const n = sources.length;
    if (n < 2) return;
    // Eine Runde: paare die Quellen
    const matches = [];
    for (let i = 0; i < n; i += 2) {
        const id = `pl_${high}_${low}_s${ko._plSeq++}`;
        matches.push({ id, round: rounds.length, aId: null, bId: null, sets: null, done: false, running: false, table: null,
            aFrom: sources[i] ? sources[i].from : null, aFromLoser: sources[i] ? sources[i].loser : false,
            bFrom: sources[i + 1] ? sources[i + 1].from : null, bFromLoser: sources[i + 1] ? sources[i + 1].loser : false,
            placeHigh: high, placeLow: low });
    }
    rounds.push(matches);
    if (matches.length === 1) {
        // Einziges Spiel: Sieger = high, Verlierer = low. Fertig.
        matches[0].decidesHigh = high; matches[0].decidesLow = low;
        return;
    }
    // Sieger steigen in obere Haelfte, Verlierer in untere Haelfte
    const winnerSrc = matches.map(m => ({ from: m.id, loser: false }));
    const loserSrc = matches.map(m => ({ from: m.id, loser: true }));
    const mid = Math.floor((high + low) / 2);
    tpBuildPlacementTree(ko, high, mid, winnerSrc, rounds);
    tpBuildPlacementTree(ko, mid + 1, low, loserSrc, rounds);
}
function tpKoAllMatches(ko) {
    const arr = [];
    ko.rounds.forEach(rd => rd.forEach(m => arr.push(m)));
    if (ko.third) arr.push(ko.third);
    (ko.placement || []).forEach(pl => pl.rounds.forEach(rd => rd.forEach(m => arr.push(m))));
    return arr;
}
function tpKoResolveByes(ko) {
    ko.rounds[0].forEach(m => {
        if (m.aId && !m.bId) m._byeWinner = m.aId;
        else if (!m.aId && m.bId) m._byeWinner = m.bId;
    });
    tpKoPropagate(ko);
}
// Sieger in Folge-Runden setzen; Verlierer in Platzierungsbaeume setzen.
function tpKoPropagate(ko) {
    const byId = {}; tpKoAllMatches(ko).forEach(m => byId[m.id] = m);
    // Hauptbaum: Sieger weiter
    for (let r = 0; r < ko.rounds.length; r++) {
        ko.rounds[r].forEach(m => {
            const w = tpKoWinnerOf(m);
            const next = ko.rounds[r + 1] && ko.rounds[r + 1].find(x => x.aFrom === m.id || x.bFrom === m.id);
            if (next) { if (next.aFrom === m.id) next.aId = w; if (next.bFrom === m.id) next.bId = w; }
        });
    }
    // Platzierungsbaeume
    (ko.placement || []).forEach(pl => {
        pl.rounds.forEach((rd, lr) => {
            rd.forEach(m => {
                // Quellen aufloesen (Verlierer bei Level 0, sonst Sieger der Vorrunde)
                if (m.aFrom && byId[m.aFrom]) m.aId = m.aFromLoser ? tpKoLoserOf(byId[m.aFrom]) : tpKoWinnerOf(byId[m.aFrom]);
                if (m.bFrom && byId[m.bFrom]) m.bId = m.bFromLoser ? tpKoLoserOf(byId[m.bFrom]) : tpKoWinnerOf(byId[m.bFrom]);
            });
        });
    });
    // Einfaches K.o.: Platz-3-Spiel = Verlierer der Halbfinals
    if (!ko.de && ko.third && ko.rounds.length >= 2) {
        const semis = ko.rounds[ko.rounds.length - 2];
        if (semis.length === 2) { ko.third.aId = tpKoLoserOf(semis[0]); ko.third.bId = tpKoLoserOf(semis[1]); }
    }
    // top4-Doppel-K.o.: Platz-3-Spiel ebenfalls aus Halbfinal-Verlierern
    if (ko.de && ko.scope === 'top4' && ko.third && ko.rounds.length >= 2) {
        const semis = ko.rounds[ko.rounds.length - 2];
        if (semis.length === 2) { ko.third.aId = tpKoLoserOf(semis[0]); ko.third.bId = tpKoLoserOf(semis[1]); }
    }
}
function tpKoWinnerOf(m) {
    if (m._byeWinner) return m._byeWinner;
    if (m.aId && !m.bId) return m.aId;
    if (!m.aId && m.bId) return m.bId;
    if (m.done && m.sets) {
        const v = TP.validateResult(m.sets, T.winSets, T.winPts);
        if (v.winner === 'a') return m.aId; if (v.winner === 'b') return m.bId;
    }
    return null;
}
function tpKoLoserOf(m) {
    if (!m.done || !m.sets) return null;
    const v = TP.validateResult(m.sets, T.winSets, T.winPts);
    if (v.winner === 'a') return m.bId; if (v.winner === 'b') return m.aId; return null;
}

// ------------------- Turnier starten -------------------
function tpStartTournament() {
    tpBindMeta();
    const named = T.players.filter(p => (p.name || p.vorname));
    if (named.length < 2) { alert('Bitte mindestens 2 Spieler mit Namen eintragen.'); return; }
    // Entrant-Builder
    const toEntrant = p => ({ id: p.id, lpz: +p.lpz || 0 });
    T.comps = {};
    T.comps.single = tpBuildComp('single', T.single, named.map(toEntrant));
    if (T.womenEnabled) {
        const women = named.filter(p => p.geschlecht === 'w');
        if (women.length >= 2) T.comps.women = tpBuildComp('women', T.women.mode, women.map(toEntrant));
    }
    if (T.doublesEnabled && T.doubles.teams.length >= 2) {
        const dEntr = T.doubles.teams.map(t => ({ id: t.id, lpz: tpTeamLpz(t) }));
        T.comps.doubles = tpBuildComp('doubles', T.doubles.mode, dEntr);
    }
    T.started = true; tpDirty = true;
    tpRenderLive();
}
function tpTeamLpz(t) { const a = T.players.find(p => p.id === t.p1), b = T.players.find(p => p.id === t.p2); return ((+a?.lpz || 0) + (+b?.lpz || 0)); }

// Label helper for a participant id (player or doubles team)
function tpLabel(compKind, id) {
    if (compKind === 'doubles') {
        const t = T.doubles.teams.find(x => x.id === id); if (!t) return '?';
        const a = T.players.find(p => p.id === t.p1), b = T.players.find(p => p.id === t.p2);
        return `${a ? a.name : '?'} / ${b ? b.name : '?'}`;
    }
    const p = T.players.find(x => x.id === id); return p ? `${p.vorname} ${p.name}`.trim() : '?';
}
function tpClub(compKind, id) {
    if (compKind === 'doubles') { const t = T.doubles.teams.find(x => x.id === id); const a = t && T.players.find(p => p.id === t.p1); return a ? a.verein : ''; }
    const p = T.players.find(x => x.id === id); return p ? p.verein : '';
}

// =====================================================================
// LIVE VIEW RENDER
// =====================================================================
let tpActiveComp = 'single';
function tpRenderLive() {
    tpUpdateUIPermissions();
    document.getElementById('tp-meta-panel').style.display = 'none';
    document.getElementById('tp-empty').style.display = 'none';
    document.getElementById('tp-live').style.display = 'block';
    document.getElementById('tp-live-title').textContent =
        `${T.name || 'Turnier'}${T.date ? ' · ' + T.date : ''}${T.leader ? ' · Leitung: ' + T.leader : ''}`;
    // Tabs
    const tabs = document.getElementById('tp-comp-tabs'); tabs.innerHTML = '';
    const labels = { single: '🎯 Einzel', women: '🚺 Damen', doubles: '👯 Doppel' };
    Object.keys(T.comps).forEach(k => {
        if (!tpActiveComp || !T.comps[tpActiveComp]) tpActiveComp = k;
        const b = document.createElement('button');
        b.className = 'tp-tab' + (k === tpActiveComp ? ' active' : '');
        b.textContent = labels[k] || k;
        b.onclick = () => { tpActiveComp = k; tpRenderLive(); };
        tabs.appendChild(b);
    });
    const editBtn = document.createElement('button');
    editBtn.className = 'tp-tab'; editBtn.textContent = '✏️ Metadaten';
    editBtn.onclick = () => { if (confirm('Zurück zur Metadaten-Ansicht? Laufende Ergebnisse bleiben erhalten.')) { document.getElementById('tp-live').style.display = 'none'; tpRenderMetaPanel(); } };
    tabs.appendChild(editBtn);

    tpRenderProgress();
    tpRenderRunning();
    tpRenderComp(tpActiveComp);
}

// ------------ Fortschritt ------------
function tpAllMatchesOf(comp) {
    const arr = [];
    (comp.groupMatches || []).forEach(g => g.forEach(m => arr.push(m)));
    if (comp.ko) { comp.ko.rounds.forEach(r => r.forEach(m => arr.push(m))); if (comp.ko.allPlaces !== false && comp.ko.third) arr.push(comp.ko.third); }
    return arr;
}
function tpKoPlayable(m) { return m.aId && m.bId && !m._byeWinner; }
function tpRenderProgress() {
    const cont = document.getElementById('tp-progress-overview');
    let html = '', totAll = 0, totDone = 0;
    Object.entries(T.comps).forEach(([k, comp]) => {
        tpKoPropagate2(comp);
        const all = tpAllMatchesOf(comp).filter(m => m.round === undefined || m.round < 0 || tpKoPlayable(m) || (m.group !== undefined));
        // Count: group matches always count; KO matches count only when both players known
        let played = 0, total = 0;
        (comp.groupMatches || []).forEach(g => g.forEach(m => { total++; if (m.done) played++; }));
        if (comp.ko) {
            comp.ko.rounds.forEach(r => r.forEach(m => { if (!m._byeWinner && (m.aId || m.bId) || m.round === 0) { total++; if (m.done || m._byeWinner) played++; } }));
            if (comp.ko.third && (comp.ko.third.aId || comp.ko.third.bId)) { total++; if (comp.ko.third.done) played++; }
            (comp.ko.placement || []).forEach(pl => pl.rounds.forEach(r => r.forEach(m => { if (!m._byeWinner && (m.aId || m.bId)) { total++; if (m.done) played++; } })));
        }
        totAll += total; totDone += played;
        const pct = total ? Math.round(played / total * 100) : 0;
        const label = { single: 'Einzel', women: 'Damen', doubles: 'Doppel' }[k] || k;
        html += `<div style="margin-bottom:10px;"><div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:700; margin-bottom:3px;"><span>${label}</span><span>${played} / ${total} Spiele</span></div><div class="tp-progress-bar"><div class="tp-progress-fill" style="width:${pct}%;"></div><div class="tp-progress-label">${pct}%</div></div></div>`;
    });
    const pctAll = totAll ? Math.round(totDone / totAll * 100) : 0;
    html += `<div style="margin-top:14px; padding-top:12px; border-top:2px solid var(--border-sand);"><div style="display:flex; justify-content:space-between; font-size:13.5px; font-weight:800; margin-bottom:4px;"><span>Gesamt</span><span>${totDone} / ${totAll} Spiele</span></div><div class="tp-progress-bar" style="height:24px;"><div class="tp-progress-fill" style="width:${pctAll}%;"></div><div class="tp-progress-label" style="font-size:13px;">${pctAll}%</div></div></div>`;
    cont.innerHTML = html;
}
function tpKoPropagate2(comp) { if (comp.ko) tpKoPropagate(comp.ko); }

// ------------ Laufende Spiele ------------
function tpRenderRunning() {
    const cont = document.getElementById('tp-running-list');
    const running = [];
    Object.entries(T.comps).forEach(([k, comp]) => {
        tpAllMatchesOf(comp).forEach(m => { if (m.running) running.push({ k, comp, m }); });
    });
    if (!running.length) { cont.innerHTML = '<p class="tp-help">Keine laufenden Spiele.</p>'; return; }
    cont.innerHTML = running.map(({ k, comp, m }) =>
        `<div class="tp-match running" onclick="tpOpenMatch('${k}','${m.id}')">
            <span class="tp-match-names">${m.table ? 'Tisch ' + m.table + ': ' : ''}${tpLabel(k, m.aId)} vs ${tpLabel(k, m.bId)}</span>
            <span class="tp-badge tp-badge-run">läuft</span>
        </div>`).join('');
}

// =====================================================================
// TURNIERPLANER – COMPETITION RENDER (Gruppen, KO, Podium) + MATCH-MODAL
// =====================================================================
function tpRenderComp(k) {
    const comp = T.comps[k]; const body = document.getElementById('tp-comp-body');
    if (!comp) { body.innerHTML = ''; return; }
    tpKoPropagate2(comp);
    let html = '';

    // ---- Gruppenphase ----
    if (comp.groups && comp.groups.length) {
        html += `<div class="tp-section-card"><h4>📊 ${comp.mode.type === 'round-robin' ? 'Jeder gegen jeden' : 'Gruppenphase'}</h4>`;
        const multiGroups = comp.groups.length > 1 && comp.mode.type !== 'round-robin';
        comp.groups.forEach((ids, gi) => {
            const matches = comp.groupMatches[gi];
            const standings = TP.computeStandings(ids, matches, T.winSets);
            html += `<div style="margin-bottom:18px;"><h5 style="font-weight:800; margin:6px 0;">Gruppe ${gi + 1}</h5>`;
            // Tabelle
            html += `<div style="overflow-x:auto;"><table class="tp-table"><thead><tr><th>#</th><th>Spieler</th><th>Verein</th><th>Spiele</th><th>Siege&nbsp;&ndash;&nbsp;Niederlagen</th><th>Punkte</th><th>Sätze</th><th>Bälle</th>${multiGroups ? '<th>Gruppe</th>' : ''}</tr></thead><tbody>`;
            standings.forEach(s => {
                const adv = comp.mode.type !== 'round-robin' && s.place <= (comp.mode.advance || 0);
                let moveCell = '';
                if (multiGroups) {
                    const anyDone = comp.groupMatches.some(g => g.some(m => m.done));
                    const opts = comp.groups.map((_, oi) => `<option value="${oi}"${oi === gi ? ' selected' : ''}>Gruppe ${oi + 1}</option>`).join('');
                    moveCell = `<td><select style="width:auto;font-size:11.5px;" ${anyDone ? 'disabled title="Erst möglich, solange keine Gruppenspiele eingetragen sind"' : ''} onchange="tpMovePlayer('${k}','${s.id}',${gi},this.value)">${opts}</select></td>`;
                }
                html += `<tr style="${adv ? 'background:#e8f7f0;font-weight:700;' : ''}"><td>${s.place}</td><td>${tpEsc(tpLabel(k, s.id))}</td><td style="font-size:11.5px;color:#64748b;">${tpEsc(tpClub(k, s.id))}</td><td>${s.games}</td><td>${s.wins}&nbsp;&ndash;&nbsp;${s.losses}</td><td><b>${s.pts}</b></td><td>${s.setsW}:${s.setsL}</td><td>${s.ballsW}:${s.ballsL}</td>${moveCell}</tr>`;
            });
            html += `</tbody></table></div>`;
            // Kreuztabelle (Spieler × Spieler)
            html += tpCrossTable(k, ids, matches, standings);
            // Spiele
            html += `<div style="margin-top:8px;">`;
            matches.forEach(m => { html += tpMatchRow(k, m); });
            html += `</div></div>`;
        });
        html += `</div>`;

        // KO-Befüllen-Button
        if (comp.mode.type === 'group-ko') {
            const allGroupsDone = comp.groupMatches.every(g => g.every(m => m.done));
            html += `<div class="tp-section-card">
                <h4>🏆 KO-Runde</h4>`;
            if (!comp.ko) {
                const advance = comp.mode.advance || 2;
                const baseCount = comp.groups.length * advance;
                const def = TP.defaultKoSize(baseCount);
                html += `<p class="tp-help">${allGroupsDone ? 'Alle Gruppen abgeschlossen.' : 'Gruppen noch nicht fertig – Tableau kann vorbereitet, Spiele erst nach Gruppenende gestartet werden.'}</p>
                <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                  <div class="tp-field" style="max-width:200px;"><label>Größe des KO-Tableaus</label>${tpKoSizeSelect('tp-kosize-' + k, def)}</div>
                  <button class="btn btn-emerald" onclick="tpFillKo('${k}')">📥 KO-Tableau befüllen</button>
                </div>
                <p class="tp-help">Default ${def} (so, dass alle ${comp.groups.length}×${advance} Qualifizierten Platz finden).</p>`;
            } else {
                html += tpRenderKo(k, comp) + `<div style="margin-top:8px;"><button class="btn btn-sand" onclick="tpResetKo('${k}')">↻ KO-Tableau neu befüllen</button></div>`;
            }
            html += `</div>`;
        }
    }

    // ---- Reines KO ----
    if (comp.mode.type === 'ko' && comp.ko) {
        html += `<div class="tp-section-card"><h4>🏆 KO-Runde</h4>${tpRenderKo(k, comp)}</div>`;
    }

    // ---- Siegertreppchen ----
    const podium = tpComputePodium(k, comp);
    if (podium) html += tpRenderPodium(podium);

    body.innerHTML = html;
}

function tpMatchRow(k, m) {
    let res = '', cls = '', badge = '';
    if (m.done && m.sets) {
        const v = TP.validateResult(m.sets, T.winSets, T.winPts);
        res = `<span class="tp-match-res">${v.setsA}:${v.setsB}</span>`; cls = ' done';
        badge = `<span class="tp-badge tp-badge-done">fertig</span>`;
    } else if (m.running) { cls = ' running'; badge = `<span class="tp-badge tp-badge-run">läuft${m.table ? ' · Tisch ' + m.table : ''}</span>`; }
    else badge = `<span class="tp-badge tp-badge-open">offen</span>`;
    return `<div class="tp-match${cls}" onclick="tpOpenMatch('${k}','${m.id}')">
        <span class="tp-match-names">${tpEsc(tpLabel(k, m.aId))} <span style="color:#94a3b8;">vs</span> ${tpEsc(tpLabel(k, m.bId))}</span>
        <span style="display:flex;gap:8px;align-items:center;">${res}${badge}</span></div>`;
}

// ------------- Spieler manuell in andere Gruppe verschieben -------------
function tpMovePlayer(k, pid, fromG, toGStr) {
    const comp = T.comps[k]; const toG = +toGStr;
    if (!comp || toG === fromG) return;
    const anyDone = comp.groupMatches.some(g => g.some(m => m.done));
    if (anyDone) { alert('Verschieben ist nur möglich, solange noch keine Gruppenspiele eingetragen sind.'); tpRenderLive(); return; }
    // Spieler aus alter Gruppe entfernen, in neue einfügen
    comp.groups[fromG] = comp.groups[fromG].filter(id => id !== pid);
    comp.groups[toG].push(pid);
    // Spiele der beiden betroffenen Gruppen neu erzeugen (noch keine Ergebnisse da)
    comp.groupMatches[fromG] = tpMakeGroupMatches(fromG, comp.groups[fromG]);
    comp.groupMatches[toG] = tpMakeGroupMatches(toG, comp.groups[toG]);
    // Falls KO schon vorbereitet war -> verwerfen (Basis hat sich geändert)
    comp.ko = null;
    tpMark(); tpRenderLive();
}

// ------------- Kreuztabelle (Spieler × Spieler) -------------
function tpCrossTable(k, ids, matches, standings) {
    if (ids.length < 2) return '';
    // Reihenfolge nach Tabellenplatz für Übersichtlichkeit
    const order = standings.map(s => s.id);
    // Ergebnis-Lookup: resById[aId][bId] = {setsA,setsB} aus Sicht von a
    const res = {};
    matches.forEach(m => {
        if (!m.done || !m.sets) return;
        const v = TP.validateResult(m.sets, T.winSets, T.winPts);
        (res[m.aId] = res[m.aId] || {})[m.bId] = { s: v.setsA + ':' + v.setsB, win: v.winner === 'a' };
        (res[m.bId] = res[m.bId] || {})[m.aId] = { s: v.setsB + ':' + v.setsA, win: v.winner === 'b' };
    });
    const shortName = id => { const l = tpLabel(k, id); return l.length > 14 ? l.slice(0, 13) + '…' : l; };
    let html = `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:12.5px;font-weight:700;color:var(--emerald-dark);">✋ Kreuztabelle (Spieler gegen Spieler)</summary>`;
    html += `<div style="overflow-x:auto;margin-top:6px;"><table class="tp-table tp-cross"><thead><tr><th style="text-align:left;">Spieler</th>`;
    order.forEach((id, i) => { html += `<th title="${tpEsc(tpLabel(k, id))}">${i + 1}</th>`; });
    html += `<th>Punkte</th></tr></thead><tbody>`;
    order.forEach((rowId, ri) => {
        const st = standings.find(s => s.id === rowId);
        html += `<tr><td style="text-align:left;white-space:nowrap;"><b>${ri + 1}.</b> ${tpEsc(shortName(rowId))} <span style="color:#94a3b8;font-size:10.5px;">${tpEsc(tpClub(k, rowId))}</span></td>`;
        order.forEach((colId) => {
            if (rowId === colId) { html += `<td style="background:#d8e3df;"></td>`; return; }
            const cell = res[rowId] && res[rowId][colId];
            if (cell) html += `<td style="${cell.win ? 'color:var(--emerald-dark);font-weight:700;' : 'color:#b91c1c;'}">${cell.s}</td>`;
            else html += `<td style="color:#cbd5c9;">–</td>`;
        });
        html += `<td><b>${st ? st.pts : 0}</b></td></tr>`;
    });
    html += `</tbody></table></div><p class="tp-help">Zeile = Sicht des Spielers; Wert = Satzergebnis gegen den jeweiligen Gegner (Spalte). Grün = gewonnen.</p></details>`;
    return html;
}

// ------------- KO-Tableau befüllen -------------
function tpFillKo(k) {
    const comp = T.comps[k];
    // Qualifikanten sammeln
    const advance = comp.mode.advance || 2;
    const quals = []; const extras = [];
    comp.groups.forEach((ids, gi) => {
        const st = TP.computeStandings(ids, comp.groupMatches[gi], T.winSets);
        st.forEach((s) => {
            const entry = { playerId: s.id, group: gi, rank: s.place, seedStrength: tpSeedOf(k, comp, s.id), _s: s };
            if (s.place <= advance) quals.push(entry); else extras.push(entry);
        });
    });
    const baseCount = quals.length;
    const sel = document.getElementById('tp-kosize-' + k);
    let size = sel ? +sel.value : TP.defaultKoSize(baseCount);
    if (!(size >= 2) || (size & (size - 1)) !== 0) { alert('Bitte eine Zweierpotenz wählen (2–64).'); return; }
    // Auffüllen mit nächstbesten, falls Tableau größer als Qualifikanten
    let field = quals.slice();
    if (field.length < size && comp.mode.fillBest) {
        extras.sort((a, b) => (a.rank - b.rank) || (a.seedStrength - b.seedStrength));
        while (field.length < size && extras.length) field.push(extras.shift());
    }
    const { slots } = TP.buildKoBracket(field, size);
    comp.ko = tpMakeKo(slots, tpModePlaceValue(comp.mode));
    tpMark(); tpRenderLive();
}
// Liefert false (einfaches K.o.) oder 'full'/'top4' (Doppel-K.o.)
function tpModePlaceValue(mode) { return mode.allPlaces ? (mode.placeScope === 'top4' ? 'top4' : 'full') : false; }
// Dropdown mit 2er-Potenzen 2..64, Default vorausgewählt.
function tpKoSizeSelect(id, def) {
    const sizes = [2, 4, 8, 16, 32, 64];
    const opts = sizes.map(s => `<option value="${s}"${s === def ? ' selected' : ''}>${s}er-Tableau</option>`).join('');
    return `<select id="${id}">${opts}</select>`;
}
function tpResetKo(k) { if (confirm('KO-Tableau verwerfen und neu befüllen? Eingetragene KO-Ergebnisse gehen verloren.')) { T.comps[k].ko = null; tpMark(); tpRenderLive(); } }
function tpSeedOf(k, comp, id) { const i = comp.entrants.indexOf(id); const e = comp.entrants.map(eid => ({ id: eid, lpz: k === 'doubles' ? tpTeamLpz(T.doubles.teams.find(t => t.id === eid)) : (+(T.players.find(p => p.id === eid) || {}).lpz || 0) })); e.sort((a, b) => b.lpz - a.lpz); return e.findIndex(x => x.id === id) + 1; }

// ------------- KO rendern -------------
function tpRoundTitle(idxFromEnd, nTotal) {
    const names = ['Finale', 'Halbfinale', 'Viertelfinale', 'Achtelfinale'];
    if (idxFromEnd < names.length) return names[idxFromEnd];
    return `Runde ${nTotal - idxFromEnd}`;
}
function tpRenderKo(k, comp) {
    const ko = comp.ko; const n = ko.rounds.length;
    // Swap-Phase läuft, solange das Tableau nicht per Button „gestartet“ wurde
    // UND noch kein Ergebnis eingetragen ist. tpKoStart() beendet sie.
    const koPlayed = tpKoAllMatches(ko).some(m => m.done || m.running);
    const swapPhase = !ko.locked && !koPlayed;
    let html = '';
    if (swapPhase) {
        html += `<div class="tp-ok-note" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>✏️ <b>Setz-Phase:</b> Startplätze zum Tauschen anklicken (zwei wählen → tauschen). Danach „KO-Runde starten“.</span>
            <span style="display:flex;gap:6px;">
              <button class="btn btn-sand" style="padding:4px 10px;" onclick="tpKoSwapApply('${k}')">⇄ Plätze tauschen (${_koSwap.length}/2)</button>
              <button class="btn btn-emerald" style="padding:4px 12px;" onclick="tpKoStart('${k}')">▶️ KO-Runde starten</button>
            </span></div>`;
    } else {
        html += `<div class="tp-help" style="margin-bottom:6px;">KO-Runde läuft – auf eine Ansetzung klicken, um Tisch/Ergebnis einzutragen. <button class="btn btn-sand" style="padding:2px 8px;font-size:11px;" onclick="tpKoUnlock('${k}')">✏️ Setzung erneut ändern</button></div>`;
    }
    html += `<div style="font-weight:800;margin:6px 0;color:var(--emerald-dark);">🏆 Gewinnerbaum</div>`;
    html += '<div class="tp-ko">';
    ko.rounds.forEach((round, r) => {
        html += `<div class="tp-ko-round"><h5>${tpRoundTitle(n - 1 - r, n)}</h5>`;
        round.forEach((m, mi) => { html += tpKoMatchBox(k, m, (r === 0 && swapPhase) ? (m.id + ':a') : null, (r === 0 && swapPhase) ? (m.id + ':b') : null); });
        html += `</div>`;
    });
    html += '</div>';
    // Einfaches K.o.: Spiel um Platz 3
    if (!ko.de && ko.third && (ko.third.aId || ko.third.bId)) {
        html += `<div style="margin-top:10px;"><h5 style="font-weight:800;color:var(--amber);">Spiel um Platz 3</h5>${tpKoMatchBox(k, ko.third)}</div>`;
    }
    // Doppel-K.o. top4: Platz-3-Spiel
    if (ko.de && ko.scope === 'top4' && ko.third && (ko.third.aId || ko.third.bId)) {
        html += `<div style="margin-top:10px;"><h5 style="font-weight:800;color:var(--amber);">Spiel um Platz 3</h5>${tpKoMatchBox(k, ko.third)}</div>`;
    }
    // Doppel-K.o. full: Verliererbaum / Platzierungsrunden
    if (ko.de && ko.scope === 'full' && (ko.placement || []).length) {
        html += `<div style="font-weight:800;margin:16px 0 6px;color:var(--amber);">🥈 Verliererbaum – Platzierungsrunden</div>`;
        ko.placement.forEach(pl => {
            html += `<div class="tp-section-card" style="margin-bottom:10px;"><h5 style="font-weight:800;margin:0 0 6px;">${pl.label}</h5>`;
            if (pl.single) { html += `<p class="tp-help">${tpEsc(tpLabel(k, tpKoLoserOf(pl.single) || ''))} erhält diesen Platz direkt.</p>`; }
            else {
                html += '<div class="tp-ko">';
                pl.rounds.forEach((round) => {
                    // Titel aus dem Platzbereich der Matches dieser Runde ableiten
                    const spans = round.map(m => m.decidesHigh != null ? `um Platz ${m.decidesHigh}/${m.decidesLow}` : `Plätze ${m.placeHigh}–${m.placeLow}`);
                    const uniq = [...new Set(spans)];
                    html += `<div class="tp-ko-round"><h5>${uniq.join(' / ')}</h5>`;
                    round.forEach(m => { html += tpKoMatchBox(k, m); });
                    html += `</div>`;
                });
                html += '</div>';
            }
            html += `</div>`;
        });
    }
    return html;
}
// slotA/slotB: wenn gesetzt, sind die Slots in Runde 0 vor Start klickbar zum Tauschen.
function tpKoMatchBox(k, m, slotA, slotB) {
    const w = tpKoWinnerOf(m);
    function slot(id, from, slotKey) {
        const selCls = slotKey && _koSwap.includes(slotKey) ? ' style="outline:2px solid var(--emerald-dark);border-radius:5px;"' : '';
        const clickAttr = slotKey ? ` onclick="event.stopPropagation();tpKoSwapPick('${slotKey}')"` : '';
        if (!id) return `<div class="tp-ko-slot bye"${selCls}${clickAttr}>${from ? 'Sieger' : '—'}</div>`;
        const win = w && w === id;
        return `<div class="tp-ko-slot${win ? ' winner' : ''}"${selCls}${clickAttr}>${tpEsc(tpLabel(k, id))}</div>`;
    }
    // Inline-Sätze
    let score = '';
    if (m.done && m.sets) {
        const v = TP.validateResult(m.sets, T.winSets, T.winPts);
        const setStr = m.sets.map(s => s[0] + ':' + s[1]).join(', ');
        score = `<div style="text-align:center;font-weight:800;color:var(--emerald-dark);font-size:11px;">${v.setsA}:${v.setsB}</div><div style="text-align:center;font-size:9.5px;color:#64748b;">${setStr}</div>`;
    }
    else if (m._byeWinner) score = `<div style="text-align:center;font-size:10px;color:#94a3b8;">Freilos</div>`;
    else if (m.running) score = `<div style="text-align:center;font-size:10px;color:var(--amber);">läuft${m.table ? ' · Tisch ' + m.table : ''}</div>`;
    const clickable = tpKoPlayable(m) && !m._byeWinner && !slotA;
    return `<div class="tp-ko-match" ${clickable ? `onclick="tpOpenMatch('${k}','${m.id}')"` : ''}>${slot(m.aId, m.aFrom, slotA)}${score}${slot(m.bId, m.bFrom, slotB)}</div>`;
}
// Manuelles Tauschen von Startplätzen
let _koSwap = [];
function tpKoSwapPick(slotKey) { const i = _koSwap.indexOf(slotKey); if (i >= 0) _koSwap.splice(i, 1); else if (_koSwap.length < 2) _koSwap.push(slotKey); tpRenderLive(); }
function tpKoSwapApply(k) {
    if (_koSwap.length !== 2) { alert('Bitte genau zwei Startplätze wählen.'); return; }
    const ko = T.comps[k].ko;
    function ref(key) { const [mid, side] = key.split(':'); const m = ko.rounds[0].find(x => x.id === mid); return { m, side }; }
    const a = ref(_koSwap[0]), b = ref(_koSwap[1]);
    if (!a.m || !b.m) { _koSwap = []; return; }
    const va = a.side === 'a' ? a.m.aId : a.m.bId;
    const vb = b.side === 'a' ? b.m.aId : b.m.bId;
    if (a.side === 'a') a.m.aId = vb; else a.m.bId = vb;
    if (b.side === 'a') b.m.aId = va; else b.m.bId = va;
    _koSwap = [];
    tpKoResolveByes(ko); tpMark(); tpRenderLive();
}
// KO-Runde starten: Setz-Phase beenden -> Spiele werden anklickbar/startbar.
function tpKoStart(k) {
    const ko = T.comps[k].ko; if (!ko) return;
    if (!confirm('KO-Runde starten? Die Setzung wird fixiert – du kannst sie später bei Bedarf wieder öffnen.')) return;
    ko.locked = true; _koSwap = []; tpMark(); tpRenderLive();
}
// Setzung erneut ändern (nur solange noch kein KO-Ergebnis eingetragen ist).
function tpKoUnlock(k) {
    const ko = T.comps[k].ko; if (!ko) return;
    const played = tpKoAllMatches(ko).some(m => m.done || m.running);
    if (played) { alert('Es sind bereits KO-Spiele eingetragen – die Setzung lässt sich nicht mehr ändern. („KO-Tableau neu befüllen“ verwirft dagegen alles.)'); return; }
    ko.locked = false; tpMark(); tpRenderLive();
}
function tpRoundShort(id) { return ''; }

// ------------- Podium -------------
function tpComputePodium(k, comp) {
    // KO-Modus: Finale/HF -> 1,2,3
    if (comp.ko) {
        const ko = comp.ko; const final = ko.rounds[ko.rounds.length - 1][0];
        if (!final || !final.done) return null;
        const first = tpKoWinnerOf(final), second = tpKoLoserOf(final);
        let thirds = [];
        if (ko.de && ko.scope === 'full') {
            // Platz 3/4 kommt aus der Platzierungsrunde mit placeHigh===3
            const pl3 = (ko.placement || []).find(pl => pl.placeHigh === 3);
            if (pl3 && pl3.rounds.length) { const fin = pl3.rounds[pl3.rounds.length - 1][0]; if (fin && fin.done) thirds = [tpKoWinnerOf(fin)]; }
            else { const semis = ko.rounds[ko.rounds.length - 2]; if (semis) thirds = semis.map(s => tpKoLoserOf(s)).filter(Boolean); }
        } else if (ko.third && ko.third.done) { thirds = [tpKoWinnerOf(ko.third)]; }
        else { const semis = ko.rounds[ko.rounds.length - 2]; if (semis) thirds = semis.map(s => tpKoLoserOf(s)).filter(Boolean); }
        if (!first) return null;
        return { kind: k, first, second, thirds, placements: tpKoFullPlacements(k, ko) };
    }
    // Round-robin: einzige Gruppe, alle gespielt
    if (comp.mode.type === 'round-robin') {
        const ids = comp.groups[0], ms = comp.groupMatches[0];
        if (!ms.every(m => m.done)) return null;
        const st = TP.computeStandings(ids, ms, T.winSets);
        return { kind: k, first: st[0] && st[0].id, second: st[1] && st[1].id, thirds: st[2] ? [st[2].id] : [] };
    }
    return null;
}
function tpRenderPodium(p) {
    const name = id => id ? tpEsc(tpLabel(p.kind, id)) : '—';
    const club = id => id ? tpEsc(tpClub(p.kind, id)) : '';
    let thirdsHtml = (p.thirds || []).filter(Boolean).map(id =>
        `<div class="tp-podium-col"><div class="tp-podium-block tp-podium-3"><div class="tp-podium-rank">🥉</div><div class="tp-podium-name">${name(id)}</div><div class="tp-podium-club">${club(id)}</div></div></div>`).join('');
    let fullList = '';
    if (p.placements && p.placements.length) {
        const rows = p.placements.map(r => `<tr><td style="text-align:right;width:40px;"><b>${r.place}.</b></td><td style="text-align:left;">${name(r.id)}</td><td style="text-align:left;font-size:11px;color:#64748b;">${club(r.id)}</td></tr>`).join('');
        fullList = `<details style="margin-top:12px;text-align:left;"><summary style="cursor:pointer;font-weight:700;color:var(--emerald-dark);font-size:12.5px;">📋 Vollständige Platzierung (Platz 1–N)</summary><table class="tp-table" style="margin-top:6px;"><tbody>${rows}</tbody></table></details>`;
    }
    return `<div class="tp-section-card" style="text-align:center;">
        <h4>🏅 Siegertreppchen</h4>
        <div class="tp-podium">
            <div class="tp-podium-col"><div class="tp-podium-block tp-podium-2"><div class="tp-podium-rank">🥈</div><div class="tp-podium-name">${name(p.second)}</div><div class="tp-podium-club">${club(p.second)}</div></div></div>
            <div class="tp-podium-col"><div class="tp-podium-block tp-podium-1"><div class="tp-podium-rank">🥇</div><div class="tp-podium-name">${name(p.first)}</div><div class="tp-podium-club">${club(p.first)}</div></div></div>
            ${thirdsHtml}
        </div>${fullList}</div>`;
}

// =====================================================================
// TURNIERPLANER – MATCH-MODAL, SPEICHERN/LADEN, EXCEL-EXPORT
// =====================================================================
let _curMatch = null; // {k, m}
function tpFindMatch(k, mid) {
    const comp = T.comps[k]; if (!comp) return null;
    let found = null;
    (comp.groupMatches || []).forEach(g => g.forEach(m => { if (m.id === mid) found = m; }));
    if (comp.ko) {
        comp.ko.rounds.forEach(r => r.forEach(m => { if (m.id === mid) found = m; }));
        if (comp.ko.third && comp.ko.third.id === mid) found = comp.ko.third;
        (comp.ko.placement || []).forEach(pl => pl.rounds.forEach(r => r.forEach(m => { if (m.id === mid) found = m; })));
    }
    return found;
}
// Vollständige Platzierungsliste (Doppel-K.o. full) für Podium/Export.
function tpKoFullPlacements(k, ko) {
    if (!ko.de || ko.scope !== 'full') return null;
    const res = [];
    const final = ko.rounds[ko.rounds.length - 1][0];
    if (final && final.done) { res.push({ place: 1, id: tpKoWinnerOf(final) }); res.push({ place: 2, id: tpKoLoserOf(final) }); }
    (ko.placement || []).forEach(pl => {
        if (pl.single) { res.push({ place: pl.placeHigh, id: tpKoLoserOf(pl.single) }); return; }
        // Jedes End-Spiel des Baums vergibt zwei benachbarte Plätze (decidesHigh/Low).
        pl.rounds.forEach(rd => rd.forEach(m => {
            if (m.decidesHigh != null && m.done) {
                res.push({ place: m.decidesHigh, id: tpKoWinnerOf(m) });
                res.push({ place: m.decidesLow, id: tpKoLoserOf(m) });
            }
        }));
    });
    return res.filter(r => r.id).sort((a, b) => a.place - b.place);
}
function tpOpenMatch(k, mid) {
    const m = tpFindMatch(k, mid); if (!m) return;
    if (!m.aId || !m.bId) { alert('Beide Teilnehmer stehen noch nicht fest.'); return; }
    _curMatch = { k, m };
    tpRenderMatchModal();
    document.getElementById('tp-match-modal').classList.add('open');
}
function tpCloseMatch() { document.getElementById('tp-match-modal').classList.remove('open'); _curMatch = null; }

function tpRenderMatchModal() {
    const { k, m } = _curMatch;
    const box = document.getElementById('tp-match-modal-body');
    const nameA = tpEsc(tpLabel(k, m.aId)), nameB = tpEsc(tpLabel(k, m.bId));
    const clubA = tpEsc(tpClub(k, m.aId)), clubB = tpEsc(tpClub(k, m.bId));
    const maxSets = T.winSets * 2 - 1;
    let setsHtml = '';
    const cur = m.sets || [];
    for (let i = 0; i < maxSets; i++) {
        const a = cur[i] ? cur[i][0] : '', b = cur[i] ? cur[i][1] : '';
        setsHtml += `<div class="tp-set-pair"><input type="number" min="0" id="tp-set-a-${i}" value="${a}"><span style="font-weight:800;">:</span><input type="number" min="0" id="tp-set-b-${i}" value="${b}"></div>`;
    }
    const started = m.running, done = m.done;
    box.innerHTML = `
        <h3>${nameA} <span style="color:#94a3b8;">vs</span> ${nameB}</h3>
        <p style="font-size:12.5px;color:#64748b;margin-bottom:10px;">${clubA || '—'} &nbsp; · &nbsp; ${clubB || '—'}</p>
        <div class="tp-field" style="max-width:160px;"><label>Tischnummer</label><input type="number" id="tp-match-table" value="${m.table || ''}" placeholder="z.B. 3"></div>
        ${(started || done) ? `
            <h4 style="margin-top:14px;">Spielstand (Satzpunkte, best of ${maxSets}, bis ${T.winPts})</h4>
            <div class="tp-set-inputs">${setsHtml}</div>
            <div id="tp-match-err"></div>
        ` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
            ${!started && !done ? `<button class="btn btn-emerald" onclick="tpStartMatch()">▶️ Spiel starten</button>` : ''}
            ${started && !done ? `<button class="btn btn-emerald" onclick="tpFinishMatch()">✅ Spiel abschließen</button>` : ''}
            ${done ? `<button class="btn btn-amber" onclick="tpCorrectMatch()">✏️ Ergebnis korrigieren</button>` : ''}
            <button class="btn btn-sand" onclick="tpCloseMatch()">Schließen</button>
        </div>`;
}
function tpReadTable() { const v = document.getElementById('tp-match-table'); return v && v.value ? +v.value : null; }
function tpReadSets() {
    const { m } = _curMatch; const maxSets = T.winSets * 2 - 1; const sets = [];
    for (let i = 0; i < maxSets; i++) {
        const a = document.getElementById('tp-set-a-' + i), b = document.getElementById('tp-set-b-' + i);
        if (!a || !b) continue;
        const va = a.value.trim(), vb = b.value.trim();
        if (va === '' && vb === '') continue;
        sets.push([va === '' ? NaN : +va, vb === '' ? NaN : +vb]);
    }
    return sets;
}
function tpStartMatch() {
    const { m } = _curMatch; m.table = tpReadTable(); m.running = true; m.done = false; tpMark();
    tpRenderMatchModal(); tpRenderLive();
}
function tpFinishMatch() {
    const { m } = _curMatch; const sets = tpReadSets(); m.table = tpReadTable();
    const v = TP.validateResult(sets, T.winSets, T.winPts);
    const err = document.getElementById('tp-match-err');
    if (!v.ok) { err.innerHTML = `<div class="tp-err"><b>Plausibilitätsprüfung fehlgeschlagen:</b><br>${v.errors.join('<br>')}</div>`; return; }
    m.sets = sets; m.done = true; m.running = false; tpMark();
    err.innerHTML = `<div class="tp-ok-note">✅ Ergebnis plausibel (${v.setsA}:${v.setsB}) und eingetragen.</div>`;
    tpRenderLive(); setTimeout(tpCloseMatch, 650);
}
function tpCorrectMatch() {
    if (!confirm('Abgeschlossenes Spiel wirklich korrigieren? Folgerunden könnten betroffen sein.')) return;
    const { m } = _curMatch; m.done = false; m.running = true; tpMark(); tpRenderMatchModal();
}

// ------------------- Speichern / Laden -------------------
// Modell: alle Turniere liegen als Map {id -> turnier} sowohl lokal (localStorage)
// als auch in EINER Drive-Datei (kind=turnier). Speichern schreibt beide,
// Laden fuehrt Drive + lokal zusammen (neuester _savedAt gewinnt). So gehen
// keine Daten verloren und Turniere erscheinen auf jedem Rechner.
function tpReadStore() { try { return JSON.parse(localStorage.getItem(TP_LS_KEY) || '{}'); } catch (e) { return {}; } }
function tpWriteStore(s) { localStorage.setItem(TP_LS_KEY, JSON.stringify(s)); }
function tpDriveReady() { return TP_DRIVE_URL && TP_DRIVE_URL.startsWith('https://script.google.com/'); }

// Lokal speichern (immer, sofort) und danach in Drive sichern (wenn konfiguriert).
async function tpSaveLocal(silent) {
    if (!T) { if (!silent) alert('Kein Turnier aktiv.'); return; }
    tpBindMeta();
    if (!T.name) T.name = 'Turnier ' + new Date().toLocaleDateString('de-DE');
    const s = tpReadStore(); s[T.id] = JSON.parse(JSON.stringify(T)); s[T.id]._savedAt = Date.now();
    tpWriteStore(s); tpDirty = false;
    tpSetSaveHint('💾 lokal gespeichert ' + new Date().toLocaleTimeString('de-DE'));
    // Immer auch in Drive sichern, damit andere Rechner den Stand sehen.
    await tpPushToDrive(s);
    return true;
}
function tpSetSaveHint(txt) { const h = document.getElementById('tp-save-hint'); if (h) h.textContent = txt; }

// Gesamte Turnier-Map in die Drive-Datei (kind=turnier) schreiben.
async function tpPushToDrive(store) {
    if (!tpDriveReady()) return false;
    
    let pwd = sessionStorage.getItem('dippe_admin_pwd');
    if (!pwd) {
        pwd = (typeof askPasswordModal === 'function') ? await askPasswordModal('🏆 Turnierplaner · Cloud-Save', 'Admin-Passwort erforderlich, um in Google Drive zu speichern:') : prompt('Admin-Passwort:');
        if (!pwd) {
            tpSetSaveHint('⚠️ Abgebrochen (kein Passwort)');
            return false;
        }
    }

    try {
        tpSetSaveHint('☁️ sichere in Drive …');
        const res = await fetch(TP_DRIVE_URL, { 
            method: 'POST', 
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ 
                kind: 'turnier', 
                password: pwd, 
                tournaments: store || tpReadStore() 
            }) 
        });
        const j = await res.json();
        if (j && j.ok) {
            sessionStorage.setItem('dippe_admin_pwd', pwd);
            tpSetSaveHint('☁️ in Drive gesichert ' + new Date().toLocaleTimeString('de-DE'));
            return true;
        } else {
            sessionStorage.removeItem('dippe_admin_pwd');
            tpAdminMode = false;
            tpUpdateUIPermissions();
            alert('Speichern fehlgeschlagen: Falsches Passwort! Admin-Modus wurde gesperrt.');
            tpSetSaveHint('⚠️ Falsches Passwort');
            return false;
        }
    } catch (e) { 
        tpSetSaveHint('⚠️ Drive nicht erreichbar.'); 
        return false; 
    }
}
// Manueller Button „In Drive sichern“
async function tpSaveToDrive() {
    if (!T) { alert('Kein Turnier aktiv.'); return; }
    await tpSaveLocal(true);
    if (!tpDriveReady()) alert('Kein Google-Drive-Endpoint konfiguriert (CONFIG.pinnwandCloudUrl). Es wurde lokal gespeichert.');
}

// Turniere aus Drive holen (Map). Toleriert altes Einzel-Format {kind:'turnier',tournament:{}}.
async function tpFetchDrive() {
    if (!tpDriveReady()) return {};
    try {
        const res = await fetch(TP_DRIVE_URL + '?kind=turnier&t=' + Date.now(), { method: 'GET', redirect: 'follow' });
        if (!res.ok) return {};
        const j = await res.json();
        if (!j) return {};
        if (j.tournaments && typeof j.tournaments === 'object') return j.tournaments;
        if (j.tournament && j.tournament.id) { const m = {}; m[j.tournament.id] = j.tournament; return m; } // altes Format
        return {};
    } catch (e) { return {}; }
}
// Lokal + Drive zusammenfuehren (neuester _savedAt gewinnt). Schreibt Ergebnis lokal zurueck.
async function tpMergeStores() {
    const local = tpReadStore();
    const drive = await tpFetchDrive();
    const merged = Object.assign({}, local);
    Object.keys(drive).forEach(id => {
        if (!merged[id] || (drive[id]._savedAt || 0) >= (merged[id]._savedAt || 0)) merged[id] = drive[id];
    });
    tpWriteStore(merged);
    return merged;
}

async function tpOpenLoad() {
    const listEl = document.getElementById('tp-load-list');
    listEl.innerHTML = '<p class="tp-help">⏳ Lade lokale und Drive-Turniere …</p>';
    document.getElementById('tp-load-modal').classList.add('open');
    const s = await tpMergeStores();
    const ids = Object.keys(s);
    if (!ids.length) { listEl.innerHTML = '<p class="tp-help">Keine gespeicherten Turniere gefunden (weder lokal noch in Drive).</p>'; return; }
    ids.sort((a, b) => (s[b]._savedAt || 0) - (s[a]._savedAt || 0));
    listEl.innerHTML = `<p class="tp-help">${tpDriveReady() ? '☁️ Lokal + Google Drive zusammengeführt.' : 'Nur lokal (kein Drive konfiguriert).'}</p>` + ids.map(id => {
        const t = s[id];
        return `<div class="tp-match"><span class="tp-match-names" style="cursor:pointer;" onclick="tpLoadTournament('${id}')">${tpEsc(t.name || id)}${t.date ? ' · ' + t.date : ''}<br><span class="tp-help">${t.players ? t.players.length : 0} Spieler · gespeichert ${t._savedAt ? new Date(t._savedAt).toLocaleString('de-DE') : '?'}</span></span><span style="display:flex;gap:6px;"><button class="tp-mini-btn" style="background:var(--emerald-dark);color:#fff;" onclick="tpLoadTournament('${id}')">Laden</button><button class="tp-mini-btn tp-mini-del" onclick="tpDeleteSaved('${id}')">✕</button></span></div>`;
    }).join('');
}
function tpCloseLoad() { document.getElementById('tp-load-modal').classList.remove('open'); }
function tpLoadTournament(id) {
    if (T && tpDirty && !confirm('Aktuelles Turnier verwerfen? Nicht gespeicherte Änderungen gehen verloren.')) return;
    const s = tpReadStore(); if (!s[id]) return;
    T = JSON.parse(JSON.stringify(s[id])); tpDirty = false; tpCloseLoad();
    if (T.started) tpRenderLive(); else tpRenderMetaPanel();
}
async function tpDeleteSaved(id) {
    if (!confirm('Dieses gespeicherte Turnier löschen (lokal und in Drive)?')) return;
    const s = tpReadStore(); delete s[id]; tpWriteStore(s);
    await tpPushToDrive(s); // Drive-Map ohne das geloeschte Turnier neu schreiben
    tpOpenLoad();
}

// ------------------- Beende-Warnung (Datenverlust vermeiden) -------------------
window.addEventListener('beforeunload', e => { if (T && tpDirty) { e.preventDefault(); e.returnValue = ''; } });

// ===================================================================
// EXCEL-EXPORT (ExcelJS) – gestylt, Auto-Breiten, Live-Formeln
// ===================================================================
// Dezente, gut erkennbare Farbpalette
const XL = {
    title:   'FF0E3D33',   // dunkelgrün (Kopfzeile)
    head:    'FF0F766E',   // teal (Tabellenköpfe)
    headTxt: 'FFFFFFFF',
    input:   'FFFFF7E6',   // zartes Gelb = EINGABE erlaubt
    inputBd: 'FFE0B84A',
    calc:    'FFEFF4F2',   // zartes Grau-Grün = AUTOMATISCH berechnet
    adv:     'FFE3F3EC',   // Hervorhebung Qualifikant
    gold:    'FFF6C948', silver: 'FFC9CDD2', bronze: 'FFD8A46A',
    line:    'FFD5CFC3'
};
function tpSetStr(m) { if (!m.sets) return ''; const v = TP.validateResult(m.sets, T.winSets, T.winPts); return `${v.setsA}:${v.setsB} (${m.sets.map(s => s[0] + ':' + s[1]).join(', ')})`; }

async function tpExportExcel() {
    if (!T) { alert('Kein Turnier aktiv.'); return; }
    if (typeof ExcelJS === 'undefined') { alert('Excel-Bibliothek lädt noch – bitte in 1-2 Sekunden erneut versuchen.'); return; }
    tpSetSaveHint('📊 erzeuge Excel …');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Turnierplaner'; wb.created = new Date();
    const winSets = T.winSets, winPts = T.winPts, maxSets = winSets * 2 - 1;

    const border = { top:{style:'thin',color:{argb:XL.line}}, left:{style:'thin',color:{argb:XL.line}}, bottom:{style:'thin',color:{argb:XL.line}}, right:{style:'thin',color:{argb:XL.line}} };
    const inBorder = { top:{style:'thin',color:{argb:XL.inputBd}}, left:{style:'thin',color:{argb:XL.inputBd}}, bottom:{style:'thin',color:{argb:XL.inputBd}}, right:{style:'thin',color:{argb:XL.inputBd}} };
    function fill(c, argb){ c.fill = {type:'pattern',pattern:'solid',fgColor:{argb}}; }
    function headRow(ws, cells, rowNum){ const r = ws.getRow(rowNum); cells.forEach((t,i)=>{ const c=r.getCell(i+1); c.value=t; c.font={bold:true,color:{argb:XL.headTxt}}; fill(c,XL.head); c.alignment={horizontal:'center',vertical:'middle'}; c.border=border; }); r.height=20; }
    function titleBlock(ws, text, span){ const c=ws.getCell('A1'); c.value=text; c.font={bold:true,size:15,color:{argb:'FFFFFFFF'}}; fill(c,XL.title); c.alignment={vertical:'middle',indent:1}; ws.getRow(1).height=28; ws.mergeCells(1,1,1,span||8); }
    function autoWidth(ws){ ws.columns.forEach(col=>{ let max=8; col.eachCell({includeEmpty:false},cell=>{ const v=cell.value; let len = (v==null)?0 : (typeof v==='object'&&v!==null&&'formula' in v)? String(v.result==null?6:v.result).length : String(v).length; if(len>max) max=len; }); col.width=Math.min(Math.max(max+2,7),42); }); }
    function legend(ws, atRow){
        let c=ws.getRow(atRow).getCell(1); c.value='Legende:'; c.font={bold:true,size:10};
        c=ws.getRow(atRow).getCell(2); c.value='Eingabe (hier eintragen)'; fill(c,XL.input); c.border=inBorder; c.font={size:10};
        c=ws.getRow(atRow).getCell(4); c.value='automatisch berechnet'; fill(c,XL.calc); c.border=border; c.font={size:10};
    }

    // ---------- 1) MELDELISTE ----------
    const wsM = wb.addWorksheet('Meldeliste', { views:[{state:'frozen',ySplit:4}] });
    titleBlock(wsM, `🏓 ${T.name||'Turnier'}  –  ${T.date||''}${T.leader?'   |   Leitung: '+T.leader:''}`, 6);
    wsM.getCell('A2').value = `Gewinnsätze: ${winSets}   ·   Gewinnpunkte/Satz: ${winPts}`; wsM.getCell('A2').font={italic:true,color:{argb:'FF555555'}}; wsM.mergeCells(2,1,2,6);
    headRow(wsM, ['#','Name','Vorname','LPZ','Geschlecht','Verein'], 4);
    T.players.forEach((p,i)=>{ const r=wsM.getRow(5+i); const vals=[i+1,p.name,p.vorname,(+p.lpz||0),p.geschlecht,p.verein]; vals.forEach((v,ci)=>{ const c=r.getCell(ci+1); c.value=v; c.border=border; if(i%2) fill(c,'FFF7F9F8'); }); });
    autoWidth(wsM);

    const summary = [];

    // ---------- 2) JE WETTBEWERB EIN BLATT ----------
    for (const k of Object.keys(T.comps||{})) {
        const comp = T.comps[k];
        tpKoPropagate2(comp);
        const label = { single:'Einzel', women:'Damen', doubles:'Doppel' }[k] || k;
        const ws = wb.addWorksheet(label, { views:[{state:'frozen',ySplit:1}] });
        titleBlock(ws, `${label} – ${T.name||'Turnier'}`, 13);
        let row = 3;
        const colL = n => ws.getColumn(n).letter;

        (comp.groups||[]).forEach((ids, gi) => {
            const matches = comp.groupMatches[gi];
            const tc=ws.getRow(row).getCell(1); tc.value = comp.mode.type==='round-robin' ? 'Jeder gegen jeden' : `Gruppe ${gi+1}`; tc.font={bold:true,size:12,color:{argb:XL.title}}; row++;

            const setStartCol = 4;
            const colSA = setStartCol + maxSets*2, colSB=colSA+1, colBA=colSA+2, colBB=colSA+3, colWin=colSA+4;
            const hr = ws.getRow(row);
            hr.getCell(1).value='Spiel'; hr.getCell(2).value='Spieler A'; hr.getCell(3).value='Spieler B';
            for (let si=0; si<maxSets; si++){ hr.getCell(setStartCol+si*2).value=`S${si+1}A`; hr.getCell(setStartCol+si*2+1).value=`S${si+1}B`; }
            hr.getCell(colSA).value='Sätze A'; hr.getCell(colSB).value='Sätze B'; hr.getCell(colBA).value='Bälle A'; hr.getCell(colBB).value='Bälle B'; hr.getCell(colWin).value='Sieger';
            for (let ci=1; ci<=colWin; ci++){ const c=hr.getCell(ci); c.font={bold:true,color:{argb:XL.headTxt}}; fill(c,XL.head); c.alignment={horizontal:'center'}; c.border=border; }
            row++;
            const firstMatchRow = row;
            matches.forEach((m,mi) => {
                const r = ws.getRow(row);
                r.getCell(1).value = mi+1;
                r.getCell(2).value = tpLabel(k,m.aId); r.getCell(3).value = tpLabel(k,m.bId);
                for (let si=0; si<maxSets; si++){
                    const ca=r.getCell(setStartCol+si*2), cb=r.getCell(setStartCol+si*2+1);
                    if (m.sets && m.sets[si]){ ca.value=m.sets[si][0]; cb.value=m.sets[si][1]; }
                    [ca,cb].forEach(c=>{ fill(c,XL.input); c.border=inBorder; c.alignment={horizontal:'center'}; });
                }
                const aCells=[], bCells=[];
                for (let si=0; si<maxSets; si++){ aCells.push(colL(setStartCol+si*2)+row); bCells.push(colL(setStartCol+si*2+1)+row); }
                const aRange = colL(setStartCol)+row+':'+colL(setStartCol+(maxSets-1)*2)+row;
                const bRange = colL(setStartCol+1)+row+':'+colL(setStartCol+1+(maxSets-1)*2)+row;
                const prodA = aCells.map((a,si)=>`(${a}<>"")*(${bCells[si]}<>"")*(${a}>${bCells[si]})`).join('+');
                const prodB = aCells.map((a,si)=>`(${a}<>"")*(${bCells[si]}<>"")*(${a}<${bCells[si]})`).join('+');
                const cSA=r.getCell(colSA), cSB=r.getCell(colSB), cBA=r.getCell(colBA), cBB=r.getCell(colBB), cW=r.getCell(colWin);
                cSA.value={formula:prodA}; cSB.value={formula:prodB};
                cBA.value={formula:`SUM(${aRange})`}; cBB.value={formula:`SUM(${bRange})`};
                cW.value={formula:`IF(${colL(colSA)}${row}=${colL(colSB)}${row},"",IF(${colL(colSA)}${row}>${colL(colSB)}${row},B${row},C${row}))`};
                [cSA,cSB,cBA,cBB,cW].forEach(c=>{ fill(c,XL.calc); c.border=border; c.alignment={horizontal:'center'}; });
                r.getCell(1).border=border; r.getCell(2).border=border; r.getCell(3).border=border;
                row++;
            });
            const lastMatchRow = row-1;
            row++;

            // Tabelle mit Live-Formeln auf den Spiele-Block
            headRow(ws, ['Platz','Spieler','Verein','Spiele','Siege','Niederlagen','Punkte','Sätze +','Sätze -','Bälle +','Bälle -'], row); row++;
            const aNameRange = `B${firstMatchRow}:B${lastMatchRow}`;
            const bNameRange = `C${firstMatchRow}:C${lastMatchRow}`;
            const saRange = `${colL(colSA)}${firstMatchRow}:${colL(colSA)}${lastMatchRow}`;
            const sbRange = `${colL(colSB)}${firstMatchRow}:${colL(colSB)}${lastMatchRow}`;
            const baRange = `${colL(colBA)}${firstMatchRow}:${colL(colBA)}${lastMatchRow}`;
            const bbRange = `${colL(colBB)}${firstMatchRow}:${colL(colBB)}${lastMatchRow}`;
            const winRange = `${colL(colWin)}${firstMatchRow}:${colL(colWin)}${lastMatchRow}`;
            ids.forEach((pid, pi) => {
                const r = ws.getRow(row); const nc = `B${row}`;
                r.getCell(1).value = pi+1;
                r.getCell(2).value = tpLabel(k,pid);
                r.getCell(3).value = tpClub(k,pid);
                r.getCell(4).value={formula:`SUMPRODUCT((${aNameRange}=${nc})*(${winRange}<>""))+SUMPRODUCT((${bNameRange}=${nc})*(${winRange}<>""))`};
                r.getCell(5).value={formula:`SUMPRODUCT((${winRange}=${nc})*1)`};
                r.getCell(6).value={formula:`D${row}-E${row}`};
                r.getCell(7).value={formula:`E${row}*2`};
                r.getCell(8).value={formula:`SUMPRODUCT((${aNameRange}=${nc})*${saRange})+SUMPRODUCT((${bNameRange}=${nc})*${sbRange})`};
                r.getCell(9).value={formula:`SUMPRODUCT((${aNameRange}=${nc})*${sbRange})+SUMPRODUCT((${bNameRange}=${nc})*${saRange})`};
                r.getCell(10).value={formula:`SUMPRODUCT((${aNameRange}=${nc})*${baRange})+SUMPRODUCT((${bNameRange}=${nc})*${bbRange})`};
                r.getCell(11).value={formula:`SUMPRODUCT((${aNameRange}=${nc})*${bbRange})+SUMPRODUCT((${bNameRange}=${nc})*${baRange})`};
                const adv = comp.mode.type!=='round-robin' && (pi+1)<=(comp.mode.advance||0);
                for (let ci=1; ci<=11; ci++){ const c=r.getCell(ci); c.border=border; if(ci>=4) fill(c,XL.calc); else if(adv) fill(c,XL.adv); c.alignment={horizontal: (ci===2||ci===3)?'left':'center'}; }
                if (adv) r.getCell(2).font={bold:true};
                row++;
            });
            const noteR=ws.getRow(row).getCell(1); noteR.value='Hinweis: Reihenfolge = Setzung. Platzierung ergibt sich aus Punkten/Sätzen/Bällen (siehe Turnierplaner).'; noteR.font={italic:true,size:9,color:{argb:'FF888888'}};
            row += 2;
        });

        // KO / Platzierungen (Werte)
        if (comp.ko) {
            const rc=ws.getRow(row).getCell(1); rc.value='KO-Runde'; rc.font={bold:true,size:12,color:{argb:XL.title}}; row++;
            headRow(ws, ['Runde','Spieler A','Spieler B','Ergebnis','Sätze','Sieger'], row); row++;
            const nTot = comp.ko.rounds.length;
            comp.ko.rounds.forEach((round, r0) => {
                round.forEach(m => {
                    const r=ws.getRow(row);
                    r.getCell(1).value = tpRoundTitle(nTot-1-r0, nTot);
                    r.getCell(2).value = tpLabel(k,m.aId); r.getCell(3).value = tpLabel(k,m.bId);
                    if (m.done&&m.sets){ const v=TP.validateResult(m.sets,winSets,winPts); r.getCell(4).value=`${v.setsA}:${v.setsB}`; r.getCell(5).value=m.sets.map(s=>s[0]+':'+s[1]).join(', '); r.getCell(6).value=tpLabel(k,tpKoWinnerOf(m)); }
                    else if (m._byeWinner){ r.getCell(4).value='Freilos'; r.getCell(6).value=tpLabel(k,m._byeWinner); }
                    else r.getCell(4).value='offen';
                    for(let ci=1;ci<=6;ci++){ const c=r.getCell(ci); c.border=border; c.alignment={horizontal:(ci===2||ci===3||ci===5)?'left':'center'}; }
                    row++;
                });
            });
            if (!comp.ko.de && comp.ko.third && (comp.ko.third.aId||comp.ko.third.bId)){ const m=comp.ko.third; const r=ws.getRow(row); r.getCell(1).value='Spiel um Platz 3'; r.getCell(2).value=tpLabel(k,m.aId); r.getCell(3).value=tpLabel(k,m.bId); if(m.done&&m.sets){const v=TP.validateResult(m.sets,winSets,winPts); r.getCell(4).value=`${v.setsA}:${v.setsB}`; r.getCell(6).value=tpLabel(k,tpKoWinnerOf(m));} else r.getCell(4).value='offen'; for(let ci=1;ci<=6;ci++) r.getCell(ci).border=border; row++; }
            if (comp.ko.de && comp.ko.scope==='full' && (comp.ko.placement||[]).length){
                row++; const pc=ws.getRow(row).getCell(1); pc.value='Verliererbaum – Platzierungsrunden'; pc.font={bold:true,color:{argb:'FF92400E'}}; row++;
                comp.ko.placement.forEach(pl => {
                    pl.rounds.forEach(rd=>rd.forEach(m=>{ const r=ws.getRow(row); r.getCell(1).value = m.decidesHigh!=null?`um Platz ${m.decidesHigh}/${m.decidesLow}`:pl.label; r.getCell(2).value=tpLabel(k,m.aId); r.getCell(3).value=tpLabel(k,m.bId); if(m.done&&m.sets){const v=TP.validateResult(m.sets,winSets,winPts); r.getCell(4).value=`${v.setsA}:${v.setsB}`; r.getCell(6).value=tpLabel(k,tpKoWinnerOf(m));} else r.getCell(4).value='offen'; for(let ci=1;ci<=6;ci++) r.getCell(ci).border=border; row++; }));
                });
            }
            row++;
        }

        const pod = tpComputePodium(k, comp);
        if (pod){ summary.push({ label, pod, placements: tpKoFullPlacements(k, comp.ko||{}) || null, kind:k }); }
        legend(ws, row+1);
        autoWidth(ws);
    }

    // ---------- 3) ZUSAMMENFASSUNG ----------
    const wsS = wb.addWorksheet('Zusammenfassung', { views:[{state:'frozen',ySplit:1}] });
    titleBlock(wsS, `🏆 Endergebnisse – ${T.name||'Turnier'}`, 10);
    let sr = 3;
    summary.forEach(entry => {
        const { label, pod, placements, kind } = entry;
        const name = id => id? tpLabel(kind,id):'–'; const club = id => id? tpClub(kind,id):'';
        const tc=wsS.getRow(sr).getCell(1); tc.value=label; tc.font={bold:true,size:13,color:{argb:XL.title}}; sr++;
        const podRow = wsS.getRow(sr); podRow.height=22;
        const cells = [
            {col:2, rank:'🥈 2.', id:pod.second, bg:XL.silver},
            {col:3, rank:'🥇 1.', id:pod.first, bg:XL.gold},
            {col:4, rank:'🥉 3.', id:(pod.thirds||[])[0], bg:XL.bronze}
        ];
        cells.forEach(cel=>{ const c=podRow.getCell(cel.col); c.value=`${cel.rank}  ${name(cel.id)}`; fill(c,cel.bg); c.font={bold:true}; c.alignment={horizontal:'center'}; c.border=border; const c2=wsS.getRow(sr+1).getCell(cel.col); c2.value=club(cel.id); c2.alignment={horizontal:'center'}; c2.font={size:10,italic:true}; c2.border=border; });
        if ((pod.thirds||[]).length>1){ const c=podRow.getCell(5); c.value=`🥉 3.  ${name(pod.thirds[1])}`; fill(c,XL.bronze); c.font={bold:true}; c.alignment={horizontal:'center'}; c.border=border; const c2=wsS.getRow(sr+1).getCell(5); c2.value=club(pod.thirds[1]); c2.alignment={horizontal:'center'}; c2.font={size:10,italic:true}; c2.border=border; }
        sr+=3;
        if (placements && placements.length){
            headRow(wsS, ['Platz','Spieler','Verein'], sr); sr++;
            placements.forEach(p=>{ const r=wsS.getRow(sr); r.getCell(1).value=p.place+'.'; r.getCell(2).value=name(p.id); r.getCell(3).value=club(p.id); for(let ci=1;ci<=3;ci++){const c=r.getCell(ci); c.border=border; if(sr%2) fill(c,'FFF7F9F8');} r.getCell(2).alignment={horizontal:'left'}; sr++; });
        }
        sr += 2;
    });
    if (!summary.length){ wsS.getCell('A3').value='Noch keine abgeschlossenen Wettbewerbe.'; }
    legend(wsS, sr+1);
    autoWidth(wsS);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download = (T.name||'Turnier').replace(/[^\w\-]+/g,'_') + '.xlsx';
    document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    tpSetSaveHint('📊 Excel erzeugt ' + new Date().toLocaleTimeString('de-DE'));
}

// ------------------- Sortier-Header-Binding + Autosave -------------------
function tpInitTurnierplaner() {
    document.querySelectorAll('#tp-player-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (tpSortKey === key) tpSortDir *= -1; else { tpSortKey = key; tpSortDir = (key === 'lpz') ? -1 : 1; }
            tpRenderPlayerTable();
        });
    });
    // Autosave alle 30s falls dirty (lokal + Drive)
    setInterval(() => { if (T && tpDirty) tpSaveLocal(true); }, 30000);
    // Beim Start Drive + lokal zusammenfuehren, damit auf jedem Rechner
    // die anderswo gespeicherten Turniere verfuegbar sind.
    if (tpDriveReady()) { tpMergeStores().catch(() => {}); }
}

// ---- Turnierplaner Boot ----
window.addEventListener('DOMContentLoaded', () => {
    tpInitTurnierplaner();
});
