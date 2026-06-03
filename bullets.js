/* ============================================================
   bullets.js  —  Projéteis (jogador e inimigos)
   ============================================================ */

class Bullet {
    constructor(x, y, vy, owner) {
        this.x = x;
        this.y = y;
        this.vy = vy;
        this.owner = owner;
        this.width = 4;
        this.height = 14;
        this.alive = true;
    }

    update(dt, canvas) {
        this.y += this.vy * dt;
        if (this.y < -20 || this.y > canvas.height + 20) {
            this.alive = false;
        }
    }

    draw(ctx) {
        const color = this.owner === "player" ? "#00FFCC" : "#FF2E88";
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = color;
        ctx.fillRect(
            this.x - this.width / 2,
            this.y - this.height / 2,
            this.width,
            this.height
        );
        ctx.shadowBlur = 6;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(this.x - 1, this.y - this.height / 2 + 2, 2, this.height - 4);
        ctx.restore();
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
