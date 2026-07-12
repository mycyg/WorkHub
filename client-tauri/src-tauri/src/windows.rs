use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellWindowKind {
    Main,
    Pet,
    Workbench,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellWindowPlan {
    pub label: String,
    pub kind: ShellWindowKind,
    pub title: String,
    pub route: String,
    pub width: u32,
    pub height: u32,
    pub min_width: Option<u32>,
    pub min_height: Option<u32>,
    pub resizable: bool,
    pub visible: bool,
    pub focus: bool,
    pub transparent: bool,
    pub decorations: bool,
    pub always_on_top: bool,
    pub skip_taskbar: bool,
}

impl ShellWindowPlan {
    pub fn is_pet_window(&self) -> bool {
        self.kind == ShellWindowKind::Pet
    }

    pub fn tauri_conf_label(&self) -> &str {
        &self.label
    }
}

pub fn default_window_plans() -> Vec<ShellWindowPlan> {
    vec![main_window_plan(), pet_window_plan(), workbench_window_plan()]
}

pub fn main_window_plan() -> ShellWindowPlan {
    ShellWindowPlan {
        label: "main".to_string(),
        kind: ShellWindowKind::Main,
        title: "WorkHub".to_string(),
        route: "/".to_string(),
        // R8 真·Spotlight：主窗 = 一个会随内容缩放的小玻璃盒（苹果聚焦风）。起始 720×64（idle
        // 只露搜索条），webview 测得内容高度后经 set_spotlight_size 命令缩放窗高（top-left 锚定，
        // 向下生长）。min_height 收到 48 让收起态能真正贴住搜索条，不在条下留空玻璃。
        width: 720,
        height: 64,
        min_width: Some(420),
        min_height: Some(48),
        resizable: true,
        visible: true,
        focus: true,
        // 真·液态玻璃：主窗口保持完全透明，不叠原生 material；光学表面由 WebView
        // 内的 SVG displacement + backdrop/filter/highlight 层负责。
        transparent: true,
        // R8 彻底重构：主窗 = 只剩透明玻璃命令盒（搜索框即整个 app）。去掉 OS 标题栏 chrome → frameless，
        // 盒外空白由前端 -webkit-app-region:drag 拖动整窗；退出走 ⌘Q / Dock。
        decorations: false,
        always_on_top: true,
        skip_taskbar: false,
    }
}

pub fn pet_window_plan() -> ShellWindowPlan {
    ShellWindowPlan {
        label: "pet".to_string(),
        kind: ShellWindowKind::Pet,
        title: "Cuu".to_string(),
        route: "/pet.html".to_string(),
        width: 260,
        height: 340,
        min_width: Some(220),
        min_height: Some(300),
        resizable: false,
        visible: false,
        focus: false,
        transparent: true,
        decorations: false,
        always_on_top: true,
        skip_taskbar: true,
    }
}

pub fn workbench_window_plan() -> ShellWindowPlan {
    ShellWindowPlan {
        label: "workbench".to_string(),
        kind: ShellWindowKind::Workbench,
        title: "WorkHub 工作台".to_string(),
        route: "/workbench.html".to_string(),
        // R12 项目工作台：常驻三栏主窗（群聊/协同/网盘 + 右栏情境面板）。与 Spotlight 聚焦盒
        // 分工——盒子用完即走，工作台承载常驻协作；默认隐藏，由 open_workbench / 深链唤起。
        width: 1280,
        height: 800,
        min_width: Some(960),
        min_height: Some(620),
        resizable: true,
        visible: false,
        focus: false,
        // 玻璃同主窗策略：透明窗 + 原生 vibrancy（CSS backdrop-filter 在透明窗是空操作）。
        transparent: true,
        decorations: false,
        // 工作台是普通工作窗口，不悬浮压别人。
        always_on_top: false,
        skip_taskbar: false,
    }
}

pub fn window_plan_by_label(label: &str) -> Option<ShellWindowPlan> {
    default_window_plans()
        .into_iter()
        .find(|plan| plan.label == label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pet_window_contract_matches_cuu_desktop_concept() {
        let pet = pet_window_plan();

        assert_eq!(pet.label, "pet");
        assert_eq!(pet.title, "Cuu");
        assert_eq!(pet.route, "/pet.html");
        assert_eq!(pet.transparent, true);
        assert_eq!(pet.decorations, false);
        assert_eq!(pet.always_on_top, true);
        assert_eq!(pet.skip_taskbar, true);
        assert_eq!(pet.resizable, false);
        assert_eq!(pet.visible, false);
        assert_eq!(pet.focus, false);
        assert!(pet.width <= 280);
        assert!(pet.height <= 360);
    }

    #[test]
    fn main_window_is_a_resizable_spotlight_shell() {
        let main = main_window_plan();

        assert_eq!(main.label, "main");
        assert_eq!(main.route, "/");
        // 真·液态玻璃：主窗口透明，不依赖原生 vibrancy 底材。
        assert_eq!(main.transparent, true);
        // R8：主窗 frameless（去 OS 标题栏，只剩透明玻璃聚焦盒）。
        assert_eq!(main.decorations, false);
        // WorkHub Spotlight should behave like Cuu: it stays above normal app windows when opened.
        assert_eq!(main.always_on_top, true);
        assert_eq!(main.skip_taskbar, false);
        assert_eq!(main.resizable, true);
        // R8 真·Spotlight：小窗随内容缩放（不再是 1180×780 全屏壳）。
        assert_eq!(main.width, 720);
        assert_eq!(main.height, 64);
        assert_eq!(main.min_width, Some(420));
        assert_eq!(main.min_height, Some(48));
        assert!(main.width <= 900);
        assert!(main.height <= 640);
    }

    #[test]
    fn window_plans_serialize_with_tauri_style_field_names() {
        let value = serde_json::to_value(pet_window_plan()).unwrap();

        assert_eq!(value["label"], "pet");
        assert_eq!(value["alwaysOnTop"], true);
        assert_eq!(value["skipTaskbar"], true);
        assert_eq!(value["minWidth"], 220);
        assert_eq!(value["minHeight"], 300);
    }

    #[test]
    fn default_window_plan_has_main_pet_and_workbench_labels() {
        let labels = default_window_plans()
            .into_iter()
            .map(|plan| plan.label)
            .collect::<Vec<_>>();

        // R12 起默认窗口族新增常驻工作台窗（此前为 ["main","pet"]，属声明式行为变更）。
        assert_eq!(labels, vec!["main", "pet", "workbench"]);
        assert_eq!(window_plan_by_label("pet").unwrap().is_pet_window(), true);
        assert_eq!(window_plan_by_label("unknown"), None);
    }

    #[test]
    fn workbench_window_is_a_resident_glass_workspace() {
        let workbench = workbench_window_plan();

        assert_eq!(workbench.label, "workbench");
        assert_eq!(workbench.kind, ShellWindowKind::Workbench);
        assert_eq!(workbench.route, "/workbench.html");
        // 常驻工作窗：默认隐藏等唤起、可缩放、不置顶、不跳过任务栏。
        assert_eq!(workbench.visible, false);
        assert_eq!(workbench.focus, false);
        assert_eq!(workbench.resizable, true);
        assert_eq!(workbench.always_on_top, false);
        assert_eq!(workbench.skip_taskbar, false);
        // 玻璃约束：透明 + frameless（毛玻璃靠原生 vibrancy，不靠 CSS blur）。
        assert_eq!(workbench.transparent, true);
        assert_eq!(workbench.decorations, false);
        // 三栏工作台需要真实桌面级面积，且最小尺寸不能塌到三栏摆不下。
        assert!(workbench.width >= 1200);
        assert!(workbench.height >= 720);
        assert_eq!(workbench.min_width, Some(960));
        assert_eq!(workbench.min_height, Some(620));
        assert_eq!(workbench.is_pet_window(), false);
    }
}
