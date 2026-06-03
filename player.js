/* ============================================================
   player.js  â€”  Input global + classe Player
   ============================================================ */

const Input = {
    left:  false,
    right: false,
    shoot: false,
    _bound: false,

    // Edge-triggered (consumidos pelo Game)
    pressedEsc:    false,
    pressedEnter:  false,
    pressedUp:     false,
    pressedDown:   false,
    pressedPurge:  false,

    init() {
        if (this._bound) return;
        this._bound = true;

        window.addEventListener("keydown", (e) => {
            if (e.code === "ArrowLeft"  || e.code === "KeyA") this.left  = true;
            if (e.code === "ArrowRight" || e.code === "KeyD") this.right = true;
            if (e.code === "Space") {
                this.shoot = true;
                e.preventDefault();
            }
            // Edge-triggered: marca como "pressionado", Game consome
            if (e.code === "Escape") {
                this.pressedEsc = true;
                e.preventDefault();
            }
            if (e.code === "Enter") {
                this.pressedEnter = true;
                e.preventDefault();
            }
            if (e.code === "ArrowUp"   || e.code === "KeyW") this.pressedUp   = true;
            if (e.code === "ArrowDown" || e.code === "KeyS") this.pressedDown = true;
            if (e.code === "KeyE") this.pressedPurge = true;
        });

        window.addEventListener("keyup", (e) => {
            if (e.code === "ArrowLeft"  || e.code === "KeyA") this.left  = false;
            if (e.code === "ArrowRight" || e.code === "KeyD") this.right = false;
            if (e.code === "Space") this.shoot = false;
        });

        window.addEventListener("blur", () => this.resetAll());
    },

    clearEdgeFlags() {
        this.pressedEsc = false;
        this.pressedEnter = false;
        this.pressedUp = false;
        this.pressedDown = false;
        this.pressedPurge = false;
    },

    resetAll() {
        this.left = false;
        this.right = false;
        this.shoot = false;
        this.clearEdgeFlags();
    },

    /** Consome flag edge-triggered. Retorna true uma Ãºnica vez por keydown. */
    consumeEsc()   { const v = this.pressedEsc;   this.pressedEsc   = false; return v; },
    consumeEnter() { const v = this.pressedEnter; this.pressedEnter = false; return v; },
    consumeUp()    { const v = this.pressedUp;    this.pressedUp    = false; return v; },
    consumeDown()  { const v = this.pressedDown;  this.pressedDown  = false; return v; },
    consumePurge() { const v = this.pressedPurge; this.pressedPurge = false; return v; }
};


class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 48;
        this.height = 36;
        this.speed = 380;            // px/s
        this.shootCooldown = 0;
        this.baseShootDelay = 0.26;  // NOVO: base preservada para upgrades permanentes
        this.shootDelay = this.baseShootDelay;      // segundos entre tiros
        this.invulnTime = 0;

        // ----- Power-ups temporários -----
        this.shieldTime     = 0;     // segundos restantes
        this.doubleShotTime = 0;     // segundos restantes
        // NOVO: guarda lógica temporária/permanente absorve erro proposicional.
        this.logicGuardTime    = 0;
        this.logicGuardCharges = 0;

        // NOVO: upgrades permanentes persistem entre fases na mesma campanha.
        this.permanentUpgrades = {
            bootFirewall: false,
            parallelCompiler: false,
            inferenceCache: false
        };

        // Histórico visual dos upgrades coletados durante a campanha atual.
        this.collectedUpgradeKinds = [];
    }

    /**
     * @param {number} dt
     * @param {HTMLCanvasElement} canvas
     * @param {Array<Bullet>} bullets
     */
    update(dt, canvas, bullets) {
        // Movimento horizontal
        if (Input.left)  this.x -= this.speed * dt;
        if (Input.right) this.x += this.speed * dt;

        // Limites da tela
        const half = this.width / 2;
        if (this.x < half)                 this.x = half;
        if (this.x > canvas.width - half)  this.x = canvas.width - half;

        // Cooldown de tiro
        this.shootCooldown -= dt;
        if (Input.shoot && this.shootCooldown <= 0) {
            const bulletY = this.y - this.height / 2 - 4;

            if (this.doubleShotTime > 0) {
                // Tiro duplo: dois projÃ©teis paralelos
                bullets.push(new Bullet(this.x - 12, bulletY, -620, "player"));
                bullets.push(new Bullet(this.x + 12, bulletY, -620, "player"));
            } else {
                bullets.push(new Bullet(this.x, bulletY, -620, "player"));
            }
            this.shootCooldown = this.shootDelay;
        }

        // Decay de timers
        this.invulnTime     = Math.max(0, this.invulnTime - dt);
        this.shieldTime     = Math.max(0, this.shieldTime - dt);
        this.doubleShotTime = Math.max(0, this.doubleShotTime - dt);
        // NOVO: timer da guarda lógica temporária.
        this.logicGuardTime = Math.max(0, this.logicGuardTime - dt);
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Pisca durante invulnerabilidade
        if (this.invulnTime > 0 && Math.floor(this.invulnTime * 18) % 2 === 0) {
            ctx.globalAlpha = 0.25;
        }

        // PropulsÃ£o (rastro azul/verde animado)
        ctx.shadowColor = "#00FFCC";
        ctx.shadowBlur  = 18;
        ctx.fillStyle   = "rgba(0, 255, 204, 0.6)";
        ctx.beginPath();
        ctx.moveTo(-7, 16);
        ctx.lineTo(0, 24 + Math.sin(performance.now() / 60) * 3);
        ctx.lineTo(7, 16);
        ctx.closePath();
        ctx.fill();

        // Corpo da nave
        ctx.shadowColor = "#00D9FF";
        ctx.shadowBlur  = 16;
        ctx.strokeStyle = "#00D9FF";
        ctx.fillStyle   = "#0a1f3a";
        ctx.lineWidth   = 2;

        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(-24, 12);
        ctx.lineTo(-11, 8);
        ctx.lineTo(-11, 16);
        ctx.lineTo(11, 16);
        ctx.lineTo(11, 8);
        ctx.lineTo(24, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cockpit
        ctx.shadowBlur = 8;
        ctx.fillStyle  = "#00FFCC";
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(-6, 3);
        ctx.lineTo(6, 3);
        ctx.closePath();
        ctx.fill();

        // ----- Indicador de tiro duplo (canhÃµes laterais brilhando) -----
        if (this.doubleShotTime > 0) {
            const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 100);
            ctx.shadowColor = "#00FFCC";
            ctx.shadowBlur  = 10;
            ctx.fillStyle   = `rgba(0, 255, 204, ${pulse})`;
            ctx.fillRect(-13, -2, 4, 8);
            ctx.fillRect(  9, -2, 4, 8);
        }

        // ----- Escudo (esfera azul ao redor) -----
        if (this.shieldTime > 0) {
            // Pisca quando estÃ¡ acabando (< 1.5s)
            const fading = this.shieldTime < 1.5;
            const blink  = fading && Math.floor(this.shieldTime * 8) % 2 === 0;
            if (!blink) {
                ctx.shadowColor = "#00D9FF";
                ctx.shadowBlur  = 18;
                ctx.strokeStyle = "rgba(0, 217, 255, 0.85)";
                ctx.lineWidth   = 2;
                ctx.beginPath();
                ctx.arc(0, 0, 30, 0, Math.PI * 2);
                ctx.stroke();
                // Anel interno mais sutil
                ctx.strokeStyle = "rgba(0, 217, 255, 0.35)";
                ctx.lineWidth   = 1;
                ctx.beginPath();
                ctx.arc(0, 0, 26, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // NOVO: anel amarelo da Guarda Lógica temporária/permanente.
        if (this.logicGuardTime > 0 || this.logicGuardCharges > 0) {
            const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 95);
            ctx.shadowColor = "#ffe14a";
            ctx.shadowBlur  = 14 + pulse * 10;
            ctx.strokeStyle = `rgba(255, 225, 74, ${0.45 + pulse * 0.35})`;
            ctx.lineWidth   = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.arc(0, 0, 36, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    /**
     * Tenta aplicar dano. Retorna true se o dano foi efetivo.
     * Escudo absorve UM hit (e expira).
     * @returns {boolean}
     */
    hit() {
        if (this.invulnTime > 0) return false;

        if (this.shieldTime > 0) {
            // Escudo absorve o dano e quebra
            this.shieldTime = 0;
            this.invulnTime = 0.6;
            return false;
        }

        this.invulnTime = 1.2;
        return true;
    }

    /**
     * Aplica um power-up temporário.
     * @param {"shield"|"doubleshot"|"logicguard"|"bootFirewall"|"parallelCompiler"|"inferenceCache"} kind
     */
    applyPowerup(kind) {
        this.recordUpgrade(kind);

        if (kind === "shield" || kind === "bootFirewall") {
            this.shieldTime = Math.max(this.shieldTime, 8);
        }
        if (kind === "doubleshot" || kind === "parallelCompiler") {
            this.doubleShotTime = Math.max(this.doubleShotTime, 12);
        }
        // NOVO: efeito temporário da fase 3 — absorve um erro lógico por tempo limitado.
        if (kind === "logicguard" || kind === "inferenceCache") {
            this.logicGuardTime = Math.max(this.logicGuardTime, 14);
        }
    }

    // NOVO: aplica upgrade permanente sem apagar os efeitos temporários atuais.
    applyPermanentUpgrade(kind) {
        this.recordUpgrade(kind);

        if (kind === "bootFirewall") {
            this.permanentUpgrades.bootFirewall = true;
            this.shieldTime = Math.max(this.shieldTime, 5);
        }
        if (kind === "parallelCompiler") {
            this.permanentUpgrades.parallelCompiler = true;
            this.shootDelay = 0.22;
        }
        if (kind === "inferenceCache") {
            this.permanentUpgrades.inferenceCache = true;
            this.logicGuardCharges = Math.max(this.logicGuardCharges, 1);
        }
    }

    // NOVO: reativa bônus persistentes no começo de cada fase.
    applyPermanentLevelStartBonuses() {
        if (this.permanentUpgrades.bootFirewall) {
            this.shieldTime = Math.max(this.shieldTime, 5);
        }
        if (this.permanentUpgrades.inferenceCache) {
            this.logicGuardCharges = Math.max(this.logicGuardCharges, 1);
        }
    }

    // NOVO: tenta absorver erro proposicional antes de perder vida.
    absorbLogicError() {
        if (this.logicGuardCharges > 0) {
            this.logicGuardCharges--;
            return true;
        }
        if (this.logicGuardTime > 0) {
            this.logicGuardTime = 0;
            return true;
        }
        return false;
    }

    recordUpgrade(kind) {
        if (!kind) return;
        if (!this.collectedUpgradeKinds.includes(kind)) {
            this.collectedUpgradeKinds.push(kind);
        }
    }

    getCollectedUpgradeLabels() {
        const meta = {
            shield:           { label: "ESCUDO",     title: "Escudo temporário",              color: "#00D9FF" },
            doubleshot:       { label: "DUPLO",      title: "Tiro duplo temporário",          color: "#00FFCC" },
            heart:            { label: "VIDA",       title: "Coração coletado",               color: "#FF5F8F" },
            logicguard:       { label: "GUARDA",     title: "Guarda lógica temporária",       color: "#ffe14a" },
            bootFirewall:     { label: "FIREWALL",   title: "Firewall de Boot",               color: "#00D9FF" },
            parallelCompiler: { label: "COMPILADOR", title: "Compilador Paralelo",            color: "#00FFCC" },
            inferenceCache:   { label: "CACHE",      title: "Cache de Inferência",            color: "#ffe14a" }
        };

        return this.collectedUpgradeKinds.map(kind => meta[kind] || {
            label: String(kind).toUpperCase(),
            title: String(kind),
            color: "#e6edf7"
        });
    }

    // NOVO: lista compacta para HUD de passivas permanentes.
    getPermanentUpgradeLabels() {
        const labels = [];
        if (this.permanentUpgrades.bootFirewall)     labels.push({ label: "FIREWALL", color: "#00D9FF" });
        if (this.permanentUpgrades.parallelCompiler) labels.push({ label: "OVERCLOCK", color: "#00FFCC" });
        if (this.permanentUpgrades.inferenceCache)   labels.push({ label: "CACHE", color: "#ffe14a" });
        return labels;
    }

    /** Reseta todos os modificadores temporários (usado em reset / prÃ³ximo nÃ­vel). */
    clearPowerups() {
        this.shieldTime     = 0;
        this.doubleShotTime = 0;
        this.logicGuardTime = 0;
        this.invulnTime     = 0;
    }

    getBounds() {
        return {
            x: this.x - this.width / 2,
            y: this.y - this.height / 2,
            w: this.width,
            h: this.height
        };
    }
}
