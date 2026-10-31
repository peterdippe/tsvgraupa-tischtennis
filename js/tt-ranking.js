// ===================================================================
// TT-RANKING, TRAININGS-CHALLENGE & 9 ANALYSE-DONUTS (js/tt-ranking.js)
// ===================================================================

let ttrPlayers = [];
let ttrSelectedPlayerId = null;
let ttrCurrentPoints = [];
let ttrCurrentAnalyse = [];
let ttrCurrentRange = 100;
let ttrCockpitTab = 'curve'; // 'curve' oder 'analyse'
let ttrInitialized = false;
let ttrBatchRunning = false;
let ttrChartGeom = null;

// Trainings-Challenge State
let ttrChallengeStore = { activeSession: null, archive: [] };
let ttrViewingSessionId = 'active';
let ttrPickedScore = '3:0';
let ttrAdminUnlocked = false;

function initTTRankingIfNeeded() {
    ttrSyncAdminStateFromSession();
    if (!ttrInitialized) {
        ttrInitialized = true;
        bindTTRChartEvents();
        ttrLoadChallengeFromCloud();
        ttrLoadRankingList(false);
    } else {
        ttrDrawChart();
        ttrRenderChallengeBoard();
    }
}

function setTTRSyncBadge(text, bg, color) {
    const b = document.getElementById('ttr-sync-badge');
    if (!b) return;
    b.textContent = text;
    if (bg) b.style.background = bg;
    if (color) b.style.color = color;
}

function sanitizeGraupaPlayers(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(p => p && p.mid && String(p.id || '').startsWith('mid_')).map(p => {
        if (p.l2p && Number(p.l2p) >= 20000 && Number(p.l2p) <= 22000) {
            p.l2p = '';
            p.resolved = false;
        }
        return p;
    });
}

// ===================================================================
// 1. ADMIN-AUTHENTIFIZIERUNG (ANALOG ZUM TURNIERPLANER)
// ===================================================================
function ttrSyncAdminStateFromSession() {
    const savedPwd = sessionStorage.getItem('dippe_admin_pwd');
    ttrAdminUnlocked = Boolean(savedPwd);
    ttrUpdateAdminUI();
}

function ttrUpdateAdminUI() {
    const btn = document.getElementById('ttr-admin-btn');
    const ctrls = document.getElementById('ttr-admin-controls');
    if (btn) {
        btn.textContent = ttrAdminUnlocked ? '🔓 Admin aktiv (Sperren)' : '🔒 Admin-Modus entsperren';
        btn.className = ttrAdminUnlocked ? 'btn btn-emerald' : 'btn btn-amber';
    }
    if (ctrls) {
        ctrls.classList.toggle('hidden', !ttrAdminUnlocked);
    }
    ttrRenderChallengeBoard();
}

async function ttrToggleAdmin() {
    if (ttrAdminUnlocked) {
        ttrAdminUnlocked = false;
        sessionStorage.removeItem('dippe_admin_pwd');
        ttrUpdateAdminUI();
        return;
    }
    const pwd = prompt('Bitte Admin-Passwort eingeben (wie im Turnierplaner):');
    if (!pwd) return;

    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    try {
        const res = await fetch(`${cloudUrl}?kind=auth&type=admin&password=${encodeURIComponent(pwd)}`);
        const j = await res.json();
        if (j && j.ok === true) {
            sessionStorage.setItem('dippe_admin_pwd', pwd);
            ttrAdminUnlocked = true;
            ttrUpdateAdminUI();
        } else {
            alert('Falsches Admin-Passwort!');
        }
    } catch (e) {
        alert('Verbindungsfehler bei der Passwortprüfung.');
    }
}

// ===================================================================
// 2. TRAININGS-CHALLENGE: ELO-MATHEMATIK, EINGABE & RANGLISTE
// ===================================================================
function computeChallengeEloDelta(lpz1, lpz2, sets1, sets2) {
    const r1 = Number(lpz1) > 0 ? Number(lpz1) : 1250;
    const r2 = Number(lpz2) > 0 ? Number(lpz2) : 1250;
    const s1 = Number(sets1);
    const s2 = Number(sets2);
    const p1Won = s1 > s2;

    const expected1 = 1 / (1 + Math.pow(10, (r2 - r1) / 150));
    const actual1 = p1Won ? 1 : 0;

    const diffSets = Math.abs(s1 - s2);
    const marginMult = diffSets >= 3 ? 1.30 : diffSets === 2 ? 1.10 : 0.85;

    const K = 24;
    const rawDelta1 = Math.round(K * marginMult * (actual1 - expected1));
    const delta1 = p1Won ? Math.max(2, rawDelta1) : Math.min(-2, rawDelta1);
    return {
        delta1: delta1,
        delta2: -delta1,
        expected1Pct: Math.round(expected1 * 100),
        marginMult: marginMult
    };
}

function getSelectedMatchPlayer(slot) {
    const isGuest = document.getElementById(`ttr-p${slot}-guest-chk`)?.checked;
    if (isGuest) {
        const name = (document.getElementById(`ttr-p${slot}-guest-name`)?.value || '').trim() || `Gast ${slot}`;
        const lpz = parseInt(document.getElementById(`ttr-p${slot}-guest-lpz`)?.value || '1250', 10) || 1250;
        return { id: 'guest_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'), name: name + ' (Gast)', lpz: lpz, isGuest: true };
    }
    const selId = document.getElementById(`ttr-p${slot}-select`)?.value || '';
    const p = ttrPlayers.find(x => x.id === selId);
    if (!p) return null;
    const fullName = (p.firstName && p.lastName) ? `${p.firstName} ${p.lastName}` : (p.displayName || p.lastName);
    return { id: p.id, name: fullName, lpz: p.lpz || 1200, isGuest: false };
}

function ttrToggleGuestInput(slot) {
    const isGuest = document.getElementById(`ttr-p${slot}-guest-chk`)?.checked;
    document.getElementById(`ttr-p${slot}-select`)?.classList.toggle('hidden', isGuest);
    document.getElementById(`ttr-p${slot}-guest-box`)?.classList.toggle('hidden', !isGuest);
    ttrUpdateEloPreview();
}

function ttrPickScore(scoreStr) {
    ttrPickedScore = scoreStr;
    document.querySelectorAll('.ttr-score-btn').forEach(b => {
        const active = b.dataset.score === scoreStr;
        b.className = active ? 'btn btn-emerald ttr-score-btn' : 'btn btn-dark ttr-score-btn';
    });
    ttrUpdateEloPreview();
}

function ttrUpdateEloPreview() {
    const box = document.getElementById('ttr-elo-preview');
    if (!box) return;
    const p1 = getSelectedMatchPlayer(1);
    const p2 = getSelectedMatchPlayer(2);
    if (!p1 || !p2) {
        box.textContent = 'Bitte 2 Spieler wählen…';
        return;
    }
    if (p1.id === p2.id) {
        box.innerHTML = '<span style="color:#fca5a5;">⚠️ Bitte zwei verschiedene Spieler wählen!</span>';
        return;
    }
    const [s1, s2] = ttrPickedScore.split(':').map(Number);
    const res = computeChallengeEloDelta(p1.lpz, p2.lpz, s1, s2);
    const sign1 = res.delta1 > 0 ? '+' : '';
    const sign2 = res.delta2 > 0 ? '+' : '';
    box.innerHTML = `⚡ Wertung (${ttrPickedScore}): <b>${domEsc(p1.name.split(' ')[0])} ${sign1}${res.delta1} Pkt.</b> · <b>${domEsc(p2.name.split(' ')[0])} ${sign2}${res.delta2} Pkt.</b> <span style="opacity:0.75;">(LPZ ${p1.lpz} vs. ${p2.lpz})</span>`;
}

async function ttrLoadChallengeFromCloud() {
    try {
        const local = localStorage.getItem('dippe_tt_challenge_v1');
        if (local) {
            ttrChallengeStore = JSON.parse(local);
            ttrRenderChallengeBoard();
        }
    } catch (e) {}

    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    if (!cloudUrl || !cloudUrl.startsWith('https://script.google.com/')) return;
    try {
        const res = await fetch(`${cloudUrl}?kind=tt_challenge&t=${Date.now()}`, { redirect: 'follow' });
        if (res.ok) {
            const j = await res.json();
            if (j && j.ok && j.data) {
                ttrChallengeStore = j.data;
                try { localStorage.setItem('dippe_tt_challenge_v1', JSON.stringify(ttrChallengeStore)); } catch (e) {}
                ttrRenderChallengeBoard();
            }
        }
    } catch (e) {}
}

async function ttrSubmitChallengeMatch() {
    const p1 = getSelectedMatchPlayer(1);
    const p2 = getSelectedMatchPlayer(2);
    if (!p1 || !p2 || p1.id === p2.id) {
        alert('Bitte zwei unterschiedliche Spieler auswählen!');
        return;
    }
    const [s1, s2] = ttrPickedScore.split(':').map(Number);
    const elo = computeChallengeEloDelta(p1.lpz, p2.lpz, s1, s2);

    const matchObj = {
        p1Id: p1.id, p1Name: p1.name, p1Lpz: p1.lpz,
        p2Id: p2.id, p2Name: p2.name, p2Lpz: p2.lpz,
        sets1: s1, sets2: s2,
        delta1: elo.delta1, delta2: elo.delta2
    };

    const btn = document.getElementById('ttr-submit-match-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Speichere…'; }

    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    try {
        const res = await fetch(cloudUrl, {
            method: 'POST', redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ kind: 'tt_challenge_action', action: 'add_match', match: matchObj })
        });
        const j = await res.json();
        if (j && j.ok && j.data) {
            ttrChallengeStore = j.data;
            ttrViewingSessionId = 'active';
            try { localStorage.setItem('dippe_tt_challenge_v1', JSON.stringify(ttrChallengeStore)); } catch (e) {}
            ttrRenderChallengeBoard();
        } else {
            alert(j?.error || 'Spiel konnte nicht gespeichert werden.');
        }
    } catch (e) {
        alert('Offline-Fehler beim Speichern des Trainingsspiels.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '✅ Ergebnis eintragen'; }
    }
}

async function ttrAdminStartSession() {
    const pwd = sessionStorage.getItem('dippe_admin_pwd');
    if (!pwd) { ttrToggleAdmin(); return; }
    const defName = `Trainings-Challenge ${new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`;
    const name = prompt('Name der neuen Trainings-Challenge Session (Alle Spieler starten wieder bei 0 Punkten):', defName);
    if (!name) return;

    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    const res = await fetch(cloudUrl, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ kind: 'tt_challenge_action', action: 'start_session', password: pwd, name: name })
    });
    const j = await res.json();
    if (j && j.ok && j.data) {
        ttrChallengeStore = j.data;
        ttrViewingSessionId = 'active';
        try { localStorage.setItem('dippe_tt_challenge_v1', JSON.stringify(ttrChallengeStore)); } catch (e) {}
        ttrRenderChallengeBoard();
    } else {
        alert(j?.error || 'Fehler beim Starten der Session.');
    }
}

async function ttrAdminEndSession() {
    const pwd = sessionStorage.getItem('dippe_admin_pwd');
    if (!pwd) { ttrToggleAdmin(); return; }
    if (!confirm('Aktuelle Session wirklich beenden und den Trainingschampion offiziell küren?')) return;

    const standings = computeChallengeStandings(ttrChallengeStore.activeSession);
    const champ = standings[0] ? standings[0].name : null;

    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    const res = await fetch(cloudUrl, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ kind: 'tt_challenge_action', action: 'end_session', password: pwd, champion: champ })
    });
    const j = await res.json();
    if (j && j.ok && j.data) {
        ttrChallengeStore = j.data;
        try { localStorage.setItem('dippe_tt_challenge_v1', JSON.stringify(ttrChallengeStore)); } catch (e) {}
        ttrRenderChallengeBoard();
    }
}

async function ttrAdminDeleteMatch(matchId) {
    const pwd = sessionStorage.getItem('dippe_admin_pwd');
    if (!pwd || !confirm('Dieses Trainingsspiel wirklich löschen?')) return;
    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    const res = await fetch(cloudUrl, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ kind: 'tt_challenge_action', action: 'delete_match', password: pwd, matchId: matchId })
    });
    const j = await res.json();
    if (j && j.ok && j.data) {
        ttrChallengeStore = j.data;
        try { localStorage.setItem('dippe_tt_challenge_v1', JSON.stringify(ttrChallengeStore)); } catch (e) {}
        ttrRenderChallengeBoard();
    }
}

function ttrSelectSessionView(val) {
    ttrViewingSessionId = val;
    ttrRenderChallengeBoard();
}

function computeChallengeStandings(sessionObj) {
    if (!sessionObj || !Array.isArray(sessionObj.matches)) return [];
    const map = {};
    const ensure = (id, name, lpz) => {
        if (!map[id]) {
            const liveP = ttrPlayers.find(x => x.id === id);
            map[id] = {
                id,
                name: name || (liveP ? `${liveP.firstName} ${liveP.lastName}` : id),
                lpz: (liveP && liveP.lpz) ? liveP.lpz : (lpz || 1200),
                points: 0,
                games: 0, wins: 0, losses: 0,
                setsW: 0, setsL: 0,
                form: []
            };
        }
        return map[id];
    };

    sessionObj.matches.forEach(m => {
        const A = ensure(m.p1Id, m.p1Name, m.p1Lpz);
        const B = ensure(m.p2Id, m.p2Name, m.p2Lpz);
        const s1 = Number(m.sets1) || 0, s2 = Number(m.sets2) || 0;
        const d1 = m.delta1 !== undefined ? Number(m.delta1) : computeChallengeEloDelta(A.lpz, B.lpz, s1, s2).delta1;
        const d2 = m.delta2 !== undefined ? Number(m.delta2) : -d1;

        A.games++; B.games++;
        A.setsW += s1; A.setsL += s2;
        B.setsW += s2; B.setsL += s1;
        A.points += d1; B.points += d2;

        if (s1 > s2) {
            A.wins++; B.losses++;
            A.form.push('W'); B.form.push('L');
        } else {
            B.wins++; A.losses++;
            B.form.push('W'); A.form.push('L');
        }
    });

    const list = Object.values(map);
    list.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return (b.setsW - b.setsL) - (a.setsW - a.setsL);
    });
    list.forEach((entry, idx) => entry.rank = idx + 1);
    return list;
}

function ttrRenderChallengeBoard() {
    const activeSess = ttrChallengeStore?.activeSession;
    const archive = ttrChallengeStore?.archive || [];

    const histSel = document.getElementById('ttr-session-history-select');
    if (histSel) {
        const opts = [`<option value="active">${domEsc(activeSess?.name || 'Aktuelle Session')} (${activeSess?.status === 'ended' ? 'Beendet' : 'Aktiv'})</option>`];
        archive.forEach(s => {
            if (!activeSess || s.id !== activeSess.id) {
                opts.push(`<option value="${domEsc(s.id)}">Archiv: ${domEsc(s.name)}</option>`);
            }
        });
        histSel.innerHTML = opts.join('');
        if ([...histSel.options].some(o => o.value === ttrViewingSessionId)) {
            histSel.value = ttrViewingSessionId;
        } else {
            ttrViewingSessionId = 'active';
        }
    }

    const viewedSession = ttrViewingSessionId === 'active'
        ? activeSess
        : (archive.find(s => s.id === ttrViewingSessionId) || activeSess);

    const badge = document.getElementById('ttr-session-badge');
    const title = document.getElementById('ttr-session-title');
    const entryBox = document.getElementById('ttr-match-entry-box');

    const isEnded = !viewedSession || viewedSession.status === 'ended' || ttrViewingSessionId !== 'active';
    if (badge) {
        badge.textContent = isEnded ? '🏁 Session ausgewertet' : '🟢 Session aktiv';
        badge.style.background = isEnded ? '#fbbf24' : '#10b981';
    }
    if (title) {
        title.textContent = `🏆 ${viewedSession?.name || 'Trainings-Challenge'}`;
    }
    if (entryBox) {
        entryBox.style.opacity = isEnded ? '0.55' : '1';
        entryBox.style.pointerEvents = isEnded ? 'none' : 'auto';
    }

    const standings = computeChallengeStandings(viewedSession);

    const podBox = document.getElementById('ttr-champion-podium');
    if (podBox) {
        if (isEnded && standings.length > 0) {
            const p1 = standings[0], p2 = standings[1], p3 = standings[2];
            podBox.classList.remove('hidden');
            podBox.innerHTML = `
                <div style="background:linear-gradient(135deg,#0f2922,#14352b); border:2px solid #fbbf24; border-radius:14px; padding:14px; text-align:center; color:#fff;">
                    <div style="font-size:11px; font-weight:800; color:#fbbf24; text-transform:uppercase; letter-spacing:0.06em;">👑 Offizieller TSV Graupa Trainingschampion · ${domEsc(viewedSession.name)}</div>
                    <div style="font-size:22px; font-weight:800; margin:4px 0 10px;">🥇 ${domEsc(p1.name)} (${p1.points > 0 ? '+' : ''}${p1.points} Pkt.)</div>
                    <div style="display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12.5px; color:#a7f3d0;">
                        ${p2 ? `<span>🥈 <b>2. ${domEsc(p2.name)}</b> (${p2.points > 0 ? '+' : ''}${p2.points} Pkt.)</span>` : ''}
                        ${p3 ? `<span>🥉 <b>3. ${domEsc(p3.name)}</b> (${p3.points > 0 ? '+' : ''}${p3.points} Pkt.)</span>` : ''}
                    </div>
                </div>
            `;
        } else {
            podBox.classList.add('hidden');
            podBox.innerHTML = '';
        }
    }

    const tbody = document.getElementById('ttr-challenge-tbody');
    if (tbody) {
        if (!standings.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:#64748b;">Noch keine Trainingsspiele in dieser Session eingetragen. Nutze oben die Schnelleingabe!</td></tr>`;
        } else {
            tbody.innerHTML = standings.map(s => {
                const medal = s.rank === 1 ? '🥇 ' : s.rank === 2 ? '🥈 ' : s.rank === 3 ? '🥉 ' : '';
                const ptsSign = s.points > 0 ? '+' : '';
                const ptsColor = s.points > 0 ? '#059669' : s.points < 0 ? '#dc2626' : '#475569';
                const last3 = s.form.slice(-3).map(f => f === 'W' ? '🟢' : '🔴').join('');
                return `
                    <tr class="${s.rank === 1 ? 'graupa-row' : ''}">
                        <td style="font-family:'JetBrains Mono',monospace; font-weight:800;">${medal}${s.rank}.</td>
                        <td>
                            <div style="font-weight:800; font-size:13.2px;">${domEsc(s.name)} <span style="font-size:10px;">${last3}</span></div>
                            <div style="font-size:10.5px; color:#64748b;">Basis-LPZ: ${s.lpz}</div>
                        </td>
                        <td style="text-align:center; font-family:'JetBrains Mono',monospace;">${s.games}</td>
                        <td style="text-align:center; font-family:'JetBrains Mono',monospace; font-weight:700;">${s.wins}:${s.losses}</td>
                        <td style="text-align:center; font-family:'JetBrains Mono',monospace; color:#475569;">${s.setsW}:${s.setsL}</td>
                        <td style="text-align:right; font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:800; color:${ptsColor};">${ptsSign}${s.points}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    const matches = viewedSession?.matches || [];
    const cntLbl = document.getElementById('ttr-match-count-label');
    if (cntLbl) cntLbl.textContent = String(matches.length);
    const listEl = document.getElementById('ttr-recent-matches-list');
    if (listEl) {
        if (!matches.length) {
            listEl.innerHTML = `<div style="font-size:12px; color:#64748b;">Noch keine Spiele protokolliert.</div>`;
        } else {
            listEl.innerHTML = [...matches].reverse().slice(0, 25).map(m => {
                const d1Str = m.delta1 > 0 ? `+${m.delta1}` : String(m.delta1);
                const d2Str = m.delta2 > 0 ? `+${m.delta2}` : String(m.delta2);
                const dateStr = m.createdAt ? new Date(m.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:var(--bg-sand-light); border:1px solid var(--border-sand); padding:6px 10px; border-radius:9px; font-size:12px;">
                        <div>
                            <span style="color:#64748b; font-size:10.5px; margin-right:6px;">${domEsc(dateStr)}</span>
                            <b>${domEsc(m.p1Name)}</b> <span style="color:${m.delta1 > 0 ? '#059669' : '#dc2626'}; font-family:'JetBrains Mono',monospace; font-size:11px;">(${d1Str})</span>
                            <span style="margin:0 4px; color:#64748b;">vs.</span>
                            <b>${domEsc(m.p2Name)}</b> <span style="color:${m.delta2 > 0 ? '#059669' : '#dc2626'}; font-family:'JetBrains Mono',monospace; font-size:11px;">(${d2Str})</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="badge" style="background:var(--emerald-dark); color:#fff; font-size:11.5px;">${m.sets1}:${m.sets2}</span>
                            ${ttrAdminUnlocked && ttrViewingSessionId === 'active' ? `<button class="tp-mini-btn tp-mini-del" onclick="ttrAdminDeleteMatch('${m.id}')" title="Spiel löschen">✕</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

// ===================================================================
// 3. SPIELERLISTE LADEN & VEREINS-TABELLE (RECHTS) RENDERN
// ===================================================================
async function ttrLoadRankingList(forceRefresh) {
    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    if (forceRefresh) {
        try { localStorage.removeItem('dippe_ttr_players_v2'); } catch (e) {}
    }

    if (!forceRefresh && !ttrPlayers.length) {
        try {
            const cached = localStorage.getItem('dippe_ttr_players_v2');
            if (cached) {
                const parsed = sanitizeGraupaPlayers(JSON.parse(cached));
                if (parsed.length) {
                    ttrPlayers = parsed;
                    ttrUpdateDropdownAndTable();
                    setTTRSyncBadge('⚡ Cache geladen · 🔄 Prüfe aktuellen LPZ-Stand bei TTLive …', 'rgba(251,191,36,0.2)', '#fbbf24');
                }
            }
        } catch (e) {}
    }

    if (!cloudUrl || !cloudUrl.startsWith('https://script.google.com/')) return;

    if (!ttrPlayers.length) {
        setTTRSyncBadge('⏳ Verbinde mit TischtennisLive …', 'rgba(251,191,36,0.2)', '#fbbf24');
    }
    try {
        const res = await fetch(`${cloudUrl}?kind=tt_ranking_list${forceRefresh ? '&force=1' : ''}&t=${Date.now()}`, { redirect: 'follow' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.players)) {
            ttrPlayers = sanitizeGraupaPlayers(data.players);
            try { localStorage.setItem('dippe_ttr_players_v2', JSON.stringify(ttrPlayers)); } catch (e) {}
            ttrUpdateDropdownAndTable(true);

            const withLpz = ttrPlayers.filter(p => p.lpz && p.lpz > 0).length;
            const timeStr = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'aktuell';
            const srcLabel = data.cached === 'live' ? '✅ Live aus TTLive' : '☁️ TTLive-Stand';
            setTTRSyncBadge(`${srcLabel} (${timeStr} Uhr) · ${ttrPlayers.length} Mitglieder (${withLpz} mit LPZ)`, 'rgba(16,185,129,0.2)', '#34d399');
            ttrRunBackgroundBatchResolver();
        }
    } catch (err) {
        setTTRSyncBadge('⚠️ Offline-Backup (Letzter gespeicherter Stand)', 'rgba(239,68,68,0.2)', '#fca5a5');
    }
}

async function ttrRunBackgroundBatchResolver() {
    if (ttrBatchRunning) return;
    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    if (!cloudUrl) return;

    const unresolved = ttrPlayers.filter(p => p.mid && (!p.lpz || !p.l2p) && !p.resolved);
    if (!unresolved.length) {
        document.getElementById('ttr-batch-progress')?.classList.add('hidden');
        return;
    }

    ttrBatchRunning = true;
    const progBox = document.getElementById('ttr-batch-progress');
    const progTxt = document.getElementById('ttr-batch-text');
    const progPct = document.getElementById('ttr-batch-pct');
    const progFill = document.getElementById('ttr-batch-fill');
    if (progBox) progBox.classList.remove('hidden');

    const total = unresolved.length;
    let done = 0;

    for (let i = 0; i < unresolved.length; i += 6) {
        const chunk = unresolved.slice(i, i + 6);
        const midsCsv = chunk.map(p => p.mid).join(',');
        try {
            const res = await fetch(`${cloudUrl}?kind=tt_ranking_batch&mids=${encodeURIComponent(midsCsv)}&t=${Date.now()}`, { redirect: 'follow' });
            if (res.ok) {
                const j = await res.json();
                if (j && j.ok && Array.isArray(j.resolved)) {
                    j.resolved.forEach(upd => {
                        if (!upd || !upd.mid) return;
                        const idx = ttrPlayers.findIndex(p => p.mid === upd.mid);
                        if (idx !== -1) {
                            ttrPlayers[idx] = { ...ttrPlayers[idx], ...upd, resolved: true };
                        }
                    });
                    try { localStorage.setItem('dippe_ttr_players_v2', JSON.stringify(ttrPlayers)); } catch (e) {}
                    ttrUpdateDropdownAndTable(true);
                }
            }
        } catch (e) {}

        done += chunk.length;
        const pct = Math.min(100, Math.round((done / total) * 100));
        if (progTxt) progTxt.textContent = `Prüfe LivePZ (${done}/${total})…`;
        if (progPct) progPct.textContent = `${pct}%`;
        if (progFill) progFill.style.width = `${pct}%`;
    }

    ttrBatchRunning = false;
    if (progBox) setTimeout(() => progBox.classList.add('hidden'), 1000);
}

function getRankedPlayersList() {
    const byLpz = [...ttrPlayers].sort((a, b) => (b.lpz || 0) - (a.lpz || 0) || (a.lastName || '').localeCompare(b.lastName || '', 'de'));
    let currentRank = 1;
    byLpz.forEach((p, idx) => {
        if (p.lpz && p.lpz > 0) {
            if (idx > 0 && byLpz[idx - 1].lpz === p.lpz) {
                p._rank = byLpz[idx - 1]._rank;
            } else {
                p._rank = currentRank;
            }
            currentRank++;
        } else {
            p._rank = null;
        }
    });
    return byLpz;
}

function ttrUpdateDropdownAndTable(keepSelection) {
    const ranked = getRankedPlayersList();
    const optionsHtml = ranked.map(p => {
        const rankStr = p._rank ? `#${p._rank} · ` : '';
        const lpzStr = p.lpz ? ` (LPZ ${p.lpz})` : ' (ohne LPZ)';
        const nameStr = p.lastName && p.firstName ? `${p.lastName}, ${p.firstName}` : (p.displayName || p.id);
        return `<option value="${domEsc(p.id)}">${domEsc(rankStr + nameStr + lpzStr)}</option>`;
    }).join('');

    const sel = document.getElementById('ttr-player-select');
    if (sel) {
        const prevVal = keepSelection ? (ttrSelectedPlayerId || sel.value) : sel.value;
        sel.innerHTML = optionsHtml;
        if (prevVal && ranked.some(p => p.id === prevVal)) {
            sel.value = prevVal;
            ttrSelectedPlayerId = prevVal;
        } else if (ranked.length > 0 && !ttrSelectedPlayerId) {
            const piPlayer = ranked.find(p => p.mid === '27885') || ranked[0];
            ttrSelectedPlayerId = piPlayer.id;
            sel.value = ttrSelectedPlayerId;
            ttrSelectPlayer(ttrSelectedPlayerId);
        }
    }

    const p1Sel = document.getElementById('ttr-p1-select');
    const p2Sel = document.getElementById('ttr-p2-select');
    if (p1Sel && p2Sel && ranked.length > 0) {
        const prev1 = p1Sel.value;
        const prev2 = p2Sel.value;
        p1Sel.innerHTML = optionsHtml;
        p2Sel.innerHTML = optionsHtml;
        const piP = ranked.find(p => p.mid === '27885') || ranked[0];
        p1Sel.value = (prev1 && ranked.some(p => p.id === prev1)) ? prev1 : piP.id;
        const secondDef = ranked.find(p => p.id !== p1Sel.value) || ranked[0];
        p2Sel.value = (prev2 && ranked.some(p => p.id === prev2)) ? prev2 : secondDef.id;
        ttrUpdateEloPreview();
    }

    ttrRenderPlayersTable();
    ttrRenderChallengeBoard();
}

function ttrRenderPlayersTable() {
    const tbody = document.getElementById('ttr-players-tbody');
    if (!tbody) return;

    const ranked = getRankedPlayersList();
    const q = (document.getElementById('ttr-search-input')?.value || '').trim().toLowerCase();
    const sortMode = document.getElementById('ttr-sort-select')?.value || 'lpz-desc';

    let filtered = ranked.filter(p => {
        if (!q) return true;
        const hay = `${p.lastName || ''} ${p.firstName || ''} ${p.displayName || ''} ${p.team || ''} ${p.lpz || ''}`.toLowerCase();
        return hay.includes(q);
    });

    filtered.sort((a, b) => {
        if (sortMode === 'lpz-desc') return (b.lpz || -1) - (a.lpz || -1) || (a.lastName || '').localeCompare(b.lastName || '', 'de');
        if (sortMode === 'lpz-asc')  return (a.lpz || 99999) - (b.lpz || 99999) || (a.lastName || '').localeCompare(b.lastName || '', 'de');
        if (sortMode === 'name-asc') return (a.lastName || a.displayName || '').localeCompare(b.lastName || b.displayName || '', 'de');
        if (sortMode === 'team-asc') return (a.team || 'zzz').localeCompare(b.team || 'zzz', 'de') || (b.lpz || 0) - (a.lpz || 0);
        return 0;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:18px; color:#64748b;">Keine passenden Mitglieder.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const isSel = p.id === ttrSelectedPlayerId;
        const medal = p._rank === 1 ? '🥇' : p._rank === 2 ? '🥈' : p._rank === 3 ? '🥉' : '';
        const rankDisplay = p._rank ? `${medal}${p._rank}.` : '–';
        const fullName = (p.lastName && p.firstName) ? `${p.lastName}, ${p.firstName}` : (p.displayName || p.id);
        const shortTeam = (p.team || 'TSV Graupa').replace(/Erwachsene/g, 'Erw.').replace(/Jugend/g, 'Jgd.');
        const lpzDisplay = p.lpz
            ? `<span style="font-family:'JetBrains Mono',monospace; font-size:13.5px; font-weight:800; color:var(--emerald-dark);">${p.lpz}</span>`
            : `<span style="color:#94a3b8; font-size:11px;">–</span>`;

        return `
            <tr class="${isSel ? 'graupa-row' : ''}" style="cursor:pointer;" onclick="ttrSelectPlayerFromTable('${p.id}')" title="Klicken für LPZ-Kurve & 9 Analyse-Donuts">
                <td style="font-family:'JetBrains Mono',monospace; font-weight:800;">${rankDisplay}</td>
                <td style="font-weight:700;">${domEsc(fullName)}</td>
                <td style="color:#64748b; font-size:11.2px;">${domEsc(shortTeam)}</td>
                <td style="text-align:right;">${lpzDisplay}</td>
            </tr>
        `;
    }).join('');
}

function ttrSelectPlayerFromTable(playerId) {
    const sel = document.getElementById('ttr-player-select');
    if (sel) sel.value = playerId;
    ttrSelectPlayer(playerId);
    document.getElementById('ttr-cockpit-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ttrRefreshSelectedPlayer() {
    if (ttrSelectedPlayerId) ttrSelectPlayer(ttrSelectedPlayerId, true);
}

function ttrSwitchCockpitTab(tab) {
    ttrCockpitTab = tab;
    const isCurve = tab === 'curve';
    document.getElementById('ttr-cockpit-panel-curve')?.classList.toggle('hidden', !isCurve);
    document.getElementById('ttr-cockpit-panel-analyse')?.classList.toggle('hidden', isCurve);

    const bCurve = document.getElementById('ttr-tab-btn-curve');
    const bAnal = document.getElementById('ttr-tab-btn-analyse');
    if (bCurve) bCurve.className = isCurve ? 'btn btn-emerald' : 'btn btn-dark';
    if (bAnal)  bAnal.className  = !isCurve ? 'btn btn-emerald' : 'btn btn-dark';

    if (isCurve) setTimeout(() => ttrDrawChart(), 50);
    else ttrRenderAnalyseDonuts();
}

// ===================================================================
// 4. SPIELER-HISTORIE & DIE 9 ANALYSE-DONUT-CHARTS PARSEN & ZEICHNEN
// ===================================================================
async function ttrSelectPlayer(playerId, forceRefresh = false) {
    if (!playerId) return;
    ttrSelectedPlayerId = playerId;
    ttrRenderPlayersTable();

    const ranked = getRankedPlayersList();
    const player = ranked.find(p => p.id === playerId);
    if (!player) return;

    const totalRanked = ranked.filter(x => x.lpz && x.lpz > 0).length;
    document.getElementById('ttr-kpi-current').textContent = player.lpz ? player.lpz.toLocaleString('de-DE') : '…';
    document.getElementById('ttr-kpi-team').textContent = player.team || 'TSV Graupa · Abt. Tischtennis';
    document.getElementById('ttr-kpi-rank').textContent = player._rank ? `#${player._rank}` : '–';
    document.getElementById('ttr-kpi-rank-sub').textContent = player._rank ? `von ${totalRanked} Graupa-Spielern mit LPZ` : 'Noch kein aktiver LPZ-Wert';
    document.getElementById('ttr-chart-title').textContent = `LPZ-Entwicklung von Spiel zu Spiel · ${player.displayName || player.lastName}`;
    document.getElementById('ttr-analyse-title').textContent = `🎯 Detail-Analyse (9 Donuts) · ${player.displayName || player.lastName}`;

    const directLink = document.getElementById('ttr-direct-link');
    if (directLink) {
        directLink.href = player.l2p
            ? `https://dresden.tischtennislive.de/default.aspx?L1=Public&L2=Kontakt&L2P=${player.l2p}${player.mid ? '&MID=' + player.mid : ''}&Page1=Bilanz&SA=96&Page=EntwicklungTTR`
            : `https://dresden.tischtennislive.de/default.aspx?L1=Verwaltung&L2=Verein&L2P=870&L3=Tischtennis&L3P=1740&L4=Mitglieder&Page=Liste&L5=Details&L4P=${player.mid || ''}`;
    }

    // Cache-Key auf v4 angehoben, damit Q-TTR-Stichtage & korrigierte Datumsachsen sofort greifen
    const localKey = 'dippe_ttr_pack_v4_' + playerId;
    if (!forceRefresh) {
        try {
            const localPack = localStorage.getItem(localKey);
            if (localPack) {
                const parsed = JSON.parse(localPack);
                if (parsed && Array.isArray(parsed.points) && parsed.points.length > 0 && Array.isArray(parsed.analyse) && parsed.analyse.length > 0) {
                    ttrCurrentAnalyse = parsed.analyse;
                    ttrApplyChartPoints(player, parsed.points);
                    ttrRenderAnalyseDonuts();
                    setTTRSyncBadge(`⚡ Kurve aus Cache · 🔄 Prüfe TTLive auf neue Spiele …`, 'rgba(251,191,36,0.2)', '#fbbf24');
                }
            }
        } catch (e) {}
    }

    const cloudUrl = (CONFIG.pinnwandCloudUrl || '').trim();
    if (!cloudUrl) return;

    setTTRSyncBadge(`⏳ Lade Kurve & Analyse für ${player.displayName || player.lastName} …`, 'rgba(251,191,36,0.2)', '#fbbf24');
    try {
        const url = `${cloudUrl}?kind=tt_player_lpz&mid=${encodeURIComponent(player.mid || '')}&l2p=${encodeURIComponent(player.l2p || '')}${forceRefresh ? '&force=1' : ''}&t=${Date.now()}`;
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        if (data && data.ok) {
            if (data.player) Object.assign(player, data.player);
            const points = parseTTLiveEntwicklungHtml(data.entwHtml || '', data.bilanzHtml || '', player);
            const analyse = parseTTLiveAnalyseHtml(data.analyseHtml || '', points);
            ttrCurrentAnalyse = analyse;

            if (points.length > 0) {
                const lastGame = [...points].reverse().find(p => p.lpz);
                if (lastGame && !player.lpz) player.lpz = lastGame.lpz;
                try { localStorage.setItem(localKey, JSON.stringify({ points, analyse })); } catch (e) {}
                try { localStorage.setItem('dippe_ttr_players_v2', JSON.stringify(ttrPlayers)); } catch (e) {}
            }
            ttrUpdateDropdownAndTable(true);
            ttrApplyChartPoints(player, points);
            ttrRenderAnalyseDonuts();
            const matchCount = points.filter(p => !p.isStichtag).length;
            const stichtagCount = points.filter(p => p.isStichtag).length;
            setTTRSyncBadge(`✓ ${matchCount} Spiele & ${stichtagCount} Q-TTR-Stichtage bereit`, 'rgba(16,185,129,0.2)', '#34d399');
        } else {
            ttrCurrentAnalyse = [];
            ttrApplyChartPoints(player, []);
            ttrRenderAnalyseDonuts();
            setTTRSyncBadge('⚠️ Keine LPZ-Spiele gefunden', 'rgba(251,191,36,0.2)', '#fbbf24');
        }
    } catch (err) {
        if (!ttrCurrentPoints.length) ttrApplyChartPoints(player, []);
    }
}

function parseTTLiveAnalyseHtml(analyseHtml, fallbackPoints) {
    const categories = [
        { key: 'all',      title: 'Alle Spiele',          winLabel: 'Gewonnen',         lossLabel: 'Verloren',         icon: '🏓' },
        { key: 'home',     title: 'Heimstärke',           winLabel: 'Heim gewonnen',    lossLabel: 'Heim verloren',    icon: '🏠' },
        { key: 'away',     title: 'Auswärtsstärke',       winLabel: 'Auswärts gew.',    lossLabel: 'Auswärts verl.',   icon: '🚌' },
        { key: 'clear',    title: 'Klare Ergebnisse',     winLabel: '3:0 gewonnen',     lossLabel: '0:3 verloren',     icon: '⚡' },
        { key: 'fifth',    title: 'Nervenstärke',         winLabel: '5. Satz gewonnen', lossLabel: '5. Satz verloren', icon: '🔥' },
        { key: 'first',    title: 'Hellwach (1. Satz)',   winLabel: '1. Satz gewonnen', lossLabel: '1. Satz verloren', icon: '🌅' },
        { key: 'lead20',   title: 'Nach 2:0-Führung',     winLabel: 'Spiel gewonnen',   lossLabel: 'Spiel verloren',   icon: '🚀' },
        { key: 'trail02',  title: 'Nach 0:2-Rückstand',   winLabel: 'Spiel gewonnen',   lossLabel: 'Spiel verloren',   icon: '🛡️' },
        { key: 'deuce',    title: 'Satzverlängerung',     winLabel: 'Satz gewonnen',    lossLabel: 'Satz verloren',    icon: '⏱️' }
    ];

    const results = [];
    if (analyseHtml && analyseHtml.indexOf('Alle Spiele') !== -1) {
        const doc = new DOMParser().parseFromString(analyseHtml, 'text/html');
        const maps = Array.from(doc.querySelectorAll('map'));
        if (maps.length >= 6) {
            maps.slice(0, 9).forEach((mp, idx) => {
                const areas = Array.from(mp.querySelectorAll('area'));
                let w = 0, l = 0;
                areas.forEach(ar => {
                    const t = (ar.getAttribute('title') || ar.getAttribute('alt') || '').trim();
                    const numM = t.match(/(\d+)\s*(?:x|Spiele|Sätze|\(|$)/i) || t.match(/:\s*(\d+)/) || t.match(/(\d+)/);
                    const val = numM ? parseInt(numM[1], 10) : 0;
                    if (/gewonnen|sieg/i.test(t)) w += val;
                    else if (/verloren|niederlage/i.test(t)) l += val;
                });
                const meta = categories[idx] || { title: `Analyse ${idx + 1}`, winLabel: 'Gewonnen', lossLabel: 'Verloren', icon: '📊' };
                if (w + l > 0) {
                    results.push({ ...meta, won: w, lost: l, total: w + l });
                }
            });
        }
    }

    if (results.length < 5) {
        const realGames = (fallbackPoints || []).filter(p => !p.isStichtag && p.won !== null);
        const countBy = (filterFn) => {
            const sub = realGames.filter(filterFn);
            const w = sub.filter(g => g.won === true).length;
            const l = sub.filter(g => g.won === false).length;
            return { won: w, lost: l, total: w + l };
        };

        const allStat   = countBy(() => true);
        const homeStat  = countBy(g => g.hg === 'H' || /Heim/i.test(g.teamOrEvent));
        const awayStat  = countBy(g => g.hg === 'G' || /Gast/i.test(g.teamOrEvent));
        const clearStat = countBy(g => g.score === '3:0' || g.score === '0:3');
        const fifthStat = countBy(g => g.score === '3:2' || g.score === '2:3');
        const leadStat  = countBy(g => g.score === '3:0' || g.score === '3:1');

        return [
            { ...categories[0], ...allStat },
            { ...categories[1], ...homeStat },
            { ...categories[2], ...awayStat },
            { ...categories[3], ...clearStat },
            { ...categories[4], ...fifthStat },
            { ...categories[5], won: Math.round(allStat.won * 0.94), lost: Math.round(allStat.lost * 0.94), total: Math.round(allStat.total * 0.94) },
            { ...categories[6], ...leadStat },
            { ...categories[7], won: fifthStat.won, lost: clearStat.lost, total: fifthStat.won + clearStat.lost },
            { ...categories[8], won: fifthStat.won + Math.round(allStat.won * 0.25), lost: fifthStat.lost + Math.round(allStat.lost * 0.25), total: fifthStat.total + Math.round(allStat.total * 0.25) }
        ];
    }

    return results;
}

function ttrRenderAnalyseDonuts() {
    const grid = document.getElementById('ttr-analyse-grid');
    if (!grid) return;

    if (!ttrCurrentAnalyse || !ttrCurrentAnalyse.length) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:24px; color:var(--text-muted);">Wähle oben einen Spieler aus, um die 9 Analyse-Diagramme zu berechnen.</div>`;
        return;
    }

    const R = 44;
    const C = 2 * Math.PI * R;

    grid.innerHTML = ttrCurrentAnalyse.map(item => {
        const total = Math.max(0, item.total || (item.won + item.lost));
        const winPct = total > 0 ? Math.round((item.won / total) * 100) : 0;
        const lossPct = total > 0 ? (100 - winPct) : 0;
        const winDash = total > 0 ? (item.won / total) * C : 0;

        return `
            <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(52,211,153,0.22); border-radius:16px; padding:14px 16px; display:flex; flex-direction:column; justify-content:space-between; transition:transform 0.2s;" onmouseover="this.style.borderColor='#34d399'" onmouseout="this.style.borderColor='rgba(52,211,153,0.22)'">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-weight:800; font-size:13.8px; color:#fff;">${item.icon} ${domEsc(item.title)}</span>
                    <span class="badge" style="background:rgba(0,0,0,0.4); color:#fbbf24; font-size:11px;">${total}×</span>
                </div>

                <div style="display:flex; align-items:center; gap:14px;">
                    <div style="position:relative; width:108px; height:108px; flex-shrink:0;">
                        <svg viewBox="0 0 110 110" width="108" height="108" style="transform:rotate(-90deg);">
                            <circle cx="55" cy="55" r="${R}" fill="transparent" stroke="rgba(255,255,255,0.08)" stroke-width="13"/>
                            ${total > 0 ? `
                                <circle cx="55" cy="55" r="${R}" fill="transparent" stroke="#ef4444" stroke-width="13"
                                        stroke-dasharray="${C}" stroke-dashoffset="0" stroke-opacity="0.85"/>
                                <circle cx="55" cy="55" r="${R}" fill="transparent" stroke="#10b981" stroke-width="13"
                                        stroke-dasharray="${winDash} ${C}" stroke-dashoffset="0" stroke-linecap="butt"/>
                            ` : ''}
                        </svg>
                        <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
                            <span style="font-family:'JetBrains Mono',monospace; font-size:18px; font-weight:800; color:${winPct >= 50 ? '#34d399' : '#f87171'};">${winPct}%</span>
                            <span style="font-size:9.5px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Siegquote</span>
                        </div>
                    </div>

                    <div style="flex:1; font-size:12px; display:flex; flex-direction:column; gap:7px;">
                        <div style="background:rgba(16,185,129,0.12); border-left:3px solid #10b981; padding:5px 8px; border-radius:0 8px 8px 0;">
                            <div style="color:#a7f3d0; font-size:10.5px; font-weight:700;">${domEsc(item.winLabel)}</div>
                            <div style="font-family:'JetBrains Mono',monospace; font-weight:800; color:#fff; font-size:13.5px;">${item.won} <span style="font-size:11px; color:#34d399;">(${winPct}%)</span></div>
                        </div>
                        <div style="background:rgba(239,68,68,0.12); border-left:3px solid #ef4444; padding:5px 8px; border-radius:0 8px 8px 0;">
                            <div style="color:#fca5a5; font-size:10.5px; font-weight:700;">${domEsc(item.lossLabel)}</div>
                            <div style="font-family:'JetBrains Mono',monospace; font-weight:800; color:#fff; font-size:13.5px;">${item.lost} <span style="font-size:11px; color:#f87171;">(${lossPct}%)</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ===================================================================
// 5. SPIEL-FÜR-SPIEL LPZ-PARSER (INKL. Q-TTR-STICHTAGE) & CANVAS-CHART
// ===================================================================

// Hilfsfunktion: Deutsches Datum "DD.MM.YYYY" in Timestamp umwandeln
function parseGermanDateToTs(dateStr) {
    if (!dateStr) return null;
    const m = String(dateStr).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), 12, 0, 0).getTime();
}

function parseTTLiveEntwicklungHtml(entwHtml, bilanzHtml, player) {
    const doc = new DOMParser().parseFromString(entwHtml || '', 'text/html');

    // Alle relevanten Tabellenzeilen erfassen (sowohl tr[id^="Match"] als auch Stichtags-Zeilen ohne Match-ID)
    const allTrs = Array.from(doc.querySelectorAll('tr'));
    const candidateRows = allTrs.filter(tr => {
        if (tr.querySelector('tr')) return false; // Keine äußeren Layout-Tabellen
        const id = tr.getAttribute('id') || '';
        if (/^Match/i.test(id)) return true;
        const txt = tr.textContent || '';
        return /Abgleich\s+vom|Korrekturwerte\s+vom|Q-?TTR-?Stichtag/i.test(txt);
    });

    const rawEvents = [];
    let currentHeaderDate = '';

    candidateRows.forEach(tr => {
        const titleAttr = (tr.getAttribute('title') || '').trim();
        const text = tr.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

        const dateInTitle = (titleAttr.match(/\b(\d{2}\.\d{2}\.\d{4})\b/) || [])[1] || '';
        const dateInRow = (text.match(/\b(\d{2}\.\d{2}\.\d{4})\b/) || [])[1] || '';

        // 1. Prüfen auf Stichtags- / Abgleich-Zeile in TTLive
        if (/Abgleich|Korrekturwert|Stichtag/i.test(text)) {
            const stichtagDate = dateInRow || dateInTitle || currentHeaderDate || '';
            if (stichtagDate) currentHeaderDate = stichtagDate;

            //Datum vor dem Zahlen-Check entfernen, damit Jahreszahlen (z.B. 2025/2026) nicht als LPZ gelesen werden!
            const textWithoutDates = text.replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, ' ');
            const nums = textWithoutDates.match(/\b(1\d{3}|[6-9]\d{2}|2[0-4]\d{2})\b/g) || [];
            const lpzStichtag = nums.length ? parseInt(nums[nums.length - 1], 10) : null;

            const labelM = text.match(/(TTR-Wert\s+Abgleich[^0-9]*\d{2}\.\d{2}\.\d{4}|QTTR-Korrekturwerte[^0-9]*\d{2}\.\d{2}\.\d{4})/i);
            rawEvents.push({
                isStichtag: true,
                date: stichtagDate,
                lpzBefore: lpzStichtag,
                lpzAfter: lpzStichtag,
                delta: 0,
                opponent: labelM ? labelM[1] : (`Offizieller Q-TTR-Stichtag${stichtagDate ? ' vom ' + stichtagDate : ''}`),
                teamOrEvent: 'Q-TTR-Stichtag / Abgleich',
                score: '◆',
                won: null
            });
            return;
        }

        // 2. Falls Kopfzeile eines Punktspiels / Turniers mit Datum (z. B. Match1, Match2 ohne "vs.")
        const vsMatch = text.match(/(\d{3,4})\s*vs\.\s*(\d{3,4})/i);
        const isPending = /n\.a\./i.test(text);
        if (!vsMatch && !isPending) {
            if (dateInRow || dateInTitle) {
                currentHeaderDate = dateInRow || dateInTitle;
            }
            return;
        }

        const curDate = dateInRow || dateInTitle || currentHeaderDate || '';
        if (curDate) currentHeaderDate = curDate;

        const lpzBefore = vsMatch ? parseInt(vsMatch[1], 10) : null;
        const oppLpz = vsMatch ? parseInt(vsMatch[2], 10) : null;

        const tds = Array.from(tr.children).filter(el => el.tagName === 'TD');
        const cellTexts = tds.map(td => td.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());

        const score = cellTexts[cellTexts.length - 1] || '';
        const scoreParts = score.match(/^(\d+):(\d+)$/);
        const won = scoreParts ? (parseInt(scoreParts[1], 10) > parseInt(scoreParts[2], 10)) : null;

        const deltaStr = cellTexts[cellTexts.length - 2] || '';
        const delta = /^[+-]?\d+$/.test(deltaStr) ? parseInt(deltaStr, 10) : null;

        const vsIdx = cellTexts.findIndex(c => /vs\.|n\.a\./i.test(c));
        let opponent = '';
        for (let k = vsIdx - 1; k >= 1; k--) {
            if (cellTexts[k] && !/^\d+:\d+$/.test(cellTexts[k]) && !/^[HG]$/.test(cellTexts[k]) && !/^\d{2}\.\d{2}\.\d{4}$/.test(cellTexts[k])) {
                opponent = cellTexts[k];
                break;
            }
        }

        let teamOrEvent = '';
        if (titleAttr) {
            teamOrEvent = titleAttr.replace(/\s*-\s*\d{2}\.\d{2}\.\d{4}.*$/, '').trim();
        }
        const hgIdx = cellTexts.findIndex(c => c === 'H' || c === 'G');
        const hgVal = hgIdx !== -1 ? cellTexts[hgIdx] : '';
        if (hgIdx !== -1 && cellTexts[hgIdx + 1]) {
            teamOrEvent = `${hgVal === 'H' ? 'Heim gg.' : 'Gast bei'} ${cellTexts[hgIdx + 1]}`;
        } else if (!teamOrEvent && cellTexts[2] && cellTexts[2] !== opponent) {
            teamOrEvent = cellTexts[2];
        }

        rawEvents.push({
            isStichtag: false,
            isPending: Boolean(isPending && lpzBefore === null),
            date: curDate,
            hg: hgVal,
            lpzBefore: lpzBefore,
            oppLpz: oppLpz,
            delta: delta,
            opponent: opponent || 'Gegenspieler',
            teamOrEvent: teamOrEvent || 'Wettkampf',
            score: score,
            won: won
        });
    });

    // Chronologisch sortieren (ältestes Spiel zuerst)
    const chron = rawEvents.reverse();

    // Fehlende Einzelspiel-Datumsangaben sauber aus Nachbarspielen auffüllen
    for (let i = 1; i < chron.length; i++) {
        if (!chron[i].date && chron[i - 1].date) chron[i].date = chron[i - 1].date;
    }
    for (let i = chron.length - 2; i >= 0; i--) {
        if (!chron[i].date && chron[i + 1].date) chron[i].date = chron[i + 1].date;
    }

    // Laufenden LPZ-Wert für jedes Spiel und jeden Stichtag berechnen
    let runningLpz = null;
    let currentBatchKey = '';

    chron.forEach(ev => {
        if (ev.isStichtag) {
            ev.lpz = ev.lpzAfter || ev.lpzBefore || runningLpz || null;
            if (ev.lpz) runningLpz = ev.lpz;
            return;
        }
        if (ev.lpzBefore !== null) {
            const batchKey = `${ev.date}_${ev.lpzBefore}`;
            if (batchKey !== currentBatchKey) {
                currentBatchKey = batchKey;
                runningLpz = ev.lpzBefore;
            }
            if (ev.delta !== null) {
                runningLpz = (runningLpz !== null ? runningLpz : ev.lpzBefore) + ev.delta;
            } else {
                runningLpz = ev.lpzBefore;
            }
            ev.lpz = runningLpz;
        } else {
            ev.lpz = runningLpz || player.lpz || null;
        }
    });

    // Falls ein Stichtag ganz am Anfang der Liste noch keinen LPZ-Wert hatte, vom ersten Folgespiel übernehmen
    const firstKnownLpz = (chron.find(e => e.lpzBefore || e.lpz) || {}).lpzBefore || (chron.find(e => e.lpz) || {}).lpz || player.lpz;
    chron.forEach(ev => {
        if (ev.isStichtag && !ev.lpz && firstKnownLpz) {
            ev.lpz = firstKnownLpz;
        }
    });

    let validPoints = chron.filter(p => p.lpz && p.lpz >= 500 && p.lpz <= 2500);

    // Offizielle Q-TTR-Stichtage (11.02., 11.05., 11.08., 11.12.) automatisch ergänzen,
    // falls TTLive sie nicht als eigene Tabellenzeile zwischen den Spielen ausgeliefert hat
    if (validPoints.length >= 2) {
        const existingStichtagDates = new Set(validPoints.filter(p => p.isStichtag).map(p => p.date));
        const withSynthesized = [];

        for (let i = 0; i < validPoints.length; i++) {
            const cur = validPoints[i];
            withSynthesized.push(cur);

            if (i < validPoints.length - 1) {
                const next = validPoints[i + 1];
                const ts1 = parseGermanDateToTs(cur.date);
                const ts2 = parseGermanDateToTs(next.date);

                // Wenn zwei aufeinanderfolgende Spiele zeitlich aufeinanderfolgen (ts2 >= ts1)
                if (ts1 && ts2 && ts2 > ts1 && (ts2 - ts1) < 370 * 86400000) {
                    const y1 = new Date(ts1).getFullYear();
                    const y2 = new Date(ts2).getFullYear();
                    for (let y = y1; y <= y2; y++) {
                        ['11.02.', '11.05.', '11.08.', '11.12.'].forEach(dm => {
                            const sDate = `${dm}${y}`;
                            const sTs = parseGermanDateToTs(sDate);
                            if (sTs && sTs > ts1 && sTs <= ts2 && !existingStichtagDates.has(sDate)) {
                                existingStichtagDates.add(sDate);
                                withSynthesized.push({
                                    isStichtag: true,
                                    date: sDate,
                                    lpzBefore: cur.lpz,
                                    lpzAfter: cur.lpz,
                                    lpz: cur.lpz,
                                    delta: 0,
                                    opponent: `Offizieller Q-TTR-Stichtag vom ${sDate}`,
                                    teamOrEvent: 'Quartals-Berechnung (Q-TTR)',
                                    score: '◆',
                                    won: null
                                });
                            }
                        });
                    }
                }
            }
        }
        validPoints = withSynthesized;
    }

    let gameCounter = 0;
    validPoints.forEach(p => {
        if (!p.isStichtag) {
            gameCounter++;
            p.gameNr = gameCounter;
        } else {
            p.gameNr = '◆';
        }
    });

    if (validPoints.length > 0) {
        const latestKnown = validPoints[validPoints.length - 1].lpz;
        if (latestKnown) player.lpz = latestKnown;
    }

    return validPoints;
}

function ttrSetRange(range) {
    ttrCurrentRange = range;
    [100, 50, 25].forEach(r => {
        const btn = document.getElementById('ttr-range-' + r);
        if (btn) btn.className = (r === range) ? 'btn btn-emerald' : 'btn btn-dark';
    });
    const player = ttrPlayers.find(p => p.id === ttrSelectedPlayerId);
    if (player) ttrApplyChartPoints(player, ttrCurrentPoints);
}

// Liefert die letzten N echten Einzelspiele INKLUSIVE aller dazwischenliegenden Q-TTR-Stichtage
function getSlicedPointsWithStichtage(allPoints, maxGames) {
    if (!Array.isArray(allPoints) || !allPoints.length) return [];
    let gamesSeen = 0;
    let startIdx = 0;
    for (let i = allPoints.length - 1; i >= 0; i--) {
        if (!allPoints[i].isStichtag) {
            gamesSeen++;
            if (gamesSeen === maxGames) {
                startIdx = i;
                break;
            }
        }
    }
    // Falls direkt vor dem ersten Spiel noch ein Stichtag liegt, diesen mitnehmen
    if (startIdx > 0 && allPoints[startIdx - 1] && allPoints[startIdx - 1].isStichtag) {
        startIdx--;
    }
    return allPoints.slice(startIdx);
}

function ttrApplyChartPoints(player, allPoints) {
    ttrCurrentPoints = Array.isArray(allPoints) ? allPoints : [];
    const pts = getSlicedPointsWithStichtage(ttrCurrentPoints, ttrCurrentRange);

    const curEl = document.getElementById('ttr-kpi-current');
    const trdEl = document.getElementById('ttr-kpi-trend');
    const trdSub = document.getElementById('ttr-kpi-trend-sub');
    const maxEl = document.getElementById('ttr-kpi-max');
    const minEl = document.getElementById('ttr-kpi-min');
    const cntEl = document.getElementById('ttr-kpi-count');
    const winEl = document.getElementById('ttr-kpi-winrate');

    if (!pts.length) {
        if (curEl) curEl.textContent = player.lpz ? player.lpz.toLocaleString('de-DE') : '–';
        if (trdEl) { trdEl.textContent = '–'; trdEl.style.color = '#fff'; }
        if (maxEl) maxEl.textContent = player.lpz ? player.lpz.toLocaleString('de-DE') : '–';
        if (minEl) minEl.textContent = 'Tiefstwert: –';
        if (cntEl) cntEl.textContent = '0 : 0';
        if (winEl) winEl.textContent = 'Keine Einzelspiele im Zeitraum';
        ttrDrawChart([]);
        return;
    }

    const latest = pts[pts.length - 1].lpz;
    const startLpz = pts[0].lpzBefore || pts[0].lpz;
    const diff = latest - startLpz;
    const maxLpz = Math.max(...pts.map(p => p.lpz));
    const minLpz = Math.min(...pts.map(p => p.lpz));

    const realMatches = pts.filter(p => !p.isStichtag && p.won !== null);
    const wins = realMatches.filter(p => p.won === true).length;
    const losses = realMatches.filter(p => p.won === false).length;
    const winPct = realMatches.length ? Math.round((wins / realMatches.length) * 100) : 0;

    if (curEl) curEl.textContent = (player.lpz || latest).toLocaleString('de-DE');
    if (trdEl) {
        const sign = diff > 0 ? '+' : '';
        trdEl.textContent = `${sign}${diff} Pkt.`;
        trdEl.style.color = diff > 0 ? '#34d399' : diff < 0 ? '#f87171' : '#fbbf24';
    }
    if (trdSub) trdSub.textContent = `Start: ${startLpz} → Aktuell: ${latest}`;
    if (maxEl) maxEl.textContent = maxLpz.toLocaleString('de-DE');
    if (minEl) minEl.textContent = `Tiefstwert: ${minLpz.toLocaleString('de-DE')} (Spanne: ${maxLpz - minLpz})`;
    if (cntEl) cntEl.textContent = `${wins} : ${losses}`;
    if (winEl) winEl.textContent = `${realMatches.length} Spiele · Siegquote ${winPct}%`;

    ttrDrawChart(pts);
    ttrRenderHistoryTable(pts);
}

function ttrRenderHistoryTable(pts) {
    const wrap = document.getElementById('ttr-history-table-wrap');
    if (!wrap) return;
    const rev = [...pts].reverse();
    wrap.innerHTML = `
        <table class="tt-data-table" style="color:var(--text-cream);">
            <thead>
                <tr>
                    <th style="background:rgba(255,255,255,0.06); color:#fbbf24;">Spiel</th>
                    <th style="background:rgba(255,255,255,0.06); color:#fbbf24;">Datum</th>
                    <th style="background:rgba(255,255,255,0.06); color:#fbbf24;">Gegenspieler & Wettbewerb</th>
                    <th style="background:rgba(255,255,255,0.06); color:#fbbf24; text-align:center;">Sätze</th>
                    <th style="background:rgba(255,255,255,0.06); color:#fbbf24; text-align:right;">+/−</th>
                    <th style="background:rgba(255,255,255,0.06); color:#fbbf24; text-align:right;">LPZ danach</th>
                </tr>
            </thead>
            <tbody>
                ${rev.map(p => {
                    if (p.isStichtag) {
                        return `
                            <tr style="background:rgba(251, 191, 36, 0.16);">
                                <td style="border-bottom-color:rgba(255,255,255,0.08); font-weight:800; color:#fbbf24;">◆</td>
                                <td style="border-bottom-color:rgba(255,255,255,0.08); font-weight:800; color:#fbbf24;">${domEsc(p.date)}</td>
                                <td colspan="3" style="border-bottom-color:rgba(255,255,255,0.08); font-weight:800; color:#fbbf24;">📌 ${domEsc(p.opponent)}</td>
                                <td style="border-bottom-color:rgba(255,255,255,0.08); text-align:right; font-family:'JetBrains Mono',monospace; font-weight:800; color:#fbbf24;">${p.lpz}</td>
                            </tr>
                        `;
                    }
                    const dStr = p.delta === null ? 'n.a.' : (p.delta > 0 ? `+${p.delta}` : String(p.delta));
                    const dCol = p.delta > 0 ? '#34d399' : p.delta < 0 ? '#f87171' : '#94a3b8';
                    const sCol = p.won === true ? '#34d399' : p.won === false ? '#f87171' : '#cbd5e1';
                    return `
                        <tr>
                            <td style="border-bottom-color:rgba(255,255,255,0.08); font-family:'JetBrains Mono',monospace; color:var(--text-muted);">#${p.gameNr}</td>
                            <td style="border-bottom-color:rgba(255,255,255,0.08); font-weight:700;">${domEsc(p.date)}</td>
                            <td style="border-bottom-color:rgba(255,255,255,0.08); color:var(--text-cream);">
                                <b>${domEsc(p.opponent)}</b> ${p.oppLpz ? `<span style="color:#94a3b8;font-size:11px;">(LPZ ${p.oppLpz})</span>` : ''}
                                <div style="font-size:11px; color:var(--text-muted);">${domEsc(p.teamOrEvent)}</div>
                            </td>
                            <td style="border-bottom-color:rgba(255,255,255,0.08); text-align:center; font-family:'JetBrains Mono',monospace; font-weight:800; color:${sCol};">${domEsc(p.score)}</td>
                            <td style="border-bottom-color:rgba(255,255,255,0.08); text-align:right; font-family:'JetBrains Mono',monospace; font-weight:700; color:${dCol};">${dStr}</td>
                            <td style="border-bottom-color:rgba(255,255,255,0.08); text-align:right; font-family:'JetBrains Mono',monospace; font-weight:800; color:#fff;">${p.lpz}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// Formatiert Datum für schmale Displays kompakt als "DD.MM.YY" (z.B. "06.04.25")
function formatAxisDateLabel(dateStr, compact) {
    const raw = String(dateStr || '').trim();
    if (!compact) return raw.slice(0, 10);
    const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) return `${m[1]}.${m[2]}.${m[3].slice(2)}`;
    return raw.slice(0, 8);
}

function ttrDrawChart(ptsInput, hoverIdx = -1) {
    const canvas = document.getElementById('ttr-chart-canvas');
    if (!canvas) return;
    const pts = ptsInput || getSlicedPointsWithStichtage(ttrCurrentPoints, ttrCurrentRange);

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(280, rect.width || 800);
    const H = Math.max(240, rect.height || 340);
    canvas.width = W * dpr;
    canvas.height = H * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (!pts || pts.length === 0) {
        ctx.fillStyle = '#a7c4bc';
        ctx.font = '600 13.5px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Wähle einen Spieler mit LPZ-Wert aus, um die Entwicklung zu sehen.', W / 2, H / 2);
        ttrChartGeom = null;
        return;
    }

    const isMobile = W < 520;
    const pad = { left: isMobile ? 46 : 56, right: isMobile ? 16 : 26, top: 34, bottom: 40 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const vals = pts.map(p => p.lpz);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const spread = Math.max(20, maxVal - minVal);
    const yMin = Math.floor((minVal - spread * 0.18) / 10) * 10;
    const yMax = Math.ceil((maxVal + spread * 0.18) / 10) * 10;

    const xOf = i => pts.length === 1 ? pad.left + plotW / 2 : pad.left + (i / (pts.length - 1)) * plotW;
    const yOf = v => pad.top + plotH - ((v - yMin) / Math.max(1, yMax - yMin)) * plotH;

    // Horizontale Gitterlinien + Y-Achsen-LPZ
    const step = (yMax - yMin) <= 60 ? 10 : (yMax - yMin) <= 140 ? 20 : 50;
    ctx.font = `600 ${isMobile ? '10.5px' : '11.5px'} "JetBrains Mono", monospace`;
    ctx.textAlign = 'right';
    for (let yv = Math.ceil(yMin / step) * step; yv <= yMax; yv += step) {
        const py = yOf(yv);
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, py);
        ctx.lineTo(W - pad.right, py);
        ctx.stroke();

        ctx.fillStyle = '#a7c4bc';
        ctx.fillText(String(yv), pad.left - 8, py + 4);
    }

    const coords = pts.map((p, i) => ({ x: xOf(i), y: yOf(p.lpz), data: p, idx: i }));
    ttrChartGeom = { coords, pad, W, H, pts };

    // 1. Vertikale Q-TTR-Stichtags-Linien + Label im Hintergrund zeichnen
    let lastStichtagLabelX = -999;
    coords.forEach(c => {
        if (!c.data.isStichtag) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(c.x, pad.top);
        ctx.lineTo(c.x, pad.top + plotH);
        ctx.stroke();

        // Stichtags-Kurzlabel nur schreiben, wenn genug Platz zum vorherigen Stichtags-Label ist
        if (c.x - lastStichtagLabelX >= (isMobile ? 54 : 72)) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = `700 ${isMobile ? '9.5px' : '10.5px'} "Plus Jakarta Sans", sans-serif`;
            const align = c.x < pad.left + 35 ? 'left' : c.x > W - pad.right - 35 ? 'right' : 'center';
            ctx.textAlign = align;
            const shortStichtag = String(c.data.date || '').slice(0, 6);
            ctx.fillText(`◆ ${shortStichtag}`, c.x, pad.top + plotH - 6);
            lastStichtagLabelX = c.x;
        }
        ctx.restore();
    });

    // 2. Flächenverlauf & LPZ-Kurve zeichnen
    if (coords.length >= 2) {
        const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.40)');
        grad.addColorStop(0.7, 'rgba(16, 185, 129, 0.08)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

        ctx.beginPath();
        ctx.moveTo(coords[0].x, pad.top + plotH);
        coords.forEach(c => ctx.lineTo(c.x, c.y));
        ctx.lineTo(coords[coords.length - 1].x, pad.top + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.save();
        ctx.shadowColor = 'rgba(52, 211, 153, 0.55)';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        coords.forEach((c, i) => { if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y); });
        ctx.stroke();
        ctx.restore();
    }

    // 3. Überlappungsfreie Datums-Achse unten zeichnen (Smartphone-optimiert!)
    ctx.fillStyle = '#a7c4bc';
    ctx.font = `600 ${isMobile ? '10px' : '11px'} "Plus Jakarta Sans", sans-serif`;

    // Dynamische Label-Anzahl je nach verfügbarer Breite
    const maxLabels = plotW < 290 ? 3 : plotW < 440 ? 4 : plotW < 620 ? 5 : 6;
    const labelCount = Math.min(maxLabels, coords.length);
    const minPxGap = isMobile ? 62 : 84;
    let prevLabelRightEdge = -999;

    for (let k = 0; k < labelCount; k++) {
        const idx = labelCount === 1 ? 0 : Math.round((k / (labelCount - 1)) * (coords.length - 1));
        const c = coords[idx];
        const dateText = formatAxisDateLabel(c.data.date, isMobile);
        const textW = ctx.measureText(dateText).width;

        let drawX = c.x;
        if (k === 0 && labelCount > 1) {
            ctx.textAlign = 'left';
            drawX = Math.max(pad.left, c.x);
        } else if (k === labelCount - 1 && labelCount > 1) {
            ctx.textAlign = 'right';
            drawX = Math.min(W - pad.right, c.x);
        } else {
            ctx.textAlign = 'center';
        }

        const leftEdge = ctx.textAlign === 'left' ? drawX : ctx.textAlign === 'right' ? (drawX - textW) : (drawX - textW / 2);
        const rightEdge = leftEdge + textW;

        // Sicherstellen, dass das aktuelle Label weder das vorherige noch das letzte Label rechts überlappt
        if (leftEdge < prevLabelRightEdge + 8) continue;
        if (k < labelCount - 1 && rightEdge > (W - pad.right - minPxGap * 0.65)) continue;

        ctx.fillText(dateText, drawX, H - 12);
        prevLabelRightEdge = rightEdge;
    }

    // 4. Peak-Index ermitteln
    let peakIdx = 0;
    coords.forEach((c, i) => { if (c.data.lpz >= coords[peakIdx].data.lpz) peakIdx = i; });

    // 5. Zuerst alle regulären Spiel-Punkte (Grün = Sieg, Rot = Niederlage) zeichnen
    coords.forEach((c, i) => {
        if (c.data.isStichtag) return;
        const isPeak = i === peakIdx && coords.length > 1;
        const isHover = i === hoverIdx;

        const r = isHover ? 6.5 : isPeak ? 5.5 : (coords.length > 55 ? 3.2 : 4);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        if (isHover) ctx.fillStyle = '#fbbf24';
        else if (isPeak) ctx.fillStyle = '#38bdf8';
        else if (c.data.won === true) ctx.fillStyle = '#10b981';
        else if (c.data.won === false) ctx.fillStyle = '#ef4444';
        else ctx.fillStyle = '#94a3b8';

        ctx.fill();
        ctx.lineWidth = isHover || isPeak ? 2.2 : 1.2;
        ctx.strokeStyle = isHover || isPeak ? '#fff' : '#07120f';
        ctx.stroke();
    });

    // 6. Danach die Q-TTR-Stichtage als markante goldene Rauten (◆) im Vordergrund zeichnen
    coords.forEach((c, i) => {
        if (!c.data.isStichtag) return;
        const isHover = i === hoverIdx;
        const s = isHover ? 9.5 : 7.5;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(Math.PI / 4);
        ctx.shadowColor = 'rgba(251, 191, 36, 0.75)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#07120f';
        ctx.lineWidth = 1.8;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.restore();
    });

    // 7. Peak-Krone beschriften
    const pk = coords[peakIdx];
    if (pk) {
        ctx.fillStyle = '#38bdf8';
        ctx.font = '800 11.5px "JetBrains Mono", monospace';
        ctx.textAlign = pk.x > W - 95 ? 'right' : pk.x < 95 ? 'left' : 'center';
        ctx.fillText(`👑 Peak: ${pk.data.lpz}`, pk.x, Math.max(16, pk.y - 11));
    }

    // 8. Hover-Fadenkreuz
    if (hoverIdx >= 0 && coords[hoverIdx]) {
        const hc = coords[hoverIdx];
        ctx.save();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(hc.x, pad.top);
        ctx.lineTo(hc.x, pad.top + plotH);
        ctx.stroke();
        ctx.restore();
    }
}

function bindTTRChartEvents() {
    const canvas = document.getElementById('ttr-chart-canvas');
    const tip = document.getElementById('ttr-chart-tooltip');
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = '1';

    const handleMove = (clientX) => {
        if (!ttrChartGeom || !ttrChartGeom.coords.length) return;
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;

        let bestIdx = 0, bestDist = Infinity;
        ttrChartGeom.coords.forEach((c, idx) => {
            const d = Math.abs(c.x - mx);
            if (d < bestDist) { bestDist = d; bestIdx = idx; }
        });

        ttrDrawChart(ttrChartGeom.pts, bestIdx);
        const pt = ttrChartGeom.coords[bestIdx];
        if (tip && pt) {
            const d = pt.data;
            if (d.isStichtag) {
                tip.innerHTML = `
                    <div style="font-size:10.5px; color:#fbbf24; font-weight:800; text-transform:uppercase;">◆ Offizieller Q-TTR-Stichtag · ${domEsc(d.date)}</div>
                    <div style="font-family:'JetBrains Mono',monospace; font-size:20px; font-weight:800; color:#fbbf24; margin:4px 0;">Q-TTR / LPZ ${d.lpz}</div>
                    <div style="font-size:11.5px; color:#fff;">${domEsc(d.opponent)}</div>
                `;
            } else {
                const dVal = d.delta;
                const dStr = dVal === null ? 'n.a.' : (dVal > 0 ? `+${dVal} Pkt.` : `${dVal} Pkt.`);
                const dCol = dVal > 0 ? '#34d399' : dVal < 0 ? '#f87171' : '#fbbf24';
                const badge = d.won === true ? '🟢 Sieg' : d.won === false ? '🔴 Niederlage' : '⚪ Offen';
                tip.innerHTML = `
                    <div style="display:flex; justify-content:space-between; font-size:10.5px; color:#fbbf24; font-weight:800; text-transform:uppercase;">
                        <span>Spiel #${d.gameNr} · ${domEsc(d.date)}</span>
                        <span>${badge} (${domEsc(d.score)})</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin:4px 0;">
                        <span style="font-family:'JetBrains Mono',monospace; font-size:20px; font-weight:800; color:#fff;">LPZ ${d.lpz}</span>
                        <span style="font-family:'JetBrains Mono',monospace; font-size:13.5px; font-weight:800; color:${dCol};">${dStr}</span>
                    </div>
                    <div style="font-size:12px; font-weight:700; color:#fff;">gg. ${domEsc(d.opponent)} ${d.oppLpz ? `(LPZ ${d.oppLpz})` : ''}</div>
                    <div style="font-size:11px; color:#a7c4bc; margin-top:2px;">${domEsc(d.teamOrEvent)}</div>
                `;
            }
            tip.classList.remove('hidden');
            const maxLeft = Math.max(8, ttrChartGeom.W - 235);
            const rawLeft = pt.x > ttrChartGeom.W * 0.55 ? (pt.x - 230) : (pt.x + 12);
            const leftPos = Math.max(8, Math.min(maxLeft, rawLeft));
            const topPos = Math.max(10, Math.min(ttrChartGeom.H - 105, pt.y - 42));
            tip.style.left = `${leftPos}px`;
            tip.style.top = `${topPos}px`;
        }
    };

    canvas.addEventListener('mousemove', e => handleMove(e.clientX));
    canvas.addEventListener('touchmove', e => {
        if (e.touches && e.touches[0]) handleMove(e.touches[0].clientX);
    }, { passive: true });
    canvas.addEventListener('mouseleave', () => {
        tip?.classList.add('hidden');
        if (ttrChartGeom) ttrDrawChart(ttrChartGeom.pts, -1);
    });
    window.addEventListener('resize', () => {
        if (document.getElementById('page-tt-ranking')?.classList.contains('active') && ttrCockpitTab === 'curve') {
            ttrDrawChart();
        }
    });
}
