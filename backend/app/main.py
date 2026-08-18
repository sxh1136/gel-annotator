import io
import uuid
from pathlib import Path
from typing import List

import cv2
import numpy as np
from PIL import ImageFont, Image, ImageDraw
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks


# -----------------------
# Paths
# -----------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
ANNOTATED_DIR = DATA_DIR / "annotated"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Gel Annotator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(DATA_DIR)), name="static")


# -----------------------
# Models
# -----------------------
class LaneBoundModel(BaseModel):
    x0: int
    x1: int


class AnnotateRequest(BaseModel):
    imageId: str
    nLanes: int
    ladderLane: int
    ladderSizesBp: List[int]
    laneLabels: List[str]
    ladderY: List[int]
    laneBounds: List[LaneBoundModel]
    showLaneBoxes: bool = True
    laneLabelAngle: int = 35
    transparentBackground: bool = False
    laneTextScale: float = 1.0 
    ladderTextScale: float = 1.0

# -----------------------
# Helpers
# -----------------------
def parse_ladder_sizes(s: str) -> List[int]:
    vals = [int(x.strip()) for x in s.split(",") if x.strip()]
    if not vals:
        raise ValueError("No ladder sizes provided")
    return vals


def read_rgb_gray(image_bytes: bytes):
    pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    rgb = np.array(pil)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    return rgb, gray


def preprocess_gray(gray, clahe_clip=2.0, blur_ksize=3, invert=False):
    clahe = cv2.createCLAHE(clipLimit=clahe_clip, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    if blur_ksize % 2 == 0:
        blur_ksize += 1
    if blur_ksize > 1:
        enhanced = cv2.GaussianBlur(enhanced, (blur_ksize, blur_ksize), 0)

    if invert:
        enhanced = 255 - enhanced
    return enhanced


def build_equal_lanes(x0, x1, n_lanes):
    xs = np.linspace(x0, x1, n_lanes + 1).astype(int)
    return [(int(xs[i]), int(xs[i + 1])) for i in range(n_lanes)]


def detect_bands_in_lane(prep, x_left, x_right, prominence=12, min_dist=8, smooth_sigma=2.0):
    lane = prep[:, x_left:x_right]
    if lane.size == 0:
        return np.array([]), np.array([])

    profile = lane.mean(axis=1).astype(float)
    profile_s = gaussian_filter1d(profile, sigma=smooth_sigma)
    peaks, props = find_peaks(profile_s, prominence=prominence, distance=min_dist)
    prom = props["prominences"] if "prominences" in props else np.zeros(len(peaks))
    return peaks, prom


def reconcile_ladder_peaks(peaks, prominences, expected_n):
    # No interpolation when too few peaks
    if len(peaks) == 0:
        return np.array([])

    order = np.argsort(peaks)
    p = peaks[order]
    pr = prominences[order] if len(prominences) == len(peaks) else np.ones_like(p)

    if len(p) == expected_n:
        return p
    if len(p) > expected_n:
        idx = np.argsort(pr)[-expected_n:]
        return np.sort(p[idx])

    return p

from pathlib import Path
from PIL import ImageFont

FONT_CANDIDATES = [
    Path(__file__).resolve().parent / "fonts" / "DejaVuSans.ttf",
    Path(__file__).resolve().parent / "fonts" / "Inter-Regular.ttf",
    Path("C:/Windows/Fonts/arial.ttf"),
]

def get_font(size=16):
    for fp in FONT_CANDIDATES:
        try:
            if fp.exists():
                return ImageFont.truetype(str(fp), size)
        except Exception:
            pass
    # last resort (small, not ideal)
    return ImageFont.load_default()


def rotated_text_size(text, font, angle_deg):
    tmp = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    txt = Image.new("RGBA", (tw + 6, th + 6), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(txt)
    d2.text((3, 3), text, font=font, fill=(0, 0, 0, 255))
    rot = txt.rotate(angle_deg, expand=True, resample=Image.Resampling.BICUBIC)
    return rot.width, rot.height


def paste_rotated_text(base_rgba, text, center_xy, angle_deg, font, fill=(20, 20, 20, 255)):
    """
    Draw rotated text with supersampling for smoother output.
    """
    ss = 2  # supersample factor

    # Build a larger font for smoother rendering (if possible)
    try:
        font_ss = get_font(max(10, int(font.size * ss)))
    except Exception:
        font_ss = font

    # Measure text at supersampled size
    tmp = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    bbox = d.textbbox((0, 0), text, font=font_ss)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    pad = 12 * ss  # extra pad to prevent glyph clipping
    txt = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(txt)
    d2.text((pad, pad), text, font=font_ss, fill=fill)

    rot = txt.rotate(angle_deg, expand=True, resample=Image.Resampling.BICUBIC)

    # Downsample back for smoother edges
    rot = rot.resize((max(1, rot.width // ss), max(1, rot.height // ss)), Image.Resampling.LANCZOS)

    x = int(center_xy[0] - rot.width / 2)
    y = int(center_xy[1] - rot.height / 2)
    base_rgba.alpha_composite(rot, (x, y))

def draw_annotations(
    rgb,
    lane_bounds,
    lane_labels,
    ladder_lane_idx,
    ladder_y,
    ladder_sizes_bp,
    lane_label_angle=35,
    show_lane_boxes=True,
    transparent_background=False,
    lane_text_scale=1.0, 
    ladder_text_scale=1.0,
):
    h, w, _ = rgb.shape

    # Responsive scale for large/small images
    scale = max(1.0, min(4.0, (w / 900.0) ** 0.95))

    font_lane = get_font(max(16, int(round(20 * scale * lane_text_scale))))
    font_ladder = get_font(max(15, int(round(19 * scale * ladder_text_scale))))

    line_w = max(1, int(round(2.6 * scale)))
    tick_w = max(1, int(round(1.6 * scale)))
    tick_len = max(6, int(round(9 * scale)))

    # Dynamic margins
    tmp = Image.new("RGBA", (10, 10), (255, 255, 255, 0))
    d = ImageDraw.Draw(tmp)

    ladder_widths = []
    for bp in ladder_sizes_bp:
        bb = d.textbbox((0, 0), f"{bp} bp", font=font_ladder)
        ladder_widths.append(bb[2] - bb[0])

    left_pad = max(int(round(30 * scale)), (max(ladder_widths) if ladder_widths else 0) + int(round(26 * scale)))

    top_heights = []
    for i in range(len(lane_bounds)):
        label = lane_labels[i] if i < len(lane_labels) else f"S {i+1}"
        _, rh = rotated_text_size(label, font_lane, -lane_label_angle)
        top_heights.append(rh)

    top_pad = max(int(round(34 * scale)), (max(top_heights) if top_heights else 0) + int(round(18 * scale)))
    right_pad = int(round(20 * scale))
    bottom_pad = int(round(20 * scale))

    bg_color = (0, 0, 0, 0) if transparent_background else (255, 255, 255, 255)
    canvas = Image.new(
        "RGBA",
        (w + left_pad + right_pad, h + top_pad + bottom_pad),
        bg_color
    )
    gel = Image.fromarray(rgb).convert("RGBA")
    canvas.alpha_composite(gel, (left_pad, top_pad))
    draw = ImageDraw.Draw(canvas)

    # Lane boxes + labels
    for i, (x0, x1) in enumerate(lane_bounds):
        X0, X1 = left_pad + x0, left_pad + x1
        color = (255, 120, 0, 255) if i == ladder_lane_idx else (0, 160, 255, 255)

        if show_lane_boxes:
            draw.rectangle([X0, top_pad, X1, top_pad + h - 1], outline=color, width=line_w)

        label = lane_labels[i] if i < len(lane_labels) else f"S {i+1}"
        cx = (X0 + X1) // 2
        cy = max(int(round(14 * scale)), int(top_pad * 0.46))
        paste_rotated_text(canvas, label, (cx, cy), -lane_label_angle, font_lane)

    # Ladder axis + ticks + labels
    if len(ladder_y) == len(ladder_sizes_bp):
        axis_x = left_pad - int(round(10 * scale))
        draw.line([(axis_x, top_pad), (axis_x, top_pad + h - 1)], fill=(220, 50, 50, 255), width=tick_w)

        for y, bp in zip(ladder_y, ladder_sizes_bp):
            Y = top_pad + int(y)
            draw.line([(axis_x, Y), (axis_x + tick_len, Y)], fill=(220, 50, 50, 255), width=tick_w)

            txt = f"{bp} bp"
            bb = draw.textbbox((0, 0), txt, font=font_ladder)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            tx = max(4, axis_x - tw - int(round(8 * scale)))
            ty = int(Y - th / 2)
            draw.text((tx, ty), txt, fill=(220, 50, 50, 255), font=font_ladder)

    if transparent_background:
        return np.array(canvas)  # RGBA
    return np.array(canvas.convert("RGB"))


# -----------------------
# Routes
# -----------------------
@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/analyze")
async def analyze(
    image: UploadFile = File(...),
    n_lanes: int = Form(...),
    ladder_lane: int = Form(...),
    ladder_sizes: str = Form(...),
    x0: int = Form(...),
    x1: int = Form(...),
    invert: bool = Form(False),
    clahe_clip: float = Form(2.0),
    blur_k: int = Form(3),
    prominence: int = Form(12),
    min_dist: int = Form(8),
    smooth_sigma: float = Form(2.0),
):
    ladder_sizes_bp = parse_ladder_sizes(ladder_sizes)

    if ladder_lane < 1 or ladder_lane > n_lanes:
        raise HTTPException(status_code=400, detail="Invalid ladder_lane")

    data = await image.read()
    rgb, gray = read_rgb_gray(data)
    h, w = gray.shape

    x0 = max(0, min(x0, w - 2))
    x1 = max(1, min(x1, w - 1))
    if x1 <= x0:
        raise HTTPException(status_code=400, detail="x1 must be greater than x0")

    prep = preprocess_gray(gray, clahe_clip=clahe_clip, blur_ksize=blur_k, invert=invert)
    lane_bounds = build_equal_lanes(x0, x1, n_lanes)

    ladder_idx = ladder_lane - 1
    lx0, lx1 = lane_bounds[ladder_idx]
    peaks, prom = detect_bands_in_lane(prep, lx0, lx1, prominence=prominence, min_dist=min_dist, smooth_sigma=smooth_sigma)
    ladder_y_auto = reconcile_ladder_peaks(peaks, prom, expected_n=len(ladder_sizes_bp)).astype(int).tolist()

    image_id = str(uuid.uuid4())
    Image.fromarray(rgb).save(UPLOADS_DIR / f"{image_id}.png")

    return {
        "imageId": image_id,
        "imageUrl": f"/static/uploads/{image_id}.png",
        "width": w,
        "height": h,
        "laneBounds": [{"x0": int(a), "x1": int(b)} for a, b in lane_bounds],
        "ladderYAuto": ladder_y_auto,
        "ladderSizesBp": ladder_sizes_bp,
        "mismatch": len(ladder_y_auto) != len(ladder_sizes_bp),
    }


@app.post("/api/annotate")
def annotate(req: AnnotateRequest):
    img_path = UPLOADS_DIR / f"{req.imageId}.png"
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    if req.ladderLane < 1 or req.ladderLane > req.nLanes:
        raise HTTPException(status_code=400, detail="Invalid ladderLane")
    if len(req.ladderY) != len(req.ladderSizesBp):
        raise HTTPException(status_code=400, detail="ladderY length must equal ladderSizesBp length")
    if len(req.laneBounds) != req.nLanes:
        raise HTTPException(status_code=400, detail="laneBounds length must equal nLanes")

    rgb = np.array(Image.open(img_path).convert("RGB"))
    lane_bounds = [(b.x0, b.x1) for b in req.laneBounds]

    lane_labels = req.laneLabels[:req.nLanes]
    while len(lane_labels) < req.nLanes:
        lane_labels.append(f"S {len(lane_labels) + 1}d")

    annotated = draw_annotations(
        rgb=rgb,
        lane_bounds=lane_bounds,
        lane_labels=lane_labels,
        ladder_lane_idx=req.ladderLane - 1,
        ladder_y=np.array(req.ladderY, dtype=int),
        ladder_sizes_bp=req.ladderSizesBp,
        lane_label_angle=req.laneLabelAngle,
        show_lane_boxes=req.showLaneBoxes,
        transparent_background=req.transparentBackground,
        lane_text_scale=req.laneTextScale,
        ladder_text_scale=req.ladderTextScale,
    )

    out_path = ANNOTATED_DIR / f"{req.imageId}_annotated.png"
    Image.fromarray(annotated).save(out_path)

    return {"annotatedUrl": f"/static/annotated/{req.imageId}_annotated.png"}