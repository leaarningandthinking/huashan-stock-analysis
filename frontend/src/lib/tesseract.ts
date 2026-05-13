/**
 * Tesseract.js 动态加载（CDN）。仅在浏览器侧运行。
 *
 * 设计参考 stock-analyzer-web 项目：用 script 标签注入而非 npm 包，
 * 这样不占 bundle 体积，开源项目用户首次用到才下载。
 */

declare global {
  interface Window {
    Tesseract?: any;
  }
}

const CDN_URL = "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js";

let loadingPromise: Promise<void> | null = null;
let workerPromise: Promise<any> | null = null;

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

export interface OcrProgress {
  status: string; // 例: 'recognizing text'
  progress: number; // 0-1
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

export async function recognizeImage(
  dataUrlOrBlob: string | Blob,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  const worker = await getWorker(onProgress);
  const result = await worker.recognize(dataUrlOrBlob);
  return result?.data?.text ?? "";
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
