"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchStocks, type StockInfo } from "@/lib/portfolio-api";
import { cn } from "@/lib/cn";

interface Props {
  value: StockInfo | null;
  onChange: (s: StockInfo | null) => void;
  placeholder?: string;
  className?: string;
}

export function StockAutocomplete({
  value,
  onChange,
  placeholder = "输入代码或名字，例：600519 / 茅台",
  className,
}: Props) {
  const [query, setQuery] = useState(value ? `${value.code} ${value.name}` : "");
  const [candidates, setCandidates] = useState<StockInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setQuery(`${value.code} ${value.name}`);
    }
  }, [value]);

  // 防抖搜索
  useEffect(() => {
    if (!query.trim() || (value && query === `${value.code} ${value.name}`)) {
      setCandidates([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await searchStocks(query.trim(), 10);
        setCandidates(r);
        setOpen(r.length > 0);
        setActiveIdx(-1);
      } catch {
        setCandidates([]);
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // 点外面关下拉
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pick(s: StockInfo) {
    onChange(s);
    setQuery(`${s.code} ${s.name}`);
    setOpen(false);
    setCandidates([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || candidates.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && activeIdx < candidates.length) {
        e.preventDefault();
        pick(candidates[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null);
        }}
        onFocus={() => candidates.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      {open && candidates.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg">
          {candidates.map((s, idx) => (
            <button
              key={s.code}
              type="button"
              onClick={() => pick(s)}
              onMouseEnter={() => setActiveIdx(idx)}
              className={cn(
                "flex w-full items-center justify-between px-3 py-2 text-sm text-ink-700",
                idx === activeIdx ? "bg-ink-100" : "hover:bg-ink-50",
              )}
            >
              <span className="font-mono text-xs text-ink-500">{s.code}</span>
              <span className="ml-3 flex-1 text-left">{s.name}</span>
              <span className="text-xs text-ink-400">{s.exchange.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
