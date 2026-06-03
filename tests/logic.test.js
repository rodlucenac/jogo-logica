const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {
    console,
    Math,
    localStorage: {
        _d: {},
        getItem(key) { return this._d[key] || null; },
        setItem(key, value) { this._d[key] = value; },
        removeItem(key) { delete this._d[key]; }
    },
    window: { addEventListener() {}, LOGIC_INVADERS_RANKING: {} }
};
vm.createContext(context);

function loadScript(file, exportNames = []) {
    const code = fs.readFileSync(path.join(root, file), "utf8");
    const assigns = exportNames.map(name => `this.${name} = ${name};`).join("\n");
    vm.runInContext(`${code}\n${assigns}`, context, { filename: file });
}

loadScript("ranking-config.js");
loadScript("ranking-service.js", ["LogicInvadersRankingStore"]);
loadScript("logic.js", ["Logic"]);
loadScript("game.js", ["Game"]);

const Store = context.LogicInvadersRankingStore;
const Logic = context.Logic;
const Game = context.Game;

assert.strictEqual(Game.MAX_LEVEL, 6);
assert.strictEqual(Game._formatRankingTime(65), "1:05");

assert.strictEqual(Store.compareByScore(
    { name: "A", score: 100, level: 1, timeSeconds: 80, dateISO: "2026-01-02" },
    { name: "B", score: 50, level: 6, timeSeconds: 10, dateISO: "2026-01-01" }
) < 0, true);

const store = new Store({ storageKey: "testRankingV2", maxEntries: 3, minScore: 1 });
store.clearLocal();

function pushEntry(data) {
    const clean = store._cleanEntry(data);
    assert.ok(clean, `valid entry: ${JSON.stringify(data)}`);
    const board = store._append(store.loadLocal(), clean);
    store.saveLocal(board);
    return { clean, onBoard: store._madeLeaderboard(clean, board) };
}

let r = pushEntry({
    name: "Alpha",
    score: 30,
    level: 1,
    timeSeconds: 40,
    assistMode: false,
    logicErrors: 0,
    livesRemaining: 2,
    dateISO: "2026-06-01T10:00:00.000Z"
});
assert.strictEqual(r.onBoard, true);
assert.strictEqual(store.loadLocal()[0].level, 1);

r = pushEntry({
    name: "Beta",
    score: 90,
    level: 2,
    timeSeconds: 50,
    assistMode: false,
    dateISO: "2026-06-02T10:00:00.000Z"
});
r = pushEntry({
    name: "Gamma",
    score: 80,
    level: 3,
    timeSeconds: 60,
    assistMode: false,
    dateISO: "2026-06-03T10:00:00.000Z"
});
r = pushEntry({
    name: "Delta",
    score: 10,
    level: 1,
    timeSeconds: 20,
    assistMode: false,
    dateISO: "2026-06-04T10:00:00.000Z"
});
assert.strictEqual(r.onBoard, false);
assert.strictEqual(store.loadLocal().length, 3);
assert.strictEqual(store.loadLocal()[0].score, 90);

assert.strictEqual(store._cleanEntry({ name: "X", score: 0, level: 1 }), null);
assert.strictEqual(store._cleanEntry({ name: "Y", score: 5, level: 1 }).score, 5);

const imported = store.importJson(JSON.stringify([
    { name: "Epsilon", score: 95, level: 1, timeSeconds: 30, assistMode: false, dateISO: "2026-06-05T12:00:00.000Z" },
    { name: "Alpha", score: 30, level: 1, timeSeconds: 40, assistMode: false, dateISO: "2026-06-01T10:00:00.000Z" }
]));
assert.strictEqual(imported.result, "imported");
assert.strictEqual(imported.entries[0].score, 95);

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
Object.assign(Game, originalGameState);

assert.strictEqual(Logic.evaluate("(A && !B)", { A: true, B: false, C: false }), true);

for (const pool of Object.values(Logic.expressionsByTier)) {
    for (const expr of pool) {
        const usedVars = Logic.getUsedVars(expr);
        const combos = Logic.combinationsForVars(usedVars);
        assert(combos.some(vars => Logic.evaluate(expr, vars)), `valid assignment: ${expr}`);
        const options = Game._buildUpgradeChallengeOptions(expr, usedVars);
        assert(options.some(option => option.isCorrect), `correct option: ${expr}`);
    }
}

console.log("logic.test.js: ok");
