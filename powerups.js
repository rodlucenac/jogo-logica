/* ============================================================
   powerups.js  - Power-ups que caem do topo
   ------------------------------------------------------------
   Tipos:
     "shield"     - escudo absorve 1 hit (8s)
     "doubleshot" - dispara 2 projeteis paralelos (12s)
     "heart"      - recupera 1 vida
     // NOVO: especiais de fase podem iniciar mini-jogo e virar permanentes.
   ============================================================ */

class Powerup {

    constructor(x, kind, options = {}) {
        this.x      = x;
        this.y      = options.y ?? -20;
        this.kind   = kind;
        // NOVO: metadados opcionais para power-ups especiais/permanentes.
        this.isSpecial       = Boolean(options.isSpecial);
        this.level           = options.level || 0;
        this.displayName     = options.displayName || kind;
        this.description     = options.description || "";
        this.icon            = options.icon || null;
        this.colorOverride   = options.color || null;
        this.permanentEffect = options.permanentEffect || "";
        this.temporaryEffect = options.temporaryEffect || "";

        this.width  = this.isSpecial ? 40 : 28;
        this.height = this.isSpecial ? 40 : 28;
        this.vy     = this.isSpecial ? 62 : 80;
        this.alive  = true;
        this.life   = this.isSpecial ? 18 : 12;
        this.spin   = 0;
    }

    update(dt, canvas) {
        this.y    += this.vy * dt;
        this.spin += dt * (this.isSpecial ? 1.9 : 1.2);
        this.life -= dt;
        if (this.y > canvas.height + 30 || this.life <= 0) {
            this.alive = false;
        }
    }

    _color() {
        if (this.colorOverride) return this.colorOverride;
        return this.kind === "shield"
            ? "#00D9FF"
            : this.kind === "heart"
                ? "#FF5F8F"
                : this.kind === "logicguard"
                    ? "#ffe14a"
                    : "#00FFCC";
    }

    _icon() {
        if (this.icon) return this.icon;
        return this.kind === "shield" ? "◈" :
               this.kind === "heart"  ? "♥" :
               this.kind === "logicguard" ? "?" : "≫";
    }

    draw(ctx) {
        const color = this._color();

        // NOVO: power-up especial usa silhueta, brilho e rótulo distintos.
        if (this.isSpecial) {
            this._drawSpecial(ctx, color);
            return;
        }

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.spin * 0.4);

        const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 200);

        ctx.shadowColor = color;
        ctx.shadowBlur  = 16;
        ctx.strokeStyle = color;
        ctx.fillStyle   = "rgba(10, 20, 40, 0.85)";
        ctx.lineWidth   = 2;

        const r = 14 * pulse;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a  = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else         ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        ctx.fillStyle   = color;
        ctx.font         = 'bold 14px "Courier New", monospace';
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this._icon(), 0, 1);
        ctx.restore();

        if (this.life < 3 && Math.floor(this.life * 6) % 2 === 0) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // NOVO: render exclusivo do item especial que abre o mini-jogo permanente.
    _drawSpecial(ctx, color) {
        const t = performance.now();
        const pulse = 0.82 + 0.18 * Math.sin(t / 160);
        const ring  = 21 + 4 * Math.sin(t / 210);

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.spin * 0.35);

        ctx.shadowColor = color;
        ctx.shadowBlur  = 26;
        ctx.strokeStyle = color;
        ctx.fillStyle   = "rgba(255, 225, 74, 0.08)";
        ctx.lineWidth   = 2.4;

        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const a  = Math.PI / 4 + (i / 4) * Math.PI * 2;
            const px = Math.cos(a) * 20 * pulse;
            const py = Math.sin(a) * 20 * pulse;
            if (i === 0) ctx.moveTo(px, py);
            else         ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, ring, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.shadowColor = color;
        ctx.shadowBlur  = 12;
        ctx.fillStyle   = color;
        ctx.font         = 'bold 17px "Courier New", monospace';
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this._icon(), 0, -1);

        ctx.font       = 'bold 9px "Courier New", monospace';
        ctx.shadowBlur = 8;
        ctx.fillText("PERM", 0, 25);
        ctx.restore();

        if (this.life < 4 && Math.floor(this.life * 7) % 2 === 0) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.fillStyle = "rgba(255, 225, 74, 0.22)";
            ctx.beginPath();
            ctx.arc(0, 0, 28, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
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
   PowerupSpawner - gerencia spawn ocasional
   ============================================================ */
class PowerupSpawner {

    constructor(canvas) {
        this.canvas   = canvas;
        this.powerups = [];
        this.timer    = 12 + Math.random() * 8;
    }

    update(dt) {
        for (const p of this.powerups) p.update(dt, this.canvas);
        this.powerups = this.powerups.filter(p => p.alive);

        this.timer -= dt;
        if (this.timer <= 0) {
            this._spawn();
            this.timer = 18 + Math.random() * 12;
        }
    }

    _spawn() {
        const margin = 80;
        const x      = margin + Math.random() * (this.canvas.width - 2 * margin);
        const roll   = Math.random();
        const kind   = roll < 0.4 ? "shield"
                     : roll < 0.8 ? "doubleshot"
                     :              "heart";
        this.powerups.push(new Powerup(x, kind));
    }

    // NOVO: spawn único no começo de cada fase para abrir mini-jogo de upgrade permanente.
    spawnSpecial(level, upgradeDef) {
        if (!upgradeDef) return;
        const x = this.canvas.width / 2;
        this.powerups.push(new Powerup(x, upgradeDef.kind, {
            isSpecial: true,
            level,
            displayName: upgradeDef.name,
            description: upgradeDef.description,
            temporaryEffect: upgradeDef.temporaryEffect,
            permanentEffect: upgradeDef.permanentEffect,
            icon: upgradeDef.icon,
            color: upgradeDef.color
        }));
    }

    // NOVO: evita carregar item especial antigo para a fase seguinte.
    removeSpecials() {
        this.powerups = this.powerups.filter(p => !p.isSpecial);
    }

    draw(ctx) {
        for (const p of this.powerups) p.draw(ctx);
    }

    clear() {
        this.powerups = [];
        this.timer    = 12 + Math.random() * 8;
    }
}
