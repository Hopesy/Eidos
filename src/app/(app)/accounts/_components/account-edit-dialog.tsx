"use client";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
} from "@/features/accounts/account-view-model";
import type { AccountStatus, AccountType } from "@/lib/api";

export type AccountEditDialogProps = {
  open: boolean;
  editStatus: AccountStatus;
  onEditStatusChange: (value: AccountStatus) => void;
  editType: AccountType;
  onEditTypeChange: (value: AccountType) => void;
  editQuota: string;
  onEditQuotaChange: (value: string) => void;
  isUpdating: boolean;
  onClose: () => void;
  onSave: () => void | Promise<void>;
};

export function AccountEditDialog({
  open,
  editStatus,
  onEditStatusChange,
  editType,
  onEditTypeChange,
  editQuota,
  onEditQuotaChange,
  isUpdating,
  onClose,
  onSave,
}: AccountEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : null)}>
      <DialogContent showCloseButton={false} className="rounded-2xl p-4 sm:p-6">
        <DialogHeader className="gap-2">
          <DialogTitle>编辑账户</DialogTitle>
          <DialogDescription className="text-sm leading-6">手动修改账号状态、类型和额度。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">状态</label>
            <Select value={editStatus} onValueChange={(value) => onEditStatusChange(value as AccountStatus)}>
              <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountStatusOptions
                  .filter((option) => option.value !== "all")
                  .map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">类型</label>
            <Select value={editType} onValueChange={(value) => onEditTypeChange(value as AccountType)}>
              <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountTypeOptions
                  .filter((option) => option.value !== "all")
                  .map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">额度</label>
            <Input
              value={editQuota}
              onChange={(event) => onEditQuotaChange(event.target.value)}
              className="h-11 rounded-xl border-stone-200 bg-white"
            />
          </div>
        </div>
        <DialogFooter className="pt-2">
          <Button
            variant="secondary"
            className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
            onClick={onClose}
            disabled={isUpdating}
          >
            取消
          </Button>
          <Button
            className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
            onClick={() => void onSave()}
            disabled={isUpdating}
          >
            {isUpdating ? <LoaderCircle className="size-4 animate-spin" /> : null}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
