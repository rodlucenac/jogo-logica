const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {
    console,
    Math,
    window: { addEventListener() {} }
};
vm.createContext(context);

function loadScript(file, exportName) {
    const code = fs.readFileSync(path.join(root, file), "utf8");
    vm.runInContext(`${code}\nthis.${exportName} = ${exportName};`, context, { filename: file });
    return context[exportName];
}

const Logic = loadScript("logic.js", "Logic");
const Game = loadScript("game.js", "Game");

assert.strictEqual(Game.MAX_LEVEL, 6);
assert.strictEqual(Game.FIRST_CAMPAIGN_PART_LEVEL, 3);
assert.strictEqual(Game._phaseUpgradeForLevel(4), null);
assert.strictEqual(Game._phaseUpgradeForLevel(6), null);
assert.strictEqual(Game._formatRankingTime(65), "1:05");
assert.strictEqual(Game._compareRankingByTime(
    { name: "FAST", score: 10, timeSeconds: 45, date: "2026-01-02" },
    { name: "SLOW", score: 100, timeSeconds: 90, date: "2026-01-01" }
) < 0, true);
assert.strictEqual(Game._compareRankingByScore(
    { name: "A", score: 100, timeSeconds: 80, date: "2026-01-02" },
    { name: "B", score: 100, timeSeconds: 70, date: "2026-01-01" }
) > 0, true);

let installedUpgrade = null;
const originalGameState = {
    assistMode: Game.assistMode,
    level: Game.level,
    player: Game.player,
    hud: Game.hud,
    floatTexts: Game.floatTexts,
    sessionNotice: Game.sessionNotice,
    sessionNoticeTimer: Game.sessionNoticeTimer,
    sessionNoticeColor: Game.sessionNoticeColor,
    state: Game.state,
    upgradeChallenge: Game.upgradeChallenge
};
Game.assistMode = true;
Game.level = 1;
Game.player = {
    x: 0,
    y: 0,
    applyPermanentUpgrade(kind) { installedUpgrade = kind; },
    applyPowerup() { throw new Error("Assist mode special upgrade should be permanent"); },
    getCollectedUpgradeLabels() { return []; }
};
Game.hud = null;
Game.floatTexts = [];
Game._collectSpecialPhaseUpgrade({ kind: "bootFirewall", level: 1, displayName: "Firewall de Boot" });
assert.strictEqual(installedUpgrade, "bootFirewall");
assert.strictEqual(Game.state, originalGameState.state);
assert.strictEqual(Game.upgradeChallenge, originalGameState.upgradeChallenge);
Object.assign(Game, originalGameState);

assert.strictEqual(Logic.evaluate("(A && !B)", { A: true, B: false, C: false }), true);
assert.strictEqual(Logic.evaluate("(A && !B)", { A: true, B: true, C: false }), false);
assert.strictEqual(JSON.stringify(Logic.getUsedVars("(A && B) || C")), JSON.stringify(["A", "B", "C"]));
assert.strictEqual(Logic.displayExpression("(A && !B) || C"), "(A ∧ ¬B) ∨ C");

const twoVarCombos = Logic.combinationsForVars(["A", "B"]);
assert.strictEqual(twoVarCombos.length, 4);
assert.strictEqual(new Set(twoVarCombos.map(v => `${v.A}:${v.B}:${v.C}`)).size, 4);

for (const pool of Object.values(Logic.expressionsByTier)) {
    for (const expr of pool) {
        const usedVars = Logic.getUsedVars(expr);
        const combos = Logic.combinationsForVars(usedVars);
        assert(
            combos.some(vars => Logic.evaluate(expr, vars)),
            `Expression should have at least one valid assignment: ${expr}`
        );

        const options = Game._buildUpgradeChallengeOptions(expr, usedVars);
        assert(options.length > 0 && options.length <= 4, `Unexpected option count for ${expr}`);
        assert(options.some(option => option.isCorrect), `Challenge should include a correct option: ${expr}`);
        assert.strictEqual(
            new Set(options.map(option => Game._varsKey(option.vars, usedVars))).size,
            options.length,
            `Challenge options should not repeat assignments: ${expr}`
        );

        for (const option of options) {
            assert.strictEqual(option.isCorrect, Logic.evaluate(expr, option.vars));
        }
    }
}

console.log("logic.test.js: ok");
