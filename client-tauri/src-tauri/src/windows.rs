use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellWindowKind {
    Main,
    Pet,
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
    vec![main_window_plan(), pet_window_plan()]
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
        // R7 真·液态玻璃：主窗口透明，配合 main.rs 的 window-vibrancy(macOS vibrancy / Windows acrylic)
        // 让玻璃穿透看到桌面。前端 liquid-glass.ts 把 app 底色改半透明放行 OS 毛玻璃。
        transparent: true,
        // R8 彻底重构：主窗 = 只剩透明玻璃命令盒（搜索框即整个 app）。去掉 OS 标题栏 chrome → frameless，
        // 盒外空白由前端 -webkit-app-region:drag 拖动整窗；退出走 ⌘Q / Dock。
        decorations: false,
        always_on_top: false,
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
        // R7 真·液态玻璃：主窗口透明（配合 window-vibrancy 穿透看桌面）。
        assert_eq!(main.transparent, true);
        // R8：主窗 frameless（去 OS 标题栏，只剩透明玻璃聚焦盒）。
        assert_eq!(main.decorations, false);
        assert_eq!(main.always_on_top, false);
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
    fn default_window_plan_has_main_and_pet_labels() {
        let labels = default_window_plans()
            .into_iter()
            .map(|plan| plan.label)
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["main", "pet"]);
        assert_eq!(window_plan_by_label("pet").unwrap().is_pet_window(), true);
        assert_eq!(window_plan_by_label("unknown"), None);
    }
}
