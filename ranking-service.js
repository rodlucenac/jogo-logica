/* ============================================================
   ranking-service.js — ranking geral (local + Firebase opcional)
   ------------------------------------------------------------
   - Placar global: melhores pontuações de qualquer partida.
   - Nível alcançado importa só como informação (não precisa chegar ao 3).
   - Mantém as N melhores runs (padrão 40); exibição usa as top 8.
   ============================================================ */

class LogicInvadersRankingStore {
    constructor(options = {}) {
        this.storageKey = options.storageKey || "logicInvadersRankingV2";
        this.maxEntries = options.maxEntries || 40;
        this.minScore = Number.isFinite(options.minScore) ? options.minScore : 1;
        this.config = options.config || {};
    }

    static pilotKey(name) {
        return String(name || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ")
            .slice(0, 18);
    }

    isRemoteEnabled() {
        return Boolean(this._databaseUrl());
    }

    modeLabel() {
        return this.isRemoteEnabled() ? "global (Firebase)" : "local (navegador)";
    }

    loadLocal() {
        this._migrateLegacyIfNeeded();
        try {
            const raw = localStorage.getItem(this.storageKey);
            return this._normalize(raw ? JSON.parse(raw) : []);
        } catch (err) {
            console.warn("Falha ao carregar ranking local:", err);
            return [];
        }
    }

    _migrateLegacyIfNeeded() {
        const legacyKey = "logicInvadersRankingV1";
        try {
            if (localStorage.getItem(this.storageKey)) return;
            const raw = localStorage.getItem(legacyKey);
            if (!raw) return;
            const legacy = JSON.parse(raw);
            const list = Array.isArray(legacy) ? legacy : Object.values(legacy || {});
            const merged = list
                .map(item => this._cleanEntry({
                    name: item.name,
                    score: item.score,
                    level: item.level,
                    timeSeconds: item.timeSeconds,
                    assistMode: false,
                    logicErrors: 0,
                    livesRemaining: null,
                    dateISO: item.date || item.dateISO
                }))
                .filter(Boolean);
            if (merged.length > 0) {
                this.saveLocal(this._normalize(merged));
            }
        } catch (err) {
            console.warn("Falha ao migrar ranking legado:", err);
        }
    }

    saveLocal(entries) {
        try {
            localStorage.setItem(
                this.storageKey,
                JSON.stringify(this._normalize(entries))
            );
        } catch (err) {
            console.warn("Falha ao salvar ranking local:", err);
        }
    }

    clearLocal() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (err) {
            console.warn("Falha ao limpar ranking local:", err);
        }
        return [];
    }

    exportJson() {
        return JSON.stringify(this.loadLocal(), null, 2);
    }

    importJson(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            return { entries: this.loadLocal(), result: "invalid" };
        }

        const incoming = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
        const cleaned = incoming.map(raw => this._cleanEntry(raw)).filter(Boolean);
        const merged = this._normalize([...this.loadLocal(), ...cleaned]);
        this.saveLocal(merged);
        return { entries: merged, result: "imported" };
    }

    async load() {
        if (!this.isRemoteEnabled()) return this.loadLocal();

        try {
            const response = await fetch(this._remoteUrl(), {
                method: "GET",
                headers: { "Accept": "application/json" },
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const remoteEntries = this._normalize(await response.json());
            this.saveLocal(remoteEntries);
            return remoteEntries;
        } catch (err) {
            console.warn("Falha ao carregar ranking online; usando local:", err);
            return this.loadLocal();
        }
    }

    /**
     * @returns {Promise<{entries: Array, result: string, entry: object|null}>}
     * result: "added" | "not_ranked" | "rejected"
     */
    async add(entry) {
        const cleanEntry = this._cleanEntry(entry);
        if (!cleanEntry) {
            return { entries: this.loadLocal(), result: "rejected", entry: null };
        }

        const localEntries = this._append(this.loadLocal(), cleanEntry);
        this.saveLocal(localEntries);

        if (!this.isRemoteEnabled()) {
            return {
                entries: localEntries,
                result: this._madeLeaderboard(cleanEntry, localEntries) ? "added" : "not_ranked",
                entry: cleanEntry
            };
        }

        try {
            const response = await fetch(this._remoteUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...cleanEntry,
                    createdAt: new Date().toISOString()
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const entries = await this.load();
            return {
                entries,
                result: this._madeLeaderboard(cleanEntry, entries) ? "added" : "not_ranked",
                entry: cleanEntry
            };
        } catch (err) {
            console.warn("Falha ao salvar ranking online; ranking local preservado:", err);
            return {
                entries: localEntries,
                result: this._madeLeaderboard(cleanEntry, localEntries) ? "added" : "not_ranked",
                entry: cleanEntry
            };
        }
    }

    static compareByScore(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        if (b.level !== a.level) return b.level - a.level;
        const timeDiff = LogicInvadersRankingStore._entryTimeSeconds(a)
            - LogicInvadersRankingStore._entryTimeSeconds(b);
        if (timeDiff !== 0) return timeDiff;
        return String(b.dateISO || "").localeCompare(String(a.dateISO || ""));
    }

    static compareByTime(a, b) {
        const timeDiff = LogicInvadersRankingStore._entryTimeSeconds(a)
            - LogicInvadersRankingStore._entryTimeSeconds(b);
        if (timeDiff !== 0) return timeDiff;
        if (b.score !== a.score) return b.score - a.score;
        if (b.level !== a.level) return b.level - a.level;
        return String(b.dateISO || "").localeCompare(String(a.dateISO || ""));
    }

    static filterEntries(entries, options = {}) {
        const showAssist = Boolean(options.showAssist);
        if (showAssist) return entries.slice();
        return entries.filter(entry => !entry.assistMode);
    }

    _append(entries, newEntry) {
        return this._normalize([...entries, newEntry]);
    }

    _madeLeaderboard(entry, board) {
        return board.some(item => item.runId === entry.runId);
    }

    _databaseUrl() {
        return String(this.config.firebaseDatabaseUrl || "").trim().replace(/\/+$/, "");
    }

    _path() {
        return String(this.config.firebasePath || "logic-invaders/ranking-v2")
            .trim()
            .replace(/^\/+|\/+$/g, "");
    }

    _remoteUrl() {
        return `${this._databaseUrl()}/${this._path()}.json`;
    }

    _normalize(value) {
        const rawEntries = Array.isArray(value)
            ? value
            : Object.values(value || {});

        return rawEntries
            .map(entry => this._cleanEntry(entry))
            .filter(Boolean)
            .sort(LogicInvadersRankingStore.compareByScore)
            .slice(0, this.maxEntries);
    }

    static _entryTimeSeconds(entry) {
        const value = Number(entry && entry.timeSeconds);
        return Number.isFinite(value) && value >= 0 ? value : Infinity;
    }

    _newRunId() {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    _cleanEntry(entry) {
        if (!entry || typeof entry !== "object") return null;

        const name = String(entry.name || "PILOTO").trim().slice(0, 18);
        const score = Number(entry.score);
        const level = Number(entry.level);
        const rawTime = Number(entry.timeSeconds);
        const timeSeconds = Number.isFinite(rawTime) && rawTime >= 0
            ? Math.round(rawTime)
            : null;
        const logicErrors = Number(entry.logicErrors);
        const livesRemaining = Number(entry.livesRemaining);

        if (!Number.isFinite(score) || !Number.isFinite(level)) return null;
        if (score < this.minScore) return null;
        if (level < 1) return null;

        const dateISO = String(
            entry.dateISO || entry.date || new Date().toISOString()
        ).slice(0, 24);

        return {
            runId: String(entry.runId || this._newRunId()),
            name: name || "PILOTO",
            pilotKey: LogicInvadersRankingStore.pilotKey(name),
            score,
            level,
            timeSeconds,
            assistMode: Boolean(entry.assistMode),
            logicErrors: Number.isFinite(logicErrors) && logicErrors >= 0
                ? Math.round(logicErrors)
                : 0,
            livesRemaining: Number.isFinite(livesRemaining) && livesRemaining >= 0
                ? Math.round(livesRemaining)
                : null,
            dateISO
        };
    }
}
