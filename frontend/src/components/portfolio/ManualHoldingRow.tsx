"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { StockAutocomplete } from "@/components/portfolio/StockAutocomplete";
import type { StockInfo } from "@/lib/portfolio-api";

export interface ManualRow {
  stock: StockInfo | null;
  shares: string;
  cost: string;
  value: string;
}

interface Props {
  index: number;
  row: ManualRow;
  onChange: (patch: Partial<ManualRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function ManualHoldingRow({
  index,
  row,
  onChange,
  onRemove,
  canRemove,
}: Props) {
  return (
    <div className="grid grid-cols-12 items-center gap-2">
      <span className="col-span-1 text-center text-sm text-ink-400">
        {index + 1}.
      </span>
      <div className="col-span-4">
        <StockAutocomplete
          value={row.stock}
          onChange={(v) => onChange({ stock: v })}
          placeholder="代码或名字"
        />
      </div>
      <Input
        className="col-span-2"
        type="number"
        inputMode="decimal"
        placeholder="持仓"
        value={row.shares}
        onChange={(e) => onChange({ shares: e.target.value })}
      />
      <Input
        className="col-span-2"
        type="number"
        inputMode="decimal"
        placeholder="成本"
        value={row.cost}
        onChange={(e) => onChange({ cost: e.target.value })}
      />
      <Input
        className="col-span-2"
        type="number"
        inputMode="decimal"
        placeholder="市值"
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
      />
      <Button
        variant="ghost"
        size="sm"
        className="col-span-1"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="移除"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
