/**
 * Tesseract.js 动态加载（CDN）。仅在浏览器侧运行。
 *
 * 设计参考 stock-analyzer-web 项目：用 script 标签注入而非 npm 包，
 * 这样不占 bundle 体积，开源项目用户首次用到才下载。
 *
 * 针对券商 App 持仓截图做了三件事提升准确率：
 *   1) 图像预处理：放大 + 灰度 + 自动反色（适配深色主题）+ 对比增强；
 *   2) 同花顺等固定布局：按比例切「名称带 / 数字带」分列识别，数字带用数字白名单；
 *   3) 关键词指纹自动判别截图来源（也可由调用方手动指定）。
 */

declare global {
  interface Window {
    Tesseract?: any;
  }
}

const CDN_URL = "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js";

let loadingPromise: Promise<void> | null = null;
let workerPromise: Promise<any> | null = null;

export type OcrSource = "auto" | "ths" | "generic";

export interface OcrProgress {
  status: string; // 例: 'recognizing text'
  progress: number; // 0-1
}

export interface OcrResult {
  text: string;
  /** 实际采用的来源（auto 会被解析成 ths / generic） */
  source: Exclude<OcrSource, "auto">;
}

/** 同花顺持仓页固定字段词，用于关键词指纹判别。 */
const THS_KEYWORDS = [
  "持仓盈亏",
  "浮动盈亏",
  "当日盈亏",
  "参考市值",
  "成本价",
  "市值",
  "现价",
  "持仓",
  "可用",
  "冻结",
  "盈亏",
  "摊薄",
  "同花顺",
];

export function detectThsFromText(text: string): boolean {
  const hits = THS_KEYWORDS.reduce((n, kw) => (text.includes(kw) ? n + 1 : n), 0);
  return hits >= 2;
}

export async function loadTesseractScript(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Tesseract is browser-only");
  }
  if (window.Tesseract) return;
  if (!loadingPromise) {
    loadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CDN_URL;
      script.onload = () => resolve();
      script.onerror = () => {
        loadingPromise = null;
        reject(new Error("Failed to load Tesseract.js from CDN"));
      };
      document.head.appendChild(script);
    });
  }
  await loadingPromise;
}

async function getWorker(onProgress?: (p: OcrProgress) => void): Promise<any> {
  await loadTesseractScript();
  if (!workerPromise) {
    workerPromise = (async () => {
      // chi_sim + eng 同时识别中英文（持仓表常有英文/数字）
      return await window.Tesseract.createWorker("chi_sim+eng", 1, {
        logger: (m: OcrProgress) => onProgress?.(m),
      });
    })();
  }
  return workerPromise;
}

/* ----------------------------- 图像预处理 ----------------------------- */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

/**
 * 放大 + 灰度 + 自动反色（深色主题）+ 对比增强。
 * 返回处理后的 canvas，可直接喂给 Tesseract 或再裁剪。
 */
async function preprocessForOcr(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(dataUrl);
  // 手机截图字号偏小，放大到至少 ~1500px 宽（封顶 2.5x，避免画布过大）。
  const scale = Math.min(2.5, Math.max(1, 1500 / Math.max(1, img.width)));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const px = imageData.data;

  // 先转灰度并统计平均亮度，用于判断是否深色主题需要反色。
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = gray;
    sum += gray;
  }
  const mean = sum / (px.length / 4);
  const invert = mean < 115; // 深色背景 → 反色成「白底黑字」

  // 对比增强（围绕 128 线性拉伸）+ 可选反色。
  const contrast = 1.4;
  for (let i = 0; i < px.length; i += 4) {
    let v = px[i];
    if (invert) v = 255 - v;
    v = (v - 128) * contrast + 128;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/* ----------------------------- 词级识别 ----------------------------- */

interface OcrWord {
  text: string;
  x0: number;
  x1: number;
  xMid: number;
  yMid: number;
}

/** 从 Tesseract v5 的 blocks 层级里抽出所有词（带坐标）。 */
function flattenWords(data: any): OcrWord[] {
  const words: OcrWord[] = [];
  const push = (text: string, b: any) => {
    const t = (text ?? "").trim();
    if (t && b) {
      words.push({ text: t, x0: b.x0, x1: b.x1, xMid: (b.x0 + b.x1) / 2, yMid: (b.y0 + b.y1) / 2 });
    }
  };
  for (const block of data?.blocks ?? []) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        for (const word of line?.words ?? []) push(word?.text, word?.bbox);
      }
    }
  }
  return words;
}

async function recognizeWords(worker: any, image: HTMLCanvasElement | string): Promise<OcrWord[]> {
  await worker.setParameters({
    tessedit_pageseg_mode: "6", // 假定整块为单列文本，逐行读
    tessedit_char_whitelist: "",
  });
  const result = await worker.recognize(image, {}, { blocks: true });
  return flattenWords(result?.data);
}

/** 把词按 y 聚成行（行内按 x 排序），再拼成多行文本——通用路径用。 */
function wordsToText(words: OcrWord[]): string {
  if (words.length === 0) return "";
  const sorted = [...words].sort((a, b) => a.yMid - b.yMid);
  const tol = estimateRowHeight(sorted) * 0.6;
  const rows: OcrWord[][] = [];
  for (const w of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(w.yMid - row[0].yMid) <= tol) row.push(w);
    else rows.push([w]);
  }
  return rows
    .map((row) =>
      row
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text)
        .join(" "),
    )
    .join("\n");
}

/** 用相邻词 y 间距的中位数估计行高。 */
function estimateRowHeight(sortedByY: OcrWord[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < sortedByY.length; i++) {
    const g = sortedByY[i].yMid - sortedByY[i - 1].yMid;
    if (g > 2) gaps.push(g);
  }
  if (gaps.length === 0) return 24;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 24;
}

/* ----------------------------- 对外入口 ----------------------------- */

/**
 * 识别一张持仓截图（先预处理，再一次词级 OCR，按来源走不同重建）。
 *
 * - generic：词按行聚合成普通文本；
 * - ths：同花顺持仓页是「市值 | 盈亏 | 持仓/可用 | 成本/现价」4 列、每只 2 行的网格，
 *   且不显示代码。以左侧中文股名为锚点，按列 x 位置取出 持仓/成本/市值，
 *   输出「股名 持仓 成本 市值」每行一只，交后端按名字反查代码。
 */
export async function recognizeImage(
  dataUrl: string | Blob,
  onProgress?: (p: OcrProgress) => void,
  source: OcrSource = "auto",
): Promise<OcrResult> {
  const worker = await getWorker(onProgress);

  const image = typeof dataUrl === "string" ? await preprocessForOcr(dataUrl) : await blobToDataUrl(dataUrl);
  const width = image instanceof HTMLCanvasElement ? image.width : 0;

  const words = await recognizeWords(worker, image);
  const fullText = wordsToText(words);

  const isThs = source === "ths" || (source === "auto" && detectThsFromText(fullText));
  if (!isThs || width === 0) {
    return { text: fullText, source: "generic" };
  }

  const ths = reconstructThs(words, width);
  // 重建出 >=1 只才采用，否则回退整图文本交后端兜底。
  return ths.split("\n").filter(Boolean).length >= 1
    ? { text: ths, source: "ths" }
    : { text: fullText, source: "ths" };
}

const CJK_RE = /[一-鿿]/;
// 左侧角标/标签（港股通、融资融券、市场标记等），不能当成股名锚点。
const THS_TAGS = new Set(["沪", "深", "港", "京", "沪港", "深港", "融", "信", "两融", "创", "科", "北", "转", "债"]);

/** 解析数字，自动剥离货币前缀（HK$/US$/¥）、千分位逗号、百分号。 */
function numVal(text: string): number | null {
  // 去千分位逗号、百分号、空白，再剥掉开头的货币符号/字母（HK$、US$、¥、HKS 误识等）。
  let cleaned = text.replace(/[,%\s]/g, "").replace(/^[^\d\-+.]+/, "");
  if (!/[0-9]/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 是否是「数字单元格」（去掉货币/符号后是合法数字）。 */
function isNumberToken(text: string): boolean {
  return numVal(text) != null;
}

/**
 * 同花顺持仓网格重建。列边界按持仓页固定版面取比例（可按真机微调）：
 *   列1 市值/股名 [0,0.30) · 列2 盈亏 [0.30,0.52) · 列3 持仓/可用 [0.52,0.78) · 列4 成本/现价 [0.78,1]
 */
function reconstructThs(words: OcrWord[], width: number): string {
  const COL_VALUE = 0.3;
  const COL_SHARES: [number, number] = [0.52, 0.78];
  const COL_COST = 0.78;

  // 股名锚点：左侧列(<30%宽)里含中文 / ETF / LOF 的词；排除市场角标（沪港等）。
  // 先按 y 再按 x 排序，保证同一行被拆开的词（如「五 粮 液」）能按从左到右拼回。
  const nameWords = words
    .filter(
      (w) =>
        w.xMid < width * COL_VALUE &&
        (CJK_RE.test(w.text) || /ETF|LOF/i.test(w.text)) &&
        !THS_TAGS.has(w.text),
    )
    .sort((a, b) => a.yMid - b.yMid || a.x0 - b.x0);
  if (nameWords.length === 0) return "";

  const rowH = estimateRowHeight([...words].sort((a, b) => a.yMid - b.yMid));
  const tol = rowH * 0.6;

  // 同一行的多个名字词合并成一只股票的名字（去掉词间空格）。
  const anchors: { name: string; yMid: number }[] = [];
  for (const w of nameWords) {
    const last = anchors[anchors.length - 1];
    if (last && Math.abs(w.yMid - last.yMid) <= tol) {
      last.name += w.text;
    } else {
      anchors.push({ name: w.text, yMid: w.yMid });
    }
  }

  // 每只股票的行距（锚点间距中位数）：用于估算最后一只的下边界和上下行判定阈值，
  // 比单纯用词行高更稳（角标会把词行高拉小）。
  const pitches: number[] = [];
  for (let i = 1; i < anchors.length; i++) pitches.push(anchors[i].yMid - anchors[i - 1].yMid);
  pitches.sort((a, b) => a - b);
  const pitch = pitches.length ? pitches[Math.floor(pitches.length / 2)] : rowH * 2;
  const rowTol = Math.max(tol, pitch * 0.28);

  const lines: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const yTop = anchor.yMid;
    const yBottom = i + 1 < anchors.length ? anchors[i + 1].yMid : yTop + pitch;

    // 该只股票 y 区间内的所有词；上行≈yTop，下行≈yTop+行高。
    const inBlock = (w: OcrWord) => w.yMid >= yTop - rowTol && w.yMid < yBottom - rowTol;
    const isTopRow = (w: OcrWord) => Math.abs(w.yMid - yTop) <= rowTol;

    const pickNum = (filter: (w: OcrWord) => boolean): number | null => {
      const cand = words.filter((w) => inBlock(w) && filter(w) && isNumberToken(w.text));
      if (cand.length === 0) return null;
      cand.sort((a, b) => a.x0 - b.x0);
      return numVal(cand[0].text);
    };

    // 持仓：列3 上行；成本：列4 上行；市值：列1 下行（股名下方的数字）。
    const shares = pickNum((w) => w.xMid >= width * COL_SHARES[0] && w.xMid < width * COL_SHARES[1] && isTopRow(w));
    const cost = pickNum((w) => w.xMid >= width * COL_COST && isTopRow(w));
    const value = pickNum((w) => w.xMid < width * COL_VALUE && !isTopRow(w));

    const parts = [anchor.name];
    if (shares != null) parts.push(String(shares));
    if (cost != null) parts.push(String(cost));
    if (value != null) parts.push(String(value));
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function terminateWorker(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    try {
      await w.terminate();
    } catch {
      // ignore
    }
    workerPromise = null;
  }
}
