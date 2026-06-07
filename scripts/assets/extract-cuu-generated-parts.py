from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "apps/desktop-webview/src/assets/cuu/live2d/source/generated-parts-v0"

BOARDS = [
    "cuu-live2d-generated-parts-board-v0",
    "cuu-live2d-generated-face-parts-v0",
    "cuu-live2d-generated-body-parts-v0",
    "cuu-live2d-generated-accessory-parts-v0",
]


def main() -> None:
    for board_id in BOARDS:
      process_board(board_id)


def process_board(board_id: str) -> None:
    source = SOURCE_DIR / f"{board_id}-green.png"
    out_dir = SOURCE_DIR / board_id
    components_dir = out_dir / "components"
    components_dir.mkdir(parents=True, exist_ok=True)

    image = Image.open(source).convert("RGBA")
    rgb = np.array(image.convert("RGB"))
    green = (rgb[:, :, 1] > 150) & (rgb[:, :, 0] < 90) & (rgb[:, :, 2] < 120)
    alpha = (~green).astype(np.uint8) * 255
    rgba = np.array(image)
    rgba[:, :, 3] = alpha
    alpha_image = Image.fromarray(rgba, "RGBA")
    alpha_path = out_dir / f"{board_id}-alpha.png"
    alpha_image.save(alpha_path)

    components = find_components(alpha)
    sheet = Image.new("RGB", image.size, (255, 255, 255))
    sheet.paste(alpha_image, mask=alpha_image.getchannel("A"))
    draw = ImageDraw.Draw(sheet)

    for component in components:
        x, y, w, h = component["x"], component["y"], component["w"], component["h"]
        crop = alpha_image.crop((x, y, x + w, y + h))
        crop_path = components_dir / f"{board_id}-part-{component['id']:03d}.png"
        crop.save(crop_path)
        component["image_path"] = str(crop_path.relative_to(out_dir)).replace("\\", "/")
        draw.rectangle((x, y, x + w, y + h), outline=(255, 0, 0), width=3)
        draw.rectangle((x, y, x + 38, y + 24), fill=(255, 255, 255), outline=(255, 0, 0))
        draw.text((x + 4, y + 4), str(component["id"]), fill=(0, 0, 0))

    sheet_path = out_dir / f"{board_id}-components.png"
    manifest_path = out_dir / f"{board_id}-components.json"
    sheet.save(sheet_path)
    manifest_path.write_text(json.dumps({
        "board_id": board_id,
        "source": str(source.relative_to(ROOT)).replace("\\", "/"),
        "alpha": str(alpha_path.relative_to(ROOT)).replace("\\", "/"),
        "component_sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
        "component_count": len(components),
        "components": components,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{board_id}: {len(components)} components")


def find_components(alpha: np.ndarray) -> list[dict[str, int | float | str]]:
    num, labels, stats, centroids = cv2.connectedComponentsWithStats(alpha, 8)
    components = []
    for label in range(1, num):
        x, y, w, h, area = stats[label]
        if area < 80:
            continue
        # Skip accidental border-scale fragments.
        if w < 8 and h < 8:
            continue
        components.append({
            "source_label": int(label),
            "x": int(x),
            "y": int(y),
            "w": int(w),
            "h": int(h),
            "area": int(area),
            "cx": round(float(centroids[label][0]), 3),
            "cy": round(float(centroids[label][1]), 3),
        })
    components.sort(key=lambda item: (int(item["y"]), int(item["x"])))
    for index, component in enumerate(components, start=1):
        component["id"] = index
    return components


if __name__ == "__main__":
    main()
