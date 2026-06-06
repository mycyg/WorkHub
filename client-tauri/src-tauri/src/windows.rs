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
        width: 1180,
        height: 780,
        min_width: Some(960),
        min_height: Some(640),
        resizable: true,
        visible: true,
        focus: true,
        transparent: false,
        decorations: true,
        always_on_top: false,
        skip_taskbar: false,
    }
}

pub fn pet_window_plan() -> ShellWindowPlan {
    ShellWindowPlan {
        label: "pet".to_string(),
        kind: ShellWindowKind::Pet,
        title: "Cuu".to_string(),
        route: "/?surface=pet".to_string(),
        width: 180,
        height: 220,
        min_width: Some(160),
        min_height: Some(180),
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
        assert_eq!(pet.route, "/?surface=pet");
        assert_eq!(pet.transparent, true);
        assert_eq!(pet.decorations, false);
        assert_eq!(pet.always_on_top, true);
        assert_eq!(pet.skip_taskbar, true);
        assert_eq!(pet.resizable, false);
        assert_eq!(pet.visible, false);
        assert_eq!(pet.focus, false);
        assert!(pet.width <= 220);
        assert!(pet.height <= 260);
    }

    #[test]
    fn main_window_remains_the_full_workhub_shell() {
        let main = main_window_plan();

        assert_eq!(main.label, "main");
        assert_eq!(main.route, "/");
        assert_eq!(main.transparent, false);
        assert_eq!(main.decorations, true);
        assert_eq!(main.always_on_top, false);
        assert_eq!(main.skip_taskbar, false);
        assert_eq!(main.resizable, true);
        assert!(main.width >= 1100);
        assert!(main.height >= 720);
    }

    #[test]
    fn window_plans_serialize_with_tauri_style_field_names() {
        let value = serde_json::to_value(pet_window_plan()).unwrap();

        assert_eq!(value["label"], "pet");
        assert_eq!(value["alwaysOnTop"], true);
        assert_eq!(value["skipTaskbar"], true);
        assert_eq!(value["minWidth"], 160);
        assert_eq!(value["minHeight"], 180);
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
