"use client";

import type { RefObject } from "react";
import { FileUp, LoaderCircle, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  accountStatusOptions,
  accountTypeOptions,
  type AccountStatusFilter,
  type AccountTypeFilter,
} from "@/features/accounts/account-view-model";

export type AccountsToolbarProps = {
  filteredCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  typeFilter: AccountTypeFilter;
  onTypeFilterChange: (value: AccountTypeFilter) => void;
  statusFilter: AccountStatusFilter;
  onStatusFilterChange: (value: AccountStatusFilter) => void;
  importInputRef: RefObject<HTMLInputElement | null>;
  isImporting: boolean;
};

export function AccountsToolbar({
  filteredCount,
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  importInputRef,
  isImporting,
}: AccountsToolbarProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">账户列表</h2>
        <Badge variant="secondary" className="rounded-lg bg-stone-200 px-2 py-0.5 text-stone-700">
          {filteredCount}
        </Badge>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-[260px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
            }}
            placeholder="搜索邮箱 / 文件名 / 备注"
            className="h-10 rounded-xl border-stone-200 bg-white/85 pl-10"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(value) => {
            onTypeFilterChange(value as AccountTypeFilter);
          }}
        >
          <SelectTrigger className="h-10 w-full rounded-xl border-stone-200 bg-white/85 lg:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accountTypeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            onStatusFilterChange(value as AccountStatusFilter);
          }}
        >
          <SelectTrigger className="h-10 w-full rounded-xl border-stone-200 bg-white/85 lg:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accountStatusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="h-10 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
          onClick={() => importInputRef.current?.click()}
          disabled={isImporting}
        >
          {isImporting ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          导入认证文件
        </Button>
      </div>
    </div>
  );
}
