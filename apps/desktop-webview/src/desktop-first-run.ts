// WorkHub 桌面 · 首次运行标记（R24 S6）。
//
// 背景：Spotlight 落地页此前永远是空的能力网格（E-10），登录成功和「已经用过一阵子」看起来一模一样。
// 判定「这是不是这个人在这台设备上的第一次登录」需要一个能跨 reload 存活的信号——三条换 token 的
// 路径（昵称重绑 desktop-rebind.ts 的 runDesktopRebind / 密码注册 desktop-login.ts 的
// runDesktopCredentialRegister / 接受邀请 desktop-login.ts 的 runDesktopInviteAccept）都会把服务端
// 响应里如实的 identity.created 落一次本地标记；重新绑定到一个已存在的昵称（created=false）、或
// 普通登录一个已有账号（runDesktopCredentialLogin）都不会落——这两种都不是「第一次」，落地页应保持
// 现有启动器，不假装这是一次新注册。
// 落地页真正建完第一个项目后调 markDesktopOnboarded 清掉标记：同一台设备之后重启不再反复打扰。

const IDENTITY_CREATED_FLAG = "workhub_desktop_identity_created";

// 登录/注册/邀请/重绑成功后调用：created=true 才落标记；created=false 时如实清掉（同一设备之前可能
// 残留过一次未完成的首启标记，比如上次创建时网络中断——这次探明是老账号就不该继续误判成首次）。
export function markDesktopIdentityCreated(storage: Pick<Storage, "setItem" | "removeItem">, created: boolean): void {
  try {
    if (created) {
      storage.setItem(IDENTITY_CREATED_FLAG, "1");
    } else {
      storage.removeItem(IDENTITY_CREATED_FLAG);
    }
  } catch {
    // storage 不可用：首启引导只是体验优化，丢失不影响登录本身可用。
  }
}

// Spotlight 落地页据此决定：渲「建你的第一个项目」引导卡，还是保持现有的能力网格启动器。
export function isDesktopFirstRun(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(IDENTITY_CREATED_FLAG) === "1";
  } catch {
    return false;
  }
}

// 引导卡完成使命后调用（建好第一个项目 / 用户主动跳过）：清掉标记，落地页从此走普通启动器。
export function markDesktopOnboarded(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(IDENTITY_CREATED_FLAG);
  } catch {
    // ignore
  }
}
