/* ============================================================
   ranking-service.js - ranking local + ranking online opcional
   ------------------------------------------------------------
   - Sempre mantem um backup local no navegador.
   - Se ranking-config.js tiver um Firebase Realtime Database,
     sincroniza tambem com o ranking global.
   ============================================================ */

class LogicInvadersRankingStore {
    constructor(options = {}) {
        this.storageKey = options.storageKey || "logicInvadersRankingV1";
        this.maxEntries = options.maxEntries || 8;
        this.minCompletedLevel = options.minCompletedLevel || 3;
        this.config = options.config || {};
    }

    isRemoteEnabled() {
        return Boolean(this._databaseUrl());
    }

    loadLocal() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            return this._normalize(raw ? JSON.parse(raw) : []);
        } catch (err) {
            console.warn("Falha ao carregar ranking local:", err);
            return [];
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

    async add(entry) {
        const cleanEntry = this._cleanEntry(entry);
        if (!cleanEntry) return this.loadLocal();

        const localEntries = this._normalize([...this.loadLocal(), cleanEntry]);
        this.saveLocal(localEntries);

        if (!this.isRemoteEnabled()) return localEntries;

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

            return await this.load();
        } catch (err) {
            console.warn("Falha ao salvar ranking online; ranking local preservado:", err);
            return localEntries;
        }
    }

    _databaseUrl() {
        return String(this.config.firebaseDatabaseUrl || "").trim().replace(/\/+$/, "");
    }

    _path() {
        return String(this.config.firebasePath || "logic-invaders/ranking")
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
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const timeDiff = this._entryTimeSeconds(a) - this._entryTimeSeconds(b);
                if (timeDiff !== 0) return timeDiff;
                return String(a.date || "").localeCompare(String(b.date || ""));
            })
            .slice(0, this.maxEntries);
    }

    _entryTimeSeconds(entry) {
        const value = Number(entry && entry.timeSeconds);
        return Number.isFinite(value) && value >= 0 ? value : Infinity;
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
        const date = String(entry.date || new Date().toISOString().slice(0, 10)).slice(0, 10);

        if (!Number.isFinite(score) || !Number.isFinite(level)) return null;
        if (level < this.minCompletedLevel) return null;

        return {
            name: name || "PILOTO",
            score,
            level,
            timeSeconds,
            date
        };
    }
}
