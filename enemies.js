/* ============================================================
   enemies.js — Inimigos individuais + Spawner contínuo
   ------------------------------------------------------------
   Cada inimigo se move individualmente (descida + oscilação
   senoidal). O spawner mantém população alvo na tela e evita
   sobreposição horizontal entre inimigos recém-spawnados.
   ============================================================ */


class Enemy {

    /**
     * @param {number} x   posição central horizontal de spawn
     * @param {number} level
     */
    constructor(x, level) {
        this.x = x;
        this.baseX = x;
        this.y = -30;
        this.width = 56;
        this.height = 44;

        this.alive = true;
        this.flashTime = 0;
        this.deathTime = 0;
        this.spawnAnim = 0.6;

        // Velocidade vertical com leve variação para imprevisibilidade
        const speedBase = 22 + (level - 1) * 4;
        this.vy = speedBase + Math.random() * 10;

        // Oscilação horizontal
        this.oscPhase = Math.random() * Math.PI * 2;
        this.oscSpeed = 0.6 + Math.random() * 0.5;
        this.oscAmp   = 14 + Math.random() * 12;

        // Tiro inimigo
        this.shootDelay = Math.max(2.0, 5.5 - level * 0.3);
        this.shootTimer = this.shootDelay + Math.random() * 2;

        // Lógica
        this.values = Logic.randomEnemyValues();

        // Estado de "sem escudo lógico" (fallback do nível 3+)
        this.isUnshielded = false;
        this.unshieldedPhase = Math.random() * Math.PI * 2;
        this.criticalCrossHandled = false;
    }

    update(dt) {
        this.flashTime = Math.max(0, this.flashTime - dt);
        this.spawnAnim = Math.max(0, this.spawnAnim - dt);
        this.unshieldedPhase += dt * 5.2;

        if (this.alive) {
            this.y += this.vy * dt;
            this.oscPhase += dt * this.oscSpeed;
            this.x = this.baseX + Math.sin(this.oscPhase) * this.oscAmp;
        } else if (this.deathTime > 0) {
            this.deathTime -= dt;
        }
    }

    /* -------- Render principal -------- */
    draw(ctx, usedVars, options = {}) {
        if (!this.alive) {
            if (this.deathTime > 0) this._drawExplosion(ctx);
            return;
        }

        ctx.save();
        ctx.translate(this.x, this.y);

        if (options.assistSignal) {
            this._drawAssistSignal(ctx, options.assistSignal);
        }

        // Animação de spawn (crescimento + fade-in)
        if (this.spawnAnim > 0) {
            const t = 1 - this.spawnAnim / 0.6;
            ctx.globalAlpha = t;
            ctx.scale(0.7 + t * 0.3, 0.7 + t * 0.3);
        }

        if (this.isUnshielded) {
            this._drawBrokenShield(ctx);
        }

        // Cor base do casco (flash branco quando levou hit)
        const baseColor = this.flashTime > 0
            ? "#ffffff"
            : (this.isUnshielded ? "#ffb347" : "#FF2E88");

        ctx.shadowColor = baseColor;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = baseColor;
        ctx.fillStyle = "#1a0a1f";
        ctx.lineWidth = 2;

        // Asa esquerda
        ctx.beginPath();
        ctx.moveTo(-this.width / 2,      4);
        ctx.lineTo(-this.width / 2 + 6, -4);
        ctx.lineTo(-14,                 -10);
        ctx.lineTo(-10,                  10);
        ctx.lineTo(-this.width / 2 + 4,  10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Asa direita
        ctx.beginPath();
        ctx.moveTo(this.width / 2,      4);
        ctx.lineTo(this.width / 2 - 6, -4);
        ctx.lineTo(14,                 -10);
        ctx.lineTo(10,                  10);
        ctx.lineTo(this.width / 2 - 4,  10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Corpo central
        ctx.beginPath();
        ctx.moveTo(0,   -this.height / 2 + 2);
        ctx.lineTo(14,  -8);
        ctx.lineTo(14,   8);
        ctx.lineTo(0,    this.height / 2);
        ctx.lineTo(-14,  8);
        ctx.lineTo(-14, -8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // "Olho" central
        ctx.shadowBlur = 8;
        ctx.fillStyle = this.isUnshielded ? "#ffe14a" : baseColor;
        ctx.beginPath();
        ctx.ellipse(0, -6, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Reflexo do olho
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, -7, 1.5, 0, Math.PI * 2);
        ctx.fill();

        this._drawValues(ctx, usedVars);
        ctx.restore();
    }

    /* -------- Auxiliares de render -------- */
    _drawBrokenShield(ctx) {
        const pulse = 0.5 + 0.5 * Math.sin(this.unshieldedPhase);
        const warnColor = pulse > 0.5 ? "#ffe14a" : "#ff6f61";

        ctx.save();
        ctx.shadowColor = warnColor;
        ctx.shadowBlur = 16 + pulse * 10;
        ctx.strokeStyle = warnColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.ellipse(0, 0, this.width / 2 + 10, this.height / 2 + 8, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // "Faísca" do escudo quebrado
        ctx.beginPath();
        ctx.moveTo(-18, -18);
        ctx.lineTo(-4, -2);
        ctx.moveTo(4, -2);
        ctx.lineTo(18, 14);
        ctx.stroke();

        ctx.font = 'bold 9px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = warnColor;
        ctx.fillText("SHLD ERR", 0, -this.height / 2 - 10);
        ctx.restore();
    }

    _drawAssistSignal(ctx, kind) {
        const isPurge = kind === "purge";
        const color = isPurge ? "#ffb347" : "#00FFCC";
        const label = isPurge ? "E" : "ALVO";
        const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 115);

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 + pulse * 12;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.ellipse(0, 0, this.width / 2 + 18, this.height / 2 + 18, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = color;
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 0, -this.height / 2 - 24);
        ctx.restore();
    }

    _drawValues(ctx, usedVars) {
        const used = (usedVars && usedVars.length > 0) ? usedVars : ["A", "B", "C"];
        const compact = Logic.formatVarsCompact(this.values, used);

        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        // Pré-cálculo de larguras para layout horizontal centralizado
        const segments = compact.map(v => {
            const prefix = `[${v.name}:`;
            const state  = v.label;
            const suffix = "]";
            const w = Math.ceil(
                ctx.measureText(prefix).width +
                ctx.measureText(state).width +
                ctx.measureText(suffix).width
            ) + 12;
            return {
                prefix, state, suffix,
                stateColor: v.val ? "#00FFCC" : "#FF6FA8",
                width: w
            };
        });

        const gap = 6;
        const totalW = segments.reduce((s, seg) => s + seg.width, 0)
                     + gap * Math.max(0, segments.length - 1);
        let cursorX = -totalW / 2;
        const py = this.height / 2 + 14;

        for (const seg of segments) {
            // Caixa de fundo
            ctx.fillStyle = this.isUnshielded
                ? "rgba(32, 8, 8, 0.95)"
                : "rgba(4, 10, 24, 0.96)";
            ctx.shadowBlur = 0;
            ctx.fillRect(cursorX, py - 10, seg.width, 20);

            ctx.strokeStyle = this.isUnshielded
                ? "rgba(255, 179, 71, 0.95)"
                : "rgba(230, 237, 247, 0.35)";
            ctx.lineWidth = 1;
            ctx.strokeRect(cursorX, py - 10, seg.width, 20);

            // Texto
            const innerW =
                ctx.measureText(seg.prefix).width +
                ctx.measureText(seg.state).width +
                ctx.measureText(seg.suffix).width;
            let textX = cursorX + (seg.width - innerW) / 2;

            ctx.fillStyle = "#dfe7f6";
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.fillText(seg.prefix, textX, py + 0.5);
            textX += ctx.measureText(seg.prefix).width;

            ctx.fillStyle = seg.stateColor;
            ctx.shadowColor = seg.stateColor;
            ctx.shadowBlur = this.isUnshielded ? 5 : 8;
            ctx.fillText(seg.state, textX, py + 0.5);
            textX += ctx.measureText(seg.state).width;

            ctx.fillStyle = "#dfe7f6";
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.fillText(seg.suffix, textX, py + 0.5);

            cursorX += seg.width + gap;
        }
    }

    _drawExplosion(ctx) {
        const t = 1 - (this.deathTime / 0.45);

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.strokeStyle = "#00FFCC";
        ctx.shadowColor = "#00FFCC";
        ctx.shadowBlur = 22;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - t;

        // Onda de choque
        ctx.beginPath();
        ctx.arc(0, 0, 12 + t * 38, 0, Math.PI * 2);
        ctx.stroke();

        // Estilhaços radiais
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const r1 = 8 + t * 14;
            const r2 = 18 + t * 30;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
            ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
            ctx.stroke();
        }
        ctx.restore();
    }

    /* -------- Estados -------- */
    hit() {
        this.flashTime = 0.18;
    }

    kill() {
        this.alive = false;
        this.deathTime = 0.45;
    }

    markUnshielded() {
        this.isUnshielded = true;
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


/* ============================================================
   EnemySpawner — gerencia spawn contínuo, anti-overlap, tiros
   ============================================================ */
class EnemySpawner {

    constructor(canvas) {
        this.canvas = canvas;
        this.enemies = [];

        this.maxOnScreen   = 6;
        this.minOnScreen   = 4;
        this.spawnTimer    = 1.0;
        this.spawnInterval = 1.7;
        this.spawnEnabled  = true;
        this.totalToSpawn  = 0;
        this.spawned       = 0;
        this.level         = 1;
        this.allowShooting = true;
    }

    startWave(level, totalEnemies) {
        this.level         = level;
        this.totalToSpawn  = totalEnemies;
        this.spawned       = 0;
        this.spawnEnabled  = true;
        this.spawnTimer    = 1.2;
        this.spawnInterval = Math.max(0.9, 1.9 - level * 0.1);
        this.allowShooting = true;
    }

    /**
     * @param {number} dt        delta de tempo (já com escala de slowmo aplicada)
     * @param {Array<Bullet>} bullets   buffer global de projéteis
     * @param {string} currentExpression  expressão atual da fase
     */
    update(dt, bullets, currentExpression) {
        for (const e of this.enemies) {
            e.update(dt);
        }

        // Remove os que terminaram a animação de morte
        let write = 0;
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (e.alive || e.deathTime > 0) {
                this.enemies[write++] = e;
            }
        }
        this.enemies.length = write;

        // Spawn contínuo (controlado por tempo + população alvo)
        if (this.spawnEnabled && this.spawned < this.totalToSpawn) {
            const aliveCount = this.aliveCount();
            if (aliveCount < this.maxOnScreen) {
                this.spawnTimer -= dt;
                if (this.spawnTimer <= 0) {
                    this._spawnOne();
                    this.spawnTimer = this.spawnInterval * (0.7 + Math.random() * 0.6);
                }
            }
        }

        // Tiros inimigos
        if (this.allowShooting) {
            for (const e of this.enemies) {
                if (!e.alive) continue;
                if (e.y < 30) continue;       // não atira fora da tela
                e.shootTimer -= dt;
                if (e.shootTimer <= 0) {
                    bullets.push(new Bullet(
                        e.x,
                        e.y + e.height / 2 + 4,
                        260 + this.level * 8,
                        "enemy"
                    ));
                    e.shootTimer = e.shootDelay + Math.random() * 2.5;
                }
            }
        }
    }

    _spawnOne() {
        const margin  = 70;
        const w       = this.canvas.width;
        const minDist = 130;

        let x = margin;
        let attempts = 0;
        do {
            x = margin + Math.random() * (w - 2 * margin);
            attempts++;
        } while (attempts < 20 && this._tooClose(x, minDist));

        this.enemies.push(new Enemy(x, this.level));
        this.spawned++;
    }

    _tooClose(x, minDist) {
        for (const e of this.enemies) {
            if (e.alive && e.y < 100 && Math.abs(e.x - x) < minDist) {
                return true;
            }
        }
        return false;
    }

    /* -------- Consultas -------- */
    aliveCount() {
        let n = 0;
        for (const e of this.enemies) if (e.alive) n++;
        return n;
    }

    getAliveEnemies() {
        return this.enemies.filter(e => e.alive);
    }

    getUnshieldedEnemies() {
        return this.enemies.filter(e => e.alive && e.isUnshielded);
    }

    isAllSpawned() {
        return this.spawned >= this.totalToSpawn;
    }

    enemiesPassed(threshold) {
        return this.enemies.filter(e => {
            if (!e.alive || e.criticalCrossHandled) return false;
            const bottom = e.y + e.height / 2;
            return bottom >= threshold;
        });
    }

    /* -------- Controle externo -------- */
    stopSpawn() {
        this.spawnEnabled = false;
    }

    clear() {
        this.enemies = [];
        this.spawned = 0;
        this.spawnEnabled = false;
        this.allowShooting = true;
    }

    draw(ctx, usedVars, assist = null) {
        for (const e of this.enemies) {
            let assistSignal = null;
            if (assist && e.alive) {
                if (e.isUnshielded) {
                    assistSignal = "purge";
                } else if (Logic.evaluate(assist.expression, e.values)) {
                    assistSignal = "valid";
                }
            }
            e.draw(ctx, usedVars, { assistSignal });
        }
    }
}
