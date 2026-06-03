/* ============================================================
   game.js — Controlador principal (state machine + game loop)
   ------------------------------------------------------------
   Estados:
     "menu"             — tela inicial
     "rules"            — regras de operadores e mecânica
     "controls"         — controles de teclado/mouse
     "ranking"          — ranking dos pilotos
     "playing"          — gameplay
     "logicupgrade"     — NOVO: mini-jogo de upgrade permanente
     "paused"           — pausa
     "leveltransition"  — overlay entre níveis
     "campaigncheckpoint" — escolha ao concluir a primeira parte
     "gameover"         — fim de jogo (vitória ou derrota)

   Modificadores ortogonais ativos em "playing":
     slowmoTimer > 0     → timeScale = SLOWMO_SCALE
     impossibleTimer > 0 → conta tempo sem inimigos válidos

   Progressão:
     - Cada nível tem N inimigos (escala com level).
     - Sentença troca a cada 5 derrotados (ou se estado impossível).
     - Quando spawn termina e ainda há inimigos vivos → sentença final.
     - Tela limpa → leveltransition → próximo nível.
     - Nível 3+ usa fallback: inimigos abaixo da linha de segurança
       perdem o "escudo lógico" e podem ser eliminados com tecla E.
   ============================================================ */


/* ============================================================
   Util: AABB rect intersect
   ============================================================ */
function rectIntersect(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w ||
             a.y + a.h < b.y || a.y > b.y + b.h);
}


const Game = {

    /* ============================================================
       Configuração
       ============================================================ */
    INITIAL_LIVES:           5,
    POINTS_PER_HIT:          10,
    EXPRESSION_SWITCH_EVERY: 5,
    BASE_SLOWMO_DURATION:    4.0,
    MAX_SLOWMO_DURATION:     8.0,
    SLOWMO_SCALE:            0.3,
    LEVEL_TRANSITION_TIME:   2.4,
    IMPOSSIBLE_TIMEOUT:      3.0,
    PAUSE_LIMIT:             2,
    SAFETY_LINE_OFFSET:      92,
    MAX_LEVEL:               6,
    FIRST_CAMPAIGN_PART_LEVEL: 3,
    MAX_FLOAT_TEXTS:         40,
    MAX_LOG_ENTRIES:         35,

    // NOVO: tempo e feedback do mini-jogo de upgrade permanente.
    UPGRADE_CHALLENGE_TIME:          12.0,
    UPGRADE_CHALLENGE_FEEDBACK_TIME: 1.25,

    RANKING_STORAGE_KEY: "logicInvadersRankingV1",
    MAX_RANKING_ENTRIES: 8,
    MAX_RANKING_STORED_ENTRIES: 40,

    // NOVO: um upgrade especial exclusivo por fase.
    PHASE_UPGRADES: {
        1: {
            kind: "bootFirewall",
            name: "Firewall de Boot",
            description: "Blindagem inicial para estabilizar a nave no começo da campanha.",
            temporaryEffect: "Escudo comum por 8s.",
            permanentEffect: "Escudo de 5s no início desta e das próximas fases.",
            icon: "◈",
            color: "#00D9FF"
        },
        2: {
            kind: "parallelCompiler",
            name: "Compilador Paralelo",
            description: "O núcleo lógico paraleliza ciclos de disparo contra expressões compostas.",
            temporaryEffect: "Tiro duplo por 12s.",
            permanentEffect: "Cadência permanente melhorada: intervalo de tiro 0.26s → 0.22s.",
            icon: "≫",
            color: "#00FFCC"
        },
        3: {
            kind: "inferenceCache",
            name: "Cache de Inferência",
            description: "Armazena uma correção automática contra uma dedução errada na terceira fase.",
            temporaryEffect: "Absorve 1 erro lógico por até 14s.",
            permanentEffect: "Absorve 1 erro lógico por fase, recarregando no início de cada fase.",
            icon: "?",
            color: "#ffe14a"
        }
    },


    /* ============================================================
       Refs do DOM / Canvas
       ============================================================ */
    canvas: null,
    ctx:    null,
    hud:    null,


    /* ============================================================
       Entidades
       ============================================================ */
    player:   null,
    spawner:  null,
    powerups: null,
    bullets:  [],


    /* ============================================================
       Estado de gameplay
       ============================================================ */
    state:      "menu",
    lives:      5,
    score:      0,
    level:      1,
    expression: "",
    usedVars:   ["A", "B", "C"],

    currentPlayerName: "",
    lastEnteredName:   "",
    rankingEntries:    [],
    rankingStore:      null,
    rankingStatus:     "Ranking local deste navegador.",
    rankingSortMode:   "score",
    assistMode:        false,
    campaignTimeSeconds: 0,

    enemiesKilledThisLevel: 0,
    totalEnemiesThisLevel:  8,
    killsSinceLastSwitch:   0,
    isFinalWaveStarted:     false,

    slowmoTimer:    0,
    slowmoDuration: 4.0,
    slowmoMessage:  "",

    impossibleTimer: 0,

    transitionTimer:   0,
    transitionMessage: "",
    campaignCheckpointIndex: 0,
    rankingQualified: false,
    rankingEntrySubmitted: false,

    // NOVO: estado do mini-jogo acionado por upgrade especial.
    upgradeChallenge: null,

    sessionNotice:      "",
    sessionNoticeColor: "#ffe14a",
    sessionNoticeTimer: 0,

    floatTexts:  [],
    bgOffset:    0,
    screenShake: 0,

    mouseX: -1,
    mouseY: -1,
    mouseClick: false,

    menuIndex:      0,
    pauseMenuIndex: 0,
    pauseUses:      0,

    _cameFromPause: false,
    lastTime: 0,


    /* ============================================================
       Bootstrap
       ============================================================ */
    init() {
        this.canvas = document.getElementById("game");
        this.ctx    = this.canvas ? this.canvas.getContext("2d") : null;

        if (!this.ctx) {
            console.error("Canvas 2D indisponível — abortando init.");
            return;
        }

        this.hud = {
            expression:     document.getElementById("expression"),
            score:          document.getElementById("score"),
            lives:          document.getElementById("lives"),
            level:          document.getElementById("level"),
            progress:       document.getElementById("progress"),
            progressFill:   document.getElementById("progressFill"),
            upgradeHistory: document.getElementById("upgradeHistory"),
            log:            document.getElementById("log"),
            gameOver:       document.getElementById("gameOver"),
            gameOverHeader: document.querySelector("#gameOver .game-over-header"),
            gameOverTitle:  document.querySelector("#gameOver h2"),
            finalScore:     document.getElementById("finalScore"),
            finalLevel:     document.getElementById("finalLevel"),
            restartBtn:     document.getElementById("restartBtn"),
            menuBtn:        document.getElementById("menuBtn")
        };

        Input.init();
        this._bindMouse();
        this._bindOverlayButtons();

        this.spawner       = new EnemySpawner(this.canvas);
        this.powerups      = new PowerupSpawner(this.canvas);
        this.rankingStore   = this._createRankingStore();
        this.rankingEntries = this._loadRanking();
        this._syncRanking();

        this._goToMenu();

        this.lastTime = performance.now();
        requestAnimationFrame((t) => this._loop(t));
    },

    _bindMouse() {
        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const sx = this.canvas.width  / rect.width;
            const sy = this.canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * sx,
                y: (e.clientY - rect.top)  * sy
            };
        };

        this.canvas.addEventListener("mousemove", (e) => {
            const p = getPos(e);
            this.mouseX = p.x;
            this.mouseY = p.y;
        });
        this.canvas.addEventListener("mouseleave", () => {
            this.mouseX = -1;
            this.mouseY = -1;
        });
        this.canvas.addEventListener("click", (e) => {
            const p = getPos(e);
            this.mouseX = p.x;
            this.mouseY = p.y;
            this.mouseClick = true;
        });
    },

    _bindOverlayButtons() {
        if (this.hud.restartBtn) {
            this.hud.restartBtn.addEventListener("click", () => {
                this.hud.gameOver.classList.add("hidden");
                if (this.currentPlayerName) {
                    this._startGame();
                } else {
                    this._goToMenu();
                }
            });
        }
        if (this.hud.menuBtn) {
            this.hud.menuBtn.addEventListener("click", () => {
                this.hud.gameOver.classList.add("hidden");
                this._goToMenu();
            });
        }
    },


    /* ============================================================
       Navegação / lifecycle
       ============================================================ */
    _goToMenu() {
        this.state           = "menu";
        this.menuIndex       = 0;
        this.score           = 0;
        this.level           = 1;
        this.lives           = this.INITIAL_LIVES;
        this.expression      = "";
        this.usedVars        = ["A", "B", "C"];
        this.totalEnemiesThisLevel  = this._enemiesForLevel(1);
        this.enemiesKilledThisLevel = 0;
        this.killsSinceLastSwitch   = 0;
        this.isFinalWaveStarted     = false;
        this.pauseUses       = 0;
        this.campaignCheckpointIndex = 0;
        this.rankingQualified = false;
        this.rankingEntrySubmitted = false;
        this.campaignTimeSeconds = 0;
        this.slowmoTimer     = 0;
        this.slowmoMessage   = "";
        this.screenShake     = 0;
        this.impossibleTimer = 0;
        this.sessionNotice   = "";
        this.sessionNoticeTimer = 0;
        this.upgradeChallenge = null;

        this._setSentenceObscured(false);
        this._configureEndOverlay("failure");

        this.player     = null;
        this.bullets    = [];
        this.floatTexts = [];

        if (this.spawner)  this.spawner.clear();
        if (this.powerups) this.powerups.clear();

        if (this.hud.gameOver) this.hud.gameOver.classList.add("hidden");

        Input.clearEdgeFlags();
        this._refreshHud();
    },

    _configureEndOverlay(mode) {
        if (!this.hud.gameOverHeader || !this.hud.gameOverTitle || !this.hud.restartBtn) return;

        if (mode === "victory") {
            this.hud.gameOverHeader.textContent = "!! SYSTEM STABILIZED !!";
            this.hud.gameOverTitle.textContent  = "CAMPANHA CONCLUÍDA";
            this.hud.restartBtn.textContent     = "▶ JOGAR NOVAMENTE";
            if (this.hud.menuBtn) this.hud.menuBtn.textContent = "⌂ MENU PRINCIPAL";
        } else if (mode === "firstPart") {
            this.hud.gameOverHeader.textContent = "!! PRIMEIRA PARTE CONCLUÍDA !!";
            this.hud.gameOverTitle.textContent  = "CAMPANHA PARCIAL FINALIZADA";
            this.hud.restartBtn.textContent     = "▶ JOGAR NOVAMENTE";
            if (this.hud.menuBtn) this.hud.menuBtn.textContent = "⌂ MENU PRINCIPAL";
        } else {
            this.hud.gameOverHeader.textContent = "!! SYSTEM FAILURE !!";
            this.hud.gameOverTitle.textContent  = "GAME OVER";
            this.hud.restartBtn.textContent     = "↻ TENTAR NOVAMENTE";
            if (this.hud.menuBtn) this.hud.menuBtn.textContent = "⌂ MENU PRINCIPAL";
        }
    },

    _requestPlayerNameAndStart(assistMode = false) {
        const requestedAssistMode = Boolean(assistMode);
        const defaultName = this.lastEnteredName || this.currentPlayerName || "";
        let name = window.prompt("Digite o nome do piloto:", defaultName);

        // Repete se string for vazia (mas permite cancelar com null)
        while (name !== null && !name.trim()) {
            name = window.prompt("Digite o nome do piloto:", defaultName);
        }
        if (name === null) return;

        this.currentPlayerName = name.trim().slice(0, 18);
        this.lastEnteredName   = this.currentPlayerName;
        this._startGame(requestedAssistMode);
    },

    _startGame(assistMode = this.assistMode) {
        this.assistMode = Boolean(assistMode);
        this._clearLog();
        this._log(`Sistema online. Boa sorte, ${this.currentPlayerName || "piloto"}.`, "info");
        if (this.assistMode) {
            this._log("Modo assistido ativo: alvos corretos serão sinalizados. Pontuação não entra no ranking.", "system");
        }

        this.lives           = this.INITIAL_LIVES;
        this.score           = 0;
        this.campaignTimeSeconds = 0;
        this.bullets         = [];
        this.floatTexts      = [];
        this.screenShake     = 0;
        this.slowmoTimer     = 0;
        this.slowmoMessage   = "";
        this.slowmoDuration  = this.BASE_SLOWMO_DURATION;
        this.impossibleTimer = 0;
        this.pauseUses       = 0;
        this.campaignCheckpointIndex = 0;
        this.rankingQualified = false;
        this.rankingEntrySubmitted = false;
        this.sessionNotice   = "";
        this.sessionNoticeTimer = 0;
        this.upgradeChallenge = null;

        this._setSentenceObscured(false);

        this.player = new Player(
            this.canvas.width / 2,
            this.canvas.height - 60
        );

        this.spawner.clear();
        this.powerups.clear();

        if (this.hud.gameOver) this.hud.gameOver.classList.add("hidden");

        Input.clearEdgeFlags();
        this._startLevel(1);
    },


    /* ============================================================
       Progressão de nível
       ============================================================ */
    _enemiesForLevel(level) {
        return 8 + (level - 1) * 3;
    },

    _slowmoDurationForLevel(level) {
        if (level <= 1) return 4;
        if (level === 2) return 5;
        if (level === 3) return 6;
        return Math.min(this.MAX_SLOWMO_DURATION, 6 + (level - 3) * 0.5);
    },

    _dangerLineY()  { return this.canvas.height - 110; },
    _safetyLineY()  { return this._dangerLineY() - this.SAFETY_LINE_OFFSET; },

    _supportsUnshieldedFallback() {
        return this.level >= 3;
    },

    /** Inimigos elegíveis para validar uma expressão (acima da linha de segurança). */
    _eligibleEnemiesForExpression() {
        const live = this.spawner.getAliveEnemies();
        if (!this._supportsUnshieldedFallback()) return live;

        const safety = this._safetyLineY();
        return live.filter(e => !e.isUnshielded && e.y + e.height / 2 < safety);
    },

    _startLevel(level) {
        this.level                  = level;
        this.enemiesKilledThisLevel = 0;
        this.killsSinceLastSwitch   = 0;
        this.isFinalWaveStarted     = false;
        this.totalEnemiesThisLevel  = this._enemiesForLevel(level);
        this.expression             = Logic.pickByLevel(level);
        this.usedVars               = Logic.getUsedVars(this.expression);
        this.bullets                = [];
        this.slowmoDuration         = this._slowmoDurationForLevel(level);
        this.slowmoTimer            = 0;          // bug fix: reset entre níveis
        this.slowmoMessage          = "";
        this.impossibleTimer        = 0;
        this.sessionNoticeTimer     = 0;
        this.screenShake            = 0;
        this.upgradeChallenge       = null;

        // NOVO: remove especiais antigos e reativa passivas permanentes ao começar fase.
        if (this.powerups) this.powerups.removeSpecials();
        if (this.player) this.player.applyPermanentLevelStartBonuses();

        this.spawner.startWave(level, this.totalEnemiesThisLevel);

        // NOVO: item especial cai no início de cada fase.
        const phaseUpgrade = this._phaseUpgradeForLevel(level);
        if (phaseUpgrade && this.powerups) {
            this.powerups.spawnSpecial(level, phaseUpgrade);
        }

        this._log(`════ NÍVEL ${level} ════`, "system");
        this._log(`Inimigos: ${this.totalEnemiesThisLevel} · Expressão: ${Logic.displayExpression(this.expression)}`, "info");
        if (phaseUpgrade) {
            this._log(`◆ Upgrade permanente disponível: ${phaseUpgrade.name}`, "system");
            this._showNotice(`UPGRADE ESPECIAL: ${phaseUpgrade.name}`, phaseUpgrade.color, 3.0);
        }

        this.state = "playing";
        this._setSentenceObscured(false);
        this._refreshHud();
    },

    _setSentenceObscured(isPaused) {
        document.body.classList.toggle("sentence-obscured", Boolean(isPaused));
    },

    _showNotice(message, color = "#ffe14a", duration = 2.4) {
        this.sessionNotice      = message;
        this.sessionNoticeColor = color;
        this.sessionNoticeTimer = duration;
    },

    // NOVO: retorna o upgrade especial configurado para a fase atual.
    _phaseUpgradeForLevel(level) {
        return this.PHASE_UPGRADES[level] || null;
    },

    // NOVO: rótulo curto usado em floats/console.
    _phaseUpgradeLabel(kind) {
        const found = Object.values(this.PHASE_UPGRADES).find(u => u.kind === kind);
        return found ? found.name : kind;
    },

    // NOVO: aplica o efeito temporário ou permanente decidido pelo mini-jogo.
    _applyPhaseUpgrade(kind, isPermanent) {
        if (!this.player) return;

        const label = this._phaseUpgradeLabel(kind);
        const def = Object.values(this.PHASE_UPGRADES).find(u => u.kind === kind);
        const color = def ? def.color : "#00FFCC";

        if (isPermanent) {
            this.player.applyPermanentUpgrade(kind);
            this._addFloat("PERMANENTE", this.player.x, this.player.y - 34, color);
            this._log(`◆ Upgrade permanente instalado: ${label}`, "success");
            this._showNotice(`${label.toUpperCase()} PERMANENTE`, color, 3.0);
        } else {
            this.player.applyPowerup(kind);
            this._addFloat("TEMPORÁRIO", this.player.x, this.player.y - 34, color);
            this._log(`◇ Upgrade temporário aplicado: ${label}`, "info");
            this._showNotice(`${label.toUpperCase()} TEMPORÁRIO`, color, 2.4);
        }
        this._refreshHud();
    },

    // NOVO: cria desafio proposicional ao coletar o item especial.
    _startUpgradeChallenge(powerup) {
        const def = this._phaseUpgradeForLevel(powerup.level || this.level) || {
            kind: powerup.kind,
            name: powerup.displayName || powerup.kind,
            description: powerup.description || "Upgrade especial.",
            temporaryEffect: powerup.temporaryEffect || "Efeito temporário.",
            permanentEffect: powerup.permanentEffect || "Efeito permanente.",
            color: powerup.colorOverride || "#ffe14a",
            icon: powerup.icon || "?"
        };

        const expr = Logic.pickByLevel(Math.max(1, this.level));
        const usedVars = Logic.getUsedVars(expr);
        const options = this._buildUpgradeChallengeOptions(expr, usedVars);

        this.upgradeChallenge = {
            def,
            expr,
            usedVars,
            options,
            selectedIndex: 0,
            timer: this.UPGRADE_CHALLENGE_TIME,
            maxTimer: this.UPGRADE_CHALLENGE_TIME,
            resolved: false,
            success: false,
            feedbackText: "",
            feedbackColor: def.color,
            feedbackTimer: 0
        };

        this.state = "logicupgrade";
        this._setSentenceObscured(false);
        Input.clearEdgeFlags();
        this._log(`◆ Mini-jogo ativado para ${def.name}: escolha um pacote verdadeiro para tornar permanente.`, "system");
    },

    _collectSpecialPhaseUpgrade(powerup) {
        if (this.assistMode) {
            const def = this._phaseUpgradeForLevel(powerup.level || this.level);
            const kind = def ? def.kind : powerup.kind;
            const name = def ? def.name : (powerup.displayName || kind);

            this._applyPhaseUpgrade(kind, true);
            this._log(`◆ Modo assistido: ${name} instalado sem mini-jogo.`, "system");
            return;
        }

        this._startUpgradeChallenge(powerup);
    },

    _buildUpgradeChallengeOptions(expr, usedVars) {
        const combos = Logic.combinationsForVars(usedVars).map(vars => ({
            vars,
            isCorrect: Logic.evaluate(expr, vars)
        }));
        const valid = this._shuffleCopy(combos.filter(o => o.isCorrect));
        const invalid = this._shuffleCopy(combos.filter(o => !o.isCorrect));
        const selected = [];

        const addUnique = (option) => {
            if (!option) return;
            const key = this._varsKey(option.vars, usedVars);
            if (!selected.some(item => this._varsKey(item.vars, usedVars) === key)) {
                selected.push(option);
            }
        };

        addUnique(valid[0]);
        addUnique(invalid[0]);
        addUnique(valid[1]);
        addUnique(invalid[1]);

        for (const option of this._shuffleCopy(combos)) {
            if (selected.length >= 4) break;
            addUnique(option);
        }

        return this._shuffleCopy(selected);
    },

    _shuffleCopy(items) {
        const copy = items.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    },

    _varsKey(vars, usedVars) {
        const used = usedVars && usedVars.length ? usedVars : ["A", "B", "C"];
        return used.map(name => `${name}:${vars[name] ? 1 : 0}`).join("|");
    },

    _formatChallengeOption(vars, usedVars) {
        const used = usedVars && usedVars.length ? usedVars : ["A", "B", "C"];
        return used.map(name => `[${name}:${vars[name] ? "V" : "F"}]`).join("  ");
    },

    // NOVO: atualização do overlay do mini-jogo; o mundo fica pausado enquanto responde.
    _updateUpgradeChallenge(dt, escPressed) {
        const ch = this.upgradeChallenge;
        if (!ch) {
            this.state = "playing";
            return;
        }

        if (ch.resolved) {
            ch.feedbackTimer -= dt;
            if (ch.feedbackTimer <= 0) {
                this.upgradeChallenge = null;
                this.state = "playing";
                this._setSentenceObscured(false);
                Input.clearEdgeFlags();
            }
            return;
        }

        if (!Array.isArray(ch.options) || ch.options.length === 0) {
            this._resolveUpgradeChallenge(false, "SEM OPÇÕES");
            return;
        }

        if (escPressed) {
            this._resolveUpgradeChallenge(false, "IGNORADO");
            return;
        }

        if (Input.consumeUp()) {
            ch.selectedIndex = (ch.selectedIndex - 1 + ch.options.length) % ch.options.length;
        }
        if (Input.consumeDown()) {
            ch.selectedIndex = (ch.selectedIndex + 1) % ch.options.length;
        }

        const rects = this._upgradeChallengeRects();
        for (let i = 0; i < ch.options.length; i++) {
            if (this._pointInRect(this.mouseX, this.mouseY, rects.optionBtns[i])) {
                ch.selectedIndex = i;
            }
        }

        if (this.mouseClick) {
            for (let i = 0; i < ch.options.length; i++) {
                if (this._pointInRect(this.mouseX, this.mouseY, rects.optionBtns[i])) {
                    ch.selectedIndex = i;
                    const picked = ch.options[ch.selectedIndex];
                    this._resolveUpgradeChallenge(picked && picked.isCorrect, picked && picked.isCorrect ? "ACERTO" : "ERRO");
                    this.mouseClick = false;
                    return;
                }
            }
        }

        if (Input.consumeEnter()) {
            const picked = ch.options[ch.selectedIndex];
            this._resolveUpgradeChallenge(picked && picked.isCorrect, picked && picked.isCorrect ? "ACERTO" : "ERRO");
            return;
        }

        ch.timer -= dt;
        if (ch.timer <= 0) {
            ch.timer = 0;
            this._resolveUpgradeChallenge(false, "TEMPO ESGOTADO");
        }
    },

    // NOVO: encerra o desafio e decide permanente vs temporário.
    _resolveUpgradeChallenge(success, reason) {
        const ch = this.upgradeChallenge;
        if (!ch || ch.resolved) return;

        ch.resolved = true;
        ch.success = success;
        ch.feedbackTimer = this.UPGRADE_CHALLENGE_FEEDBACK_TIME;
        ch.feedbackText = success
            ? "ACERTO — UPGRADE PERMANENTE"
            : `${reason} — UPGRADE TEMPORÁRIO`;
        ch.feedbackColor = success ? "#00FFCC" : (reason === "ERRO" ? "#FF2E88" : "#ffe14a");

        this._applyPhaseUpgrade(ch.def.kind, success);
    },

    // NOVO: geometria do mini-jogo.
    _upgradeChallengeLayout() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const margin = 36;
        const boxW = Math.min(860, w - margin * 2);
        const boxH = Math.min(640, h - margin);
        const boxX = (w - boxW) / 2;
        const boxY = (h - boxH) / 2;
        const bw = boxW - 120;
        const bh = 42;
        const gap = 10;
        const startY = boxY + 390;
        return {
            boxX,
            boxY,
            boxW,
            boxH,
            optionBtns: [0, 1, 2, 3].map(i => ({
                x: w / 2 - bw / 2,
                y: startY + i * (bh + gap),
                w: bw,
                h: bh
            }))
        };
    },

    _upgradeChallengeRects() {
        return this._upgradeChallengeLayout();
    },

    /**
     * Marca como "sem escudo lógico" todos os inimigos abaixo da linha de
     * segurança (usado em níveis 3+). Retorna quantos foram marcados.
     */
    _markUnsafeEnemiesAsUnshielded() {
        if (!this._supportsUnshieldedFallback()) return 0;

        const safety = this._safetyLineY();
        let changed = 0;
        for (const enemy of this.spawner.getAliveEnemies()) {
            if (enemy.isUnshielded) continue;
            if (enemy.y + enemy.height / 2 >= safety) {
                enemy.markUnshielded();
                changed++;
            }
        }

        if (changed > 0) {
            this._showNotice("ESCUDOS DESPROGRAMADOS — pressione E", "#ffe14a", 3.4);
            this._log(`Escudos desprogramados em ${changed} nave(s). Pressione E para eliminar.`, "system");
        }
        return changed;
    },

    _destroyEnemy(enemy, reason = "logic") {
        enemy.kill();
        const isUnshielded = reason === "unshielded";
        const color = isUnshielded ? "#ffe14a" : "#00FFCC";
        const label = isUnshielded ? "DESPROGRAMADO" : `+${this.POINTS_PER_HIT}`;
        this._addFloat(label, enemy.x, enemy.y, color);
        this._onEnemyKilled();
    },

    _purgeUnshieldedEnemies() {
        if (!this._supportsUnshieldedFallback()) return;
        const targets = this.spawner.getUnshieldedEnemies();
        if (targets.length === 0) return;

        for (const enemy of targets) this._destroyEnemy(enemy, "unshielded");

        this._showNotice(`PULSO E: ${targets.length} NAVE(S) ELIMINADAS`, "#ffb347", 2.8);
        this._log(`Pulso E executado: ${targets.length} nave(s) sem escudo removidas.`, "success");
    },

    _gainLife(amount = 1, reason = "Recuperação") {
        const before = this.lives;
        this.lives = Math.min(this.INITIAL_LIVES, this.lives + amount);
        const gained = this.lives - before;

        if (gained > 0) {
            this._addFloat(`+${gained} VIDA`, this.player.x, this.player.y - 30, "#FF5F8F");
            this._log(`${reason}: +${gained} vida`, "success");
            this._refreshHud();
            return true;
        }
        this._addFloat("VIDA CHEIA", this.player.x, this.player.y - 30, "#ffe14a");
        this._log(`${reason}: vidas já estão no máximo`, "info");
        return false;
    },

    _onEnemyKilled() {
        this.enemiesKilledThisLevel++;
        this.killsSinceLastSwitch++;
        this.score += this.POINTS_PER_HIT;

        // Troca de sentença a cada N kills (somente se ainda há spawn pela frente)
        if (
            !this.isFinalWaveStarted &&
            this.killsSinceLastSwitch >= this.EXPRESSION_SWITCH_EVERY &&
            !this.spawner.isAllSpawned()
        ) {
            this._switchExpression("progress");
        }

        // Quando todos foram spawnados e ainda há inimigos vivos → sentença final
        if (
            this.spawner.isAllSpawned() &&
            !this.isFinalWaveStarted &&
            this.spawner.aliveCount() > 0
        ) {
            this._startFinalWave();
        }

        this._refreshHud();
    },

    /**
     * Troca a expressão atual, ativando câmera lenta. Usa Logic.pickValidExpression
     * para garantir que a nova sentença SEJA solucionável quando há inimigos
     * elegíveis (evita estados impossíveis).
     */
    _switchExpression(reason) {
        const eligible = this._eligibleEnemiesForExpression();
        const newExpr  = Logic.pickValidExpression(this.level, eligible, this.expression);

        this.expression = newExpr;
        this.usedVars   = Logic.getUsedVars(newExpr);
        this.killsSinceLastSwitch = 0;
        this.impossibleTimer      = 0;
        this.slowmoDuration       = this._slowmoDurationForLevel(this.level);
        this.slowmoTimer          = this.slowmoDuration;
        this.spawner.allowShooting = false;

        // Marca como unshielded as naves abaixo da linha de segurança (nível 3+)
        this._markUnsafeEnemiesAsUnshielded();

        if (reason === "progress") {
            this.slowmoMessage = "NOVA SENTENÇA DETECTADA";
            this._log(`⟳ Sentença atualizada: ${Logic.displayExpression(newExpr)}`, "system");
        } else if (reason === "final") {
            this.slowmoMessage = "SENTENÇA FINAL DA FASE";
            this._log(`★ SENTENÇA FINAL: ${Logic.displayExpression(newExpr)}`, "system");
        } else if (reason === "impossible") {
            this.slowmoMessage = "RECALIBRANDO LÓGICA";
            this._log(`⚠ Sem alvos válidos — sentença trocada: ${Logic.displayExpression(newExpr)}`, "system");
        }

        this._refreshHud();
    },

    _startFinalWave() {
        this.isFinalWaveStarted = true;
        this.spawner.stopSpawn();
        this._switchExpression("final");
    },

    _completeCampaign() {
        if (this.level >= this.FIRST_CAMPAIGN_PART_LEVEL) {
            this.rankingQualified = true;
        }
        this._submitRankingIfEligible();
        this.state = "gameover";
        this._setSentenceObscured(false);
        this._configureEndOverlay("victory");
        if (this.hud.finalScore) this.hud.finalScore.textContent = this.score;
        if (this.hud.finalLevel) this.hud.finalLevel.textContent = this.level;
        if (this.hud.gameOver)   this.hud.gameOver.classList.remove("hidden");
        this._log(`=== CAMPANHA CONCLUÍDA POR ${this.currentPlayerName || "PILOTO"} ===`, "system");
    },

    _startCampaignCheckpoint() {
        this.rankingQualified = true;
        this._submitRankingIfEligible();

        this.state = "campaigncheckpoint";
        this.campaignCheckpointIndex = 0;
        this.transitionMessage = "PRIMEIRA PARTE DA CAMPANHA FINALIZADA";
        this._setSentenceObscured(false);
        this._log("=== PRIMEIRA PARTE DA CAMPANHA FINALIZADA ===", "system");
        this._log("Você pode continuar para as fases extras ou parar por aqui.", "info");
        Input.clearEdgeFlags();
    },

    _continueAfterCampaignCheckpoint() {
        if (this.player) this.player.clearPowerups();
        this.bullets = [];
        if (this.powerups) this.powerups.clear();
        this._log("Continuando campanha: fases extras liberadas.", "system");
        this._startLevel(this.level + 1);
    },

    _stopAfterCampaignCheckpoint() {
        this.state = "gameover";
        this._setSentenceObscured(false);
        this._configureEndOverlay("firstPart");
        if (this.hud.finalScore) this.hud.finalScore.textContent = this.score;
        if (this.hud.finalLevel) this.hud.finalLevel.textContent = this.level;
        if (this.hud.gameOver)   this.hud.gameOver.classList.remove("hidden");
        this._log(`=== PRIMEIRA PARTE ENCERRADA POR ${this.currentPlayerName || "PILOTO"} ===`, "system");
    },

    _checkLevelComplete() {
        if (this.state !== "playing")        return;
        if (!this.spawner.isAllSpawned())    return;
        if (this.spawner.aliveCount() > 0)   return;

        if (this.level === this.FIRST_CAMPAIGN_PART_LEVEL && !this.rankingQualified) {
            this._startCampaignCheckpoint();
            return;
        }

        if (this.level >= this.MAX_LEVEL) {
            this._completeCampaign();
            return;
        }

        this.state             = "leveltransition";
        this.transitionTimer   = this.LEVEL_TRANSITION_TIME;
        this.transitionMessage = `NÍVEL ${this.level} COMPLETO`;
        this._log(`✓ Nível ${this.level} completo!`, "success");
    },

    /**
     * Detecta se há ao menos um inimigo vivo e elegível que satisfaz a
     * expressão. Se não houver por mais de IMPOSSIBLE_TIMEOUT, troca
     * automaticamente.
     */
    _checkImpossibleState(dt) {
        if (this.state !== "playing") return;
        if (this.slowmoTimer > 0)     return;

        const eligible = this.spawner
            .getAliveEnemies()
            .filter(e => !e.isUnshielded);

        if (eligible.length === 0) {
            this.impossibleTimer = 0;
            return;
        }

        const anyValid = eligible.some(e => Logic.evaluate(this.expression, e.values));
        if (anyValid) {
            this.impossibleTimer = 0;
        } else {
            this.impossibleTimer += dt;
            if (this.impossibleTimer >= this.IMPOSSIBLE_TIMEOUT) {
                this._switchExpression("impossible");
            }
        }
    },


    /* ============================================================
       Game Loop
       ============================================================ */
    _loop(now) {
        const dt = Math.min(0.05, (now - this.lastTime) / 1000);
        this.lastTime = now;

        this.bgOffset = (this.bgOffset + dt * 28) % 40;

        this._update(dt);
        this._draw();

        this.mouseClick = false;
        requestAnimationFrame((t) => this._loop(t));
    },

    _update(dt) {
        const escPressed   = Input.consumeEsc();
        const purgePressed = Input.consumePurge();

        // ----- Estados sem física de gameplay -----
        switch (this.state) {
            case "menu":
                this._updateMenu();
                return;

            case "rules":
                if (escPressed || Input.consumeEnter() || this._clickInRect(this._backBtnRect())) {
                    if (this._cameFromPause) {
                        this.state = "paused";
                        this._cameFromPause = false;
                    } else {
                        this.state = "menu";
                    }
                }
                return;

            case "controls":
                if (escPressed || Input.consumeEnter() || this._clickInRect(this._backBtnRect())) {
                    this.state = "menu";
                }
                return;

            case "ranking":
                this._updateRankingScreen(escPressed);
                return;

            case "logicupgrade":
                this._tickCampaignTime(dt);
                this._updateUpgradeChallenge(dt, escPressed);
                return;

            case "campaigncheckpoint":
                this._updateCampaignCheckpoint(escPressed);
                return;

            case "paused":
                this._updatePauseMenu(escPressed);
                return;

            case "gameover":
                return;
        }

        // ----- Pause via ESC -----
        if (escPressed && this.state === "playing") {
            if (this.pauseUses < this.PAUSE_LIMIT) {
                this._pause();
            } else {
                this._showNotice("LIMITE DE PAUSAS ATINGIDO", "#ff6f61", 2.5);
                this._log("Limite de pausas atingido", "error");
            }
            return;
        }

        // ----- Tick de timers reais -----
        this.screenShake        = Math.max(0, this.screenShake - dt);
        this.sessionNoticeTimer = Math.max(0, this.sessionNoticeTimer - dt);

        const inSlowmo  = this.slowmoTimer > 0;
        const timeScale = inSlowmo ? this.SLOWMO_SCALE : 1.0;
        const scaledDt  = dt * timeScale;

        if (inSlowmo) {
            this.slowmoTimer = Math.max(0, this.slowmoTimer - dt);
            if (this.slowmoTimer === 0) {
                this.spawner.allowShooting = true;
                this.slowmoMessage = "";
            }
        }

        // ----- Estado: PLAYING -----
        if (this.state === "playing") {
            this._tickCampaignTime(dt);

            if (purgePressed && this._supportsUnshieldedFallback()) {
                this._purgeUnshieldedEnemies();
            }

            this.player.update(dt, this.canvas, this.bullets);

            this.spawner.update(scaledDt, this.bullets, this.expression);
            this.powerups.update(scaledDt);

            // Bullets do jogador rodam em tempo real; bullets inimigas em slowmo
            for (const b of this.bullets) {
                b.update(b.owner === "player" ? dt : scaledDt, this.canvas);
            }

            // Float texts
            for (const f of this.floatTexts) {
                f.y    -= 36 * dt;
                f.life -= dt;
            }

            // Limpeza in-place
            this._cleanupBullets();
            this._cleanupFloatTexts();

            // Colisões e pickups
            this._checkCollisions();
            this._checkPowerupPickup();

            // Inimigos cruzaram a zona crítica?
            const dangerY = this._dangerLineY();
            const passed  = this.spawner.enemiesPassed(dangerY);
            if (passed.length > 0) {
                this._handleEnemiesPassed(passed);
            }

            this._checkImpossibleState(dt);
            this._checkLevelComplete();
            return;
        }

        // ----- Estado: LEVEL TRANSITION -----
        if (this.state === "leveltransition") {
            this._tickCampaignTime(dt);

            for (const f of this.floatTexts) f.life -= dt;
            this._cleanupFloatTexts();

            this.transitionTimer -= dt;
            if (this.transitionTimer <= 0) {
                if (this.player) this.player.clearPowerups();
                this._startLevel(this.level + 1);
            }
        }
    },

    _cleanupBullets() {
        let write = 0;
        for (let i = 0; i < this.bullets.length; i++) {
            if (this.bullets[i].alive) this.bullets[write++] = this.bullets[i];
        }
        this.bullets.length = write;
    },

    _cleanupFloatTexts() {
        let write = 0;
        for (let i = 0; i < this.floatTexts.length; i++) {
            if (this.floatTexts[i].life > 0) this.floatTexts[write++] = this.floatTexts[i];
        }
        this.floatTexts.length = write;
    },

    _pause() {
        this.state          = "paused";
        this.pauseMenuIndex = 0;
        this.pauseUses     += 1;
        this._setSentenceObscured(true);
        Input.clearEdgeFlags();
        this._log("⏸ Jogo pausado", "info");
    },

    _resume() {
        this.state = "playing";
        this._setSentenceObscured(false);
        Input.clearEdgeFlags();
        this._log("▶ Retomando", "info");
    },


    /* ============================================================
       Menus (lógica)
       ============================================================ */
    _menuItems() {
        return [
            { label: "▶  JOGAR NORMAL",    action: () => this._requestPlayerNameAndStart(false) },
            { label: "◎  MODO ASSISTIDO",  action: () => this._requestPlayerNameAndStart(true) },
            { label: "🏆  RANKING",        action: () => { this.state = "ranking"; } },
            { label: "📖  REGRAS",        action: () => { this._cameFromPause = false; this.state = "rules"; } },
            { label: "🎮  CONTROLES",     action: () => { this.state = "controls"; } }
        ];
    },

    _pauseMenuItems() {
        return [
            { label: "▶  CONTINUAR",       action: () => this._resume() },
            { label: "📖  REGRAS",         action: () => { this._cameFromPause = true; this.state = "rules"; } },
            { label: "↻  REINICIAR JOGO",  action: () => { this._setSentenceObscured(false); this._startGame(); } },
            { label: "⌂  MENU PRINCIPAL",  action: () => this._goToMenu() }
        ];
    },

    _campaignCheckpointItems() {
        return [
            { label: "▶  CONTINUAR",       action: () => this._continueAfterCampaignCheckpoint() },
            { label: "■  PARAR POR AQUI",  action: () => this._stopAfterCampaignCheckpoint() }
        ];
    },

    _updateMenu() {
        const items = this._menuItems();

        if (Input.consumeUp())   this.menuIndex = (this.menuIndex - 1 + items.length) % items.length;
        if (Input.consumeDown()) this.menuIndex = (this.menuIndex + 1) % items.length;
        if (Input.consumeEnter()) {
            items[this.menuIndex].action();
            return;
        }

        const rects = this._menuRects(items.length);
        for (let i = 0; i < items.length; i++) {
            if (this._pointInRect(this.mouseX, this.mouseY, rects[i])) {
                this.menuIndex = i;
                if (this.mouseClick) {
                    items[i].action();
                    this.mouseClick = false;
                    return;
                }
            }
        }
    },

    _updatePauseMenu(escPressed) {
        const items = this._pauseMenuItems();
        if (escPressed) { this._resume(); return; }

        if (Input.consumeUp())   this.pauseMenuIndex = (this.pauseMenuIndex - 1 + items.length) % items.length;
        if (Input.consumeDown()) this.pauseMenuIndex = (this.pauseMenuIndex + 1) % items.length;
        if (Input.consumeEnter()) {
            items[this.pauseMenuIndex].action();
            return;
        }

        const rects = this._menuRects(items.length, true);
        for (let i = 0; i < items.length; i++) {
            if (this._pointInRect(this.mouseX, this.mouseY, rects[i])) {
                this.pauseMenuIndex = i;
                if (this.mouseClick) {
                    items[i].action();
                    this.mouseClick = false;
                    return;
                }
            }
        }
    },

    _rankingSortBtnRect() {
        return {
            x: this.canvas.width - 330,
            y: 116,
            w: 250,
            h: 38
        };
    },

    _updateRankingScreen(escPressed) {
        if (escPressed || this._clickInRect(this._backBtnRect())) {
            this.state = "menu";
            return;
        }

        if (Input.consumeEnter() || this._clickInRect(this._rankingSortBtnRect())) {
            this.rankingSortMode = this.rankingSortMode === "score" ? "time" : "score";
        }
    },

    _updateCampaignCheckpoint(escPressed) {
        const items = this._campaignCheckpointItems();
        if (escPressed) {
            this.campaignCheckpointIndex = 1;
            this._stopAfterCampaignCheckpoint();
            return;
        }

        if (Input.consumeUp())   this.campaignCheckpointIndex = (this.campaignCheckpointIndex - 1 + items.length) % items.length;
        if (Input.consumeDown()) this.campaignCheckpointIndex = (this.campaignCheckpointIndex + 1) % items.length;
        if (Input.consumeEnter()) {
            items[this.campaignCheckpointIndex].action();
            return;
        }

        const rects = this._menuRects(items.length, true);
        for (let i = 0; i < items.length; i++) {
            if (this._pointInRect(this.mouseX, this.mouseY, rects[i])) {
                this.campaignCheckpointIndex = i;
                if (this.mouseClick) {
                    items[i].action();
                    this.mouseClick = false;
                    return;
                }
            }
        }
    },

    _menuRects(n, isPause = false) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const bw = 340;
        const compact = !isPause && n > 4;
        const bh = compact ? 48 : 54;
        const gap = compact ? 10 : 12;
        const startY = isPause ? h / 2 - 30 : h / 2 + (compact ? 20 : 40);
        const rects = [];
        for (let i = 0; i < n; i++) {
            rects.push({
                x: w / 2 - bw / 2,
                y: startY + i * (bh + gap),
                w: bw,
                h: bh
            });
        }
        return rects;
    },

    _backBtnRect() {
        return {
            x: this.canvas.width / 2 - 100,
            y: this.canvas.height - 80,
            w: 200,
            h: 44
        };
    },

    _pointInRect(px, py, r) {
        return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    },

    _clickInRect(r) {
        return this.mouseClick && this._pointInRect(this.mouseX, this.mouseY, r);
    },

    _tickCampaignTime(dt) {
        if (this.rankingEntrySubmitted) return;
        if (this.level > this.FIRST_CAMPAIGN_PART_LEVEL) return;
        this.campaignTimeSeconds += Math.max(0, dt);
    },


    /* ============================================================
       Colisões
       ============================================================ */
    _checkCollisions() {
        // 1) Bullets do jogador vs. inimigos
        for (const bullet of this.bullets) {
            if (bullet.owner !== "player" || !bullet.alive) continue;

            const bb = bullet.getBounds();
            for (const enemy of this.spawner.enemies) {
                if (!enemy.alive) continue;
                if (rectIntersect(bb, enemy.getBounds())) {
                    bullet.alive = false;
                    this._handleEnemyHit(enemy);
                    break;
                }
            }
        }

        // 2) Bullets inimigas vs. jogador
        const playerBounds = this.player.getBounds();
        for (const bullet of this.bullets) {
            if (bullet.owner !== "enemy" || !bullet.alive) continue;
            if (rectIntersect(bullet.getBounds(), playerBounds)) {
                bullet.alive = false;
                const hadShield = this.player.shieldTime > 0;
                if (this.player.hit()) {
                    this._loseLife("Atingido por tiro inimigo!");
                } else if (hadShield) {
                    this._addFloat("ESCUDO!", this.player.x, this.player.y - 30, "#00D9FF");
                    this._log("◈ Escudo absorveu o impacto", "info");
                }
            }
        }
    },

    _checkPowerupPickup() {
        const playerBounds = this.player.getBounds();
        for (const p of this.powerups.powerups) {
            if (!p.alive) continue;
            if (!rectIntersect(p.getBounds(), playerBounds)) continue;

            p.alive = false;

            // NOVO: no modo normal abre mini-jogo; no assistido instala direto.
            if (p.isSpecial) {
                this._collectSpecialPhaseUpgrade(p);
                continue;
            }

            if (p.kind === "heart") {
                if (this.player.recordUpgrade) this.player.recordUpgrade("heart");
                this._gainLife(1, "Coração coletado");
                continue;
            }

            this.player.applyPowerup(p.kind);
            const label = p.kind === "shield" ? "ESCUDO" : "TIRO DUPLO";
            const color = p.kind === "shield" ? "#00D9FF" : "#00FFCC";
            this._addFloat(`+ ${label}`, this.player.x, this.player.y - 30, color);
            this._log(`▲ Power-up: ${label}`, "success");
            this._refreshHud();
        }
    },

    /**
     * Inimigo cruzou a linha de perigo. Avalia a sentença com os valores da nave:
     * - V (deveria ter sido destruída): -1 vida
     * - F (correto não atirar): mesmos pontos e progresso de um acerto lógico
     */
    _handleEnemiesPassed(passed) {
        const shouldHaveHit = [];
        const correctPass   = [];

        for (const enemy of passed) {
            if (Logic.evaluate(this.expression, enemy.values)) {
                shouldHaveHit.push(enemy);
            } else {
                correctPass.push(enemy);
            }
            enemy.kill();
        }

        for (const enemy of correctPass) {
            this._addFloat(`+${this.POINTS_PER_HIT}`, enemy.x, enemy.y, "#00FFCC");
            const detail = `${Logic.displayExpression(this.expression)} | ${Logic.formatVars(enemy.values)} → F`;
            this._log(`✔ EVASÃO CORRETA  ${detail}`, "success");
            this._onEnemyKilled();
        }

        if (shouldHaveHit.length > 0) {
            const n = shouldHaveHit.length;
            this._loseLife(`Inimigo verdadeiro cruzou a zona crítica! (${n})`);
        }
    },

    _handleEnemyHit(enemy) {
        // Inimigos sem escudo: kill direto (sem checagem lógica)
        if (enemy.isUnshielded) {
            this._destroyEnemy(enemy, "unshielded");
            this._log("✚ Alvo sem escudo eliminado.", "success");
            return;
        }

        const result = Logic.evaluate(this.expression, enemy.values);
        const detail = `${Logic.displayExpression(this.expression)} | ${Logic.formatVars(enemy.values)} → ${result}`;

        if (result === true) {
            this._destroyEnemy(enemy, "logic");
            this._log(`✔ ACERTO  ${detail}`, "success");
        } else {
            enemy.hit();
            this._addFloat("ERRO!", enemy.x, enemy.y, "#FF2E88");
            this._log(`✘ ERRO LÓGICO  ${detail}`, "error");

            // NOVO: Cache de Inferência pode absorver um erro proposicional.
            if (this.player.absorbLogicError()) {
                this._addFloat("GUARDA LÓGICA", this.player.x, this.player.y - 36, "#ffe14a");
                this._showNotice("ERRO ABSORVIDO PELO CACHE", "#ffe14a", 2.2);
                this._log("Cache de Inferência absorveu o erro lógico.", "success");
                this._refreshHud();
                return;
            }

            this._loseLife("Erro lógico — expressão FALSA.");
        }
    },


    /* ============================================================
       Vidas / Game Over
       ============================================================ */
    _loseLife(reason) {
        if (this.state !== "playing") return;

        this.lives -= 1;
        this.screenShake = 0.35;

        const remaining = Math.max(0, this.lives);
        const plural = remaining === 1 ? "" : "s";
        this._log(`Vida perdida: ${reason} (${remaining} restante${plural})`, "error");
        this._refreshHud();

        if (this.lives <= 0) this._gameOver();
    },

    _gameOver() {
        this._submitRankingIfEligible();
        this.state = "gameover";
        this._setSentenceObscured(false);
        this._configureEndOverlay("failure");
        if (this.hud.finalScore) this.hud.finalScore.textContent = this.score;
        if (this.hud.finalLevel) this.hud.finalLevel.textContent = this.level;
        if (this.hud.gameOver)   this.hud.gameOver.classList.remove("hidden");
        this._log("=== GAME OVER ===", "system");
    },


    /* ============================================================
       Ranking (local + online configuravel)
       ============================================================ */
    _createRankingStore() {
        if (typeof LogicInvadersRankingStore !== "function") {
            this.rankingStatus = "Ranking local deste navegador.";
            return null;
        }

        const store = new LogicInvadersRankingStore({
            storageKey: this.RANKING_STORAGE_KEY,
            maxEntries: this.MAX_RANKING_STORED_ENTRIES,
            minCompletedLevel: this.FIRST_CAMPAIGN_PART_LEVEL,
            config: window.LOGIC_INVADERS_RANKING || {}
        });

        this.rankingStatus = store.isRemoteEnabled()
            ? "Ranking online sincronizado."
            : "Ranking local deste navegador.";

        return store;
    },

    async _syncRanking() {
        if (!this.rankingStore) return;

        const wasRemote = this.rankingStore.isRemoteEnabled();
        if (wasRemote) this.rankingStatus = "Sincronizando ranking online...";

        this.rankingEntries = await this.rankingStore.load();
        this.rankingStatus = wasRemote
            ? "Ranking online sincronizado."
            : "Ranking local deste navegador.";
    },

    _loadRanking() {
        if (this.rankingStore) {
            return this.rankingStore.loadLocal();
        }

        try {
            const raw = localStorage.getItem(this.RANKING_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(entry =>
                    entry &&
                    typeof entry.name  === "string" &&
                    typeof entry.score === "number" &&
                    typeof entry.level === "number" &&
                    entry.level >= this.FIRST_CAMPAIGN_PART_LEVEL
                )
                .map(entry => ({
                    ...entry,
                    timeSeconds: Number.isFinite(Number(entry.timeSeconds))
                        ? Number(entry.timeSeconds)
                        : null
                }))
                .sort((a, b) => this._compareRankingByScore(a, b))
                .slice(0, this.MAX_RANKING_STORED_ENTRIES);
        } catch (err) {
            console.warn("Falha ao carregar ranking:", err);
            return [];
        }
    },

    _saveRanking() {
        if (this.rankingStore) {
            this.rankingStore.saveLocal(this.rankingEntries);
            return;
        }

        try {
            localStorage.setItem(
                this.RANKING_STORAGE_KEY,
                JSON.stringify(this.rankingEntries.slice(0, this.MAX_RANKING_STORED_ENTRIES))
            );
        } catch (err) {
            console.warn("Falha ao salvar ranking:", err);
        }
    },

    _submitRankingIfEligible() {
        if (this.rankingEntrySubmitted) return;
        if (!this.rankingQualified || this.level < this.FIRST_CAMPAIGN_PART_LEVEL) return;

        if (this.assistMode) {
            this.rankingEntrySubmitted = true;
            this._log("Primeira parte concluída no modo assistido; ranking não foi alterado.", "info");
            return;
        }

        this.rankingEntrySubmitted = true;
        this._addRankingEntry(this.FIRST_CAMPAIGN_PART_LEVEL);
    },

    _addRankingEntry(entryLevel = this.level) {
        const entry = {
            name:  this.currentPlayerName || "PILOTO",
            score: this.score,
            level: entryLevel,
            timeSeconds: Math.max(0, Math.round(this.campaignTimeSeconds)),
            date:  new Date().toISOString().slice(0, 10)
        };

        if (this.rankingStore) {
            const wasRemote = this.rankingStore.isRemoteEnabled();
            this.rankingEntries = [...this.rankingEntries, entry]
                .sort((a, b) => this._compareRankingByScore(a, b))
                .slice(0, this.MAX_RANKING_STORED_ENTRIES);
            this.rankingStatus = wasRemote
                ? "Salvando pontuação no ranking online..."
                : "Pontuação salva no ranking local.";

            this.rankingStore.add(entry).then(entries => {
                this.rankingEntries = entries;
                this.rankingStatus = wasRemote
                    ? "Ranking online sincronizado."
                    : "Pontuação salva no ranking local.";
            });
            return;
        }

        this.rankingEntries.push(entry);
        this.rankingEntries.sort((a, b) => this._compareRankingByScore(a, b));
        this.rankingEntries = this.rankingEntries.slice(0, this.MAX_RANKING_STORED_ENTRIES);
        this._saveRanking();
    },

    _entryTimeSeconds(entry) {
        const value = Number(entry && entry.timeSeconds);
        return Number.isFinite(value) && value >= 0 ? value : Infinity;
    },

    _compareRankingByScore(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        const timeDiff = this._entryTimeSeconds(a) - this._entryTimeSeconds(b);
        if (timeDiff !== 0) return timeDiff;
        return String(a.date || "").localeCompare(String(b.date || ""));
    },

    _compareRankingByTime(a, b) {
        const timeDiff = this._entryTimeSeconds(a) - this._entryTimeSeconds(b);
        if (timeDiff !== 0) return timeDiff;
        if (b.score !== a.score) return b.score - a.score;
        return String(a.date || "").localeCompare(String(b.date || ""));
    },

    _sortedRankingEntries() {
        const compare = this.rankingSortMode === "time"
            ? (a, b) => this._compareRankingByTime(a, b)
            : (a, b) => this._compareRankingByScore(a, b);
        return [...this.rankingEntries]
            .sort(compare)
            .slice(0, this.MAX_RANKING_ENTRIES);
    },

    _formatRankingTime(seconds) {
        const total = Number(seconds);
        if (!Number.isFinite(total) || total < 0) return "--:--";
        const rounded = Math.round(total);
        const min = Math.floor(rounded / 60);
        const sec = rounded % 60;
        return `${min}:${String(sec).padStart(2, "0")}`;
    },


    /* ============================================================
       Render principal
       ============================================================ */
    _draw() {
        const ctx = this.ctx;
        ctx.save();

        // Screen shake (apenas em playing)
        if (this.screenShake > 0 && this.state === "playing") {
            const s = this.screenShake * 9;
            ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
        }

        this._drawBackground(ctx);

        const showWorld =
            this.state === "playing" ||
            this.state === "logicupgrade" ||
            this.state === "paused"  ||
            this.state === "leveltransition" ||
            this.state === "campaigncheckpoint" ||
            this.state === "gameover";

        if (showWorld && this.player) {
            this.powerups.draw(ctx);
            for (const b of this.bullets) b.draw(ctx);
            this.spawner.draw(ctx, this.usedVars, this.assistMode ? { expression: this.expression } : null);

            if (this.state !== "gameover") this.player.draw(ctx);

            this._drawFloatTexts(ctx);

            if (this.state === "playing" || this.state === "paused" || this.state === "logicupgrade") {
                this._drawPowerupIndicators(ctx);
                this._drawSessionNotice(ctx);
            }
            if (this.state === "playing") {
                this._drawAssistModeBadge(ctx);
                this._drawUnshieldedPrompt(ctx);
            }
        }

        if (this.slowmoTimer > 0 && this.state === "playing") this._drawSlowmoOverlay(ctx);
        if (this.state === "logicupgrade")                    this._drawUpgradeChallengeOverlay(ctx);
        if (this.state === "leveltransition")                 this._drawTransitionOverlay(ctx);
        if (this.state === "campaigncheckpoint")              this._drawCampaignCheckpointOverlay(ctx);
        if (this.state === "menu")     this._drawMenu(ctx);
        if (this.state === "paused")   this._drawPauseOverlay(ctx);
        if (this.state === "ranking")  this._drawRankingScreen(ctx);
        if (this.state === "rules")    this._drawRulesScreen(ctx);
        if (this.state === "controls") this._drawControlsScreen(ctx);

        ctx.restore();
    },

    _drawBackground(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#0a1428");
        grad.addColorStop(1, "#03060f");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Grid neon scrolling
        ctx.strokeStyle = "rgba(0, 217, 255, 0.10)";
        ctx.lineWidth   = 1;
        const gridSize = 50;
        for (let x = 0; x <= w; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = -gridSize + this.bgOffset; y <= h; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Estrelas
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        for (let i = 0; i < 70; i++) {
            const sx = (i * 137.5) % w;
            const sy = (i * 71 + this.bgOffset * 1.5) % h;
            const size = i % 7 === 0 ? 2 : 1;
            ctx.fillRect(sx, sy, size, size);
        }

        // Linhas de zona (durante gameplay)
        if (this.state === "playing" || this.state === "paused" || this.state === "leveltransition") {
            // Linha de segurança (somente nível 3+)
            if (this._supportsUnshieldedFallback()) {
                const safetyY = this._safetyLineY();
                ctx.strokeStyle = "rgba(255, 225, 74, 0.20)";
                ctx.setLineDash([4, 8]);
                ctx.beginPath();
                ctx.moveTo(0, safetyY);
                ctx.lineTo(w, safetyY);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "rgba(255, 225, 74, 0.45)";
                ctx.font      = '10px "Courier New", monospace';
                ctx.textAlign = "left";
                ctx.fillText("// LINHA DE SEGURANÇA", 12, safetyY - 6);
            }

            // Zona crítica
            const dangerY = this._dangerLineY();
            ctx.strokeStyle = "rgba(255, 46, 136, 0.30)";
            ctx.setLineDash([8, 10]);
            ctx.beginPath();
            ctx.moveTo(0, dangerY);
            ctx.lineTo(w, dangerY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(255, 46, 136, 0.55)";
            ctx.font      = '10px "Courier New", monospace';
            ctx.textAlign = "left";
            ctx.fillText("// ZONA CRÍTICA", 12, dangerY - 6);
        }
    },

    _drawFloatTexts(ctx) {
        for (const f of this.floatTexts) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, f.life);
            ctx.fillStyle   = f.color;
            ctx.shadowColor = f.color;
            ctx.shadowBlur  = 12;
            ctx.font        = 'bold 18px "Courier New", monospace';
            ctx.textAlign   = "center";
            ctx.fillText(f.text, f.x, f.y);
            ctx.restore();
        }
    },

    _drawPowerupIndicators(ctx) {
        const items = [];
        if (this.player.shieldTime > 0) {
            items.push({ label: "ESCUDO",     time: this.player.shieldTime,     max: 8,  color: "#00D9FF" });
        }
        if (this.player.doubleShotTime > 0) {
            items.push({ label: "TIRO DUPLO", time: this.player.doubleShotTime, max: 12, color: "#00FFCC" });
        }
        // NOVO: indicador temporário/permanente da Guarda Lógica.
        if (this.player.logicGuardTime > 0) {
            items.push({ label: "GUARDA", time: this.player.logicGuardTime, max: 14, color: "#ffe14a" });
        }
        if (this.player.logicGuardCharges > 0) {
            items.push({ label: `GUARDA x${this.player.logicGuardCharges}`, time: null, max: 1, color: "#ffe14a" });
        }

        const permanent = this.player.getPermanentUpgradeLabels ? this.player.getPermanentUpgradeLabels() : [];
        if (items.length === 0 && permanent.length === 0) return;

        const baseX = 14;
        let baseY = this.canvas.height - 14;

        ctx.save();
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];

            ctx.fillStyle   = "rgba(10, 20, 40, 0.85)";
            ctx.fillRect(baseX, baseY - 22, 152, 22);

            ctx.strokeStyle = it.color;
            ctx.lineWidth   = 1;
            ctx.strokeRect(baseX, baseY - 22, 152, 22);

            ctx.fillStyle    = it.color;
            ctx.shadowColor  = it.color;
            ctx.shadowBlur   = 8;
            ctx.font         = 'bold 11px "Courier New", monospace';
            ctx.textAlign    = "left";
            ctx.textBaseline = "middle";
            const text = it.time === null ? it.label : `${it.label} ${it.time.toFixed(1)}s`;
            ctx.fillText(text, baseX + 8, baseY - 11);

            // Barra de progresso para timers; carga permanente não precisa barra.
            if (it.time !== null) {
                ctx.shadowBlur = 0;
                ctx.fillStyle  = "rgba(10, 20, 40, 0.85)";
                ctx.fillRect(baseX, baseY - 4, 152, 4);
                ctx.fillStyle  = it.color;
                ctx.fillRect(baseX, baseY - 4, 152 * (it.time / it.max), 4);
            }

            baseY -= 32;
        }

        // NOVO: badges compactas dos upgrades permanentes instalados.
        if (permanent.length > 0) {
            let x = baseX;
            const y = baseY - 20;
            for (const badge of permanent) {
                const bw = Math.max(82, 18 + badge.label.length * 8);
                ctx.fillStyle = "rgba(10, 20, 40, 0.88)";
                ctx.fillRect(x, y, bw, 22);
                ctx.strokeStyle = badge.color;
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, bw, 22);
                ctx.fillStyle = badge.color;
                ctx.shadowColor = badge.color;
                ctx.shadowBlur = 6;
                ctx.font = 'bold 10px "Courier New", monospace';
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(`PERM ${badge.label}`, x + bw / 2, y + 11);
                x += bw + 8;
            }
        }
        ctx.restore();
    },

    _drawSessionNotice(ctx) {
        if (this.sessionNoticeTimer <= 0 || !this.sessionNotice) return;

        const w = this.canvas.width;
        const alpha = Math.min(1, this.sessionNoticeTimer / 0.35);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = "rgba(3, 6, 15, 0.82)";
        ctx.strokeStyle = this.sessionNoticeColor;
        ctx.lineWidth   = 1.5;
        ctx.shadowColor = this.sessionNoticeColor;
        ctx.shadowBlur  = 18;
        ctx.fillRect(w / 2 - 240, 24, 480, 34);
        ctx.strokeRect(w / 2 - 240, 24, 480, 34);

        ctx.fillStyle    = this.sessionNoticeColor;
        ctx.font         = 'bold 15px "Courier New", monospace';
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.sessionNotice, w / 2, 41);
        ctx.restore();
    },

    _drawAssistModeBadge(ctx) {
        if (!this.assistMode) return;

        const x = this.canvas.width - 222;
        const y = 18;
        const w = 202;
        const h = 42;

        ctx.save();
        ctx.fillStyle = "rgba(10, 20, 40, 0.86)";
        ctx.strokeStyle = "#00FFCC";
        ctx.lineWidth = 1.4;
        ctx.shadowColor = "#00FFCC";
        ctx.shadowBlur = 14;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        ctx.shadowBlur = 0;
        ctx.fillStyle = "#00FFCC";
        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("MODO ASSISTIDO", x + w / 2, y + 15);
        ctx.fillStyle = "rgba(230, 237, 247, 0.72)";
        ctx.font = '10px "Courier New", monospace';
        ctx.fillText("mire nas naves com ALVO", x + w / 2, y + 31);
        ctx.restore();
    },

    _drawUnshieldedPrompt(ctx) {
        if (!this._supportsUnshieldedFallback()) return;
        const count = this.spawner.getUnshieldedEnemies().length;
        if (count === 0) return;

        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.save();
        ctx.fillStyle   = "rgba(28, 8, 8, 0.78)";
        ctx.strokeStyle = "#ffb347";
        ctx.lineWidth   = 1.5;
        ctx.shadowColor = "#ff6f61";
        ctx.shadowBlur  = 16;
        ctx.fillRect(w / 2 - 305, h - 112, 610, 42);
        ctx.strokeRect(w / 2 - 305, h - 112, 610, 42);

        ctx.fillStyle    = "#ffe14a";
        ctx.font         = 'bold 14px "Courier New", monospace';
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
            `ESCUDOS DESPROGRAMADOS — pressione [E] para eliminar (${count})`,
            w / 2, h - 91
        );
        ctx.restore();
    },

    /**
     * Overlay de slowmo. Usa fade-in rápido (0.35s), hold, e fade-out
     * proporcional ao restante do timer — bug do alpha original (sin curve)
     * deixava a mensagem invisível no início.
     */
    _drawSlowmoOverlay(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Tinta azul cyber (mais transparente para não cegar)
        ctx.fillStyle = "rgba(0, 217, 255, 0.06)";
        ctx.fillRect(0, 0, w, h);

        // Fade-in (primeiros 0.35s) e fade-out (últimos 0.6s)
        const elapsed = this.slowmoDuration - this.slowmoTimer;
        const fadeIn  = Math.min(1, elapsed / 0.35);
        const fadeOut = Math.min(1, this.slowmoTimer / 0.6);
        const alpha   = Math.min(fadeIn, fadeOut);

        ctx.save();
        ctx.globalAlpha = alpha;

        const isFinal      = this.slowmoMessage.includes("FINAL");
        const isImpossible = this.slowmoMessage.includes("RECALIBRANDO");
        const color = isFinal      ? "#FF2E88"
                    : isImpossible ? "#ffe14a"
                    :                "#00D9FF";

        ctx.fillStyle    = color;
        ctx.shadowColor  = color;
        ctx.shadowBlur   = 30;
        ctx.font         = 'bold 38px "Courier New", monospace';
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.slowmoMessage, w / 2, h / 2 - 60);

        // Nova expressão BEM grande
        ctx.font        = 'bold 52px "Courier New", monospace';
        ctx.fillStyle   = "#ffe14a";
        ctx.shadowColor = "#ffe14a";
        ctx.shadowBlur  = 38;
        ctx.fillText(Logic.displayExpression(this.expression), w / 2, h / 2 + 14);

        ctx.font       = '14px "Courier New", monospace';
        ctx.fillStyle  = "rgba(230, 237, 247, 0.8)";
        ctx.shadowBlur = 0;
        ctx.fillText(
            `tempo desacelerado · ${this.slowmoTimer.toFixed(1)}s para recalcular`,
            w / 2, h / 2 + 70
        );
        ctx.restore();
    },

    // NOVO: overlay visual do mini-jogo de lógica para upgrade permanente.
    _drawUpgradeChallengeOverlay(ctx) {
        const ch = this.upgradeChallenge;
        if (!ch) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const layout = this._upgradeChallengeLayout();
        const { boxX, boxY, boxW, boxH } = layout;
        const color = ch.def.color || "#ffe14a";
        const centerX = boxX + boxW / 2;

        ctx.fillStyle = "rgba(3, 6, 15, 0.86)";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.fillStyle   = "rgba(10, 20, 40, 0.96)";
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 26;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
        ctx.restore();

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle    = color;
        ctx.shadowColor  = color;
        ctx.shadowBlur   = 20;
        ctx.font         = 'bold 18px "Courier New", monospace';
        ctx.fillText("// MINI-JOGO DE UPGRADE PERMANENTE", centerX, boxY + 34);

        ctx.font         = 'bold 34px "Courier New", monospace';
        ctx.fillText(`${ch.def.icon || "?"} ${ch.def.name}`, centerX, boxY + 78);

        ctx.shadowBlur = 0;
        ctx.fillStyle  = "rgba(230, 237, 247, 0.82)";
        ctx.font       = '13px "Courier New", monospace';
        this._drawWrappedText(ctx, ch.def.description, centerX, boxY + 112, boxW - 120, 16, {
            align: "center",
            maxLines: 2
        });

        ctx.fillStyle = "#e6edf7";
        ctx.font      = 'bold 15px "Courier New", monospace';
        ctx.fillText("Escolha um pacote de valores que torne a sentença VERDADEIRA:", centerX, boxY + 166);

        ctx.fillStyle    = "#ffe14a";
        ctx.shadowColor  = "#ffe14a";
        ctx.shadowBlur   = 18;
        ctx.font         = 'bold 42px "Courier New", monospace';
        ctx.fillText(Logic.displayExpression(ch.expr), centerX, boxY + 216);

        ctx.font = '12px "Courier New", monospace';
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(230, 237, 247, 0.68)";
        this._drawWrappedText(ctx, `Temporário se errar/ignorar: ${ch.def.temporaryEffect}`, centerX, boxY + 258, boxW - 130, 16, {
            align: "center",
            maxLines: 2
        });
        ctx.fillStyle = "rgba(0, 255, 204, 0.78)";
        this._drawWrappedText(ctx, `Permanente se escolher um pacote verdadeiro: ${ch.def.permanentEffect}`, centerX, boxY + 294, boxW - 130, 16, {
            align: "center",
            maxLines: 2
        });

        // Timer
        const barX = boxX + 100;
        const barY = boxY + 346;
        const barW = boxW - 200;
        ctx.fillStyle = "rgba(3, 6, 15, 0.95)";
        ctx.fillRect(barX, barY, barW, 8);
        ctx.strokeStyle = "rgba(230, 237, 247, 0.30)";
        ctx.strokeRect(barX, barY, barW, 8);
        ctx.fillStyle = ch.timer <= 3 ? "#FF2E88" : color;
        ctx.fillRect(barX, barY, barW * (ch.timer / ch.maxTimer), 8);
        ctx.fillStyle = "rgba(230, 237, 247, 0.7)";
        ctx.font = '11px "Courier New", monospace';
        ctx.fillText(`tempo: ${ch.timer.toFixed(1)}s`, centerX, barY + 26);

        ctx.restore();

        const rects = layout;
        for (let i = 0; i < ch.options.length; i++) {
            const option = ch.options[i];
            const label = this._formatChallengeOption(option.vars, ch.usedVars);
            this._drawButton(ctx, rects.optionBtns[i], label, ch.selectedIndex === i && !ch.resolved, "#00D9FF");
        }

        ctx.save();
        ctx.textAlign = "center";
        ctx.font = '12px "Courier New", monospace';
        ctx.fillStyle = "rgba(230, 237, 247, 0.55)";
        ctx.fillText("↑/↓ alterna · ENTER confirma · ESC ignora", centerX, boxY + boxH - 24);

        if (ch.resolved) {
            ctx.fillStyle = "rgba(3, 6, 15, 0.76)";
            ctx.fillRect(boxX, boxY, boxW, boxH);
            ctx.strokeStyle = ch.feedbackColor;
            ctx.lineWidth = 2;
            ctx.shadowColor = ch.feedbackColor;
            ctx.shadowBlur = 28;
            ctx.strokeRect(boxX + 24, boxY + 160, boxW - 48, 122);
            ctx.fillStyle = ch.feedbackColor;
            ctx.font = 'bold 34px "Courier New", monospace';
            ctx.textBaseline = "middle";
            ctx.fillText(ch.feedbackText, centerX, boxY + 220);
            ctx.font = '14px "Courier New", monospace';
            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(230, 237, 247, 0.82)";
            const correctOption = ch.options.find(option => option.isCorrect);
            const correctText = correctOption
                ? this._formatChallengeOption(correctOption.vars, ch.usedVars)
                : "sem pacote disponível";
            ctx.fillText(`Um pacote verdadeiro: ${correctText}`, centerX, boxY + 258);
        }
        ctx.restore();
    },

    _drawTransitionOverlay(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = "rgba(0, 255, 204, 0.05)";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.fillStyle    = "#00FFCC";
        ctx.shadowColor  = "#00FFCC";
        ctx.shadowBlur   = 30;
        ctx.font         = 'bold 48px "Courier New", monospace';
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.transitionMessage, w / 2, h / 2 - 30);

        ctx.font       = '16px "Courier New", monospace';
        ctx.fillStyle  = "rgba(230, 237, 247, 0.85)";
        ctx.shadowBlur = 0;
        ctx.fillText(`Iniciando NÍVEL ${this.level + 1}…`, w / 2, h / 2 + 24);
        ctx.fillText(`Pontuação: ${this.score}`,           w / 2, h / 2 + 50);
        ctx.restore();
    },

    _drawCampaignCheckpointOverlay(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = "rgba(3, 6, 15, 0.88)";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle    = "#00FFCC";
        ctx.shadowColor  = "#00FFCC";
        ctx.shadowBlur   = 30;
        ctx.font         = 'bold 42px "Courier New", monospace';
        ctx.fillText("PRIMEIRA PARTE FINALIZADA", w / 2, h / 2 - 150);

        ctx.shadowBlur = 0;
        ctx.fillStyle  = "rgba(230, 237, 247, 0.9)";
        ctx.font       = '16px "Courier New", monospace';
        ctx.fillText("Você concluiu os 3 primeiros níveis da campanha.", w / 2, h / 2 - 98);

        ctx.fillStyle = this.assistMode ? "#ffe14a" : "#00D9FF";
        ctx.fillText(
            this.assistMode
                ? "Modo assistido: pontuação não entra no ranking."
                : "Pontuação registrada no ranking da primeira parte.",
            w / 2,
            h / 2 - 68
        );

        ctx.fillStyle = "rgba(230, 237, 247, 0.82)";
        ctx.fillText(
            `Pontuação: ${this.score}  ·  Tempo: ${this._formatRankingTime(this.campaignTimeSeconds)}  ·  Próximo nível: ${this.level + 1}`,
            w / 2,
            h / 2 - 38
        );
        ctx.restore();

        const items = this._campaignCheckpointItems();
        const rects = this._menuRects(items.length, true);
        for (let i = 0; i < items.length; i++) {
            this._drawButton(ctx, rects[i], items[i].label, this.campaignCheckpointIndex === i, i === 0 ? "#00FFCC" : "#FF5F8F");
        }

        ctx.save();
        ctx.fillStyle = "rgba(230, 237, 247, 0.45)";
        ctx.font      = '12px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.fillText("↑ ↓ + ENTER para escolher · ESC para parar", w / 2, h - 32);
        ctx.restore();
    },


    /* ============================================================
       Render: Menu inicial
       ============================================================ */
    _drawMenu(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = "rgba(3, 6, 15, 0.65)";
        ctx.fillRect(0, 0, w, h);

        const titleY = h / 2 - 178;
        const pulse  = 0.85 + 0.15 * Math.sin(performance.now() / 600);

        ctx.save();
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";

        ctx.font         = 'bold 88px "Courier New", monospace';
        ctx.fillStyle    = "#00D9FF";
        ctx.shadowColor  = "#00D9FF";
        ctx.shadowBlur   = 46 * pulse;
        ctx.fillText("LOGIC", w / 2, titleY);

        ctx.font         = 'bold 92px "Courier New", monospace';
        ctx.fillStyle    = "#00FFCC";
        ctx.shadowColor  = "#00FFCC";
        ctx.shadowBlur   = 52 * pulse;
        ctx.fillText("INVADERS", w / 2, titleY + 86);

        ctx.font        = 'bold 15px "Courier New", monospace';
        ctx.fillStyle   = "rgba(230, 237, 247, 0.65)";
        ctx.shadowBlur  = 0;
        ctx.fillText("// PROPOSITIONAL.LOGIC.COMBAT.SYSTEM", w / 2, titleY + 138);
        ctx.restore();

        const items = this._menuItems();
        const rects = this._menuRects(items.length);
        for (let i = 0; i < items.length; i++) {
            this._drawButton(ctx, rects[i], items[i].label, this.menuIndex === i, "#00FFCC");
        }

        this._drawRankingPreview(ctx);

        if (this.lastEnteredName) {
            ctx.save();
            ctx.fillStyle = "rgba(0, 255, 204, 0.72)";
            ctx.font      = '13px "Courier New", monospace';
            ctx.textAlign = "center";
            ctx.fillText(`último piloto: ${this.lastEnteredName}`, w / 2, h / 2 + 28);
            ctx.restore();
        }
    },

    _drawRankingPreview(ctx) {
        const entries = this._sortedRankingEntries().slice(0, 3);
        const x = this.canvas.width - 320;
        const y = 160;
        const w = 250;
        const h = 150;

        ctx.save();
        ctx.fillStyle   = "rgba(10, 20, 40, 0.8)";
        ctx.strokeStyle = "#FF5F8F";
        ctx.lineWidth   = 1.2;
        ctx.shadowColor = "#FF5F8F";
        ctx.shadowBlur  = 14;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        ctx.shadowBlur = 0;
        ctx.fillStyle  = "#FF5F8F";
        ctx.font       = 'bold 16px "Courier New", monospace';
        ctx.textAlign  = "left";
        ctx.fillText("// TOP RANKING", x + 14, y + 24);

        ctx.font = '13px "Courier New", monospace';
        if (entries.length === 0) {
            ctx.fillStyle = "rgba(230, 237, 247, 0.18)";
            ctx.fillRect(x + 14, y + 48, w - 28, 1);
        } else {
            entries.forEach((entry, index) => {
                const lineY = y + 58 + index * 28;
                ctx.fillStyle = index === 0 ? "#ffe14a" : "#e6edf7";
                ctx.fillText(`${index + 1}. ${entry.name}`, x + 14, lineY);
                ctx.fillStyle = "#00D9FF";
                ctx.textAlign = "right";
                ctx.fillText(`${entry.score} pts · ${this._formatRankingTime(entry.timeSeconds)}`, x + w - 14, lineY);
                ctx.textAlign = "left";
            });
        }
        ctx.restore();
    },

    _drawRankingScreen(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = "rgba(3, 6, 15, 0.93)";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.textAlign    = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font         = 'bold 34px "Courier New", monospace';
        ctx.fillStyle    = "#FF5F8F";
        ctx.shadowColor  = "#FF5F8F";
        ctx.shadowBlur   = 18;
        ctx.fillText("// RANKING DOS PILOTOS", 60, 78);
        ctx.shadowBlur = 0;

        ctx.font      = '14px "Courier New", monospace';
        ctx.fillStyle = "rgba(230, 237, 247, 0.72)";
        ctx.fillText("Entram apenas pilotos que concluíram os 3 primeiros níveis.", 60, 112);
        ctx.fillText(this.rankingStatus, 60, 134);

        const sortButton = this._rankingSortBtnRect();
        const nextSortLabel = this.rankingSortMode === "score" ? "ORDENAR: TEMPO" : "ORDENAR: PONTOS";
        this._drawButton(ctx, sortButton, nextSortLabel, this._pointInRect(this.mouseX, this.mouseY, sortButton), "#00FFCC");

        ctx.font      = '13px "Courier New", monospace';
        ctx.fillStyle = this.rankingSortMode === "score" ? "#00D9FF" : "#00FFCC";
        ctx.fillText(
            this.rankingSortMode === "score"
                ? "Classificação atual: maior pontuação, menor tempo em empate."
                : "Classificação atual: menor tempo, maior pontuação em empate.",
            60,
            156
        );

        const tableX = 80;
        const tableY = 182;
        const tableW = w - 160;
        const rowH   = 46;
        const entries = this._sortedRankingEntries();

        ctx.strokeStyle = "#1f3559";
        ctx.fillStyle   = "rgba(10, 20, 40, 0.72)";
        ctx.fillRect(tableX, tableY, tableW, rowH);
        ctx.strokeRect(tableX, tableY, tableW, rowH);

        ctx.fillStyle = "#00D9FF";
        ctx.font      = 'bold 15px "Courier New", monospace';
        ctx.fillText("POS",    tableX +  20, tableY + 29);
        ctx.fillText("PILOTO", tableX + 100, tableY + 29);
        ctx.fillText("NÍVEL",  tableX + 520, tableY + 29);
        ctx.fillText("PTS",    tableX + 630, tableY + 29);
        ctx.fillText("TEMPO",  tableX + 730, tableY + 29);
        ctx.fillText("DATA",   tableX + 850, tableY + 29);

        if (entries.length === 0) {
            ctx.fillStyle = "rgba(230, 237, 247, 0.65)";
            ctx.font      = '15px "Courier New", monospace';
            ctx.fillText("Nenhuma primeira parte concluída ainda.", tableX + 20, tableY + 88);
        } else {
            entries.forEach((entry, index) => {
                const rowY = tableY + rowH + index * rowH;
                ctx.fillStyle   = index % 2 === 0 ? "rgba(10, 20, 40, 0.56)" : "rgba(6, 12, 24, 0.72)";
                ctx.strokeStyle = "rgba(31, 53, 89, 0.7)";
                ctx.fillRect(tableX, rowY, tableW, rowH);
                ctx.strokeRect(tableX, rowY, tableW, rowH);

                ctx.font = '14px "Courier New", monospace';
                ctx.fillStyle = index === 0 ? "#ffe14a" : "#e6edf7";
                ctx.fillText(`${index + 1}`,    tableX +  20, rowY + 29);
                ctx.fillText(entry.name,        tableX + 100, rowY + 29);
                ctx.fillStyle = "#00FFCC";
                ctx.fillText(`${entry.level}`,  tableX + 520, rowY + 29);
                ctx.fillStyle = "#00D9FF";
                ctx.fillText(`${entry.score}`,  tableX + 630, rowY + 29);
                ctx.fillStyle = "#ffe14a";
                ctx.fillText(this._formatRankingTime(entry.timeSeconds), tableX + 730, rowY + 29);
                ctx.fillStyle = "rgba(230, 237, 247, 0.76)";
                ctx.fillText(entry.date || "-", tableX + 850, rowY + 29);
            });
        }
        ctx.restore();

        const back = this._backBtnRect();
        const isHover = this._pointInRect(this.mouseX, this.mouseY, back);
        this._drawButton(ctx, back, "◀ VOLTAR", isHover, "#00D9FF");
    },


    /* ============================================================
       Render: Pause
       ============================================================ */
    _drawPauseOverlay(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = "rgba(3, 6, 15, 0.85)";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.font         = 'bold 60px "Courier New", monospace';
        ctx.fillStyle    = "#ffe14a";
        ctx.shadowColor  = "#ffe14a";
        ctx.shadowBlur   = 30;
        ctx.fillText("|| PAUSA", w / 2, h / 2 - 130);

        ctx.font         = '12px "Courier New", monospace';
        ctx.fillStyle    = "rgba(230, 237, 247, 0.6)";
        ctx.shadowBlur   = 0;
        ctx.fillText(
            `Nível ${this.level} · Pontos: ${this.score} · Vidas: ${this.lives} · Pausas: ${this.pauseUses}/${this.PAUSE_LIMIT}`,
            w / 2, h / 2 - 90
        );
        ctx.restore();

        const items = this._pauseMenuItems();
        const rects = this._menuRects(items.length, true);
        for (let i = 0; i < items.length; i++) {
            this._drawButton(ctx, rects[i], items[i].label, this.pauseMenuIndex === i, "#00D9FF");
        }

        ctx.save();
        ctx.fillStyle = "rgba(230, 237, 247, 0.45)";
        ctx.font      = '12px "Courier New", monospace';
        ctx.textAlign = "center";
        ctx.fillText(
            `ESC retoma · Pausas ${this.pauseUses}/${this.PAUSE_LIMIT} · ↑ ↓ + ENTER`,
            w / 2, h - 32
        );
        ctx.restore();
    },


    /* ============================================================
       Render: Regras
       ============================================================ */
    _drawRulesScreen(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = "rgba(3, 6, 15, 0.92)";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.textAlign    = "left";
        ctx.textBaseline = "alphabetic";

        ctx.font        = 'bold 34px "Courier New", monospace';
        ctx.fillStyle   = "#ffe14a";
        ctx.shadowColor = "#ffe14a";
        ctx.shadowBlur  = 18;
        ctx.fillText("// REGRAS DO COMBATE LÓGICO", 60, 70);
        ctx.shadowBlur = 0;

        const leftX = 60;
        const leftW = 500;
        const rightX = 625;
        const rightW = 420;
        let y = 120;
        let ry = 120;

        ctx.fillStyle = "#00FFCC";
        ctx.font      = 'bold 18px "Courier New", monospace';
        ctx.fillText("OPERADORES PROPOSICIONAIS:", leftX, y);
        y += 30;

        const ops = [
            { sym: "∧", name: "Conjunção", desc: "verdadeira só se ambas as proposições forem verdadeiras" },
            { sym: "∨", name: "Disjunção", desc: "verdadeira se pelo menos uma proposição for verdadeira" },
            { sym: "¬", name: "Negação",   desc: "inverte o valor lógico da proposição" }
        ];
        ctx.font = '14px "Courier New", monospace';
        ops.forEach(o => {
            ctx.fillStyle = "#00D9FF";
            ctx.font = 'bold 20px "Courier New", monospace';
            ctx.fillText(o.sym, leftX + 20, y + 2);
            ctx.fillStyle = "#e6edf7";
            ctx.font = '14px "Courier New", monospace';
            y = this._drawWrappedText(ctx, `${o.name}: ${o.desc}`, leftX + 70, y, leftW - 80, 17, {
                hangingIndent: 0,
                maxLines: 2
            }) + 6;
        });

        y += 10;
        ctx.fillStyle = "#00FFCC";
        ctx.font      = 'bold 18px "Courier New", monospace';
        ctx.fillText("MECÂNICA:", leftX, y);
        y += 26;

        const rules = [
            "• Cada inimigo tem valores booleanos exibidos como [A:V] [B:F].",
            "• Uma sentença lógica aparece no topo (ex.: A ∧ ¬B).",
            "• Ao concluir o nível 3, a primeira parte termina e você escolhe continuar ou parar.",
            "• Atire APENAS em inimigos que tornam a sentença VERDADEIRA.",
            "• Acerto certo: +10 pts, inimigo é destruído.",
            "• Acerto errado: -1 vida.",
            "• Inimigo falso que cruza a zona crítica: +10 pts (evasão correta).",
            "• Inimigo verdadeiro que cruza a zona crítica: -1 vida.",
            "• Você começa com 5 vidas e pode pausar no máximo 2 vezes por partida.",
            "• A sentença troca a cada 5 inimigos derrotados, com slow-motion.",
            "• Modo assistido sinaliza naves corretas com ALVO, mas não registra ranking.",
            "• Item PERM: no modo normal, escolha um pacote verdadeiro; no assistido, instala direto.",
            "• As fases extras 4, 5 e 6 não têm aprimoramento fixo de fase.",
            "• Só entra no ranking quem completar os 3 primeiros níveis.",
            "• O ranking pode ser classificado por pontuação ou por menor tempo.",
            "• Do nível 3 em diante, naves abaixo da linha de segurança perdem o escudo lógico e podem ser limpas com [E]."
        ];
        ctx.font      = '13px "Courier New", monospace';
        ctx.fillStyle = "#e6edf7";
        rules.forEach(r => {
            y = this._drawWrappedText(ctx, r, leftX + 20, y, leftW - 20, 15, {
                hangingIndent: 18,
                maxLines: 2
            }) + 3;
        });

        ctx.fillStyle = "#00FFCC";
        ctx.font      = 'bold 18px "Courier New", monospace';
        ctx.fillText("POWER-UPS COMUNS:", rightX, ry);
        ry += 28;

        const commonPowerups = [
            { color: "#00D9FF", text: "◈ ESCUDO — absorve 1 hit por 8s" },
            { color: "#00FFCC", text: "≫ TIRO DUPLO — 2 projéteis por 12s" },
            { color: "#FF5F8F", text: "♥ CORAÇÃO — recupera 1 vida" },
            { color: "#ffe14a", text: "◆ PERM — abre desafio de upgrade" }
        ];
        ctx.font = '13px "Courier New", monospace';
        commonPowerups.forEach(item => {
            ctx.fillStyle = item.color;
            ry = this._drawWrappedText(ctx, item.text, rightX + 18, ry, rightW - 18, 17, {
                hangingIndent: 16,
                maxLines: 2
            }) + 3;
        });

        ry += 18;
        ctx.fillStyle = "#00FFCC";
        ctx.font      = 'bold 18px "Courier New", monospace';
        ctx.fillText("UPGRADES FIXOS POR FASE (1-3):", rightX, ry);
        ry += 30;

        const phaseUpgrades = [
            {
                color: "#00D9FF",
                title: "FASE 1 — Firewall de Boot",
                temp:  "Temporário: escudo comum por 8s.",
                perm:  "Permanente: escudo de 5s no início das fases."
            },
            {
                color: "#00FFCC",
                title: "FASE 2 — Compilador Paralelo",
                temp:  "Temporário: tiro duplo por 12s.",
                perm:  "Permanente: tiro mais rápido, 0.26s → 0.22s."
            },
            {
                color: "#ffe14a",
                title: "FASE 3 — Cache de Inferência",
                temp:  "Temporário: absorve 1 erro lógico por até 14s.",
                perm:  "Permanente: absorve 1 erro lógico por fase."
            }
        ];

        phaseUpgrades.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.font = 'bold 13px "Courier New", monospace';
            ry = this._drawWrappedText(ctx, item.title, rightX + 18, ry, rightW - 18, 16, {
                maxLines: 2
            }) + 2;
            ctx.fillStyle = "#e6edf7";
            ctx.font = '12px "Courier New", monospace';
            ry = this._drawWrappedText(ctx, item.temp, rightX + 34, ry, rightW - 34, 15, {
                hangingIndent: 12,
                maxLines: 2
            }) + 1;
            ry = this._drawWrappedText(ctx, item.perm, rightX + 34, ry, rightW - 34, 15, {
                hangingIndent: 12,
                maxLines: 2
            }) + 12;
        });

        ctx.restore();

        const back = this._backBtnRect();
        const isHover = this._pointInRect(this.mouseX, this.mouseY, back);
        this._drawButton(ctx, back, "◀ VOLTAR", isHover, "#00D9FF");
    },


    /* ============================================================
       Render: Controles
       ============================================================ */
    _drawControlsScreen(ctx) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = "rgba(3, 6, 15, 0.92)";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.textAlign    = "left";
        ctx.textBaseline = "alphabetic";

        ctx.font        = 'bold 34px "Courier New", monospace';
        ctx.fillStyle   = "#ffe14a";
        ctx.shadowColor = "#ffe14a";
        ctx.shadowBlur  = 18;
        ctx.fillText("// CONTROLES", 60, 80);
        ctx.shadowBlur = 0;

        const controls = [
            { keys: "← →   ou   A D",  action: "Mover a nave" },
            { keys: "ESPAÇO",           action: "Atirar" },
            { keys: "ESC",              action: "Pausar / fechar telas; no mini-jogo, ignorar" },
            { keys: "E",                action: "Eliminar naves sem escudo" },
            { keys: "↑ ↓   ou   W S",   action: "Navegar menus / alternar resposta do mini-jogo" },
            { keys: "ENTER",            action: "Confirmar seleção / resposta" },
            { keys: "MOUSE",            action: "Hover + click nos botões" }
        ];

        let y = 150;
        const lineH  = 50;
        ctx.font = '17px "Courier New", monospace';

        controls.forEach(c => {
            ctx.fillStyle   = "#0d1a33";
            ctx.strokeStyle = "#00D9FF";
            ctx.lineWidth   = 1;
            ctx.fillRect(80, y - 22, 280, 32);
            ctx.strokeRect(80, y - 22, 280, 32);

            ctx.fillStyle = "#00D9FF";
            ctx.fillText(c.keys, 96, y);

            ctx.fillStyle = "#e6edf7";
            ctx.fillText(c.action, 390, y);
            y += lineH;
        });

        ctx.fillStyle = "rgba(230, 237, 247, 0.55)";
        ctx.font      = '13px "Courier New", monospace';
        ctx.fillText("Dica: no modo normal, o item PERM abre um desafio lógico; no assistido, instala direto.", 80, y + 10);
        ctx.restore();

        const back = this._backBtnRect();
        const isHover = this._pointInRect(this.mouseX, this.mouseY, back);
        this._drawButton(ctx, back, "◀ VOLTAR", isHover, "#00D9FF");
    },


    /* ============================================================
       Helper: botão
       ============================================================ */
    _drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, options = {}) {
        const align = options.align || ctx.textAlign || "left";
        const hangingIndent = options.hangingIndent || 0;
        const maxLines = options.maxLines || Infinity;
        const originalAlign = ctx.textAlign;
        const originalBaseline = ctx.textBaseline;
        const words = String(text || "").split(/\s+/).filter(Boolean);
        const lines = [];
        let line = "";
        let didTruncate = false;

        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            const lineMaxWidth = maxWidth - (lines.length > 0 ? hangingIndent : 0);
            if (line && ctx.measureText(candidate).width > lineMaxWidth) {
                lines.push(line);
                line = word;
                if (lines.length >= maxLines) {
                    didTruncate = true;
                    break;
                }
            } else {
                line = candidate;
            }
        }

        if (line && lines.length < maxLines) lines.push(line);

        if (didTruncate && lines.length === maxLines) {
            let last = lines[lines.length - 1];
            const lastMaxWidth = maxWidth - (lines.length > 1 ? hangingIndent : 0);
            while (last.length > 1 && ctx.measureText(`${last}...`).width > lastMaxWidth) {
                last = last.slice(0, -1).trimEnd();
            }
            lines[lines.length - 1] = `${last}...`;
        }

        ctx.textAlign = align;
        ctx.textBaseline = "alphabetic";

        lines.forEach((content, index) => {
            const lineX = align === "left" ? x + (index > 0 ? hangingIndent : 0) : x;
            ctx.fillText(content, lineX, y + index * lineHeight);
        });

        ctx.textAlign = originalAlign;
        ctx.textBaseline = originalBaseline;
        return y + Math.max(lines.length, 1) * lineHeight;
    },

    _drawButton(ctx, r, label, isHover, color) {
        ctx.save();

        if (isHover) {
            ctx.shadowColor = color;
            ctx.shadowBlur  = 22;
            ctx.fillStyle   = color;
            ctx.globalAlpha = 0.18;
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = "rgba(10, 20, 40, 0.7)";
            ctx.fillRect(r.x, r.y, r.w, r.h);
        }

        ctx.shadowColor = color;
        ctx.shadowBlur  = isHover ? 18 : 8;
        ctx.strokeStyle = color;
        ctx.lineWidth   = isHover ? 2 : 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);

        ctx.fillStyle    = isHover ? "#ffffff" : color;
        ctx.font         = 'bold 17px "Courier New", monospace';
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);

        ctx.restore();
    },


    /* ============================================================
       HUD / Console
       ============================================================ */
    _refreshHud() {
        if (!this.hud) return;

        if (this.hud.expression) this.hud.expression.textContent = this.expression ? Logic.displayExpression(this.expression) : "—";
        if (this.hud.score)      this.hud.score.textContent      = this.score;
        if (this.hud.level)      this.hud.level.textContent      = this.level;
        if (this.hud.lives) {
            this.hud.lives.textContent = "♥".repeat(Math.max(0, this.lives)) || "—";
        }

        const total = this.totalEnemiesThisLevel;
        const done  = this.enemiesKilledThisLevel;
        if (this.hud.progress) this.hud.progress.textContent = `${done}/${total}`;
        if (this.hud.progressFill) {
            const pct = Math.min(100, (done / total) * 100);
            this.hud.progressFill.style.width = pct + "%";
        }

        if (this.hud.upgradeHistory) {
            const upgrades = this.player && this.player.getCollectedUpgradeLabels
                ? this.player.getCollectedUpgradeLabels()
                : [];
            this.hud.upgradeHistory.textContent = upgrades.length
                ? upgrades.map(u => u.label).join(" · ")
                : "—";
            this.hud.upgradeHistory.title = upgrades.length
                ? upgrades.map(u => u.title).join(" | ")
                : "Nenhum upgrade coletado nesta campanha";
        }
    },

    _log(msg, type) {
        if (!this.hud || !this.hud.log) return;
        const div = document.createElement("div");
        div.className   = `log-msg log-${type || "info"}`;
        div.textContent = `> ${msg}`;
        this.hud.log.appendChild(div);
        this.hud.log.scrollTop = this.hud.log.scrollHeight;
        while (this.hud.log.children.length > this.MAX_LOG_ENTRIES) {
            this.hud.log.removeChild(this.hud.log.firstChild);
        }
    },

    _clearLog() {
        if (this.hud && this.hud.log) this.hud.log.innerHTML = "";
    },

    _addFloat(text, x, y, color) {
        // Cap para evitar acúmulo se algo der errado
        if (this.floatTexts.length >= this.MAX_FLOAT_TEXTS) {
            this.floatTexts.shift();
        }
        this.floatTexts.push({ text, x, y, color, life: 1.2 });
    }
};


/* ============================================================
   Boot
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => Game.init());
