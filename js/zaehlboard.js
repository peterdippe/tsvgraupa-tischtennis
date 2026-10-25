// -----------------------------------------------------------------
// 13. DIGITALES ZÄHLBOARD (JANOVA-STYLE MIT HISTORIE, AUFSCHLAG-BALL & TIMERN)
// -----------------------------------------------------------------
let sb = {
    ptsL: 0, ptsR: 0,
    setsL: 0, setsR: 0,
    winSets: 3,
    initialServer: 'left', // wer im 1. Satz begonnen hat ('left' oder 'right')
    expedite: false,       // Zeitspiel (1x Aufschlagwechsel)
    setHistory: [],        // Array aus { l, r, winner }
    timeoutUsed: { left: false, right: false },
    cards: { left: 0, right: 0 }, // 0=keine, 1=Gelb, 2=Gelb-Rot
    sideSwappedInDecider: false,
    matchFinished: false,
    undoStack: [],
    clockRunning: false,
    clockSeconds: 0,
    clockInterval: null,
    countdownSeconds: 0,
    countdownLabel: '',
    countdownInterval: null
};

function sbSaveSnapshot() {
    sb.undoStack.push(JSON.stringify({
        ptsL: sb.ptsL, ptsR: sb.ptsR, setsL: sb.setsL, setsR: sb.setsR,
        initialServer: sb.initialServer, expedite: sb.expedite,
        setHistory: sb.setHistory, timeoutUsed: sb.timeoutUsed,
        cards: sb.cards, sideSwappedInDecider: sb.sideSwappedInDecider,
        matchFinished: sb.matchFinished
    }));
    if (sb.undoStack.length > 40) sb.undoStack.shift();
    const uBtn = document.getElementById('sb-undo-btn');
    if (uBtn) uBtn.disabled = false;
}

function sbUndo() {
    if (!sb.undoStack.length) return;
    const prev = JSON.parse(sb.undoStack.pop());
    Object.assign(sb, prev);
    const uBtn = document.getElementById('sb-undo-btn');
    if (uBtn) uBtn.disabled = sb.undoStack.length === 0;
    sbRender();
}

function sbCurrentServer() {
    // In jedem neuen Satz wechselt der erste Aufschläger gegenüber dem vorherigen Satz
    const setNumber = sb.setsL + sb.setsR; // 0-basiert
    const setStarter = (setNumber % 2 === 0)
        ? sb.initialServer
        : (sb.initialServer === 'left' ? 'right' : 'left');

    const totalPts = sb.ptsL + sb.ptsR;
    const isDeuce = (sb.ptsL >= 10 && sb.ptsR >= 10) || sb.expedite;

    let flips = 0;
    if (sb.expedite) {
        flips = totalPts;
    } else if (sb.ptsL >= 10 && sb.ptsR >= 10) {
        flips = 10 + (totalPts - 20);
    } else {
        flips = Math.floor(totalPts / 2);
    }
    const starterIsCurrent = (flips % 2 === 0);
    const server = starterIsCurrent ? setStarter : (setStarter === 'left' ? 'right' : 'left');
    const servesLeftInTurn = isDeuce ? 1 : (2 - (totalPts % 2));
    return { server, servesLeftInTurn, isDeuce };
}

function sbAddPoint(side, delta) {
    if (sb.matchFinished && delta > 0) return;
    sbSaveSnapshot();

    if (!sb.clockRunning && delta > 0 && sb.ptsL === 0 && sb.ptsR === 0 && sb.setsL === 0 && sb.setsR === 0) {
        sbToggleMatchClock(true);
    }

    if (side === 'left') sb.ptsL = Math.max(0, sb.ptsL + delta);
    else sb.ptsR = Math.max(0, sb.ptsR + delta);

    if (document.getElementById('sb-sound')?.checked && typeof tetrisBeep === 'function') {
        tetrisBeep(side === 'left' ? 520 : 440, 0.045);
    }

    const a = sb.ptsL, b = sb.ptsR;
    const nameL = document.getElementById('sb-name-left')?.value || 'Links';
    const nameR = document.getElementById('sb-name-right')?.value || 'Rechts';

    // Prüfen auf Seitenwechsel bei 5 Punkten im Entscheidungssatz
    const isDecider = (sb.setsL === sb.winSets - 1 && sb.setsR === sb.winSets - 1);
    if (isDecider && !sb.sideSwappedInDecider && (a === 5 || b === 5) && a + b >= 5 && delta > 0) {
        sb.sideSwappedInDecider = true;
        setTimeout(() => {
            if (confirm('🔄 5 Punkte im Entscheidungssatz erreicht! Jetzt Tischseiten & ersten Aufschläger automatisch wechseln?')) {
                sbSwapSides(true);
            }
        }, 80);
    }

    // Satzgewinn prüfen (mind. 11 Punkte & 2 Punkte Vorsprung)
    if ((a >= 11 || b >= 11) && Math.abs(a - b) >= 2 && delta > 0) {
        const winnerSide = a > b ? 'left' : 'right';
        const winnerName = a > b ? nameL : nameR;
        sb.setHistory.push({ l: a, r: b, winner: winnerSide });
        if (winnerSide === 'left') sb.setsL++; else sb.setsR++;
        sb.ptsL = 0; sb.ptsR = 0;
        sb.expedite = false;

        if (document.getElementById('sb-sound')?.checked && typeof tetrisBeep === 'function') {
            tetrisBeep(660, 0.14);
        }

        if (sb.setsL >= sb.winSets || sb.setsR >= sb.winSets) {
            sb.matchFinished = true;
            document.getElementById('sb-status-banner').textContent = `🏆 Matchgewinn: ${winnerName}!`;
        } else {
            document.getElementById('sb-status-banner').textContent = `✓ Satz ${sb.setHistory.length} an ${winnerName} (${a}:${b})`;
            sbStartCountdown(60, 'Satzpause (1 Min.)');
        }
    } else {
        const setNo = sb.setsL + sb.setsR + 1;
        document.getElementById('sb-status-banner').textContent = `${setNo}. Satz läuft`;
    }

    sbRender();
}

function sbRender() {
    document.getElementById('sb-pts-left').textContent = sb.ptsL;
    document.getElementById('sb-pts-right').textContent = sb.ptsR;
    document.getElementById('sb-sets-left').textContent = sb.setsL;
    document.getElementById('sb-sets-right').textContent = sb.setsR;

    const { server, servesLeftInTurn } = sbCurrentServer();
    const cardL = document.getElementById('sb-card-left');
    const cardR = document.getElementById('sb-card-right');
    cardL.classList.toggle('serving', server === 'left' && !sb.matchFinished);
    cardR.classList.toggle('serving', server === 'right' && !sb.matchFinished);

    // Satzball / Matchball Highlight
    const gpL = !sb.matchFinished && sb.ptsL >= 10 && sb.ptsL - sb.ptsR >= 1;
    const gpR = !sb.matchFinished && sb.ptsR >= 10 && sb.ptsR - sb.ptsL >= 1;
    cardL.classList.toggle('game-point', gpL);
    cardR.classList.toggle('game-point', gpR);

    document.getElementById('sb-serve-text-left').textContent =
        server === 'left' ? `🏓 Aufschlag (${servesLeftInTurn}×)${gpL ? ' · SATZBALL' : ''}` : (gpL ? '🔥 SATZBALL' : 'Rückschlag');
    document.getElementById('sb-serve-text-right').textContent =
        server === 'right' ? `🏓 Aufschlag (${servesLeftInTurn}×)${gpR ? ' · SATZBALL' : ''}` : (gpR ? '🔥 SATZBALL' : 'Rückschlag');

    // Satz-Historie rendern
    const histEl = document.getElementById('sb-set-history');
    if (!sb.setHistory.length) {
        histEl.innerHTML = `<span style="font-size:11.5px; color:rgba(255,255,255,0.35);">Noch kein Satz beendet</span>`;
    } else {
        histEl.innerHTML = sb.setHistory.map((s, idx) =>
            `<span class="sb-set-chip ${s.winner === 'left' ? 'win-a' : 'win-b'}" title="${idx + 1}. Satz">${s.l}:${s.r}</span>`
        ).join('');
    }

    // Time-Out & Karten-Badges
    ['left', 'right'].forEach(side => {
        const toBtn = document.getElementById('sb-to-' + side);
        if (toBtn) {
            toBtn.classList.toggle('active-to', sb.timeoutUsed[side]);
            toBtn.textContent = sb.timeoutUsed[side] ? '⏱️ TO ✓' : '⏱️ Time-Out';
        }
        const ylBtn = document.getElementById('sb-yl-' + side);
        if (ylBtn) {
            const c = sb.cards[side];
            ylBtn.classList.toggle('active-yl', c > 0);
            ylBtn.textContent = c === 0 ? '🟨 Karte' : (c === 1 ? '🟨 Gelb' : '🟨🟥 Gelb-Rot');
        }
    });

    const exBtn = document.getElementById('sb-expedite-btn');
    if (exBtn) exBtn.classList.toggle('active-ex', sb.expedite);
}

function sbToggleInitialServer() {
    sbSaveSnapshot();
    sb.initialServer = sb.initialServer === 'left' ? 'right' : 'left';
    sbRender();
}

function sbSwapSides(skipSnapshot) {
    if (!skipSnapshot) sbSaveSnapshot();
    const nL = document.getElementById('sb-name-left'), nR = document.getElementById('sb-name-right');
    const cL = document.getElementById('sb-club-left'), cR = document.getElementById('sb-club-right');
    [nL.value, nR.value] = [nR.value, nL.value];
    [cL.value, cR.value] = [cR.value, cL.value];
    [sb.ptsL, sb.ptsR] = [sb.ptsR, sb.ptsL];
    [sb.setsL, sb.setsR] = [sb.setsR, sb.setsL];
    [sb.timeoutUsed.left, sb.timeoutUsed.right] = [sb.timeoutUsed.right, sb.timeoutUsed.left];
    [sb.cards.left, sb.cards.right] = [sb.cards.right, sb.cards.left];
    sb.setHistory = sb.setHistory.map(s => ({ l: s.r, r: s.l, winner: s.winner === 'left' ? 'right' : 'left' }));
    sb.initialServer = sb.initialServer === 'left' ? 'right' : 'left';
    sbRender();
}

function sbChangeMode() {
    sb.winSets = Number(document.getElementById('sb-bestof')?.value || 3);
    sbRender();
}

function sbTriggerTimeout(side) {
    sbSaveSnapshot();
    sb.timeoutUsed[side] = !sb.timeoutUsed[side];
    if (sb.timeoutUsed[side]) sbStartCountdown(60, `Time-Out (${side === 'left' ? 'Links' : 'Rechts'})`);
    sbRender();
}

function sbToggleCard(side) {
    sbSaveSnapshot();
    sb.cards[side] = (sb.cards[side] + 1) % 3;
    sbRender();
}

function sbToggleExpedite() {
    sbSaveSnapshot();
    sb.expedite = !sb.expedite;
    sbRender();
}

function sbToggleMatchClock(forceStart) {
    if (forceStart) sb.clockRunning = true;
    else sb.clockRunning = !sb.clockRunning;
    clearInterval(sb.clockInterval);
    const btn = document.getElementById('sb-clock-btn');
    if (btn) btn.textContent = sb.clockRunning ? '⏸ Uhr' : '▶ Uhr';
    if (sb.clockRunning) {
        sb.clockInterval = setInterval(() => {
            sb.clockSeconds++;
            const m = String(Math.floor(sb.clockSeconds / 60)).padStart(2, '0');
            const s = String(sb.clockSeconds % 60).padStart(2, '0');
            const el = document.getElementById('sb-timer-display');
            if (el) el.textContent = `${m}:${s}`;
        }, 1000);
    }
}

function sbStartCountdown(seconds, label) {
    clearInterval(sb.countdownInterval);
    sb.countdownSeconds = seconds;
    sb.countdownLabel = label;
    const sub = document.getElementById('sb-subtimer-display');
    const tick = () => {
        if (!sub) return;
        if (sb.countdownSeconds <= 0) {
            clearInterval(sb.countdownInterval);
            sub.textContent = `🔔 ${label} abgelaufen!`;
            if (document.getElementById('sb-sound')?.checked && typeof tetrisBeep === 'function') tetrisBeep(880, 0.25);
            return;
        }
        const m = Math.floor(sb.countdownSeconds / 60);
        const s = String(sb.countdownSeconds % 60).padStart(2, '0');
        sub.textContent = `⏳ ${label}: ${m}:${s}`;
        sb.countdownSeconds--;
    };
    tick();
    sb.countdownInterval = setInterval(tick, 1000);
}

function sbToggleFullscreen() {
    const el = document.getElementById('sb-arena');
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
}

function sbSyncNames() {}

function sbResetMatch() {
    if ((sb.ptsL > 0 || sb.ptsR > 0 || sb.setsL > 0 || sb.setsR > 0) && !confirm('Aktuelles Match wirklich zurücksetzen?')) return;
    clearInterval(sb.clockInterval);
    clearInterval(sb.countdownInterval);
    sb = {
        ptsL: 0, ptsR: 0, setsL: 0, setsR: 0,
        winSets: Number(document.getElementById('sb-bestof')?.value || 3),
        initialServer: 'left', expedite: false, setHistory: [],
        timeoutUsed: { left: false, right: false }, cards: { left: 0, right: 0 },
        sideSwappedInDecider: false, matchFinished: false, undoStack: [],
        clockRunning: false, clockSeconds: 0, clockInterval: null,
        countdownSeconds: 0, countdownLabel: '', countdownInterval: null
    };
    document.getElementById('sb-timer-display').textContent = '00:00';
    document.getElementById('sb-subtimer-display').textContent = '';
    document.getElementById('sb-clock-btn').textContent = '▶ Uhr';
    document.getElementById('sb-status-banner').textContent = '1. Satz bereit';
    document.getElementById('sb-undo-btn').disabled = true;
    sbRender();
}

document.addEventListener('keydown', (e) => {
    if (!document.getElementById('page-zaehlboard')?.classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'a' || e.key === 'A') sbAddPoint('left', 1);
    if (e.key === 'l' || e.key === 'L') sbAddPoint('right', 1);
    if (e.key === 's' || e.key === 'S') sbToggleInitialServer();
    if (e.key === 'z' || e.key === 'Z') sbUndo();
});


