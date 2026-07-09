const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const html = fs.readFileSync("select/tiao_ma.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const sandbox = {
  window: {},
  location: { hostname: "localhost" },
  document: {
    getElementById() {
      return { style: {}, innerHTML: "", innerText: "", onchange: null };
    }
  },
  localStorage: {
    getItem() { return null; },
    setItem() {}
  },
  setTimeout() {},
  console
};

vm.createContext(sandbox);
vm.runInContext(`${script}
this.MASTER_DB = MASTER_DB;
this.INGREDIENT_ALIASES = INGREDIENT_ALIASES;
this.INGREDIENT_DETAILS = INGREDIENT_DETAILS;
this.normalizeIngredientText = normalizeIngredientText;
this.collectIngredientAnalysis = collectIngredientAnalysis;
this.getSafetySummary = getSafetySummary;
this.getBarcodeFallbackMessage = getBarcodeFallbackMessage;`, sandbox);

function covered(name, aliases = []) {
  assert(Object.values(sandbox.MASTER_DB).some((group) => group.keywords.includes(name)), `${name} missing from MASTER_DB`);
  assert(sandbox.INGREDIENT_ALIASES[name], `${name} missing aliases`);
  assert(sandbox.INGREDIENT_DETAILS[name], `${name} missing details`);
  for (const alias of aliases) {
    assert(sandbox.INGREDIENT_ALIASES[name].includes(alias), `${name} missing alias ${alias}`);
  }
}

[
  ["脱氢乙酸", ["E265"]],
  ["对羟基苯甲酸甲酯", ["E218"]],
  ["山梨酸钙", ["E203"]],
  ["焦糖色", ["E150"]],
  ["胭脂虫红", ["E120"]],
  ["甜菊糖苷", ["E960"]],
  ["麦芽糖醇", ["E965"]],
  ["D-异抗坏血酸钠", ["E316"]],
  ["抗坏血酸", ["E300"]],
  ["蔗糖脂肪酸酯", ["E473"]],
  ["硬脂酰乳酸钠", ["E481"]],
  ["柠檬酸", ["E330"]],
  ["柠檬酸钠", ["E331"]],
  ["磷酸", ["E338"]],
  ["乳酸", ["E270"]],
  ["亚硝酸盐", ["E249", "E250"]]
].forEach(([name, aliases]) => covered(name, aliases));

assert.strictEqual(sandbox.normalizeIngredientText("Ｅ３３０，I＋G").includes("E330,I+G"), true);

const risky = sandbox.collectIngredientAnalysis("配料：水、亚硝酸钠、柠檬黄、山梨酸钾");
assert.strictEqual(risky.danger.length, 1);
assert.strictEqual(risky.warning.length, 2);
assert(risky.score < 70, "high-risk ingredients should lower safety score");
assert.strictEqual(sandbox.getSafetySummary(risky).level, "高风险");

const clean = sandbox.collectIngredientAnalysis("配料：饮用水、燕麦、牛奶");
assert.strictEqual(clean.score, 96);
assert.strictEqual(sandbox.getSafetySummary(clean).level, "较安全");

assert(sandbox.getBarcodeFallbackMessage("offline").includes("拍配料表"));
assert(sandbox.getBarcodeFallbackMessage("missing_ingredients", "示例商品").includes("示例商品"));

console.log("tiao_ma ingredient library ok");
