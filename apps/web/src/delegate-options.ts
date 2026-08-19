import type { WorkHubLocale } from "@workhub/contracts";

export type DelegateUserOption = {
  id: string;
  nickname: string;
  is_admin: boolean;
};

type OptionLike = {
  value: string;
  textContent: string | null;
};

export function buildDelegateOptionNodes<T extends OptionLike>(
  createOption: () => T,
  users: readonly DelegateUserOption[],
  locale: WorkHubLocale
): T[] {
  return users.map((user) => {
    const option = createOption();
    option.value = user.id;
    option.textContent = `${user.nickname}${user.is_admin
      ? locale === "en-US" ? " (admin)" : "（管理员）"
      : ""}`;
    return option;
  });
}

export function buildDelegateStatusOption<T extends OptionLike>(
  createOption: () => T,
  message: string
): T {
  const option = createOption();
  option.value = "";
  option.textContent = message;
  return option;
}
