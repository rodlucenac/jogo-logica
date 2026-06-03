/* ============================================================
   logic.js  â€”  NÃºcleo de lÃ³gica proposicional
   ExpressÃµes organizadas por dificuldade.
   ============================================================ */

const Logic = {

    _poolForLevel(level) {
        if (level <= 1) {
            return this.expressionsByTier.easy;
        }
        if (level <= 3) {
            return [
                ...this.expressionsByTier.easy,
                ...this.expressionsByTier.medium
            ];
        }
        if (level <= 5) {
            return [
                ...this.expressionsByTier.medium,
                ...this.expressionsByTier.hard
            ];
        }
        return this.expressionsByTier.hard;
    },

    _pickRandom(pool) {
        return pool[Math.floor(Math.random() * pool.length)];
    },

    // Pool de expressões por dificuldade.
    expressionsByTier: {
        easy: [
            "(A && B)",
            "(A || B)",
            "(A && !B)",
            "(!A || B)",
            "(!A && B)"
        ],
        medium: [
            "(A && B) || C",
            "(!A && B) || C",
            "A && (B || C)",
            "(A || B) && C",
            "!A && (B || C)",
            "(A && !B) || C"
        ],
        hard: [
            "(A && !B) || (!A && B)",   // XOR
            "!(A && B)",
            "!(A || B)",
            "(A || B) && !C",
            "(A && B && C)",
            "(A || B) && (!B || C)",
            "(!A && !B) || C",
            "(A && B) || (!A && C)"
        ]
    },

    /**
     * Escolhe expressÃ£o considerando o nÃ­vel de dificuldade.
     * Quanto maior o nÃ­vel, mais complexo o pool.
     * @param {number} level
     * @returns {string}
     */
    pickByLevel(level) {
        return this._pickRandom(this._poolForLevel(level));
    },

    /**
     * Escolhe uma expressÃ£o vÃ¡lida para os inimigos elegÃ­veis na tela.
     * Se nÃ£o houver combinaÃ§Ã£o possÃ­vel, usa qualquer expressÃ£o do mesmo pool.
     * @param {number} level
     * @param {Array<{values:Object}>} enemies
     * @param {string} previousExpr
     * @returns {string}
     */
    pickValidExpression(level, enemies, previousExpr = "") {
        const pool = this._poolForLevel(level);
        const withoutPrevious = pool.filter(expr => expr !== previousExpr);
        const candidatePool = withoutPrevious.length > 0 ? withoutPrevious : pool;

        if (!Array.isArray(enemies) || enemies.length === 0) {
            return this._pickRandom(candidatePool);
        }

        const validPool = candidatePool.filter(expr => this.hasValidEnemy(expr, enemies));
        return this._pickRandom(validPool.length > 0 ? validPool : candidatePool);
    },

    /**
     * Avalia expressÃ£o para um conjunto de valores {A, B, C}.
     * Retorna boolean. Usa new Function (seguro: pool controlado).
     */
    evaluate(expr, vars) {
        try {
            const fn = new Function("A", "B", "C", "return " + expr + ";");
            return Boolean(fn(vars.A, vars.B, vars.C));
        } catch (err) {
            console.error("ExpressÃ£o invÃ¡lida:", expr, err);
            return false;
        }
    },

    /**
     * Gera valores aleatÃ³rios para um inimigo.
     * @returns {{A:boolean, B:boolean, C:boolean}}
     */
    randomEnemyValues() {
        return {
            A: Math.random() < 0.5,
            B: Math.random() < 0.5,
            C: Math.random() < 0.5
        };
    },

    /**
     * Gera todas as combinações possíveis para as variáveis usadas.
     * Variáveis fora da lista ficam falsas só para completar {A,B,C}.
     * @param {Array<"A"|"B"|"C">} usedVars
     * @returns {Array<{A:boolean, B:boolean, C:boolean}>}
     */
    combinationsForVars(usedVars) {
        const vars = Array.isArray(usedVars) && usedVars.length > 0
            ? usedVars
            : ["A", "B", "C"];
        const total = Math.pow(2, vars.length);
        const combos = [];

        for (let mask = 0; mask < total; mask++) {
            const values = { A: false, B: false, C: false };
            vars.forEach((name, index) => {
                values[name] = Boolean(mask & (1 << index));
            });
            combos.push(values);
        }

        return combos;
    },

    /**
     * Formata valores como string compacta para o console.
     * @returns {string}  ex.: "A=1, B=0, C=1"
     */
    formatVars(vars) {
        return `A=${vars.A?1:0}, B=${vars.B?1:0}, C=${vars.C?1:0}`;
    },

    /**
     * Converte a sintaxe interna em símbolos formais de lógica proposicional.
     * A expressão interna continua em JavaScript para avaliação.
     * @param {string} expr
     * @returns {string}
     */
    displayExpression(expr) {
        return String(expr || "")
            .replace(/&&/g, "∧")
            .replace(/\|\|/g, "∨")
            .replace(/!/g, "¬");
    },

    /**
     * Detecta quais variÃ¡veis (A, B, C) aparecem em uma expressÃ£o.
     * Usado pelo HUD/inimigos para mostrar SOMENTE as variÃ¡veis relevantes.
     * @param {string} expr
     * @returns {Array<"A"|"B"|"C">}
     */
    getUsedVars(expr) {
        const used = [];
        if (/\bA\b/.test(expr)) used.push("A");
        if (/\bB\b/.test(expr)) used.push("B");
        if (/\bC\b/.test(expr)) used.push("C");
        return used;
    },

    /**
     * Formata valores no estilo "[A:V] [B:F]" mostrando apenas
     * as variÃ¡veis presentes na expressÃ£o atual.
     * V = verdadeiro, F = falso.
     * @returns {Array<{name:string, val:boolean, label:string}>}
     */
    formatVarsCompact(vars, usedVars) {
        return usedVars.map(name => ({
            name,
            val:   vars[name],
            label: vars[name] ? "V" : "F"
        }));
    },

    /**
     * Verifica se hÃ¡ pelo menos um inimigo (entre os passados) que
     * satisfaz a expressÃ£o. Usado para detectar "estado impossÃ­vel".
     * @param {string} expr
     * @param {Array<{values:Object}>} enemies
     * @returns {boolean}
     */
    hasValidEnemy(expr, enemies) {
        return enemies.some(e => this.evaluate(expr, e.values));
    }
};
