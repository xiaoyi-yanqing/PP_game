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
this.getDefaultCropRect = getDefaultCropRect;
this.clampCropRect = clampCropRect;
this.fixOcrIngredientText = fixOcrIngredientText;
this.extractIngredientText = extractIngredientText;
this.isUsableIngredientText = isUsableIngredientText;
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

assert.strictEqual(JSON.stringify(sandbox.getDefaultCropRect(1000, 800)), JSON.stringify({ x: 50, y: 120, width: 900, height: 480 }));
assert.strictEqual(JSON.stringify(sandbox.clampCropRect({ x: -20, y: 760, width: 5, height: 100 }, 1000, 800)), JSON.stringify({ x: 0, y: 740, width: 80, height: 60 }));

const risky = sandbox.collectIngredientAnalysis("配料：水、亚硝酸钠、柠檬黄、山梨酸钾");
assert.strictEqual(risky.danger.length, 1);
assert.strictEqual(risky.warning.length, 2);
assert(risky.score < 70, "high-risk ingredients should lower safety score");
assert.strictEqual(sandbox.getSafetySummary(risky).level, "高风险");
assert.strictEqual(sandbox.getSafetySummary(risky).tone, "danger");
assert(risky.danger[0].injury.includes("可能"), "ingredient detail should describe possible harm");

const extracted = sandbox.extractIngredientText("营养成分表\n配料：饮用水、柠檬酸纳、三氯庶糖、山梨酸甲\n产品标准号 GB/T 12345");
assert(extracted.includes("配料：饮用水、柠檬酸钠、三氯蔗糖、山梨酸钾"), "OCR text should be corrected and trimmed to ingredients");
assert(!extracted.includes("营养成分表"), "non-ingredient text before the ingredient label should be removed");
assert(!extracted.includes("产品标准号"), "non-ingredient text after ingredients should be removed");
assert.strictEqual(sandbox.isUsableIngredientText("饮用水"), false, "short OCR text should not be treated as a valid report");
assert.strictEqual(sandbox.isUsableIngredientText(extracted), true, "extracted ingredients should be treated as usable");

const ocrRisky = sandbox.collectIngredientAnalysis(extracted);
assert(ocrRisky.warning.some((item) => item.word === "柠檬酸钠"), "OCR typo 柠檬酸纳 should match 柠檬酸钠");
assert(ocrRisky.warning.some((item) => item.word === "三氯蔗糖"), "OCR typo 三氯庶糖 should match 三氯蔗糖");
assert(ocrRisky.warning.some((item) => item.word === "山梨酸钾"), "OCR typo 山梨酸甲 should match 山梨酸钾");

const audience = sandbox.getAudienceAdvice(risky);
assert.deepStrictEqual(Array.from(audience, (item) => item.name), ["成人", "孕妇", "儿童"]);
assert(audience.find((item) => item.name === "孕妇").level.includes("不建议"));
assert(audience.find((item) => item.name === "儿童").harm.includes("发育"));
const adultAdvice = audience.find((item) => item.name === "成人");
const pregnantAdvice = audience.find((item) => item.name === "孕妇");
const childAdvice = audience.find((item) => item.name === "儿童");
assert.strictEqual(adultAdvice.ingredients.length, 3);
assert(pregnantAdvice.ingredients.some((item) => item.word === "亚硝酸钠"));
assert(childAdvice.ingredients.some((item) => item.word === "柠檬黄"));
assert(audience.every((item) => item.ingredients.every((ingredient) => ingredient.harm.includes("可能"))));

const clean = sandbox.collectIngredientAnalysis("配料：饮用水、燕麦、牛奶");
assert.strictEqual(clean.score, 96);
assert.strictEqual(sandbox.getSafetySummary(clean).level, "较安全");
assert(sandbox.getAudienceAdvice(clean).every((item) => item.ingredients.length === 0));

assert(sandbox.getBarcodeFallbackMessage("offline").includes("拍配料表"));
assert(sandbox.getBarcodeFallbackMessage("scan_timeout").includes("10 秒"));
assert(sandbox.getBarcodeFallbackMessage("invalid_qr").includes("不是商品条码"));
assert(sandbox.getBarcodeFallbackMessage("missing_ingredients", "示例商品").includes("示例商品"));

assert(html.includes('id="progressArea"'), "analysis progress bar missing");
assert(html.includes('id="audienceArea"'), "audience analysis area missing");
assert(html.includes('id="cropArea"'), "manual crop area missing");
assert(html.includes("确认裁剪并识别"), "crop confirmation action missing");
assert(html.includes('id="ocrReviewArea"'), "OCR review area missing");
assert(html.includes("audience-ingredient"), "audience ingredient details missing");
assert(html.includes("const OCR_MAX_WIDTH = 3600"), "OCR max width should keep more small-text detail");
assert(html.includes('canvas.toBlob((blob) => resolve(blob || canvas), "image/png")'), "OCR image should use lossless PNG");
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
