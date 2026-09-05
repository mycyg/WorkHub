//! R25 聚焦盒「灵动生长」：锚点几何 + 生长动画的纯计算。
//!
//! 两个历史缺口都落在这一层：
//!
//! - **M-02（R24 S3 走查）聚焦盒一路往下漂**。实测同一会话里顶边 Y 从 133 → 756 → 356 → 172。
//!   根因是 `set_size` 在 macOS 上走 AppKit 的 `setContentSize:`，保持的是 **frame.origin（左下角）**
//!   ——盒子从 671 收到 48 时顶边就往下掉 623（133+623=756，实测数字对得上）。也就是说每次生长/收缩
//!   都以底边为锚点重排，几轮交互后「苹果聚焦盒」就跑到屏幕中下部去了。
//!   修法不是去猜平台的锚定语义，而是**每次改尺寸都显式把位置摆回去**：顶边与水平中心不动，只让底边伸缩。
//! - **BX-06（R24 S4 健康清单）resize 仍是原生窗口硬跳变**，即 R8 apple-feel 复审的 M1/L4：
//!   自 2026-06 承诺的「盒子 spring 生长」从未兑现，每次都是一帧到位的矩形跳变。
//!   修法是把一次 `set_size` 摊成一串 ~16ms 的中间帧（`spotlight_growth_frames`）。
//!
//! 这里只做算术、不碰任何 tauri 类型，`cargo test` 能在没有窗口系统的 CI 上全覆盖。

/// 逻辑坐标矩形：`y` 向下增长，原点在显示器工作区左上角——与 `outer_position()` / `work_area()`
/// 转成 logical 之后的坐标系一致（tao 已经把 macOS 的左下原点翻好了）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpotlightRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl SpotlightRect {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn center_x(&self) -> f64 {
        self.x + self.width / 2.0
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }

    pub fn is_finite(&self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
    }
}

/// 聚焦盒的锚点：**顶边 + 水平中心**（macOS 聚焦搜索就是这两条不动，只让底边伸缩）。
///
/// `applied` 记着壳层上一次亲手摆下去的左上角。下一次改尺寸时用它分辨窗口是「还停在我们摆的地方」
/// 还是「被用户拖走了」——拖走了就以新位置重记锚点，否则沿用记住的顶边（含"底边让位"之前的原始值）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpotlightAnchor {
    pub top: f64,
    pub center_x: f64,
    pub applied: Option<(f64, f64)>,
}

impl SpotlightAnchor {
    pub fn new(top: f64, center_x: f64) -> Self {
        Self {
            top,
            center_x,
            applied: None,
        }
    }
}

/// 判定「窗口还停在壳层上次摆的位置」的容差（逻辑像素）。取 1.5：跨 Retina/非 Retina 的
/// 物理↔逻辑取整最多差 1px，用户真去拖窗口不可能只差这么点。
pub const SPOTLIGHT_ANCHOR_MATCH_EPSILON: f64 = 1.5;

/// 没有记忆时的默认顶边：工作区高度的 10%（与 R8 起 `position_main_window_top_center` 的落点一致）。
pub const SPOTLIGHT_DEFAULT_TOP_RATIO: f64 = 0.10;

/// 生长动画时长。取 180ms：低于 ~140ms 眼睛读不出"生长"只觉得闪了一下，高于 ~220ms 在每次敲键都会
/// 重排的搜索框里会拖泥带水（用户输入比动画快，下一帧目标就来了）。
pub const SPOTLIGHT_GROWTH_DURATION_MS: u64 = 180;

/// 每帧间隔，对齐 60Hz 的 ~16.7ms。真机上 ProMotion 也只是多丢几帧，不会更抖。
pub const SPOTLIGHT_GROWTH_FRAME_MS: u64 = 16;

/// 小于这个高度差直接落到目标：4px 的动画肉眼看不见，却要多 12 次 set_size。
pub const SPOTLIGHT_GROWTH_MIN_DELTA_PX: f64 = 4.0;

/// webview 可能量出离谱的值（0 / NaN / 一屏放不下的高度），落到窗口计划的上下限内。
/// 下限对齐 tauri.conf.json 主窗的 minWidth=420 / minHeight=48（让 idle 细搜索条能真正贴住内容）。
pub fn clamp_spotlight_size(width: f64, height: f64) -> (f64, f64) {
    let safe_width = if width.is_finite() {
        width.clamp(420.0, 1600.0)
    } else {
        720.0
    };
    let safe_height = if height.is_finite() {
        height.clamp(48.0, 1400.0)
    } else {
        480.0
    };
    (safe_width, safe_height)
}

/// 工作区里的默认顶边（屏幕上方，聚焦盒的位置）。
pub fn default_spotlight_top(work_area: SpotlightRect) -> f64 {
    work_area.y + work_area.height * SPOTLIGHT_DEFAULT_TOP_RATIO
}

/// 把「记住的锚点」与「窗口此刻的真实位置」对账。
///
/// 窗口还停在壳层上次摆的位置 → 沿用记住的锚点；否则（用户原生拖动 / `move_main_window_by` /
/// 首次调用 / 上次记账丢失）→ 以窗口当前位置为准重新记锚点。
///
/// 这一条是「底边让位不改锚点」成立的关键：让位那一帧我们摆下去的 y 比 `anchor.top` 小，
/// 但 `applied` 记的就是那个让位后的 y，下一次对账因此判定"没被拖走"，`anchor.top` 原样留着，
/// 盒子收缩回去时自然回到记住的顶边。
pub fn reconcile_spotlight_anchor(
    stored: Option<SpotlightAnchor>,
    current: SpotlightRect,
) -> SpotlightAnchor {
    let observed = SpotlightAnchor::new(current.y, current.center_x());
    if !current.is_finite() {
        return stored.unwrap_or(observed);
    }
    let Some(stored) = stored else {
        return observed;
    };
    let Some((applied_x, applied_y)) = stored.applied else {
        return observed;
    };
    let stayed_put = (applied_x - current.x).abs() <= SPOTLIGHT_ANCHOR_MATCH_EPSILON
        && (applied_y - current.y).abs() <= SPOTLIGHT_ANCHOR_MATCH_EPSILON;
    if stayed_put {
        stored
    } else {
        observed
    }
}

/// 给定锚点与新尺寸，算这一帧窗口该摆的左上角。
///
/// - 水平：`center_x` 不动 → `x = center_x - width/2`；整条盒子留在工作区内（盒子比工作区还宽时贴左边）。
/// - 垂直：`top` 不动。**只有底边顶出工作区时才向上让位**，而且让位只改这一帧的落点、不回写锚点
///   （见 `reconcile_spotlight_anchor`）——否则「长高一次就把顶边往上偷一点」会累积成另一种漂移。
/// - 拿不到工作区（多显示器热插拔、无显示器）→ 不夹紧，宁可原样摆也不要瞎猜一个显示器。
pub fn anchored_spotlight_position(
    anchor: &SpotlightAnchor,
    width: f64,
    height: f64,
    work_area: Option<SpotlightRect>,
) -> (f64, f64) {
    let x = anchor.center_x - width / 2.0;
    let y = anchor.top;
    if !x.is_finite() || !y.is_finite() {
        return (0.0, 0.0);
    }
    let Some(area) = work_area else {
        return (x, y);
    };
    if !area.is_finite() || !width.is_finite() || !height.is_finite() {
        return (x, y);
    }
    let max_x = (area.x + area.width - width).max(area.x);
    let max_y = (area.bottom() - height).max(area.y);
    (x.clamp(area.x, max_x), y.clamp(area.y, max_y))
}

/// 隐藏后再显示（托盘 / Option+Space / Dock / 深链）时的锚点：**记住的顶边 + 屏幕水平居中**。
///
/// 顶边保留是因为用户把盒子拖到哪一档高度是个偏好；水平回中线是因为聚焦盒的心智模型就是"屏幕中间那条"，
/// 而且横向漂移比纵向更容易把盒子推到副屏边缘。拿不到工作区就原样保留锚点（不猜显示器）。
pub fn spotlight_show_anchor(
    anchor: SpotlightAnchor,
    work_area: Option<SpotlightRect>,
) -> SpotlightAnchor {
    let Some(area) = work_area else {
        return anchor;
    };
    if !area.is_finite() {
        return anchor;
    }
    let top = if anchor.top.is_finite() {
        anchor.top
    } else {
        default_spotlight_top(area)
    };
    SpotlightAnchor {
        top,
        center_x: area.center_x(),
        applied: anchor.applied,
    }
}

/// ease-out cubic。**刻意不用带回弹的弹簧**：窗口高度过冲意味着盒子比内容高，透明窗里那几帧就是
/// 一截空玻璃（内容还没那么长），而且过冲会顶出工作区触发让位。生长要的是"迅速铺开再稳住"，
/// ease-out 的前段快、后段收得住，正好。
pub fn ease_out_cubic(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    let inv = 1.0 - t;
    1.0 - inv * inv * inv
}

/// 一次生长的执行计划。
#[derive(Debug, Clone, PartialEq)]
pub enum SpotlightGrowthPlan {
    /// 直接落到目标（减弱动态效果 / 高度几乎没变 / 数值异常）。
    Snap,
    /// 逐帧插值，**最后一帧精确等于目标**（不留亚像素残差）。
    Animate(Vec<f64>),
}

/// 生成插值帧序列。首帧已经带着位移（不是 `from` 本身），末帧精确落在 `to`。
pub fn spotlight_growth_frames(from: f64, to: f64, duration_ms: u64, frame_ms: u64) -> Vec<f64> {
    let frame_ms = frame_ms.max(1);
    let steps = duration_ms.div_ceil(frame_ms).max(1);
    (1..=steps)
        .map(|step| {
            if step == steps {
                to
            } else {
                let t = step as f64 / steps as f64;
                from + (to - from) * ease_out_cubic(t)
            }
        })
        .collect()
}

/// 决定这次改尺寸是补间还是直落。
///
/// `reduced_motion` 由 webview 侧 `matchMedia("(prefers-reduced-motion: reduce)")` 递进来——
/// WKWebView 直接映射 macOS 的「减弱动态效果」，壳层不必自己去问 NSWorkspace（也就不用为此多开
/// 一个 objc2-app-kit feature）。
pub fn plan_spotlight_growth(from: f64, to: f64, reduced_motion: bool) -> SpotlightGrowthPlan {
    if reduced_motion || !from.is_finite() || !to.is_finite() {
        return SpotlightGrowthPlan::Snap;
    }
    if (to - from).abs() < SPOTLIGHT_GROWTH_MIN_DELTA_PX {
        return SpotlightGrowthPlan::Snap;
    }
    SpotlightGrowthPlan::Animate(spotlight_growth_frames(
        from,
        to,
        SPOTLIGHT_GROWTH_DURATION_MS,
        SPOTLIGHT_GROWTH_FRAME_MS,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area() -> SpotlightRect {
        // 1440x900 逻辑点，顶部 25pt 菜单栏 + 底部 Dock 之后的典型工作区。
        SpotlightRect::new(0.0, 25.0, 1440.0, 800.0)
    }

    #[test]
    fn spotlight_size_clamp_allows_idle_search_bar_height() {
        assert_eq!(clamp_spotlight_size(720.0, 52.0), (720.0, 52.0));
        assert_eq!(clamp_spotlight_size(200.0, 20.0), (420.0, 48.0));
        // 非有限值（NaN / ±∞）走的是"回默认尺寸"那条分支，不是夹紧分支——夹紧只对有限的离谱值生效。
        assert_eq!(
            clamp_spotlight_size(f64::NAN, f64::INFINITY),
            (720.0, 480.0)
        );
        assert_eq!(clamp_spotlight_size(9000.0, 9000.0), (1600.0, 1400.0));
    }

    #[test]
    fn growing_and_shrinking_keep_the_top_edge_and_horizontal_centre_fixed() {
        // M-02 的原始复现：671 高的展开态收成 48 的 idle 条，再长回 448。顶边全程不动。
        let anchor = SpotlightAnchor::new(133.0, 720.0);
        let expanded = anchored_spotlight_position(&anchor, 720.0, 671.0, Some(area()));
        let collapsed = anchored_spotlight_position(&anchor, 720.0, 48.0, Some(area()));
        let regrown = anchored_spotlight_position(&anchor, 720.0, 448.0, Some(area()));
        assert_eq!(expanded.1, 133.0);
        assert_eq!(collapsed.1, 133.0);
        assert_eq!(regrown.1, 133.0);
        // 水平中心不动 → 三次的 x 都是 center_x - width/2。
        assert_eq!(expanded.0, 360.0);
        assert_eq!(collapsed.0, 360.0);
        assert_eq!(regrown.0, 360.0);
    }

    #[test]
    fn width_changes_pivot_around_the_horizontal_centre() {
        let anchor = SpotlightAnchor::new(133.0, 720.0);
        assert_eq!(
            anchored_spotlight_position(&anchor, 900.0, 300.0, Some(area())).0,
            270.0
        );
    }

    #[test]
    fn bottom_overflow_moves_up_without_touching_the_anchor() {
        // 顶边记在 700，长到 400 高就会捅穿工作区底（25+800=825）→ 这一帧上移到 425。
        let anchor = SpotlightAnchor::new(700.0, 720.0);
        let (_, y) = anchored_spotlight_position(&anchor, 720.0, 400.0, Some(area()));
        assert_eq!(y, 425.0);
        // 锚点本身没被改（函数是纯的），收回 48 高时立刻回到记住的 700。
        assert_eq!(anchor.top, 700.0);
        assert_eq!(
            anchored_spotlight_position(&anchor, 720.0, 48.0, Some(area())).1,
            700.0
        );
    }

    #[test]
    fn a_box_taller_than_the_work_area_sticks_to_the_work_area_top() {
        let anchor = SpotlightAnchor::new(400.0, 720.0);
        let (_, y) = anchored_spotlight_position(&anchor, 720.0, 1200.0, Some(area()));
        assert_eq!(y, 25.0);
    }

    #[test]
    fn horizontal_clamp_keeps_the_box_inside_a_secondary_monitor() {
        // 副屏：原点在主屏右侧 1440 处。锚点还停在主屏中线时，盒子被夹回副屏左缘而不是横跨两屏。
        let secondary = SpotlightRect::new(1440.0, 0.0, 1280.0, 800.0);
        let anchor = SpotlightAnchor::new(100.0, 720.0);
        let (x, _) = anchored_spotlight_position(&anchor, 720.0, 300.0, Some(secondary));
        assert_eq!(x, 1440.0);
        // 反向：锚点跑到副屏右外侧 → 夹到右缘（工作区右边界 - 盒宽）。
        let anchor = SpotlightAnchor::new(100.0, 3000.0);
        let (x, _) = anchored_spotlight_position(&anchor, 720.0, 300.0, Some(secondary));
        assert_eq!(x, 2000.0);
    }

    #[test]
    fn no_work_area_means_no_clamping_rather_than_guessing_a_monitor() {
        let anchor = SpotlightAnchor::new(-40.0, 100.0);
        assert_eq!(
            anchored_spotlight_position(&anchor, 720.0, 300.0, None),
            (-260.0, -40.0)
        );
    }

    #[test]
    fn anchor_is_reused_while_the_window_stays_where_the_shell_put_it() {
        let stored = SpotlightAnchor {
            top: 133.0,
            center_x: 720.0,
            // 上一帧因底边让位摆到了 y=425，applied 记的就是让位后的落点。
            applied: Some((360.0, 425.0)),
        };
        let current = SpotlightRect::new(360.0, 425.0, 720.0, 400.0);
        let reconciled = reconcile_spotlight_anchor(Some(stored), current);
        assert_eq!(
            reconciled.top, 133.0,
            "让位过的窗口不该把锚点顶边改成让位值"
        );
        assert_eq!(reconciled.center_x, 720.0);
    }

    #[test]
    fn dragging_the_window_reseats_the_anchor() {
        let stored = SpotlightAnchor {
            top: 133.0,
            center_x: 720.0,
            applied: Some((360.0, 133.0)),
        };
        // 用户把盒子拖到别处（原生拖动或 move_main_window_by 都只改位置、不写 applied）。
        let dragged = SpotlightRect::new(500.0, 300.0, 720.0, 200.0);
        let reconciled = reconcile_spotlight_anchor(Some(stored), dragged);
        assert_eq!(reconciled.top, 300.0);
        assert_eq!(reconciled.center_x, 860.0);
        assert_eq!(reconciled.applied, None);
    }

    #[test]
    fn first_call_and_lost_bookkeeping_both_seat_the_anchor_from_the_window() {
        let current = SpotlightRect::new(360.0, 90.0, 720.0, 64.0);
        assert_eq!(
            reconcile_spotlight_anchor(None, current),
            SpotlightAnchor::new(90.0, 720.0)
        );
        assert_eq!(
            reconcile_spotlight_anchor(Some(SpotlightAnchor::new(10.0, 10.0)), current),
            SpotlightAnchor::new(90.0, 720.0)
        );
    }

    #[test]
    fn sub_pixel_rounding_still_counts_as_staying_put() {
        let stored = SpotlightAnchor {
            top: 133.0,
            center_x: 720.0,
            applied: Some((360.0, 133.0)),
        };
        // 物理↔逻辑取整带来的 1px 抖动不该被当成"用户拖窗口"。
        let current = SpotlightRect::new(361.0, 132.0, 720.0, 200.0);
        assert_eq!(reconcile_spotlight_anchor(Some(stored), current).top, 133.0);
    }

    #[test]
    fn showing_again_keeps_the_remembered_top_and_recentres_horizontally() {
        let anchor = SpotlightAnchor {
            top: 210.0,
            center_x: 300.0,
            applied: Some((0.0, 210.0)),
        };
        let shown = spotlight_show_anchor(anchor, Some(area()));
        assert_eq!(shown.top, 210.0);
        assert_eq!(shown.center_x, 720.0);
        let (x, y) = anchored_spotlight_position(&shown, 720.0, 64.0, Some(area()));
        assert_eq!((x, y), (360.0, 210.0));
    }

    #[test]
    fn a_never_placed_box_falls_back_to_the_top_tenth_of_the_work_area() {
        assert_eq!(default_spotlight_top(area()), 105.0);
        let shown = spotlight_show_anchor(
            SpotlightAnchor::new(f64::NAN, f64::NAN),
            Some(SpotlightRect::new(0.0, 25.0, 1440.0, 800.0)),
        );
        assert_eq!(shown.top, 105.0);
    }

    #[test]
    fn growth_frames_start_moving_immediately_and_land_exactly_on_target() {
        let frames = spotlight_growth_frames(48.0, 600.0, 180, 16);
        assert_eq!(frames.len(), 12, "180ms / 16ms 向上取整 = 12 帧");
        assert_eq!(
            *frames.last().expect("frames"),
            600.0,
            "末帧必须精确落到目标"
        );
        assert!(frames[0] > 48.0 && frames[0] < 200.0);
        // 单调递增（ease-out 不回弹）。
        for pair in frames.windows(2) {
            assert!(pair[1] > pair[0], "帧序列必须单调：{pair:?}");
        }
        // ease-out：前半程已经走完大半。
        assert!(frames[5] > 48.0 + (600.0 - 48.0) * 0.8);
    }

    #[test]
    fn shrinking_uses_the_same_curve_in_reverse() {
        let frames = spotlight_growth_frames(600.0, 48.0, 180, 16);
        assert_eq!(*frames.last().expect("frames"), 48.0);
        for pair in frames.windows(2) {
            assert!(pair[1] < pair[0], "收缩也必须单调：{pair:?}");
        }
    }

    #[test]
    fn reduced_motion_and_hairline_deltas_snap_instead_of_animating() {
        assert_eq!(
            plan_spotlight_growth(48.0, 600.0, true),
            SpotlightGrowthPlan::Snap
        );
        assert_eq!(
            plan_spotlight_growth(600.0, 602.0, false),
            SpotlightGrowthPlan::Snap
        );
        assert_eq!(
            plan_spotlight_growth(f64::NAN, 600.0, false),
            SpotlightGrowthPlan::Snap
        );
        assert!(matches!(
            plan_spotlight_growth(48.0, 600.0, false),
            SpotlightGrowthPlan::Animate(_)
        ));
    }

    #[test]
    fn ease_out_cubic_is_bounded_and_never_overshoots() {
        assert_eq!(ease_out_cubic(0.0), 0.0);
        assert_eq!(ease_out_cubic(1.0), 1.0);
        assert_eq!(ease_out_cubic(-1.0), 0.0);
        assert_eq!(ease_out_cubic(2.0), 1.0);
        for step in 0..=100 {
            let value = ease_out_cubic(f64::from(step) / 100.0);
            assert!((0.0..=1.0).contains(&value), "t={step} → {value}");
        }
    }
}
