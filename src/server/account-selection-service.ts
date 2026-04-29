import type { AccountRecord } from "@/server/types";

export type AccountSelectorDependencies = {
  listRecords(): Promise<AccountRecord[]>;
  refreshAccountState(accessToken: string): Promise<AccountRecord | null>;
};

export type AccountSelector = {
  reset(accountCount: number): void;
  getAvailableAccessToken(excludedTokens?: Set<string>): Promise<string>;
};

export function createAccountSelector(dependencies: AccountSelectorDependencies): AccountSelector {
  let nextIndex = 0;

  return {
    reset(accountCount: number) {
      if (accountCount > 0) {
        nextIndex %= accountCount;
      } else {
        nextIndex = 0;
      }
    },

    async getAvailableAccessToken(excludedTokens?: Set<string>) {
      const accounts = await dependencies.listRecords();
      // 过滤：未被禁用 + 未在排除集合中（quota=0 的新导入账号也允许参与，刷新后再判断实际余量）
      const candidates = accounts.filter(
        (item) => item.status !== "禁用" && !excludedTokens?.has(item.access_token),
      );
      if (candidates.length === 0) {
        throw new Error("暂无可用账号，请先在账号管理页面添加并启用账号");
      }

      // 优先使用已有 quota 的账号（避免对每个新账号都发起远端请求拖慢速度）
      const withQuota = candidates.filter((item) => item.quota > 0);
      const available = withQuota.length > 0 ? withQuota : candidates;

      while (available.length > 0) {
        const account = available[nextIndex % available.length];
        nextIndex += 1;
        const refreshed = await dependencies.refreshAccountState(account.access_token);
        if (refreshed && refreshed.status !== "禁用" && refreshed.quota > 0) {
          return refreshed.access_token;
        }
        excludedTokens?.add(account.access_token);
        const nextAccounts = available.filter((item) => item.access_token !== account.access_token);
        available.splice(0, available.length, ...nextAccounts);
      }

      throw new Error("暂无可用账号，请先在账号管理页面添加并启用账号");
    },
  };
}
