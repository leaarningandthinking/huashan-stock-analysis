"use client";

import { useEffect, useState } from "react";
import { Upload, Image as ImageIcon, X, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recognizeImage, type OcrProgress, type OcrSource } from "@/lib/tesseract";

interface UploadedImage {
  id: string;
  file: File;
  dataUrl: string;
  ocrText: string | null;
  detectedSource: "ths" | "generic" | null;
  status: "pending" | "ocr" | "done" | "fail";
  error?: string;
}

interface Props {
  /** OCR 完成后回调，把拼接的文本 + 截图来源传出去 */
  onTextExtracted: (text: string, source: "ths" | "generic") => void;
}

const SOURCE_OPTIONS: { value: OcrSource; label: string }[] = [
  { value: "auto", label: "自动识别" },
  { value: "ths", label: "同花顺" },
  { value: "generic", label: "通用" },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ImageOcrTab({ onTextExtracted }: Props) {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [source, setSource] = useState<OcrSource>("auto");
  const [running, setRunning] = useState(false);
  const [globalProgress, setGlobalProgress] = useState<OcrProgress | null>(null);
  const [combinedText, setCombinedText] = useState("");

  useEffect(() => {
    // 任何图片状态变化，重新拼一次文本
    const text = images
      .filter((i) => i.ocrText)
      .map((i, idx) => `=== 截图 ${idx + 1} ===\n${i.ocrText}`)
      .join("\n\n");
    setCombinedText(text);
    // 任一张被判定为同花顺，则整批按同花顺解析。
    const batchSource: "ths" | "generic" = images.some((i) => i.detectedSource === "ths")
      ? "ths"
      : "generic";
    if (text) onTextExtracted(text, batchSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  async function addFiles(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;

    const items: UploadedImage[] = [];
    for (const f of imageFiles) {
      const dataUrl = await fileToDataUrl(f);
      items.push({
        id: `${Date.now()}-${Math.random()}`,
        file: f,
        dataUrl,
        ocrText: null,
        detectedSource: null,
        status: "pending",
      });
    }
    setImages((prev) => [...prev, ...items]);
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((i) => i.id !== id));
  }

  async function runOcr() {
    setRunning(true);
    setGlobalProgress(null);
    try {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.ocrText) continue;
        setImages((prev) =>
          prev.map((x) => (x.id === img.id ? { ...x, status: "ocr" } : x)),
        );
        try {
          const result = await recognizeImage(
            img.dataUrl,
            (p) => setGlobalProgress(p),
            source,
          );
          setImages((prev) =>
            prev.map((x) =>
              x.id === img.id
                ? { ...x, ocrText: result.text, detectedSource: result.source, status: "done" }
                : x,
            ),
          );
        } catch (e) {
          setImages((prev) =>
            prev.map((x) =>
              x.id === img.id
                ? {
                    ...x,
                    status: "fail",
                    error: e instanceof Error ? e.message : String(e),
                  }
                : x,
            ),
          );
        }
      }
    } finally {
      setRunning(false);
      setGlobalProgress(null);
    }
  }

  const allDone = images.length > 0 && images.every((i) => i.status === "done");
  const anyPending = images.some((i) => i.status === "pending");

  return (
    <div className="space-y-4 rounded-lg border border-ink-200 bg-white/60 p-6">
      {/* 上传区 */}
      <label
        htmlFor="image-input"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-ink-300 bg-white/40 py-10 transition hover:border-scarlet-400 hover:bg-white/70"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="h-8 w-8 text-ink-400" />
        <p className="text-sm text-ink-600">点击或拖拽券商 App 持仓截图到这里</p>
        <p className="text-xs text-ink-400">
          支持多张同时上传 · 完全在浏览器内 OCR · 不上传服务器
        </p>
        <input
          id="image-input"
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {/* 截图来源（影响识别策略） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-500">截图来源</span>
        <div className="inline-flex overflow-hidden rounded-md border border-ink-200">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSource(opt.value)}
              className={
                "px-3 py-1.5 text-xs transition " +
                (source === opt.value
                  ? "bg-scarlet-600 text-white"
                  : "bg-white text-ink-600 hover:bg-ink-50")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-400">
          同花顺用户选「同花顺」可按持仓页固定版面分列识别，更准
        </span>
      </div>

      {/* 缩略图列表 */}
      {images.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map((img, idx) => (
            <div
              key={img.id}
              className="relative flex items-start gap-3 rounded-md border border-ink-200 bg-white/70 p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.dataUrl}
                alt={`截图 ${idx + 1}`}
                className="h-20 w-20 flex-none rounded object-cover"
              />
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-medium text-ink-700">
                  截图 {idx + 1} · {(img.file.size / 1024).toFixed(0)} KB
                </p>
                <StatusBadge status={img.status} error={img.error} />
                {img.detectedSource === "ths" && (
                  <span className="ml-1 inline-block rounded bg-scarlet-50 px-1.5 py-0.5 text-[10px] font-medium text-scarlet-600">
                    同花顺版面
                  </span>
                )}
                {img.ocrText && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-ink-500 hover:text-scarlet-600">
                      展开识别文本（{img.ocrText.length} 字）
                    </summary>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-ink-50 p-2 text-[11px] leading-tight text-ink-600">
                      {img.ocrText}
                    </pre>
                  </details>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="flex-none"
                onClick={() => removeImage(img.id)}
                aria-label="移除"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* 进度 + 操作 */}
      {images.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3">
          <Button
            onClick={runOcr}
            disabled={running || !anyPending}
            size="md"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
            {anyPending ? "开始 OCR 识别" : "全部已识别"}
          </Button>

          {running && globalProgress && (
            <span className="text-xs text-ink-500">
              {globalProgress.status} · {Math.round(globalProgress.progress * 100)}%
            </span>
          )}

          {allDone && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <FileText className="h-3.5 w-3.5" />
              已识别 {images.length} 张图，文本已注入下方解析框
            </span>
          )}
        </div>
      )}

      {/* 识别后的合并文本（可编辑） */}
      {combinedText && (
        <div>
          <p className="mb-1 text-xs text-ink-500">
            合并文本（OCR 难免有错，可手动修正后再点【解析预览】）
          </p>
          <textarea
            className="h-48 w-full resize-y rounded-md border border-ink-300 bg-white/70 p-3 font-mono text-xs leading-relaxed focus-visible:border-scarlet-500 focus-visible:outline-none"
            value={combinedText}
            onChange={(e) => {
              setCombinedText(e.target.value);
              const batchSource: "ths" | "generic" = images.some((i) => i.detectedSource === "ths")
                ? "ths"
                : "generic";
              onTextExtracted(e.target.value, batchSource);
            }}
            spellCheck={false}
          />
        </div>
      )}

      <p className="text-xs text-ink-400">
        💡 首次 OCR 会从 CDN 加载 Tesseract.js（约 8MB）+ 中文模型（约 10MB），
        过后浏览器缓存，秒开。完全本地识别，图片不上传服务器。
      </p>
    </div>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: UploadedImage["status"];
  error?: string;
}) {
  const map = {
    pending: { text: "待识别", color: "text-ink-500" },
    ocr: { text: "识别中…", color: "text-amber-700" },
    done: { text: "已识别", color: "text-emerald-700" },
    fail: { text: "失败", color: "text-red-700" },
  } as const;
  const m = map[status];
  return (
    <p className={"mt-0.5 " + m.color}>
      {m.text}
      {error && <span className="ml-1 text-red-600">：{error}</span>}
    </p>
  );
}
