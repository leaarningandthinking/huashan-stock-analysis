"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { testProvider, type ProviderMeta } from "@/lib/llm-api";
import { useLLMStore } from "@/stores/llm";
import type { ProviderId } from "@/lib/llm-config";

interface Props {
  meta: ProviderMeta;
}

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "ok"; latency: number; sample: string }
  | { phase: "error"; error: string };

export function ProviderCard({ meta }: Props) {
  const providerId = meta.id as ProviderId;
  const { config, hydrated, setProvider } = useLLMStore();
  const stored = config.providers[providerId];

  const CUSTOM_KEY = "__custom__";

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState(meta.models[0]?.id ?? "");
  const [customMode, setCustomMode] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<TestState>({ phase: "idle" });

  // hydrate 完成后从 store 拉初始值
  useEffect(() => {
    if (!hydrated) return;
    if (stored) {
      setApiKey(stored.apiKey);
      setBaseUrl(stored.baseUrl);
      const m = stored.defaultModel || meta.models[0]?.id || "";
      setModel(m);
      // 已存的模型不在预设列表里 → 自定义模式
      setCustomMode(!!m && !meta.models.some((x) => x.id === m));
      setEnabled(stored.enabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  async function handleTest() {
    if (!apiKey) {
      setTestState({ phase: "error", error: "请先填 API Key" });
      return;
    }
    setTestState({ phase: "testing" });
    try {
      const r = await testProvider({
        provider: providerId,
        api_key: apiKey,
        model,
        base_url: baseUrl || undefined,
      });
      if (r.ok) {
        setTestState({ phase: "ok", latency: r.latency_ms, sample: r.sample });
        // 测试成功自动保存 + 启用
        setProvider(providerId, {
          apiKey,
          baseUrl,
          defaultModel: model,
          enabled: true,
          lastTestedAt: Date.now(),
        });
        setEnabled(true);
      } else {
        setTestState({ phase: "error", error: r.error ?? "未知错误" });
      }
    } catch (e) {
      setTestState({
        phase: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function handleSave() {
    setProvider(providerId, {
      apiKey,
      baseUrl,
      defaultModel: model,
      enabled,
      lastTestedAt: stored?.lastTestedAt ?? 0,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{meta.name}</span>
          <a
            href={meta.homepage}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-normal text-ink-500 hover:text-scarlet-600"
          >
            官网 <ExternalLink className="h-3 w-3" />
          </a>
        </CardTitle>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`key-${providerId}`}>API Key</Label>
          <div className="flex gap-2">
            <Input
              id={`key-${providerId}`}
              type={showKey ? "text" : "password"}
              placeholder={meta.api_key_format_hint}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              size="md"
              variant="outline"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? "隐藏" : "显示"}
            </Button>
          </div>
          <p className="text-xs text-ink-400">
            仅保存在你浏览器的 localStorage，不会上传服务器。
          </p>
        </div>

        {meta.base_url_editable && (
          <div className="space-y-1.5">
            <Label htmlFor={`url-${providerId}`}>
              Base URL <span className="text-ink-400">（可选，留空用默认）</span>
            </Label>
            <Input
              id={`url-${providerId}`}
              type="text"
              placeholder={meta.default_base_url}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`model-${providerId}`}>默认模型</Label>
          <Select
            id={`model-${providerId}`}
            value={customMode ? CUSTOM_KEY : model}
            onChange={(e) => {
              if (e.target.value === CUSTOM_KEY) {
                setCustomMode(true);
                setModel("");
              } else {
                setCustomMode(false);
                setModel(e.target.value);
              }
            }}
          >
            {meta.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.notes && `· ${m.notes}`}
              </option>
            ))}
            <option value={CUSTOM_KEY}>自定义…</option>
          </Select>
          {customMode && (
            <Input
              type="text"
              placeholder="输入模型 ID，例：deepseek-chat-v4-0509"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              spellCheck={false}
              className="mt-2"
            />
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 pt-1">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-scarlet-600"
          />
          <span className="text-sm text-ink-700">启用此 Provider</span>
        </label>
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Button onClick={handleTest} disabled={testState.phase === "testing"}>
            {testState.phase === "testing" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            测试连通性
          </Button>
          <Button variant="outline" onClick={handleSave}>
            保存
          </Button>
        </div>

        <TestStatus state={testState} stored={stored} />
      </CardFooter>
    </Card>
  );
}

function TestStatus({
  state,
  stored,
}: {
  state: TestState;
  stored: { lastTestedAt: number } | undefined;
}) {
  if (state.phase === "ok") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-700">
        <CheckCircle2 className="h-4 w-4" />
        通畅 · {state.latency}ms · 回包: {state.sample}
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="flex max-w-full items-start gap-1.5 text-xs text-red-700">
        <XCircle className="h-4 w-4 flex-none" />
        <span className="break-all">{state.error}</span>
      </div>
    );
  }
  if (stored?.lastTestedAt) {
    const ago = Math.floor((Date.now() - stored.lastTestedAt) / 60000);
    return (
      <div className="text-xs text-ink-400">
        上次测试: {ago < 1 ? "刚刚" : `${ago} 分钟前`}
      </div>
    );
  }
  return null;
}
