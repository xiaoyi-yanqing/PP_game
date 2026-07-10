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
this.parseScannedBarcode = parseScannedBarcode;
this.collectIngredientAnalysis = collectIngredientAnalysis;
this.getSafetySummary = getSafetySummary;
this.getAudienceAdvice = getAudienceAdvice;
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

[
  ["爱德万甜", "E969"],
  ["阿斯巴甜-安赛蜜盐", "E962"],
  ["喹啉黄", "E104"],
  ["专利蓝V", "E131"],
  ["抗坏血酸钙", "E302"],
  ["抗坏血酸棕榈酸酯", "E304"],
  ["双乙酰酒石酸单双甘油酯", "E472E"],
  ["乙酸", "E260"],
  ["富马酸", "E297"]
].forEach(([name, alias]) => {
  assert(Object.values(sandbox.MASTER_DB).some((group) => group.keywords.includes(name)), `${name} missing from MASTER_DB`);
  assert(sandbox.INGREDIENT_ALIASES[name].includes(alias), `${name} missing alias ${alias}`);
});

assert.strictEqual(sandbox.normalizeIngredientText("Ｅ３３０，I＋G").includes("E330,I+G"), true);
assert.strictEqual(sandbox.parseScannedBarcode("6901234567890"), "6901234567890");
assert.strictEqual(sandbox.parseScannedBarcode("https://example.com/product/6901234567890"), "6901234567890");
assert.strictEqual(sandbox.parseScannedBarcode("https://example.com/product"), "");

const risky = sandbox.collectIngredientAnalysis("配料：水、亚硝酸钠、柠檬黄、山梨酸钾");
assert.strictEqual(risky.danger.length, 1);
assert.strictEqual(risky.warning.length, 2);
assert(risky.score < 70, "high-risk ingredients should lower safety score");
assert.strictEqual(sandbox.getSafetySummary(risky).level, "高风险");
assert.strictEqual(sandbox.getSafetySummary(risky).tone, "danger");
assert(risky.danger[0].injury.includes("可能"), "ingredient detail should describe possible harm");

const audience = sandbox.getAudienceAdvice(risky);
assert.deepStrictEqual(Array.from(audience, (item) => item.name), ["成人", "孕妇", "儿童"]);
assert(audience.find((item) => item.name === "孕妇").level.includes("不建议"));
assert(audience.find((item) => item.name === "儿童").harm.includes("发育"));

const clean = sandbox.collectIngredientAnalysis("配料：饮用水、燕麦、牛奶");
assert.strictEqual(clean.score, 96);
assert.strictEqual(sandbox.getSafetySummary(clean).level, "较安全");

assert(sandbox.getBarcodeFallbackMessage("offline").includes("拍配料表"));
assert(sandbox.getBarcodeFallbackMessage("scan_timeout").includes("10 秒"));
assert(sandbox.getBarcodeFallbackMessage("invalid_qr").includes("不是商品条码"));
assert(sandbox.getBarcodeFallbackMessage("missing_ingredients", "示例商品").includes("示例商品"));

assert(html.includes('id="progressArea"'), "analysis progress bar missing");
assert(html.includes('id="audienceArea"'), "audience analysis area missing");
assert(html.includes("const SCAN_TIMEOUT_MS = 10000"), "10-second scan timeout missing");
assert(html.includes("切换拍配料表"), "scan fallback action missing");
assert(html.includes("html5-qrcode@2.3.8"), "scanner dependency should be pinned");
assert(html.includes("cdn.jsdelivr.net/npm/html5-qrcode@2.3.8"), "scanner CDN fallback missing");
const tanshuKeyMatch = html.match(/tanshuKey\s*:\s*"([^"]+)"/);
assert(tanshuKeyMatch && tanshuKeyMatch[1].length >= 8, "tanshu API key should be configured");
assert(!html.includes('id="barcodeImageInput"'), "extra barcode photo entry should be removed");
assert(!html.includes("exportLocalCache"), "cache export entry should be removed");
assert.strictEqual(fs.existsSync("index.html"), false, "root index entry should be removed");

console.log("tiao_ma ingredient library ok");
