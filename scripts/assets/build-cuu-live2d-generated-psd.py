from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "apps/desktop-webview/src/assets/cuu/live2d/source/generated-parts-v0"
OUT_DIR = ROOT / "apps/desktop-webview/src/assets/cuu/live2d/source/generated-psd-draft-v1"
LAYERS_DIR = OUT_DIR / "layers"
PSD_FILE = OUT_DIR / "cuu-live2d-generated-psd-draft-v1.psd"
PREVIEW_FILE = OUT_DIR / "cuu-live2d-generated-psd-draft-v1-preview.png"
PSD_COMPOSITE_FILE = OUT_DIR / "cuu-live2d-generated-psd-draft-v1-psd-composite.png"
MANIFEST_FILE = OUT_DIR / "cuu-live2d-generated-psd-draft-v1.manifest.json"
REPORT_FILE = OUT_DIR / "cuu-live2d-generated-psd-draft-v1-report.json"

CANVAS_SIZE = (1200, 1600)

GROUP_ORDER = [
    "00_Guide_DoNotExport",
    "10_Back",
    "20_Body",
    "30_Tail",
    "40_Head",
    "50_Face",
    "60_Collar",
    "70_Accessories",
    "80_Expressions",
]

BOARDS = {
    "parts": "cuu-live2d-generated-parts-board-v0",
    "face": "cuu-live2d-generated-face-parts-v0",
    "body": "cuu-live2d-generated-body-parts-v0",
    "accessory": "cuu-live2d-generated-accessory-parts-v0",
}


Layer = dict[str, Any]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    LAYERS_DIR.mkdir(parents=True, exist_ok=True)
    for stale_layer in LAYERS_DIR.glob("*.png"):
        stale_layer.unlink()

    layers: list[Layer] = []
    add_guide_layers(layers)
    add_body_and_tail_layers(layers)
    add_head_and_face_layers(layers)
    add_collar_and_accessory_layers(layers)

    validate_unique_layer_names(layers)
    save_layer_pngs(layers)
    preview = composite_preview(layers)
    preview.save(PREVIEW_FILE)
    save_psd(layers)
    save_psd_composite()
    MANIFEST_FILE.write_text(json.dumps(build_manifest(layers), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT_FILE.write_text(json.dumps(build_report(layers), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {PSD_FILE.relative_to(ROOT)}")
    print(f"layers: {len(layers)}")
    print(f"default visible layers: {sum(1 for layer in layers if layer['opacity'] > 0)}")


def add_guide_layers(layers: list[Layer]) -> None:
    add_component(layers, "00_Guide_DoNotExport", "Guide_Body_Reference_DoNotBind", "body", 1, 820, 250, 300, 427, 1, opacity=0, bind_target=None, note="Generated full-body pose reference only; do not bind or export.")
    add_component(layers, "00_Guide_DoNotExport", "Guide_Face_Reference_DoNotBind", "face", 2, 50, 80, 288, 276, 2, opacity=0, bind_target=None, note="Generated full-head expression reference only; do not bind or export.")
    add_component(layers, "00_Guide_DoNotExport", "Guide_Collar_Reference_DoNotBind", "accessory", 3, 50, 690, 356, 325, 3, opacity=0, bind_target=None, note="Generated collar and tassel reference only; do not bind or export.")
    add_component(layers, "00_Guide_DoNotExport", "Guide_PartsBoard_Reference_DoNotBind", "parts", 1, 40, 1080, 246, 232, 4, opacity=0, bind_target=None, note="Generated component board sample reference only; do not bind or export.")


def add_body_and_tail_layers(layers: list[Layer]) -> None:
    add_paint(layers, "10_Back", "Shadow_SoftUnderBody", 360, 1132, 450, 96, 10, [
        {"kind": "ellipse", "xy": (0, 18, 450, 78), "fill": (60, 43, 30, 72), "blur": 10},
    ], opacity=90, origin="paint_behind_placeholder", bind_target=None, note="Preview shadow only; remove or replace in final Cubism texture.")

    add_component(layers, "30_Tail", "Body_PaintBehind_TailRoot", "body", 17, 702, 646, 108, 177, 20, opacity=0, origin="paint_behind_placeholder", bind_target="TailRoot", note="Generated orange paint-behind patch for tail root coverage.")
    add_component(layers, "30_Tail", "Tail_Base", "body", 18, 710, 705, 168, 210, 21, bind_target="Tail_Base")
    add_component(layers, "30_Tail", "Tail_01", "body", 19, 780, 744, 230, 211, 22, bind_target="Tail_01")
    add_component(layers, "30_Tail", "Tail_02", "body", 21, 850, 790, 224, 204, 23, bind_target="Tail_02")
    add_component(layers, "30_Tail", "Tail_03", "body", 22, 915, 842, 190, 167, 24, bind_target="Tail_03")
    add_component(layers, "30_Tail", "Tail_Tip", "body", 23, 960, 878, 174, 136, 25, bind_target="Tail_Tip")
    add_component(layers, "30_Tail", "Tail_Alt_Curl_DoNotDefault", "body", 20, 900, 770, 112, 201, 26, opacity=0, bind_target="Tail_Alt", note="Alternate curled tail candidate, hidden by default.")
    add_paint(layers, "30_Tail", "Tail_ShadowOnBody", 704, 710, 308, 210, 27, [
        {"kind": "ellipse", "xy": (18, 32, 288, 182), "fill": (78, 42, 22, 46), "blur": 8},
    ], opacity=0, origin="paint_behind_placeholder", bind_target="Tail", note="Optional tail/body contact shadow; hidden until Cubism review.")

    add_component(layers, "20_Body", "Body_BackFur", "body", 2, 382, 545, 428, 570, 40, bind_target="Body")
    add_component(layers, "20_Body", "Body_ChestCream", "body", 3, 440, 634, 335, 526, 41, bind_target="Body")
    add_component(layers, "20_Body", "Body_SideFur_L", "body", 5, 396, 688, 118, 440, 42, opacity=0, bind_target="BodyAngleL", note="Generated side-fur angle layer, hidden in default front pose.")
    add_component(layers, "20_Body", "Body_SideFur_R", "body", 4, 694, 688, 122, 450, 43, opacity=0, bind_target="BodyAngleR", note="Generated side-fur angle layer, hidden in default front pose.")
    add_component(layers, "20_Body", "Body_PaintBehind_Collar", "body", 20, 495, 558, 104, 187, 44, opacity=0, origin="paint_behind_placeholder", bind_target="Body", note="Cream paint-behind patch for collar swing coverage.")
    add_component(layers, "20_Body", "Body_PaintBehind_Paws", "body", 17, 424, 900, 110, 180, 45, opacity=0, origin="paint_behind_placeholder", bind_target="Body", note="Orange paint-behind patch for front paw lift coverage.")
    add_component(layers, "20_Body", "Paw_L_FrontUpper", "body", 6, 424, 872, 105, 308, 50, bind_target="Paw_L_Front")
    add_component(layers, "20_Body", "Paw_L_FrontLower", "body", 9, 416, 982, 104, 288, 51, opacity=0, bind_target="Paw_L_Front", note="Alternate paw-pad lower layer, hidden by default.")
    add_component(layers, "20_Body", "Paw_R_FrontUpper", "body", 7, 542, 872, 108, 306, 52, bind_target="Paw_R_Front")
    add_component(layers, "20_Body", "Paw_R_FrontLower", "body", 10, 545, 984, 104, 280, 53, opacity=0, bind_target="Paw_R_Front", note="Alternate paw-pad lower layer, hidden by default.")
    add_component(layers, "20_Body", "Paw_L_Back", "body", 13, 376, 1058, 82, 61, 54, bind_target="Paw_L_Back")
    add_component(layers, "20_Body", "Paw_R_Back", "body", 14, 650, 1062, 82, 59, 55, bind_target="Paw_R_Back")
    add_component(layers, "20_Body", "Paw_L_Pads_DoNotDefault", "body", 12, 414, 1070, 68, 120, 56, opacity=0, bind_target="Paw_L_Front", note="Paw pad detail candidate, hidden for standing default pose.")
    add_component(layers, "20_Body", "Paw_R_Pads_DoNotDefault", "body", 11, 575, 1070, 70, 125, 57, opacity=0, bind_target="Paw_R_Front", note="Paw pad detail candidate, hidden for standing default pose.")
    add_component(layers, "20_Body", "Paw_Toe_L_01", "body", 15, 442, 1092, 43, 30, 58, opacity=0, bind_target="Paw_L_Front", note="Individual toe candidate, hidden until paw mesh pass.")
    add_component(layers, "20_Body", "Paw_Toe_R_01", "body", 16, 594, 1094, 43, 27, 59, opacity=0, bind_target="Paw_R_Front", note="Individual toe candidate, hidden until paw mesh pass.")


def add_head_and_face_layers(layers: list[Layer]) -> None:
    add_component(layers, "40_Head", "Head_BaseClean", "face", 1, 250, 86, 580, 495, 80, bind_target="Head")
    add_component(layers, "40_Head", "Head_Reference_DoNotBind", "face", 2, 286, 110, 530, 508, 81, opacity=0, bind_target=None, note="Full-expression head reference, hidden by default.")
    add_component(layers, "40_Head", "Ear_L_Outer", "face", 3, 254, 96, 162, 241, 82, bind_target="Ear_L")
    add_component(layers, "40_Head", "Ear_R_Outer", "face", 4, 662, 98, 160, 241, 83, bind_target="Ear_R")
    add_component(layers, "40_Head", "Ear_L_Inner", "face", 5, 290, 132, 106, 190, 84, bind_target="Ear_L")
    add_component(layers, "40_Head", "Ear_R_Inner", "face", 6, 682, 134, 108, 193, 85, bind_target="Ear_R")
    add_component(layers, "40_Head", "Ear_L_Inner_Fur_01_SourceCandidate_DoNotDefault", "face", 7, 312, 178, 34, 75, 86, opacity=0, bind_target="Ear_L", note="Generated ear-fur candidate hidden because green-screen fringe remains visible.")
    add_component(layers, "40_Head", "Ear_L_Inner_Fur_02_SourceCandidate_DoNotDefault", "face", 9, 348, 182, 26, 74, 87, opacity=0, bind_target="Ear_L", note="Generated ear-fur candidate hidden because green-screen fringe remains visible.")
    add_component(layers, "40_Head", "Ear_R_Inner_Fur_01_SourceCandidate_DoNotDefault", "face", 8, 716, 180, 36, 72, 88, opacity=0, bind_target="Ear_R", note="Generated ear-fur candidate hidden because green-screen fringe remains visible.")
    add_paint(layers, "40_Head", "Ear_L_Inner_Fur_01", 316, 184, 80, 100, 86, [
        {"kind": "line", "xy": (16, 72, 34, 16), "fill": (255, 217, 178, 190), "width": 3},
        {"kind": "line", "xy": (34, 76, 46, 22), "fill": (255, 229, 192, 160), "width": 2},
        {"kind": "line", "xy": (50, 74, 60, 28), "fill": (255, 229, 192, 150), "width": 2},
    ], origin="procedural_detail", bind_target="Ear_L", note="Temporary clean ear-fur replacement.")
    add_paint(layers, "40_Head", "Ear_R_Inner_Fur_01", 698, 184, 80, 100, 88, [
        {"kind": "line", "xy": (64, 72, 46, 16), "fill": (255, 217, 178, 190), "width": 3},
        {"kind": "line", "xy": (46, 76, 34, 22), "fill": (255, 229, 192, 160), "width": 2},
        {"kind": "line", "xy": (30, 74, 20, 28), "fill": (255, 229, 192, 150), "width": 2},
    ], origin="procedural_detail", bind_target="Ear_R", note="Temporary clean ear-fur replacement.")
    add_component(layers, "40_Head", "FurTuft_Front_01", "face", 10, 420, 120, 86, 38, 89, bind_target="Head")
    add_component(layers, "40_Head", "FurTuft_Front_02", "face", 11, 540, 118, 86, 38, 90, bind_target="Head")

    add_component(layers, "50_Face", "Muzzle_Cream", "face", 28, 430, 396, 255, 129, 100, bind_target="Muzzle")
    add_component(layers, "50_Face", "Eye_L_White", "face", 12, 400, 282, 94, 99, 101, bind_target="Eye_L")
    add_component(layers, "50_Face", "Eye_R_White", "face", 13, 588, 282, 94, 99, 102, bind_target="Eye_R")
    add_component(layers, "50_Face", "Eye_L_Iris", "face", 14, 410, 292, 78, 83, 103, bind_target="Eye_L")
    add_component(layers, "50_Face", "Eye_R_Iris", "face", 15, 598, 292, 79, 83, 104, bind_target="Eye_R")
    add_component(layers, "50_Face", "Eye_L_Pupil", "face", 16, 424, 306, 54, 58, 105, bind_target="Eye_L")
    add_component(layers, "50_Face", "Eye_R_Pupil", "face", 17, 612, 306, 58, 59, 106, bind_target="Eye_R")
    add_paint(layers, "50_Face", "Eye_L_Highlight_01", 430, 300, 30, 28, 107, [
        {"kind": "ellipse", "xy": (3, 2, 17, 16), "fill": (255, 255, 248, 238)},
        {"kind": "ellipse", "xy": (18, 16, 26, 24), "fill": (255, 248, 220, 180)},
    ], origin="procedural_detail", bind_target="Eye_L", note="Highlight split for Cubism eye sparkle.")
    add_paint(layers, "50_Face", "Eye_R_Highlight_01", 618, 300, 30, 28, 108, [
        {"kind": "ellipse", "xy": (3, 2, 17, 16), "fill": (255, 255, 248, 238)},
        {"kind": "ellipse", "xy": (18, 16, 26, 24), "fill": (255, 248, 220, 180)},
    ], origin="procedural_detail", bind_target="Eye_R", note="Highlight split for Cubism eye sparkle.")
    add_component(layers, "50_Face", "Eye_L_UpperLid", "face", 18, 392, 270, 104, 29, 109, bind_target="Eye_L")
    add_component(layers, "50_Face", "Eye_R_UpperLid", "face", 19, 582, 270, 102, 30, 110, bind_target="Eye_R")
    add_component(layers, "50_Face", "Eye_L_LowerLid", "face", 24, 392, 366, 102, 36, 111, opacity=165, bind_target="Eye_L")
    add_component(layers, "50_Face", "Eye_R_LowerLid", "face", 25, 582, 366, 100, 36, 112, opacity=165, bind_target="Eye_R")
    add_component(layers, "50_Face", "Nose_Base", "face", 29, 534, 398, 78, 50, 113, bind_target="Nose")
    add_component(layers, "50_Face", "Mouth_Line_Closed", "face", 37, 524, 464, 84, 17, 114, bind_target="Mouth")
    add_component(layers, "50_Face", "Whisker_L_SourceCandidate_DoNotDefault", "face", 39, 306, 438, 180, 23, 115, opacity=0, bind_target="Whisker_L", note="Generated whisker candidate retained for art review; hidden because green-screen fringe is still visible.")
    add_component(layers, "50_Face", "Whisker_R_SourceCandidate_DoNotDefault", "face", 38, 594, 438, 182, 26, 116, opacity=0, bind_target="Whisker_R", note="Generated whisker candidate retained for art review; hidden because green-screen fringe is still visible.")
    add_paint(layers, "50_Face", "Whisker_L_01", 294, 424, 190, 70, 117, [
        {"kind": "line", "xy": (6, 24, 180, 10), "fill": (246, 238, 218, 210), "width": 2},
        {"kind": "line", "xy": (0, 42, 184, 34), "fill": (246, 238, 218, 185), "width": 2},
        {"kind": "line", "xy": (24, 58, 188, 64), "fill": (246, 238, 218, 170), "width": 2},
    ], origin="procedural_detail", bind_target="Whisker_L", note="Temporary clean whisker replacement until regenerated source whisker is approved.")
    add_paint(layers, "50_Face", "Whisker_R_01", 598, 424, 190, 70, 118, [
        {"kind": "line", "xy": (8, 10, 184, 24), "fill": (246, 238, 218, 210), "width": 2},
        {"kind": "line", "xy": (4, 34, 188, 42), "fill": (246, 238, 218, 185), "width": 2},
        {"kind": "line", "xy": (2, 64, 166, 58), "fill": (246, 238, 218, 170), "width": 2},
    ], origin="procedural_detail", bind_target="Whisker_R", note="Temporary clean whisker replacement until regenerated source whisker is approved.")
    add_component(layers, "50_Face", "Cheek_Blush_L_SourceCandidate_DoNotDefault", "face", 40, 358, 392, 112, 62, 119, opacity=0, bind_target="Cheek_L", note="Generated blush candidate hidden because green-screen edge is still visible.")
    add_component(layers, "50_Face", "Cheek_Blush_R_SourceCandidate_DoNotDefault", "face", 41, 626, 392, 114, 63, 120, opacity=0, bind_target="Cheek_R", note="Generated blush candidate hidden because green-screen edge is still visible.")
    add_paint(layers, "50_Face", "Cheek_Blush_L", 358, 394, 112, 62, 119, [
        {"kind": "ellipse", "xy": (0, 4, 112, 58), "fill": (242, 139, 92, 54), "blur": 6},
    ], origin="procedural_detail", bind_target="Cheek_L", note="Temporary clean blush replacement.")
    add_paint(layers, "50_Face", "Cheek_Blush_R", 626, 394, 114, 62, 120, [
        {"kind": "ellipse", "xy": (0, 4, 114, 58), "fill": (242, 139, 92, 54), "blur": 6},
    ], origin="procedural_detail", bind_target="Cheek_R", note="Temporary clean blush replacement.")

    add_component(layers, "80_Expressions", "Eye_L_Closed", "face", 30, 400, 318, 82, 35, 130, opacity=0, bind_target="Eye_L", note="Blink replacement, hidden in default pose.")
    add_component(layers, "80_Expressions", "Eye_R_Closed", "face", 31, 594, 318, 82, 35, 131, opacity=0, bind_target="Eye_R", note="Blink replacement, hidden in default pose.")
    add_component(layers, "80_Expressions", "Eye_L_WorriedLine", "face", 26, 392, 260, 80, 42, 132, opacity=0, bind_target="Eye_L", note="Worried expression candidate, hidden by default.")
    add_component(layers, "80_Expressions", "Eye_R_WorriedLine", "face", 27, 604, 260, 78, 42, 133, opacity=0, bind_target="Eye_R", note="Worried expression candidate, hidden by default.")
    add_component(layers, "80_Expressions", "Mouth_OpenSmall", "face", 33, 540, 458, 44, 53, 134, opacity=0, bind_target="Mouth", note="Small speaking mouth, hidden by default.")
    add_component(layers, "80_Expressions", "Mouth_Surprised", "face", 32, 532, 450, 58, 68, 135, opacity=0, bind_target="Mouth", note="Surprised mouth, hidden by default.")
    add_component(layers, "80_Expressions", "Mouth_Smile", "face", 36, 518, 456, 84, 43, 136, opacity=0, bind_target="Mouth", note="Smile mouth, hidden by default.")
    add_component(layers, "80_Expressions", "Mouth_Tongue", "face", 35, 544, 468, 44, 55, 137, opacity=0, bind_target="Mouth", note="Tongue candidate, hidden by default.")
    add_component(layers, "80_Expressions", "Mouth_Inside_Wide", "face", 34, 520, 456, 85, 54, 138, opacity=0, bind_target="Mouth", note="Wide open-mouth inside, hidden by default.")
    add_component(layers, "80_Expressions", "Whisker_L_Alt_01", "face", 42, 304, 462, 184, 37, 139, opacity=0, bind_target="Whisker_L", note="Alternate whisker curve, hidden by default.")
    add_component(layers, "80_Expressions", "Whisker_R_Alt_01", "face", 43, 596, 462, 184, 28, 140, opacity=0, bind_target="Whisker_R", note="Alternate whisker curve, hidden by default.")
    add_component(layers, "80_Expressions", "Whisker_L_Alt_02", "face", 44, 314, 486, 150, 57, 141, opacity=0, bind_target="Whisker_L", note="Alternate whisker curve, hidden by default.")
    add_component(layers, "80_Expressions", "Whisker_R_Alt_02", "face", 45, 626, 486, 150, 51, 142, opacity=0, bind_target="Whisker_R", note="Alternate whisker curve, hidden by default.")


def add_collar_and_accessory_layers(layers: list[Layer]) -> None:
    add_component(layers, "60_Collar", "LaceBib_Back", "accessory", 2, 314, 492, 520, 224, 150, bind_target="LaceBib")
    add_component(layers, "60_Collar", "LaceBib_Front", "accessory", 1, 300, 520, 548, 233, 151, bind_target="LaceBib")
    add_component(layers, "60_Collar", "LaceBib_Edge_L", "accessory", 4, 272, 540, 310, 139, 152, opacity=0, bind_target="LaceBib_Edge_L", note="Separated lace left edge candidate, hidden to avoid double lace in default preview.")
    add_component(layers, "60_Collar", "LaceBib_Edge_R", "accessory", 5, 560, 540, 300, 139, 153, opacity=0, bind_target="LaceBib_Edge_R", note="Separated lace right edge candidate, hidden to avoid double lace in default preview.")
    add_component(layers, "60_Collar", "LaceBib_Edge_Bottom", "accessory", 6, 352, 660, 430, 89, 154, opacity=0, bind_target="LaceBib_Edge_Bottom", note="Separated lace bottom edge candidate, hidden to avoid double lace in default preview.")
    for index, part_id in enumerate(range(7, 14), start=1):
        add_component(layers, "60_Collar", f"LaceBib_Scallop_{index:02d}", "accessory", part_id, 316 + (index - 1) * 72, 672, 72, 34, 154 + index, opacity=0, bind_target=f"LaceBib_Scallop_{index:02d}", note="Individual lace scallop candidate, hidden until Cubism lace mesh pass.")

    add_component(layers, "70_Accessories", "Bow_L_Wing", "accessory", 14, 350, 514, 152, 239, 180, bind_target="Bow_L")
    add_component(layers, "70_Accessories", "Bow_R_Wing", "accessory", 15, 484, 514, 154, 238, 181, bind_target="Bow_R")
    add_component(layers, "70_Accessories", "Bow_Center", "accessory", 17, 480, 566, 92, 64, 182, bind_target="Bow_Center")
    add_component(layers, "70_Accessories", "Bow_L_Fold", "accessory", 16, 394, 574, 128, 91, 183, opacity=0, bind_target="Bow_L", note="Bow fold detail candidate, hidden by default.")
    add_component(layers, "70_Accessories", "Bow_R_Fold", "accessory", 18, 500, 574, 128, 76, 184, opacity=0, bind_target="Bow_R", note="Bow fold detail candidate, hidden by default.")
    add_component(layers, "70_Accessories", "Bow_L_TipFold", "accessory", 19, 438, 622, 70, 55, 185, opacity=0, bind_target="Bow_L", note="Small bow tip fold candidate, hidden by default.")
    add_component(layers, "70_Accessories", "Bow_R_TipFold", "accessory", 20, 574, 624, 40, 42, 186, opacity=0, bind_target="Bow_R", note="Small bow tip fold candidate, hidden by default.")

    add_component(layers, "70_Accessories", "Tassel_L_Reference_DoNotBind", "accessory", 22, 326, 620, 68, 302, 190, opacity=0, bind_target=None, note="Full left tassel reference; use split strings and beads for binding.")
    add_component(layers, "70_Accessories", "Tassel_R_Reference_DoNotBind", "accessory", 23, 666, 620, 64, 291, 191, opacity=0, bind_target=None, note="Full right tassel reference; use split strings and beads for binding.")
    add_component(layers, "70_Accessories", "Tassel_L_String_01", "accessory", 21, 332, 626, 12, 312, 192, bind_target="Tassel_L_01")
    add_component(layers, "70_Accessories", "Tassel_L_String_02", "accessory", 25, 350, 640, 12, 279, 193, bind_target="Tassel_L_02")
    add_component(layers, "70_Accessories", "Tassel_L_String_03", "accessory", 30, 372, 704, 12, 250, 194, bind_target="Tassel_L_03")
    add_component(layers, "70_Accessories", "Tassel_L_String_04", "accessory", 39, 388, 756, 12, 172, 195, opacity=0, bind_target="Tassel_L_04", note="Extra left string for richer physics, hidden by default.")
    add_component(layers, "70_Accessories", "Tassel_R_String_01", "accessory", 24, 682, 626, 12, 310, 196, bind_target="Tassel_R_01")
    add_component(layers, "70_Accessories", "Tassel_R_String_02", "accessory", 26, 704, 646, 12, 286, 197, bind_target="Tassel_R_02")
    add_component(layers, "70_Accessories", "Tassel_R_String_03", "accessory", 32, 724, 710, 12, 246, 198, bind_target="Tassel_R_03")
    add_component(layers, "70_Accessories", "Tassel_R_String_04", "accessory", 40, 744, 756, 12, 172, 199, opacity=0, bind_target="Tassel_R_04", note="Extra right string for richer physics, hidden by default.")

    left_beads = [
        ("Pearl_L_01", 27, 326, 850, 48, 49),
        ("Pearl_L_02", 28, 360, 866, 44, 44),
        ("Pearl_L_03", 29, 342, 900, 40, 40),
        ("RedBead_L_01", 41, 314, 820, 32, 32),
        ("RedBead_L_02", 42, 386, 828, 28, 28),
        ("GoldRing_L_01", 51, 328, 806, 34, 34),
        ("GoldBead_L_01", 52, 344, 940, 26, 38),
    ]
    right_beads = [
        ("Pearl_R_01", 27, 684, 850, 48, 49),
        ("Pearl_R_02", 28, 718, 866, 44, 44),
        ("Pearl_R_03", 29, 700, 900, 40, 40),
        ("RedBead_R_01", 41, 674, 820, 32, 32),
        ("RedBead_R_02", 42, 746, 828, 28, 28),
        ("GoldRing_R_01", 51, 686, 806, 34, 34),
        ("GoldBead_R_01", 53, 704, 940, 26, 37),
    ]
    z = 210
    for name, part_id, x, y, w, h in left_beads + right_beads:
        add_component(layers, "70_Accessories", name, "accessory", part_id, x, y, w, h, z, bind_target=name.rsplit("_", 1)[0])
        z += 1
    for index, part_id in enumerate([31, 33, 34, 35, 36, 37, 38, 43, 44, 45, 46, 47, 48, 49, 50, 54, 55, 56, 57, 58, 59, 60, 61], start=1):
        add_component(layers, "80_Expressions", f"Accessory_SpareBead_{index:02d}", "accessory", part_id, 790 + (index % 6) * 34, 820 + (index // 6) * 38, None, None, 230 + index, opacity=0, bind_target="Accessory_Spare", note="Generated spare bead/ring layer for art iteration, hidden by default.")


def add_component(
    layers: list[Layer],
    group: str,
    name: str,
    board_key: str,
    part_id: int,
    x: int,
    y: int,
    width: int | None,
    height: int | None,
    z_index: int,
    *,
    opacity: int = 255,
    origin: str = "generated_layer_png",
    bind_target: str | None,
    note: str | None = None,
) -> None:
    image = load_component(board_key, part_id)
    image = resize_component(image, width, height)
    layers.append({
        "group": group,
        "name": name,
        "origin": origin,
        "source_board": BOARDS[board_key],
        "source_part_id": part_id,
        "image": image,
        "left": x,
        "top": y,
        "width": image.width,
        "height": image.height,
        "opacity": opacity,
        "z_index": z_index,
        "default_visible": opacity > 0,
        "bind_target": bind_target,
        "note": note,
    })


def add_paint(
    layers: list[Layer],
    group: str,
    name: str,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    shapes: list[dict[str, Any]],
    *,
    opacity: int = 255,
    origin: str,
    bind_target: str | None,
    note: str | None,
) -> None:
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for shape in shapes:
        draw_shape(image, shape)
    layers.append({
        "group": group,
        "name": name,
        "origin": origin,
        "source_board": None,
        "source_part_id": None,
        "image": image,
        "left": x,
        "top": y,
        "width": image.width,
        "height": image.height,
        "opacity": opacity,
        "z_index": z_index,
        "default_visible": opacity > 0,
        "bind_target": bind_target,
        "note": note,
    })


def load_component(board_key: str, part_id: int) -> Image.Image:
    board_id = BOARDS[board_key]
    path = SOURCE_DIR / board_id / "components" / f"{board_id}-part-{part_id:03d}.png"
    if not path.exists():
        raise FileNotFoundError(path)
    return remove_green_fringe(Image.open(path).convert("RGBA"))


def remove_green_fringe(image: Image.Image) -> Image.Image:
    rgba = np.array(image, dtype=np.uint8)
    alpha = rgba[:, :, 3].copy()
    if int(alpha.max()) == 0:
        return image

    eroded = np.array(Image.fromarray(alpha, "L").filter(ImageFilter.MinFilter(7)))
    edge = (alpha > 0) & (eroded < 248)
    rgb = rgba[:, :, :3].astype(np.int16)
    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]

    strong_green_edge = edge & (g > 112) & ((g - r) > 18) & ((g - b) > 24)
    alpha[strong_green_edge] = 0

    mild_green_edge = edge & ((g - r) > 4) & ((g - b) > 6) & (g > 90)
    neutral = np.minimum(g, np.maximum(r, b) + 8).clip(0, 255).astype(np.uint8)
    rgba[:, :, 1][mild_green_edge] = neutral[mild_green_edge]
    rgba[:, :, 3] = alpha
    return Image.fromarray(rgba, "RGBA")


def resize_component(image: Image.Image, width: int | None, height: int | None) -> Image.Image:
    if width is None and height is None:
        return image
    if width is None:
        assert height is not None
        width = round(image.width * height / image.height)
    if height is None:
        height = round(image.height * width / image.width)
    return image.resize((max(1, width), max(1, height)), Image.Resampling.LANCZOS)


def draw_shape(image: Image.Image, shape: dict[str, Any]) -> None:
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    kind = shape["kind"]
    xy = tuple(shape["xy"])
    fill = tuple(shape["fill"])
    if kind == "ellipse":
        draw.ellipse(xy, fill=fill)
    elif kind == "rectangle":
        draw.rectangle(xy, fill=fill)
    elif kind == "line":
        draw.line(xy, fill=fill, width=int(shape.get("width", 1)))
    else:
        raise ValueError(f"Unsupported paint shape: {kind}")
    blur = shape.get("blur")
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(float(blur)))
    image.alpha_composite(layer)


def validate_unique_layer_names(layers: list[Layer]) -> None:
    names = [layer["name"] for layer in layers]
    duplicates = sorted(name for name, count in Counter(names).items() if count > 1)
    if duplicates:
        raise RuntimeError(f"Duplicate PSD layer names: {duplicates}")


def save_layer_pngs(layers: list[Layer]) -> None:
    LAYERS_DIR.mkdir(parents=True, exist_ok=True)
    for layer in layers:
        path = LAYERS_DIR / f"{layer['name']}.png"
        layer["image"].save(path)
        layer["image_path"] = str(path.relative_to(OUT_DIR)).replace("\\", "/")


def composite_preview(layers: list[Layer]) -> Image.Image:
    preview = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    for layer in sorted(layers, key=lambda item: item["z_index"]):
        if layer["opacity"] <= 0:
            continue
        image = layer["image"].copy()
        if layer["opacity"] < 255:
            alpha = image.getchannel("A")
            alpha = Image.eval(alpha, lambda value: round(value * layer["opacity"] / 255))
            image.putalpha(alpha)
        preview.alpha_composite(image, (layer["left"], layer["top"]))
    return preview


def save_psd(layers: list[Layer]) -> None:
    psd = PSDImage.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    for group_name in GROUP_ORDER:
        group = psd.create_group(name=group_name)
        for layer in sorted((item for item in layers if item["group"] == group_name), key=lambda item: item["z_index"]):
            pixel_layer = psd.create_pixel_layer(layer["image"], name=layer["name"], left=layer["left"], top=layer["top"], opacity=layer["opacity"])
            group.append(pixel_layer)
        psd.append(group)
    psd.save(PSD_FILE)


def save_psd_composite() -> None:
    loaded = PSDImage.open(PSD_FILE)
    composite = loaded.composite(force=True)
    composite.save(PSD_COMPOSITE_FILE)


def build_manifest(layers: list[Layer]) -> dict[str, Any]:
    return {
        "version": 1,
        "character": "Cuu",
        "artifact": "cuu-live2d-generated-psd-draft-v1",
        "status": "draft_psd_generated_requires_art_review_and_cubism_binding",
        "canvas": {
            "width": CANVAS_SIZE[0],
            "height": CANVAS_SIZE[1],
            "anchor_x": 600,
            "anchor_y": 1216,
        },
        "source": {
            "generator": str((ROOT / "scripts/assets/build-cuu-live2d-generated-psd.py").relative_to(ROOT)).replace("\\", "/"),
            "component_extractor": str((ROOT / "scripts/assets/extract-cuu-generated-parts.py").relative_to(ROOT)).replace("\\", "/"),
            "component_boards": {
                key: str((SOURCE_DIR / f"{board_id}-green.png").relative_to(ROOT)).replace("\\", "/")
                for key, board_id in BOARDS.items()
            },
        },
        "outputs": {
            "psd": str(PSD_FILE.relative_to(ROOT)).replace("\\", "/"),
            "preview": str(PREVIEW_FILE.relative_to(ROOT)).replace("\\", "/"),
            "psd_composite": str(PSD_COMPOSITE_FILE.relative_to(ROOT)).replace("\\", "/"),
            "manifest": str(MANIFEST_FILE.relative_to(ROOT)).replace("\\", "/"),
            "report": str(REPORT_FILE.relative_to(ROOT)).replace("\\", "/"),
        },
        "layers": [manifest_layer(layer) for layer in sorted(layers, key=lambda item: item["z_index"])],
    }


def manifest_layer(layer: Layer) -> dict[str, Any]:
    return {
        "group": layer["group"],
        "name": layer["name"],
        "origin": layer["origin"],
        "source_board": layer["source_board"],
        "source_part_id": layer["source_part_id"],
        "image_path": layer["image_path"],
        "x": layer["left"],
        "y": layer["top"],
        "width": layer["width"],
        "height": layer["height"],
        "opacity": layer["opacity"],
        "z_index": layer["z_index"],
        "default_visible": layer["default_visible"],
        "bind_target": layer["bind_target"],
        "note": layer["note"],
    }


def build_report(layers: list[Layer]) -> dict[str, Any]:
    by_group = Counter(layer["group"] for layer in layers)
    by_origin = Counter(layer["origin"] for layer in layers)
    generated_layers = [layer for layer in layers if layer["origin"] == "generated_layer_png"]
    hidden_layers = [layer for layer in layers if layer["opacity"] <= 0]
    return {
        "artifact": "cuu-live2d-generated-psd-draft-v1",
        "result": "draft_created_not_visual_pass",
        "layer_count": len(layers),
        "default_visible_layer_count": len(layers) - len(hidden_layers),
        "hidden_or_expression_layer_count": len(hidden_layers),
        "generated_layer_count": len(generated_layers),
        "group_counts": dict(sorted(by_group.items())),
        "origin_counts": dict(sorted(by_origin.items())),
        "required_next_checks": [
            "Open PSD in Krita, Photoshop, or Live2D Cubism and confirm all groups/layers survive import.",
            "Replace any synthetic-looking or misaligned generated parts with regenerated clean parts.",
            "Paint behind collar, paws, and tail root before mesh binding.",
            "Bind separate eye, blink, mouth, tail, bow, lace, and tassel physics in Cubism.",
            "Record multi-second desktop-pet motion after Cubism export; static preview alone cannot pass.",
        ],
        "known_limitations": [
            "This draft stitches generated components; it is not a finished Cubism model.",
            "Head base still contains some ear structure, so ear split layers need art cleanup before final binding.",
            "Tail segment overlap needs Cubism mesh cleanup to avoid thick duplicate edges.",
            "Several expression, lace, bead, and paint-behind layers are hidden by default and exist for art iteration.",
        ],
    }


if __name__ == "__main__":
    main()
