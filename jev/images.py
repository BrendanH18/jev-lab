"""Images for System One requests: validation, sample pictures, and inspector-safe traces.

Images and Box questions are "dreamer-ready" in TypeSafe's docs: they need the
`TypeSafe-Danger-Zone-Images: true` header, and the request format may still change
(https://docs.typesafe.ai/images). An image travels as an asset keyed by a reference string;
the reference appears wherever the image belongs in the state, instructions, or criteria.

The browser resizes photos before upload, but the server checks every image again against the
documented limits so a bad file fails here, without a paid call.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re
import struct
from typing import Any, Dict, Optional, Tuple

from .config import PROJECT_ROOT

IMAGES_HEADER = "TypeSafe-Danger-Zone-Images"
MIN_SIDE, MAX_SIDE = 280, 1568
MIN_PIXELS, MAX_PIXELS = MIN_SIDE * MIN_SIDE, MAX_SIDE * MAX_SIDE
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_IMAGES = 4
# Image token counts are not documented yet. Hold generously per image use until the call settles.
RESERVE_TOKENS_PER_IMAGE = 16_000

SAMPLES_DIR = PROJECT_ROOT / "static" / "img" / "samples"
SAMPLES = {
    "torn-bag": "A coffee bag with a torn seal and beans spilled on the counter",
    "intact-bag": "The same kind of coffee bag, sealed and undamaged",
    "crushed-box": "A shipping box with a crushed corner",
    "grinder-ok": "A burr grinder with an intact hopper",
}

REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{5,63}$")


class ImageError(ValueError):
    pass


def dimensions(data: bytes) -> Tuple[str, int, int]:
    """(format, width, height) read from a PNG or JPEG header. Raises ImageError for anything else."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        if len(data) < 24 or data[12:16] != b"IHDR":
            raise ImageError("The PNG file is damaged.")
        if b"acTL" in data[:4096] and data.find(b"acTL") < data.find(b"IDAT"):
            raise ImageError("Animated PNGs are not accepted.")
        width, height = struct.unpack(">II", data[16:24])
        return "png", width, height
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
                i += 1 if marker == 0xFF else 2
                continue
            (length,) = struct.unpack(">H", data[i + 2:i + 4])
            # SOF0-SOF15 carry the frame size, except DHT (C4), JPG (C8), and DAC (CC).
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack(">HH", data[i + 5:i + 9])
                return "jpg", width, height
            i += 2 + length
        raise ImageError("The JPEG file is damaged or incomplete.")
    raise ImageError("Images must be PNG or JPEG.")


def check(data: bytes) -> dict:
    """Validate image bytes against the documented limits and describe them."""
    if len(data) > MAX_FILE_BYTES:
        raise ImageError("Image is %.1f MiB; the limit is 16 MiB." % (len(data) / 1024 / 1024))
    fmt, width, height = dimensions(data)
    if not (MIN_SIDE <= width <= MAX_SIDE and MIN_SIDE <= height <= MAX_SIDE):
        raise ImageError("Image is %d×%d; each side must be %d to %d pixels." % (width, height, MIN_SIDE, MAX_SIDE))
    if not MIN_PIXELS <= width * height <= MAX_PIXELS:
        raise ImageError("Image has %d pixels; the limit is %d to %d." % (width * height, MIN_PIXELS, MAX_PIXELS))
    return {"format": fmt, "width": width, "height": height, "bytes": len(data),
            "sha": hashlib.sha256(data).hexdigest()[:16]}


def decode(data_base64: Any) -> bytes:
    if not isinstance(data_base64, str) or not data_base64:
        raise ImageError("Image data must be a base64 string.")
    if data_base64.startswith("data:"):
        data_base64 = data_base64.split(",", 1)[-1]
    try:
        return base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError) as err:
        raise ImageError("Image data is not valid base64.") from err


def asset(data: bytes) -> dict:
    """The canonical asset entry this app passes to JevClient: validated bytes plus their description."""
    info = check(data)
    return dict(info, data=data)


def sample_bytes(name: str) -> bytes:
    if name not in SAMPLES:
        raise ImageError("Unknown sample image: %s" % name)
    return (SAMPLES_DIR / ("%s.png" % name)).read_bytes()


def sample_asset(name: str) -> dict:
    return dict(asset(sample_bytes(name)), sample=name)


def parse_upload(spec: Any) -> dict:
    """Turn a browser upload, {"sample": name} or {"data_base64": ...}, into an asset entry."""
    if not isinstance(spec, dict):
        raise ImageError("Each image must be an object with `sample` or `data_base64`.")
    if spec.get("sample"):
        return sample_asset(str(spec["sample"]))
    return asset(decode(spec.get("data_base64")))


def parse_images(images: Any) -> Dict[str, dict]:
    """Validate a {reference: upload} map from the browser."""
    if images in (None, {}):
        return {}
    if not isinstance(images, dict):
        raise ImageError("`images` must be an object keyed by reference.")
    if len(images) > MAX_IMAGES:
        raise ImageError("At most %d images per request." % MAX_IMAGES)
    out = {}
    for ref, spec in images.items():
        if not isinstance(ref, str) or not REF_RE.match(ref):
            raise ImageError("Image reference %r must be 6-64 letters, digits, '.', '_' or '-'." % (ref,))
        try:
            out[ref] = parse_upload(spec)
        except ImageError as err:
            raise ImageError("%s: %s" % (ref, err)) from err
    return out


def new_ref(seed: bytes, label: str = "img") -> str:
    """A reference that cannot occur in ordinary text by accident: label plus a content hash."""
    return "%s-%s" % (label, hashlib.sha256(seed).hexdigest()[:12])


def wire_asset(entry: dict) -> dict:
    """The JSON form of an asset for a base64 request body."""
    return {"type": "image", "format": entry["format"], "data_base64": base64.b64encode(entry["data"]).decode("ascii")}


def trace_asset(entry: dict) -> dict:
    """What the inspector shows instead of megabytes of base64."""
    out = {"type": "image", "format": entry["format"],
           "data_base64": "<%s %d×%d, %.0f KB, omitted from this view>" % (
               entry["format"].upper(), entry["width"], entry["height"], entry["bytes"] / 1024)}
    if entry.get("sample"):
        out["sample"] = entry["sample"]
    return out


def count_uses(refs, *values: Any) -> int:
    """How many times the references occur in the request text. Each use adds the image again."""
    text = "".join(_strings(v) for v in values)
    return sum(text.count(ref) for ref in refs)


def unreferenced(refs, *values: Any) -> list:
    text = "".join(_strings(v) for v in values)
    return [ref for ref in refs if ref not in text]


def _strings(value: Any) -> str:
    if isinstance(value, str):
        return value + "\x00"
    if isinstance(value, dict):
        return "".join(_strings(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return "".join(_strings(v) for v in value)
    return ""


def needs_images_header(questions: Dict[str, dict], assets: Optional[dict]) -> bool:
    return bool(assets) or any(isinstance(q, dict) and q.get("type") == "box" for q in questions.values())
