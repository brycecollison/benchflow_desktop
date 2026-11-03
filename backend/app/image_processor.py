import os
from pathlib import Path
from typing import Dict, Any, Tuple, Optional, List
import numpy as np
from PIL import Image

# Pseudo-color palette for fluorescence microscopy channels
FLUOR_PALETTE = [
    [0, 180, 255],   # Cyan/Blue (DAPI / Hoechst)
    [0, 255, 60],    # Green (GFP / Alexa 488)
    [255, 30, 30],   # Red (mCherry / RFP / Alexa 568 / 594)
    [255, 0, 255],   # Magenta (Cy5 / Alexa 647)
    [255, 230, 0],   # Yellow (YFP / Alexa 532)
]


def normalize_to_8bit(arr: np.ndarray) -> np.ndarray:
    """Percentile-based contrast normalization to 0-255 uint8 for scientific imaging."""
    if arr.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)
    if arr.dtype == np.uint8:
        return arr

    arr_f = arr.astype(np.float32)
    p_min = float(np.percentile(arr_f, 0.5))
    p_max = float(np.percentile(arr_f, 99.8))

    if p_max <= p_min:
        p_min = float(np.min(arr_f))
        p_max = float(np.max(arr_f))

    if p_max <= p_min:
        return np.zeros_like(arr, dtype=np.uint8)

    norm = np.clip((arr_f - p_min) / (p_max - p_min) * 255.0, 0, 255)
    return norm.astype(np.uint8)


def composite_channels(channels_2d: List[np.ndarray], channel_colors: Optional[List[List[int]]] = None) -> np.ndarray:
    """Composites a list of 2D uint8 arrays of shape (H, W) into an RGB (H, W, 3) image."""
    if not channels_2d:
        return np.zeros((100, 100, 3), dtype=np.uint8)

    # Ensure all channels are strictly 2D
    cleaned_channels = []
    for ch in channels_2d:
        s = np.squeeze(ch)
        while s.ndim > 2:
            s = np.max(s, axis=0)
        if s.ndim == 1:
            s = np.expand_dims(s, axis=0)
        cleaned_channels.append(s)

    H, W = cleaned_channels[0].shape[:2]

    if len(cleaned_channels) == 1:
        ch = cleaned_channels[0]
        return np.stack([ch, ch, ch], axis=-1)

    if len(cleaned_channels) == 3 and channel_colors is None:
        return np.stack(cleaned_channels[:3], axis=-1)

    colors = channel_colors or FLUOR_PALETTE
    rgb_composite = np.zeros((H, W, 3), dtype=np.float32)
    for i, ch in enumerate(cleaned_channels):
        col = np.array(colors[i % len(colors)], dtype=np.float32)
        norm_ch = ch.astype(np.float32) / 255.0
        rgb_composite += norm_ch[:, :, None] * col

    return np.clip(rgb_composite, 0, 255).astype(np.uint8)


def process_tiff(file_path: Path, preview_path: Path) -> Dict[str, Any]:
    """Reads a TIFF file (including multi-channel, 16-bit, and Z-stacks) and generates a web preview."""
    import tifffile
    with tifffile.TiffFile(str(file_path)) as tif:
        page_count = len(tif.pages)
        first_page = tif.pages[0] if page_count > 0 else None
        dtype_str = str(first_page.dtype) if first_page else "unknown"
        arr = tif.asarray()

    meta: Dict[str, Any] = {
        "format": "TIFF",
        "dtype": dtype_str,
        "page_count": page_count,
        "raw_shape": list(arr.shape),
    }

    squeezed = np.squeeze(arr)

    # 2D Grayscale: (H, W)
    if squeezed.ndim == 2:
        H, W = squeezed.shape
        ch_8bit = normalize_to_8bit(squeezed)
        rgb = np.stack([ch_8bit, ch_8bit, ch_8bit], axis=-1)
        meta["width"] = int(W)
        meta["height"] = int(H)
        meta["channels"] = 1

    # 3D: (H, W, 3/4) RGB or (C, H, W) or (Z, H, W)
    elif squeezed.ndim == 3:
        if squeezed.shape[2] in (3, 4):
            H, W, C = squeezed.shape
            rgb = normalize_to_8bit(squeezed[:, :, :3])
            meta["width"] = int(W)
            meta["height"] = int(H)
            meta["channels"] = int(C)
        elif squeezed.shape[0] in (2, 3, 4):
            C, H, W = squeezed.shape
            chs = [normalize_to_8bit(squeezed[c]) for c in range(C)]
            rgb = composite_channels(chs)
            meta["width"] = int(W)
            meta["height"] = int(H)
            meta["channels"] = int(C)
        else:
            Z, H, W = squeezed.shape
            mip = np.max(squeezed, axis=0)
            ch_8bit = normalize_to_8bit(mip)
            rgb = np.stack([ch_8bit, ch_8bit, ch_8bit], axis=-1)
            meta["width"] = int(W)
            meta["height"] = int(H)
            meta["z_slices"] = int(Z)
            meta["channels"] = 1
            meta["projection"] = "Max Intensity Projection (Z)"

    # 4D+: reduce higher dimensions
    else:
        curr = squeezed
        while curr.ndim > 3:
            curr = np.max(curr, axis=0)
        if curr.ndim == 3 and curr.shape[2] not in (3, 4):
            if curr.shape[0] in (2, 3, 4):
                chs = [normalize_to_8bit(curr[c]) for c in range(curr.shape[0])]
                rgb = composite_channels(chs)
            else:
                curr = np.max(curr, axis=0)
                ch_8bit = normalize_to_8bit(curr)
                rgb = np.stack([ch_8bit, ch_8bit, ch_8bit], axis=-1)
        elif curr.ndim == 3:
            rgb = normalize_to_8bit(curr[:, :, :3])
        else:
            ch_8bit = normalize_to_8bit(curr)
            rgb = np.stack([ch_8bit, ch_8bit, ch_8bit], axis=-1)

        meta["width"] = int(rgb.shape[1])
        meta["height"] = int(rgb.shape[0])
        meta["channels"] = 1

    pil_img = Image.fromarray(rgb)
    if max(pil_img.size) > 2048:
        pil_img.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
    pil_img.save(preview_path, format="PNG", optimize=True)
    return meta


def process_nd2(file_path: Path, preview_path: Path) -> Dict[str, Any]:
    """Reads a Nikon ND2 file, handles multi-position and multi-channel axes, and generates a composite preview."""
    import nd2
    with nd2.ND2File(str(file_path)) as f:
        sizes = dict(f.sizes)
        dtype_str = str(f.dtype)
        meta: Dict[str, Any] = {
            "format": "Nikon ND2",
            "dtype": dtype_str,
            "sizes": sizes,
            "ndim": f.ndim,
        }

        # Channel names and colors
        channel_names = []
        channel_colors = []
        try:
            if f.metadata and hasattr(f.metadata, "channels") and f.metadata.channels:
                for ch_meta in f.metadata.channels:
                    c = getattr(ch_meta, "channel", ch_meta)
                    cname = getattr(c, "name", None)
                    if cname:
                        channel_names.append(str(cname))
                    ccolor = getattr(c, "color", None)
                    if ccolor and hasattr(ccolor, "r") and hasattr(ccolor, "g") and hasattr(ccolor, "b"):
                        r, g, b = int(ccolor.r), int(ccolor.g), int(ccolor.b)
                        # Avoid pure white wash out in multi-channel composites
                        if r == 255 and g == 255 and b == 255 and len(f.metadata.channels) > 1:
                            channel_colors.append([255, 0, 255])
                        else:
                            channel_colors.append([r, g, b])
        except Exception:
            pass

        if channel_names:
            meta["channel_names"] = channel_names

        # Voxel / pixel size
        try:
            vox = f.voxel_size()
            if vox:
                meta["pixel_size_um"] = {
                    "x": round(float(getattr(vox, 'x', 0)), 4),
                    "y": round(float(getattr(vox, 'y', 0)), 4),
                    "z": round(float(getattr(vox, 'z', 0)), 4) if hasattr(vox, 'z') and getattr(vox, 'z', None) is not None else None,
                }
        except Exception:
            pass

        # Text information (microscope metadata)
        try:
            txt = f.text_info
            if txt and isinstance(txt, dict):
                clean_txt = {}
                for k, v in txt.items():
                    if v is not None and str(v).strip():
                        clean_txt[str(k)] = str(v).strip()
                if clean_txt:
                    meta["text_info"] = clean_txt
        except Exception:
            pass

        arr = f.asarray()

    Y = sizes.get('Y', arr.shape[-2] if arr.ndim >= 2 else 512)
    X = sizes.get('X', arr.shape[-1] if arr.ndim >= 1 else 512)
    meta["width"] = int(X)
    meta["height"] = int(Y)

    num_c = sizes.get('C', 1)
    meta["channels"] = int(num_c)
    if 'P' in sizes:
        meta["positions"] = int(sizes['P'])
    if 'S' in sizes:
        meta["scenes"] = int(sizes['S'])
    if 'Z' in sizes:
        meta["z_slices"] = int(sizes['Z'])
    if 'T' in sizes:
        meta["timepoints"] = int(sizes['T'])

    current_arr = arr
    axes = list(sizes.keys())

    # Step 1: Reduce Positions / Scenes (P, S, M) -> pick position 0
    for pos_key in ('P', 'S', 'M', 'position', 'scene'):
        if pos_key in axes:
            idx = axes.index(pos_key)
            current_arr = np.take(current_arr, indices=0, axis=idx)
            axes.pop(idx)

    # Step 2: Reduce Time (T) -> pick frame 0
    if 'T' in axes:
        idx = axes.index('T')
        current_arr = np.take(current_arr, indices=0, axis=idx)
        axes.pop(idx)

    # Step 3: Reduce Z (Z-stack) -> Max intensity projection along Z
    if 'Z' in axes:
        idx = axes.index('Z')
        current_arr = np.max(current_arr, axis=idx)
        axes.pop(idx)
        meta["projection"] = "Max Intensity Projection (Z)"

    # Step 4: Reduce any other remaining extra axis that is not C, Y, X
    for ax in list(axes):
        if ax not in ('C', 'Y', 'X'):
            idx = axes.index(ax)
            current_arr = np.take(current_arr, indices=0, axis=idx)
            axes.pop(idx)

    # Step 5: Composite channels along C
    if 'C' in axes:
        c_idx = axes.index('C')
        current_arr = np.moveaxis(current_arr, c_idx, 0)
        c_count = current_arr.shape[0]
        chs_2d = []
        for i in range(c_count):
            ch_plane = np.squeeze(current_arr[i])
            while ch_plane.ndim > 2:
                ch_plane = np.max(ch_plane, axis=0)
            chs_2d.append(normalize_to_8bit(ch_plane))

        rgb = composite_channels(chs_2d, channel_colors if len(channel_colors) == c_count else None)
    else:
        plane = np.squeeze(current_arr)
        while plane.ndim > 2:
            plane = np.max(plane, axis=0)
        norm_2d = normalize_to_8bit(plane)
        rgb = np.stack([norm_2d, norm_2d, norm_2d], axis=-1)

    pil_img = Image.fromarray(rgb)
    if max(pil_img.size) > 2048:
        pil_img.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
    pil_img.save(preview_path, format="PNG", optimize=True)
    return meta


def process_uploaded_file(file_path: Path, uploads_dir: Path) -> Tuple[Optional[str], Dict[str, Any]]:
    """
    Checks if an uploaded file is a TIFF or ND2 file (or standard image).
    Generates a web-viewable PNG preview if needed.
    Returns (preview_relative_url, metadata_dict).
    """
    ext = file_path.suffix.lower()
    preview_filename = f"{file_path.stem}_preview.png"
    preview_path = uploads_dir / preview_filename

    if ext in ('.tif', '.tiff'):
        try:
            meta = process_tiff(file_path, preview_path)
            return f"/uploads/{preview_filename}", meta
        except Exception as e:
            print(f"Error reading TIFF with tifffile: {e}")
            try:
                with Image.open(file_path) as im:
                    im.convert("RGB").save(preview_path, format="PNG")
                    return f"/uploads/{preview_filename}", {
                        "format": "TIFF",
                        "width": im.width,
                        "height": im.height,
                    }
            except Exception as e2:
                print(f"PIL fallback failed: {e2}")
                return None, {"format": "TIFF", "error": str(e)}

    elif ext == '.nd2':
        try:
            meta = process_nd2(file_path, preview_path)
            return f"/uploads/{preview_filename}", meta
        except Exception as e:
            print(f"Error reading ND2: {e}")
            return None, {"format": "Nikon ND2", "error": str(e)}

    elif ext in ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'):
        try:
            with Image.open(file_path) as im:
                return None, {
                    "format": im.format or "Image",
                    "width": im.width,
                    "height": im.height,
                    "mode": im.mode,
                }
        except Exception:
            return None, {"format": ext[1:].upper()}

    return None, {}
