from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps/desktop-webview/src/assets/cuu/static/cuu-static-fallback-v1-alpha-clean.png"
LAYER_MANIFEST = ROOT / "apps/desktop-webview/src/assets/cuu/live2d/source/cuu-live2d-v0-layer-manifest.json"
OUT_DIR = ROOT / "apps/desktop-webview/src/assets/cuu/live2d/prototype/cuu-layered-rig-v0"
MANIFEST = OUT_DIR / "cuu-layered-rig-v0.manifest.json"
PREVIEW = OUT_DIR / "cuu-layered-rig-v0-preview.png"


class CropSpec(TypedDict):
    id: str
    source_layer: str
    file: str
    crop: tuple[int, int, int, int]
    pivot: tuple[int, int]
    z: int
    bone: str


LAYER_SPECS: list[CropSpec] = [
    {
        "id": "tail",
        "source_layer": "Tail_Base",
        "file": "tail.png",
        "crop": (250, 236, 330, 340),
        "pivot": (28, 70),
        "z": 10,
        "bone": "tail",
    },
    {
        "id": "body_backfur",
        "source_layer": "Body_BackFur",
        "file": "body-backfur.png",
        "crop": (108, 144, 322, 368),
        "pivot": (112, 206),
        "z": 20,
        "bone": "body",
    },
    {
        "id": "front_paws",
        "source_layer": "FrontPaws",
        "file": "front-paws.png",
        "crop": (108, 274, 218, 370),
        "pivot": (54, 86),
        "z": 30,
        "bone": "front_paws",
    },
    {
        "id": "head",
        "source_layer": "Head_FaceBase",
        "file": "head.png",
        "crop": (78, 42, 270, 210),
        "pivot": (100, 134),
        "z": 40,
        "bone": "head",
    },
    {
        "id": "lace_bib",
        "source_layer": "LaceBib_Front",
        "file": "lace-bib.png",
        "crop": (88, 154, 266, 296),
        "pivot": (88, 28),
        "z": 50,
        "bone": "lace_bib",
    },
    {
        "id": "bow",
        "source_layer": "Bow_Center",
        "file": "bow.png",
        "crop": (102, 174, 190, 250),
        "pivot": (44, 28),
        "z": 60,
        "bone": "bow",
    },
    {
        "id": "tassel_l",
        "source_layer": "Tassel_L_String_01",
        "file": "tassel-l.png",
        "crop": (74, 192, 128, 334),
        "pivot": (28, 14),
        "z": 70,
        "bone": "tassel_l",
    },
    {
        "id": "tassel_r",
        "source_layer": "Tassel_R_String_01",
        "file": "tassel-r.png",
        "crop": (202, 188, 252, 338),
        "pivot": (22, 14),
        "z": 70,
        "bone": "tassel_r",
    },
]


PARAMETERS = [
    ("ParamAngleX", -1, 1, 0, "head horizontal aim"),
    ("ParamAngleY", -1, 1, 0, "head vertical aim"),
    ("ParamAngleZ", -1, 1, 0, "head tilt"),
    ("ParamBodyAngleX", -1, 1, 0, "body horizontal lean"),
    ("ParamBodyAngleY", -1, 1, 0, "body vertical lean"),
    ("ParamEyeLOpen", 0, 1, 1, "left eye open amount"),
    ("ParamEyeROpen", 0, 1, 1, "right eye open amount"),
    ("ParamEyeBallX", -1, 1, 0, "eye look x"),
    ("ParamEyeBallY", -1, 1, 0, "eye look y"),
    ("ParamMouthOpenY", 0, 1, 0, "mouth open amount"),
    ("ParamMouthForm", -1, 1, 0, "mouth smile/frown"),
    ("ParamEarLWiggle", -1, 1, 0, "left ear wiggle"),
    ("ParamEarRWiggle", -1, 1, 0, "right ear wiggle"),
    ("ParamTailSway", -1, 1, 0, "tail swaying amplitude"),
    ("ParamTailCurl", -1, 1, 0, "tail curl or tuck"),
    ("ParamBibSway", -1, 1, 0, "lace bib sway"),
    ("ParamBowBounce", -1, 1, 0, "bow bounce"),
    ("ParamTasselSwingL", -1, 1, 0, "left tassel swing"),
    ("ParamTasselSwingR", -1, 1, 0, "right tassel swing"),
    ("ParamPawTap", -1, 1, 0, "front paw tap"),
    ("ParamPawHoldDoc", -1, 1, 0, "future document hold pose"),
]


MOTIONS = {
    "idle": ("idle_breathe", True, "idle", {"ParamTailSway": 0.28, "ParamBibSway": 0.12}),
    "blink": ("idle_blink", False, "idle", {"ParamEyeLOpen": 0, "ParamEyeROpen": 0}),
    "look": ("look_at_mouse", False, "idle", {"ParamAngleX": 0.38, "ParamEyeBallX": 0.42}),
    "thinking": ("thinking_tail", True, "normal", {"ParamAngleZ": -0.12, "ParamTailSway": 0.62}),
    "approval": ("asking_approval_bounce", True, "urgent", {"ParamBowBounce": 0.62, "ParamPawTap": 0.42}),
    "review": ("searching_evidence_peek", True, "normal", {"ParamAngleX": -0.24, "ParamBibSway": 0.16}),
    "worried": ("worried_ears", True, "urgent", {"ParamAngleZ": -0.22, "ParamTailCurl": 0.38}),
    "celebrate": ("celebrating_jump", False, "normal", {"ParamBowBounce": 0.85, "ParamPawTap": 0.72}),
    "drag": ("drag_hold", True, "normal", {"ParamBodyAngleY": 0.18}),
    "tap": ("tap_bubble", False, "normal", {"ParamPawTap": 0.78}),
    "offline": ("offline_sleep", True, "idle", {"ParamEyeLOpen": 0.28, "ParamEyeROpen": 0.28}),
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")
    layers = []
    preview = Image.new("RGBA", source.size, (0, 0, 0, 0))

    for spec in sorted(LAYER_SPECS, key=lambda item: item["z"]):
        image, x, y, pivot_x, pivot_y = crop_layer(source, spec)
        image.save(OUT_DIR / spec["file"])
        preview.alpha_composite(image, (x, y))
        layers.append(
            {
                "id": spec["id"],
                "origin": "static_png_crop",
                "source_layer": spec["source_layer"],
                "image_path": spec["file"],
                "x": x,
                "y": y,
                "width": image.width,
                "height": image.height,
                "pivot_x": pivot_x,
                "pivot_y": pivot_y,
                "z_index": spec["z"],
                "bone": spec["bone"],
            }
        )

    preview.save(PREVIEW)
    MANIFEST.write_text(json.dumps(build_manifest(layers, source), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def crop_layer(source: Image.Image, spec: CropSpec) -> tuple[Image.Image, int, int, int, int]:
    left, top, right, bottom = spec["crop"]
    raw = source.crop((left, top, right, bottom))
    alpha_bbox = raw.getchannel("A").getbbox()
    if not alpha_bbox:
        raise RuntimeError(f"Layer {spec['id']} produced no opaque pixels")
    trim_left, trim_top, trim_right, trim_bottom = alpha_bbox
    image = raw.crop(alpha_bbox)
    x = left + trim_left
    y = top + trim_top
    pivot_x = spec["pivot"][0] - trim_left
    pivot_y = spec["pivot"][1] - trim_top
    if not (0 <= pivot_x <= image.width and 0 <= pivot_y <= image.height):
        raise RuntimeError(f"Layer {spec['id']} pivot left the trimmed crop")
    return image, x, y, pivot_x, pivot_y


def build_manifest(layers: list[dict[str, object]], source: Image.Image) -> dict[str, object]:
    return {
        "version": 1,
        "character": "Cuu",
        "artifact": "cuu-layered-rig-v0",
        "status": "prototype_layered",
        "source": {
            "static_alpha": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
            "layer_manifest": str(LAYER_MANIFEST.relative_to(ROOT)).replace("\\", "/"),
            "psd_path": "docs/workhub/05-clients/assets/cuu-live2d/cuu-v1.psd",
        },
        "stage": {
            "width": source.width,
            "height": source.height,
            "anchor_x": 170,
            "anchor_y": 386,
        },
        "layers": layers,
        "bones": [
            {"id": "root", "x": 170, "y": 386},
            {"id": "body", "parent": "root", "x": 170, "y": 286, "parameter": "ParamBodyAngleY"},
            {"id": "tail", "parent": "body", "x": 260, "y": 300, "parameter": "ParamTailSway"},
            {"id": "front_paws", "parent": "body", "x": 164, "y": 332, "parameter": "ParamPawTap"},
            {"id": "head", "parent": "body", "x": 176, "y": 176, "parameter": "ParamAngleZ"},
            {"id": "lace_bib", "parent": "body", "x": 178, "y": 202, "parameter": "ParamBibSway"},
            {"id": "bow", "parent": "lace_bib", "x": 148, "y": 208, "parameter": "ParamBowBounce"},
            {"id": "tassel_l", "parent": "lace_bib", "x": 102, "y": 208, "parameter": "ParamTasselSwingL"},
            {"id": "tassel_r", "parent": "lace_bib", "x": 224, "y": 208, "parameter": "ParamTasselSwingR"},
        ],
        "parameters": [
            {"id": parameter_id, "min": minimum, "max": maximum, "default": default, "description": description}
            for parameter_id, minimum, maximum, default, description in PARAMETERS
        ],
        "motions": {
            motion_id: {
                "id": motion_id,
                "loop": loop,
                "priority": priority,
                "fallback_sprite_clip": fallback,
                "parameters": parameters,
            }
            for motion_id, (fallback, loop, priority, parameters) in MOTIONS.items()
        },
    }


if __name__ == "__main__":
    main()
