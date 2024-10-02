#!/usr/bin/env python3
import curses
import json
import os
import select
import fcntl
import re
import subprocess
import random
import tempfile
from datetime import datetime
import signal
import sys
import contextlib
import io
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SETTINGS_PATH = ROOT / "configs" / "tile_videos_settings.json"
SRC_DIR = ROOT / "src"
DEFAULT_OUTPUT_WIDTH = 1920
DEFAULT_OUTPUT_HEIGHT = 1080

sys.path.insert(0, str(ROOT))
from video_tiling import tile_videos as tv
from video_tiling import trim_videos as trim_tool
from video_tiling import concat_videos as concat_tool
from video_tiling import detect_scenes as detect_tool


MAIN_MENU = [
    "Run saved settings",
    "Create new settings",
    "Edit saved settings",
    "Random settings (YOLO)",
    "Help",
    "Tools and Doctor",
    "Exit",
]

BACK = object()


def is_back(value):
    return value is None or value is BACK

PAIR_HEADER = 1
PAIR_FOOTER = 2
PAIR_HIGHLIGHT = 3
PAIR_BORDER = 4
PAIR_ACCENT = 5
PAIR_ERROR = 6
PAIR_SUCCESS = 7
PAIR_TILE_START = 10

TILE_COLORS = [
    curses.COLOR_CYAN,
    curses.COLOR_GREEN,
    curses.COLOR_YELLOW,
    curses.COLOR_MAGENTA,
    curses.COLOR_BLUE,
    curses.COLOR_RED,
    curses.COLOR_WHITE,
    curses.COLOR_CYAN,
    curses.COLOR_GREEN,
]


def init_colors():
    if not curses.has_colors():
        return
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(PAIR_HEADER, curses.COLOR_WHITE, curses.COLOR_BLUE)
    curses.init_pair(PAIR_FOOTER, curses.COLOR_WHITE, curses.COLOR_BLUE)
    curses.init_pair(PAIR_HIGHLIGHT, curses.COLOR_BLACK, curses.COLOR_WHITE)
    curses.init_pair(PAIR_BORDER, curses.COLOR_CYAN, -1)
    curses.init_pair(PAIR_ACCENT, curses.COLOR_YELLOW, -1)
    curses.init_pair(PAIR_ERROR, curses.COLOR_RED, -1)
    curses.init_pair(PAIR_SUCCESS, curses.COLOR_GREEN, -1)
    for i, color in enumerate(TILE_COLORS):
        curses.init_pair(PAIR_TILE_START + i, color, -1)


def style(pair, fallback=curses.A_NORMAL):
    if curses.has_colors():
        return curses.color_pair(pair)
    return fallback


def tile_style(tile_index, fallback=curses.A_NORMAL):
    if tile_index is None:
        return fallback
    if curses.has_colors() and 0 <= tile_index < len(TILE_COLORS):
        return curses.color_pair(PAIR_TILE_START + tile_index)
    return fallback


PULSE_FRAMES = ["..", "::", "==", "##", "==", "::"]


def pulse_frame(tick):
    return PULSE_FRAMES[tick % len(PULSE_FRAMES)]


def draw_panel(stdscr, y, x, height, width, title=None):
    if height < 3 or width < 3:
        return

    horizontal = "-" * (width - 2)
    stdscr.addstr(y, x, "+" + horizontal + "+", style(PAIR_BORDER))
    for row in range(y + 1, y + height - 1):
        stdscr.addstr(row, x, "|", style(PAIR_BORDER))
        stdscr.addstr(row, x + width - 1, "|", style(PAIR_BORDER))
    stdscr.addstr(y + height - 1, x, "+" + horizontal + "+", style(PAIR_BORDER))

    if title:
        title_text = f" {title} "
        max_title = max(0, width - 4)
        stdscr.addstr(y, x + 2, title_text[:max_title], style(PAIR_ACCENT, curses.A_BOLD))


def log_line_style(line):
    lower = line.lower()
    if "error" in lower or "failed" in lower or "\u2717" in line or "✗" in line:
        return style(PAIR_ERROR)
    if "\u2713" in line or "✓" in line or "success" in lower or "created" in lower:
        return style(PAIR_SUCCESS)
    return curses.A_NORMAL


def load_settings():
    if SETTINGS_PATH.exists():
        with open(SETTINGS_PATH, "r") as f:
            return json.load(f)
    return None


def save_settings(settings):
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=2)


def draw_header(stdscr, title):
    height, width = stdscr.getmaxyx()
    stdscr.attron(style(PAIR_HEADER, curses.A_REVERSE))
    stdscr.addstr(0, 0, " " * (width - 1))
    stdscr.addstr(0, 2, title[: width - 4], style(PAIR_HEADER, curses.A_BOLD))
    stdscr.attroff(style(PAIR_HEADER, curses.A_REVERSE))


def draw_footer(stdscr, text):
    height, width = stdscr.getmaxyx()
    stdscr.attron(style(PAIR_FOOTER, curses.A_REVERSE))
    stdscr.addstr(height - 1, 0, " " * (width - 1))
    stdscr.addstr(height - 1, 2, text[: width - 4], style(PAIR_FOOTER))
    stdscr.attroff(style(PAIR_FOOTER, curses.A_REVERSE))


def summary_layout(stdscr):
    height, width = stdscr.getmaxyx()
    if width >= 110:
        panel_width = min(44, width - 6)
        x = width - panel_width - 2
        y = 2
        h = height - 4
        return {"mode": "right", "x": x, "y": y, "width": panel_width, "height": h}

    panel_height = min(9, max(5, height // 3))
    x = 2
    y = height - panel_height - 2
    w = width - 4
    return {"mode": "bottom", "x": x, "y": y, "width": w, "height": panel_height}


def draw_summary(stdscr, summary, layout=None, extra_lines=None, layout_preview=None):
    if summary is None and not extra_lines and not layout_preview:
        return
    if layout is None:
        layout = summary_layout(stdscr)

    draw_panel(stdscr, layout["y"], layout["x"], layout["height"], layout["width"], "Summary")
    row = layout["y"] + 2
    max_width = layout["width"] - 4

    if summary:
        for label, value in summary:
            if row >= layout["y"] + layout["height"] - 1:
                break
            line = f"{label}: {value}"
            stdscr.addstr(row, layout["x"] + 2, line[:max_width])
            row += 1

    if extra_lines:
        if row < layout["y"] + layout["height"] - 1:
            row += 1
        for line in extra_lines:
            if row >= layout["y"] + layout["height"] - 1:
                break
            stdscr.addstr(row, layout["x"] + 2, line[:max_width])
            row += 1

    if layout_preview and row < layout["y"] + layout["height"] - 1:
        row += 1
        label = "Layout preview:"
        stdscr.addstr(row, layout["x"] + 2, label[:max_width], style(PAIR_ACCENT, curses.A_BOLD))
        row += 1
        remaining = layout["y"] + layout["height"] - 1 - row
        if remaining > 0:
            draw_layout_preview(
                stdscr,
                layout_preview,
                row,
                layout["x"] + 2,
                max_width,
                remaining,
            )


def draw_layout_preview(stdscr, layout_code, y, x, max_width, max_height):
    if not layout_code:
        return
    lines = tv.LAYOUT_ASCII.get(layout_code, [])
    if not lines:
        return
    row = y
    for line in lines:
        if row >= y + max_height:
            break
        col = 0
        for part in re.split(r"(\d+)", line):
            if not part or col >= max_width:
                continue
            snippet = part[: max_width - col]
            if part.isdigit():
                tile_index = int(part) - 1
                attr = tile_style(tile_index, curses.A_BOLD) | curses.A_BOLD
            else:
                attr = curses.A_NORMAL
            stdscr.addstr(row, x + col, snippet, attr)
            col += len(snippet)
        row += 1


def list_select(
    stdscr,
    title,
    options,
    selected=0,
    help_text=None,
    summary=None,
    option_colors=None,
    layout_preview=None,
    layout_preview_func=None,
):
    if help_text is None:
        help_text = "Arrow keys to move, Enter to select, b/Esc to go back"

    while True:
        stdscr.clear()
        draw_header(stdscr, title)
        draw_footer(stdscr, help_text)
        height, width = stdscr.getmaxyx()

        show_summary = summary is not None or layout_preview is not None or layout_preview_func is not None
        layout = summary_layout(stdscr) if show_summary else None
        if layout:
            preview_code = layout_preview_func(selected) if layout_preview_func else layout_preview
            draw_summary(stdscr, summary or [], layout=layout, layout_preview=preview_code)

        list_x = 2
        list_y = 2
        list_w = width - 4
        list_h = height - 4

        if layout and layout["mode"] == "right":
            list_w = max(20, layout["x"] - list_x - 2)
        if layout and layout["mode"] == "bottom":
            list_h = max(6, layout["y"] - list_y - 2)

        draw_panel(stdscr, list_y, list_x, list_h, list_w, "Options")

        start_row = list_y + 1
        for i, opt in enumerate(options):
            is_selected = i == selected
            opt_style = style(PAIR_HIGHLIGHT, curses.A_REVERSE) if is_selected else curses.A_NORMAL
            if not is_selected and option_colors and i < len(option_colors) and option_colors[i] is not None:
                opt_style = option_colors[i]
            marker = "[x]" if is_selected else "[ ]"
            line = f"{marker} {opt}"[: list_w - 4]
            if start_row + i < list_y + list_h - 1:
                stdscr.addstr(start_row + i, list_x + 2, line, opt_style)

        stdscr.refresh()
        key = stdscr.getch()

        if key in (curses.KEY_UP, ord("k")):
            selected = (selected - 1) % len(options)
        elif key in (curses.KEY_DOWN, ord("j")):
            selected = (selected + 1) % len(options)
        elif key in (curses.KEY_ENTER, 10, 13):
            if options and options[selected].strip().lower() == "back":
                return BACK
            return selected
        elif key in (27, ord("b")):
            return BACK


def multi_select(
    stdscr,
    title,
    options,
    help_text=None,
    summary=None,
    values=None,
    option_colors=None,
    layout_preview=None,
):
    if help_text is None:
        help_text = "Space to toggle, Enter to confirm (selects current), b/Esc to go back"

    selected = 0
    chosen = set()

    while True:
        stdscr.clear()
        draw_header(stdscr, title)
        draw_footer(stdscr, help_text)
        height, width = stdscr.getmaxyx()

        show_summary = summary is not None or layout_preview is not None
        layout = summary_layout(stdscr) if show_summary else None
        if layout:
            draw_summary(stdscr, summary or [], layout=layout, layout_preview=layout_preview)

        list_x = 2
        list_y = 2
        list_w = width - 4
        list_h = height - 4
        if layout and layout["mode"] == "right":
            list_w = max(20, layout["x"] - list_x - 2)
        if layout and layout["mode"] == "bottom":
            list_h = max(6, layout["y"] - list_y - 2)

        draw_panel(stdscr, list_y, list_x, list_h, list_w, "Options")

        start_row = list_y + 1
        for i, opt in enumerate(options):
            is_current = i == selected
            is_checked = i in chosen
            opt_style = style(PAIR_HIGHLIGHT, curses.A_REVERSE) if is_current else curses.A_NORMAL
            if not is_current and option_colors and i < len(option_colors) and option_colors[i] is not None:
                opt_style = option_colors[i]
            marker = "[x]" if is_checked else "[ ]"
            line = f"{marker} {opt}"[: list_w - 4]
            if start_row + i < list_y + list_h - 1:
                stdscr.addstr(start_row + i, list_x + 2, line, opt_style)

        stdscr.refresh()
        key = stdscr.getch()
        if key in (curses.KEY_UP, ord("k")):
            selected = (selected - 1) % len(options)
        elif key in (curses.KEY_DOWN, ord("j")):
            selected = (selected + 1) % len(options)
        elif key == ord(" "):
            if selected in chosen:
                chosen.remove(selected)
            else:
                chosen.add(selected)
        elif key in (curses.KEY_ENTER, 10, 13):
            if not chosen:
                chosen.add(selected)
            if values:
                return [values[i] for i in sorted(chosen)]
            return [options[i] for i in sorted(chosen)]
        elif key in (27, ord("b")):
            return BACK


def text_input(stdscr, prompt, initial="", summary=None):
    stdscr.clear()
    draw_header(stdscr, "Input")
    draw_footer(stdscr, "Enter to submit, Esc to cancel")
    height, width = stdscr.getmaxyx()

    layout = summary_layout(stdscr) if summary else None
    if summary:
        draw_summary(stdscr, summary, layout=layout)

    input_x = 2
    input_y = 2
    input_w = width - 4
    input_h = 6

    if layout and layout["mode"] == "right":
        input_w = max(20, layout["x"] - input_x - 2)
    if layout and layout["mode"] == "bottom":
        input_h = max(6, layout["y"] - input_y - 2)

    draw_panel(stdscr, input_y, input_x, input_h, input_w, "Input")

    stdscr.addstr(input_y + 1, input_x + 2, prompt[: input_w - 4])
    stdscr.addstr(input_y + 3, input_x + 2, initial[: input_w - 4])
    stdscr.move(input_y + 3, input_x + 2 + len(initial))
    stdscr.refresh()

    buf = list(initial)
    while True:
        key = stdscr.getch()
        if key in (10, 13):
            return "".join(buf).strip()
        if key == 27:
            return None
        if key in (curses.KEY_BACKSPACE, 127, 8):
            if buf:
                buf.pop()
        elif key >= 32 and key < 127:
            buf.append(chr(key))

        stdscr.addstr(input_y + 3, input_x + 2, " " * (input_w - 4))
        stdscr.addstr(input_y + 3, input_x + 2, "".join(buf)[: input_w - 4])
        stdscr.move(input_y + 3, input_x + 2 + len(buf))
        stdscr.refresh()


def confirm(stdscr, prompt, default=True, summary=None):
    suffix = "[Y/n]" if default else "[y/N]"
    value = text_input(stdscr, f"{prompt} {suffix}", "", summary=summary)
    if value is None or value == "":
        return default
    return value.lower().startswith("y")


def confirm_with_back(stdscr, prompt, default=True, summary=None):
    suffix = "[Y/n]" if default else "[y/N]"
    value = text_input(stdscr, f"{prompt} {suffix}", "", summary=summary)
    if value is None:
        return BACK
    if value == "":
        return default
    return value.lower().startswith("y")


def input_float_optional(stdscr, prompt, summary=None):
    while True:
        value = text_input(stdscr, prompt, summary=summary)
        if value is None:
            return None, True
        if value == "":
            return None, False
        try:
            number = float(value)
            if number > 0:
                return number, False
        except ValueError:
            pass


def pick_layout(stdscr, summary=None):
    options = [f"{code} - {desc}" for code, desc in tv.LAYOUTS.values()]
    def preview_for_index(index):
        try:
            return tv.LAYOUTS[str(index + 1)][0]
        except KeyError:
            return None

    selection = list_select(
        stdscr,
        "Select Layout",
        options,
        summary=summary,
        layout_preview_func=preview_for_index,
    )
    if is_back(selection):
        return None
    return tv.LAYOUTS[str(selection + 1)][0]


def pick_crop_mode(stdscr, summary=None):
    options = [tv.CROP_MODE_NAMES[mode] for mode in tv.CROP_MODES.values()]
    selection = list_select(stdscr, "Select Crop Mode", options, summary=summary)
    if is_back(selection):
        return None
    return tv.CROP_MODES[str(selection + 1)]


def pick_distribution(stdscr, default_key="4", summary=None):
    options = [
        "1. Round-Robin",
        "2. Sequential Blocks",
        "3. Random Distribution",
        "4. Shuffle then Round-Robin",
    ]
    default_index = int(default_key) - 1
    selection = list_select(stdscr, "Distribution Mode", options, selected=default_index, summary=summary)
    if is_back(selection):
        return None
    return tv.DISTRIBUTION_MODES[str(selection + 1)]


def human_size(num_bytes):
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(num_bytes)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def folder_size_bytes(folder_path):
    total = 0
    for root, _, files in os.walk(folder_path):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                continue
    return total


def count_files_in_subdir(folder_path, subdir, extensions=None):
    base = Path(folder_path) / subdir
    if not base.exists() or not base.is_dir():
        return 0
    count = 0
    for path in base.iterdir():
        if not path.is_file():
            continue
        if extensions is None or path.suffix.lower() in extensions:
            count += 1
    return count


def folder_media_info(folder_path):
    return {
        "images": count_files_in_subdir(folder_path, "images", tv.IMAGE_EXTENSIONS),
        "landscape": count_files_in_subdir(folder_path, "landscape", tv.VIDEO_EXTENSIONS),
    }


def tile_is_landscape(layout_code, tile_index, width=DEFAULT_OUTPUT_WIDTH, height=DEFAULT_OUTPUT_HEIGHT):
    dims = tv.get_tile_dimensions(layout_code, tile_index, width, height)
    if not dims:
        return False
    return dims[0] > dims[1]


def get_src_folders_info():
    if not SRC_DIR.exists():
        return []
    folders = []
    for path in SRC_DIR.iterdir():
        if not path.is_dir():
            continue
        size = folder_size_bytes(path)
        media = folder_media_info(path)
        folders.append({
            "name": path.name,
            "path": path,
            "size": size,
            "images": media["images"],
            "landscape": media["landscape"],
        })
    return sorted(folders, key=lambda x: x["name"].lower())


def list_src_folders():
    return [entry["name"] for entry in get_src_folders_info()]


def pick_folder(stdscr, title, summary=None, layout_code=None):
    info = get_src_folders_info()
    options = [
        f"{entry['name']} ({human_size(entry['size'])}, images:{entry['images']}, landscape:{entry['landscape']})"
        for entry in info
    ]
    options.append("Custom path...")
    tile_index = extract_tile_index(title)
    folder_style = tile_style(tile_index, style(PAIR_ACCENT)) | curses.A_BOLD
    option_colors = [folder_style] * len(info) + [style(PAIR_ACCENT, curses.A_BOLD)]
    selection = list_select(
        stdscr,
        title,
        options,
        summary=summary,
        option_colors=option_colors,
        layout_preview=layout_code,
    )
    if is_back(selection):
        return None
    if selection == len(options) - 1:
        value = text_input(stdscr, "Enter folder path:", summary=summary)
        return value
    return info[selection]["name"]


def pick_transition(stdscr, tile_index, summary=None, layout_code=None):
    options = [
        "1. Simple Cut",
        "2. Cross-Dissolve",
        "3. Fade to Black",
    ]
    selection = list_select(
        stdscr,
        f"Transition for Tile {tile_index + 1}",
        options,
        summary=summary,
        layout_preview=layout_code,
    )
    if is_back(selection):
        return None, None
    trans_type = tv.TRANSITIONS[str(selection + 1)]
    duration = 0
    if trans_type != "cut":
        while True:
            value = text_input(stdscr, "Transition duration (seconds):", summary=summary)
            if value is None:
                return None, None
            try:
                duration = float(value)
                if duration > 0:
                    break
            except ValueError:
                pass
    return trans_type, duration


def pick_crop_position(stdscr, tile_index, summary=None, layout_code=None):
    options = [f"{key}. {name}" for key, name in tv.CROP_POSITION_NAMES.items()]
    selection = list_select(
        stdscr,
        f"Crop Position for Tile {tile_index + 1}",
        options,
        summary=summary,
        layout_preview=layout_code,
    )
    if is_back(selection):
        return None
    keys = list(tv.CROP_POSITION_NAMES.keys())
    return keys[selection]


def pick_audio_tile(stdscr, tile_folders, summary=None, layout_code=None):
    options = [f"{i + 1}. {folder}" for i, folder in enumerate(tile_folders)]
    option_colors = [tile_style(i, style(PAIR_ACCENT)) | curses.A_BOLD for i in range(len(tile_folders))]
    selection = list_select(
        stdscr,
        "Select Audio Tile",
        options,
        summary=summary,
        option_colors=option_colors,
        layout_preview=layout_code,
    )
    if is_back(selection):
        return None
    return selection


def pick_audio_tiles(stdscr, tile_folders, summary=None, layout_code=None):
    options = [f"{i + 1}. {folder}" for i, folder in enumerate(tile_folders)]
    option_colors = [tile_style(i, style(PAIR_ACCENT)) | curses.A_BOLD for i in range(len(tile_folders))]
    values = list(range(len(tile_folders)))
    selection = multi_select(
        stdscr,
        "Select Audio Tiles",
        options,
        summary=summary,
        values=values,
        option_colors=option_colors,
        layout_preview=layout_code,
    )
    if is_back(selection):
        return None
    return selection


def normalize_settings(settings):
    layout_info = tv.get_layout_info(settings["layout_code"])
    num_tiles = layout_info["count"]

    if len(settings.get("tile_folders", [])) != num_tiles:
        settings["tile_folders"] = (settings.get("tile_folders") or [""])[:num_tiles]
        while len(settings["tile_folders"]) < num_tiles:
            settings["tile_folders"].append(settings["tile_folders"][0] if settings["tile_folders"] else "")

    settings["tile_folders"] = [
        str(tv.resolve_folder_path(folder)) if folder else folder
        for folder in settings.get("tile_folders", [])
    ]

    if len(settings.get("tile_settings", [])) != num_tiles:
        settings["tile_settings"] = (settings.get("tile_settings") or [])[:num_tiles]
        while len(settings["tile_settings"]) < num_tiles:
            settings["tile_settings"].append({
                "trans_type": "cut",
                "trans_duration": 0,
                "crop_position": "center",
                "speed": 1.0,
                "use_landscape": False,
                "mode": "video",
                "image_duration": 3.0,
            })
    else:
        for item in settings.get("tile_settings", []):
            if "speed" not in item:
                item["speed"] = 1.0
            if "use_landscape" not in item:
                item["use_landscape"] = False
            if "mode" not in item:
                item["mode"] = "video"
            if "image_duration" not in item:
                item["image_duration"] = 3.0

    if settings.get("max_durations"):
        settings["max_durations"] = settings["max_durations"][:num_tiles]
        while len(settings["max_durations"]) < num_tiles:
            settings["max_durations"].append(None)

    if settings.get("audio_enabled") is False:
        settings["audio_tile"] = None
        settings["audio_tiles"] = []
    else:
        audio_tiles = settings.get("audio_tiles")
        if audio_tiles is None:
            if settings.get("audio_tile") is None:
                settings["audio_tile"] = 0
            settings["audio_tiles"] = [settings["audio_tile"]]
        else:
            cleaned = []
            for idx in audio_tiles:
                try:
                    value = int(idx)
                except (ValueError, TypeError):
                    continue
                if 0 <= value < num_tiles and value not in cleaned:
                    cleaned.append(value)
            if not cleaned:
                cleaned = [settings.get("audio_tile", 0)]
            settings["audio_tiles"] = cleaned
            settings["audio_tile"] = cleaned[0]

    return settings


def format_settings_value(settings, field):
    if field == "layout_code":
        code = settings.get("layout_code")
        if not code:
            return "(unset)"
        layout = tv.get_layout_info(code)
        return f"{code} ({layout['count']} tiles)"
    if field == "crop_mode":
        mode = settings.get("crop_mode")
        return tv.CROP_MODE_NAMES.get(mode, "(unset)")
    if field == "audio_enabled":
        return "yes" if settings.get("audio_enabled", True) else "no"
    if field == "audio_tile":
        if settings.get("audio_enabled") is False:
            return "(disabled)"
        tiles = settings.get("audio_tiles") or []
        if len(tiles) > 1:
            labels = ", ".join(str(t + 1) for t in tiles)
            return f"mix tiles {labels}"
        value = settings.get("audio_tile")
        return f"tile {value + 1}" if value is not None else "(unset)"
    if field == "tile_folders":
        folders = settings.get("tile_folders") or []
        return ", ".join(folders) if folders else "(unset)"
    if field == "distribution_mode":
        mode = settings.get("distribution_mode")
        if not mode:
            return "(none)"
        return tv.DISTRIBUTION_MODE_NAMES.get(mode, mode)
    if field == "tile_settings":
        items = settings.get("tile_settings") or []
        if not items:
            return "(unset)"
        parts = []
        for i, item in enumerate(items, start=1):
            trans = tv.TRANSITION_NAMES.get(item.get("trans_type"), item.get("trans_type"))
            crop = item.get("crop_position", "center")
            speed = item.get("speed", 1.0)
            mode = item.get("mode", "video")
            parts.append(f"{i}:{mode}/{trans}/{crop}/{speed}x")
        return " | ".join(parts)
    if field == "max_durations":
        values = settings.get("max_durations")
        if not values:
            return "(none)"
        return ", ".join(["no limit" if v is None else f"{v}s" for v in values])
    if field == "max_total_duration":
        value = settings.get("max_total_duration")
        return "no limit" if value is None else f"{value}s"
    return ""


def format_tile_summary(tile_cfg):
    mode = tile_cfg.get("mode", "video")
    trans = tv.TRANSITION_NAMES.get(tile_cfg.get("trans_type"), tile_cfg.get("trans_type"))
    crop = tile_cfg.get("crop_position", "center")
    speed = tile_cfg.get("speed", 1.0)
    image_duration = tile_cfg.get("image_duration", 3.0)
    use_landscape = tile_cfg.get("use_landscape", False)
    if mode == "image":
        return f"image/{image_duration}s/{speed}x/{crop}"
    suffix = "/landscape" if use_landscape else ""
    return f"video{suffix}/{trans}/{crop}/{speed}x"


def edit_tile_settings_menu(stdscr, settings):
    settings = normalize_settings(settings)
    layout_info = tv.get_layout_info(settings["layout_code"])
    num_tiles = layout_info["count"]
    summary = [("layout", settings["layout_code"])]

    while True:
        options = []
        for i in range(num_tiles):
            folder = settings["tile_folders"][i]
            tile_cfg = settings["tile_settings"][i]
            options.append(f"Tile {i + 1} ({Path(folder).name}): {format_tile_summary(tile_cfg)}")
        options.append("Back")

        option_colors = [tile_style(i, style(PAIR_ACCENT)) | curses.A_BOLD for i in range(num_tiles)] + [None]
        choice = list_select(
            stdscr,
            "Edit Tile Settings",
            options,
            summary=summary,
            option_colors=option_colors,
            layout_preview=settings["layout_code"],
        )
        if is_back(choice) or choice == len(options) - 1:
            return

        tile_index = choice
        tile_cfg = settings["tile_settings"][tile_index]

        while True:
            folder_path = tv.resolve_folder_path(settings["tile_folders"][tile_index])
            media = folder_media_info(folder_path)
            is_landscape = tile_is_landscape(settings["layout_code"], tile_index)
            landscape_label = "Use landscape folder: "
            if not is_landscape:
                landscape_label += "n/a (portrait tile)"
            elif media["landscape"] == 0:
                landscape_label += "n/a (no folder)"
            else:
                landscape_label += "yes" if tile_cfg.get("use_landscape", False) else "no"

            fields = [
                f"Folder: {Path(folder_path).name} (images:{media['images']}, landscape:{media['landscape']})",
                f"Mode: {tile_cfg.get('mode', 'video')}",
            ]

            if tile_cfg.get("mode", "video") == "video":
                fields.append(landscape_label)
                fields.append(f"Transition: {tv.TRANSITION_NAMES.get(tile_cfg.get('trans_type'), tile_cfg.get('trans_type'))}")
                fields.append(f"Transition duration: {tile_cfg.get('trans_duration', 0)}s")
            else:
                fields.append(f"Image duration: {tile_cfg.get('image_duration', 3.0)}s")

            fields.extend([
                f"Crop position: {tile_cfg.get('crop_position', 'center')}",
                f"Speed: {tile_cfg.get('speed', 1.0)}x",
                "Back",
            ])

            field_summary = [("layout", settings["layout_code"]), ("tile", str(tile_index + 1))]
            field_choice = list_select(
                stdscr,
                f"Tile {tile_index + 1} Settings",
                fields,
                summary=field_summary,
                layout_preview=settings["layout_code"],
            )
            if is_back(field_choice) or field_choice == len(fields) - 1:
                break

            if field_choice == 0:
                # Folder info is read-only
                continue
            if field_choice == 1:
                mode_choice = list_select(
                    stdscr,
                    "Tile mode",
                    ["Video", "Images"],
                    summary=field_summary,
                    layout_preview=settings["layout_code"],
                )
                if is_back(mode_choice):
                    continue
                selected_mode = "video" if mode_choice == 0 else "image"
                if selected_mode == "image" and media["images"] == 0:
                    text_input(stdscr, "No images/ folder found. Press Enter.")
                    continue
                tile_cfg["mode"] = selected_mode
                if tile_cfg["mode"] == "image":
                    tile_cfg["trans_type"] = "cut"
                    tile_cfg["trans_duration"] = 0
            elif tile_cfg.get("mode", "video") == "video" and field_choice == 2:
                if not is_landscape:
                    text_input(stdscr, "This tile is portrait. Press Enter.")
                    continue
                if media["landscape"] == 0:
                    text_input(stdscr, "No landscape folder found. Press Enter.")
                    continue
                tile_cfg["use_landscape"] = confirm(stdscr, "Use landscape subfolder?", default=False)
            elif tile_cfg.get("mode", "video") == "image" and field_choice == 2:
                value = text_input(stdscr, "Image duration seconds:", str(tile_cfg.get("image_duration", 3.0)))
                if value is None:
                    continue
                try:
                    duration = float(value) if value else 3.0
                except ValueError:
                    duration = 3.0
                if duration <= 0:
                    duration = 3.0
                tile_cfg["image_duration"] = duration
            elif tile_cfg.get("mode", "video") == "video" and field_choice == 3:
                trans_type, trans_duration = pick_transition(
                    stdscr,
                    tile_index,
                    layout_code=settings["layout_code"],
                )
                if trans_type is None:
                    continue
                tile_cfg["trans_type"] = trans_type
                tile_cfg["trans_duration"] = trans_duration
            elif tile_cfg.get("mode", "video") == "video" and field_choice == 4:
                if tile_cfg.get("trans_type") == "cut":
                    text_input(stdscr, "Simple Cut has no duration. Press Enter.")
                    continue
                value = text_input(stdscr, "Transition duration seconds:", str(tile_cfg.get("trans_duration", 0)))
                if value is None:
                    continue
                try:
                    duration = float(value) if value else 0
                except ValueError:
                    duration = 0
                if duration < 0:
                    duration = 0
                tile_cfg["trans_duration"] = duration
            elif (tile_cfg.get("mode", "video") == "video" and field_choice == 5) or (tile_cfg.get("mode", "video") == "image" and field_choice == 3):
                if settings["crop_mode"] != "crop":
                    text_input(stdscr, "Crop position applies only to crop mode. Press Enter.")
                    continue
                    crop_position = pick_crop_position(
                        stdscr,
                        tile_index,
                        layout_code=settings["layout_code"],
                    )
                if crop_position is None:
                    continue
                tile_cfg["crop_position"] = crop_position
            elif (tile_cfg.get("mode", "video") == "video" and field_choice == 6) or (tile_cfg.get("mode", "video") == "image" and field_choice == 4):
                value = text_input(stdscr, "Playback speed (0.5=slow, 1=normal, 1.5=fast):", str(tile_cfg.get("speed", 1.0)))
                if value is None:
                    continue
                try:
                    speed = float(value) if value else 1.0
                except ValueError:
                    speed = 1.0
                if speed <= 0:
                    speed = 1.0
                tile_cfg["speed"] = speed


def render_progress(done, total, width=16):
    if total <= 0:
        return ""
    filled = int((done / total) * width)
    bar = "#" * filled + "-" * (width - filled)
    return f"[{bar}] {done}/{total}"


def tile_status_char(state):
    if state == "running":
        return ">"
    if state == "done":
        return "#"
    if state == "failed":
        return "!"
    return "."


def render_tile_ascii(layout_code, tile_states):
    art = tv.LAYOUT_ASCII.get(layout_code)
    if not art:
        return []
    lines = []
    for line in art:
        updated = line
        for i in range(1, len(tile_states) + 1):
            updated = updated.replace(str(i), tile_status_char(tile_states[i - 1]))
        lines.append(updated)
    return lines


def extract_tile_index(line):
    match = re.search(r"tile\s+(\d+)", line, re.IGNORECASE)
    if not match:
        return None
    return int(match.group(1)) - 1


def build_yolo_settings():
    info = get_src_folders_info()
    if not info:
        return None

    folder_names = [entry["name"] for entry in info]
    folder_info = {entry["name"]: entry for entry in info}

    layout_code = random.choice([code for code, _ in tv.LAYOUTS.values()])
    layout_info = tv.get_layout_info(layout_code)
    num_tiles = layout_info["count"]

    crop_mode = random.choice(list(tv.CROP_MODES.values()))
    distribution_mode = random.choice(list(tv.DISTRIBUTION_MODES.values()))
    audio_enabled = True

    tile_folders = [random.choice(folder_names) for _ in range(num_tiles)]
    tile_settings = []

    trans_types = list(tv.TRANSITIONS.values())
    crop_positions = list(tv.CROP_POSITION_NAMES.keys())
    speeds = [0.5, 1.0, 1.5]
    image_durations = [2.0, 3.0, 4.0, 5.0]

    for i, folder in enumerate(tile_folders):
        info_entry = folder_info[folder]
        is_landscape = tile_is_landscape(layout_code, i)
        use_landscape = False
        if is_landscape and info_entry["landscape"] > 0:
            use_landscape = random.choice([True, False])

        mode = "video"
        if info_entry["images"] > 0 and random.random() < 0.25:
            mode = "image"

        if mode == "image" and info_entry["images"] == 0:
            mode = "video"

        trans_type = random.choice(trans_types)
        trans_duration = 0.0 if trans_type == "cut" else random.choice([0.5, 1.0, 1.5, 2.0])
        if mode == "image":
            trans_type = "cut"
            trans_duration = 0.0

        tile_settings.append({
            "mode": mode,
            "trans_type": trans_type,
            "trans_duration": trans_duration,
            "crop_position": random.choice(crop_positions),
            "speed": random.choice(speeds),
            "image_duration": random.choice(image_durations),
            "use_landscape": use_landscape,
        })

    audio_tile = random.randrange(num_tiles) if audio_enabled else None

    settings = {
        "layout_code": layout_code,
        "crop_mode": crop_mode,
        "audio_enabled": audio_enabled,
        "audio_tile": audio_tile,
        "audio_tiles": [audio_tile] if audio_tile is not None else [],
        "tile_folders": tile_folders,
        "distribution_mode": distribution_mode,
        "tile_settings": tile_settings,
        "max_durations": [None] * num_tiles,
        "max_total_duration": None,
    }

    return normalize_settings(settings)


def yolo_mode(stdscr):
    info = get_src_folders_info()
    if not info:
        text_input(stdscr, "No folders in src/. Press Enter.")
        return

    while True:
        settings = build_yolo_settings()
        if not settings:
            text_input(stdscr, "No folders in src/. Press Enter.")
            return

        summary = [
            ("layout", format_settings_value(settings, "layout_code")),
            ("crop", format_settings_value(settings, "crop_mode")),
            ("audio", format_settings_value(settings, "audio_enabled")),
            ("distribution", format_settings_value(settings, "distribution_mode")),
            ("folders", ", ".join(settings.get("tile_folders", []))[:40]),
        ]

        choice = list_select(
            stdscr,
            "Random settings (YOLO)",
            ["Run with these settings", "Reroll", "Cancel"],
            summary=summary,
            layout_preview=settings.get("layout_code"),
        )
        if is_back(choice) or choice == 2:
            return
        if choice == 0:
            temp_dir = ROOT / "outputs" / "tui-logs"
            temp_dir.mkdir(parents=True, exist_ok=True)
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(
                    "w",
                    delete=False,
                    suffix=".json",
                    dir=str(temp_dir),
                    encoding="utf-8",
                ) as temp_file:
                    json.dump(settings, temp_file, indent=2)
                    temp_path = temp_file.name
                run_with_saved_settings(stdscr, settings, settings_path=temp_path)
            finally:
                if temp_path:
                    try:
                        Path(temp_path).unlink()
                    except Exception:
                        pass
            return


def wizard(stdscr):
    state = {
        "layout_code": None,
        "crop_mode": None,
        "audio_enabled": True,
        "use_single": False,
        "tile_folders": [],
        "max_durations": [],
        "distribution_mode": None,
        "tile_settings": [],
        "audio_tile": None,
        "audio_tiles": [],
        "max_total_duration": None,
    }

    step = 0
    while True:
        summary = []
        if state["layout_code"]:
            summary.append(("layout", state["layout_code"]))
        if state["crop_mode"]:
            summary.append(("crop", tv.CROP_MODE_NAMES.get(state["crop_mode"], state["crop_mode"])))
        summary.append(("audio", "yes" if state["audio_enabled"] else "no"))

        if step == 0:
            layout_code = pick_layout(stdscr, summary=summary)
            if is_back(layout_code):
                return None
            state["layout_code"] = layout_code
            step += 1
            continue

        if step == 1:
            crop_mode = pick_crop_mode(stdscr, summary=summary)
            if is_back(crop_mode):
                step -= 1
                continue
            state["crop_mode"] = crop_mode
            step += 1
            continue

        if step == 2:
            audio_enabled = confirm_with_back(stdscr, "Include audio?", default=True, summary=summary)
            if is_back(audio_enabled):
                step -= 1
                continue
            state["audio_enabled"] = audio_enabled
            step += 1
            continue

        layout_info = tv.get_layout_info(state["layout_code"])
        num_tiles = layout_info["count"]

        if step == 3:
            use_single = False
            if num_tiles > 1:
                use_single = confirm_with_back(stdscr, "Use one folder for all tiles?", default=False, summary=summary)
                if is_back(use_single):
                    step -= 1
                    continue
            state["use_single"] = use_single
            step += 1
            continue

        if step == 4:
            tile_folders = []
            max_durations = []
            if state["use_single"]:
                folder = pick_folder(
                    stdscr,
                    "Folder for all tiles",
                    summary=summary,
                    layout_code=state["layout_code"],
                )
                if is_back(folder) or not folder:
                    step -= 1
                    continue
                tile_folders = [folder] * num_tiles
                max_value, cancelled = input_float_optional(
                    stdscr,
                    "Max duration for this folder (blank for no limit):",
                    summary=summary,
                )
                if cancelled:
                    step -= 1
                    continue
                max_durations = [max_value] * num_tiles
            else:
                for i in range(num_tiles):
                    folder = pick_folder(
                        stdscr,
                        f"Folder for tile {i + 1}",
                        summary=summary,
                        layout_code=state["layout_code"],
                    )
                    if is_back(folder) or not folder:
                        tile_folders = None
                        break
                    tile_folders.append(folder)
                    max_value, cancelled = input_float_optional(
                        stdscr,
                        "Max duration for this folder (blank for no limit):",
                        summary=summary,
                    )
                    if cancelled:
                        tile_folders = None
                        break
                    max_durations.append(max_value)

                if tile_folders is None:
                    step -= 1
                    continue

            state["tile_folders"] = [str(tv.resolve_folder_path(folder)) for folder in tile_folders]
            state["max_durations"] = max_durations
            step += 1
            continue

        if step == 5:
            distribution_mode = pick_distribution(stdscr, default_key="4" if state["use_single"] else "1", summary=summary)
            if is_back(distribution_mode):
                step -= 1
                continue
            state["distribution_mode"] = distribution_mode
            step += 1
            continue

        if step == 6:
            tile_settings = []
            tile_index = 0
            while tile_index < num_tiles:
                trans_type, trans_duration = pick_transition(
                    stdscr,
                    tile_index,
                    summary=summary,
                    layout_code=state["layout_code"],
                )
                if is_back(trans_type) or trans_type is None:
                    if tile_index == 0:
                        step -= 1
                        tile_settings = None
                        break
                    tile_index -= 1
                    tile_settings.pop()
                    continue
                crop_position = "center"
                if state["crop_mode"] == "crop":
                    crop_position = pick_crop_position(
                        stdscr,
                        tile_index,
                        summary=summary,
                        layout_code=state["layout_code"],
                    )
                    if is_back(crop_position):
                        if tile_index == 0:
                            step -= 1
                            tile_settings = None
                            break
                        tile_index -= 1
                        tile_settings.pop()
                        continue

                folder_path = tv.resolve_folder_path(state["tile_folders"][tile_index])
                media = folder_media_info(folder_path)
                while True:
                    mode_choice = list_select(
                        stdscr,
                        f"Tile {tile_index + 1} mode",
                        ["Video", "Images"],
                        summary=summary,
                    )
                    if is_back(mode_choice):
                        if tile_index == 0:
                            step -= 1
                            tile_settings = None
                            break
                        tile_index -= 1
                        tile_settings.pop()
                        break
                    tile_mode = "video" if mode_choice == 0 else "image"
                    if tile_mode == "image" and media["images"] == 0:
                        text_input(stdscr, "No images/ folder found for this tile. Press Enter.", summary=summary)
                        continue
                    break
                if tile_settings is None:
                    break

                image_duration = 3.0
                if tile_mode == "image":
                    img_value = text_input(stdscr, "Image duration seconds (default 3):", "3", summary=summary)
                    if img_value is None:
                        continue
                    try:
                        image_duration = float(img_value) if img_value else 3.0
                    except ValueError:
                        image_duration = 3.0
                    if image_duration <= 0:
                        image_duration = 3.0

                speed_value = text_input(stdscr, "Playback speed (0.5=slow, 1=normal, 1.5=fast):", "1", summary=summary)
                if speed_value is None:
                    continue
                try:
                    speed_factor = float(speed_value) if speed_value else 1.0
                except ValueError:
                    speed_factor = 1.0
                if speed_factor <= 0:
                    speed_factor = 1.0

                use_landscape = False
                if tile_mode == "video":
                    is_landscape = tile_is_landscape(state["layout_code"], tile_index)
                    if is_landscape and media["landscape"] > 0:
                        use_landscape = confirm_with_back(stdscr, "Use landscape subfolder?", default=False, summary=summary)
                        if is_back(use_landscape):
                            if tile_index == 0:
                                step -= 1
                                tile_settings = None
                                break
                            tile_index -= 1
                            tile_settings.pop()
                            continue

                tile_settings.append({
                    "trans_type": trans_type,
                    "trans_duration": trans_duration,
                    "crop_position": crop_position,
                    "speed": speed_factor,
                    "use_landscape": use_landscape,
                    "mode": tile_mode,
                    "image_duration": image_duration,
                })
                tile_index += 1

            if tile_settings is None:
                continue
            state["tile_settings"] = tile_settings
            step += 1
            continue

        if step == 7:
            audio_tile = None
            audio_tiles = []
            if state["audio_enabled"]:
                mix_audio = confirm_with_back(
                    stdscr,
                    "Mix audio from multiple tiles?",
                    default=False,
                    summary=summary,
                )
                if is_back(mix_audio):
                    step -= 1
                    continue
                if mix_audio:
                    audio_tiles = pick_audio_tiles(
                        stdscr,
                        state["tile_folders"],
                        summary=summary,
                        layout_code=state["layout_code"],
                    )
                    if is_back(audio_tiles) or not audio_tiles:
                        step -= 1
                        continue
                    audio_tile = audio_tiles[0]
                else:
                    audio_tile = pick_audio_tile(
                        stdscr,
                        state["tile_folders"],
                        summary=summary,
                        layout_code=state["layout_code"],
                    )
                    if is_back(audio_tile):
                        step -= 1
                        continue
                    audio_tiles = [audio_tile]
            state["audio_tile"] = audio_tile
            state["audio_tiles"] = audio_tiles
            step += 1
            continue

        if step == 8:
            max_total_duration, cancelled = input_float_optional(
                stdscr,
                "Max total output duration (blank for no limit):",
                summary=summary,
            )
            if cancelled:
                step -= 1
                continue
            state["max_total_duration"] = max_total_duration
            break

    settings = {
        "layout_code": state["layout_code"],
        "crop_mode": state["crop_mode"],
        "tile_folders": state["tile_folders"],
        "audio_tile": state["audio_tile"],
        "audio_tiles": state.get("audio_tiles", []),
        "audio_enabled": state["audio_enabled"],
        "tile_settings": state["tile_settings"],
        "max_durations": state["max_durations"],
        "max_total_duration": state["max_total_duration"],
    }

    if state["distribution_mode"]:
        settings["distribution_mode"] = state["distribution_mode"]

    return normalize_settings(settings)


def edit_settings(stdscr, settings):
    if not settings:
        text_input(stdscr, "No saved settings. Press Enter.")
        return None

    settings = normalize_settings(settings)

    fields = [
        "layout_code",
        "crop_mode",
        "audio_enabled",
        "audio_tile",
        "tile_folders",
        "distribution_mode",
        "tile_settings",
        "max_durations",
        "max_total_duration",
        "Save and return",
        "Cancel",
    ]

    selected = 0
    while True:
        stdscr.clear()
        draw_header(stdscr, "Edit Saved Settings")
        draw_footer(stdscr, "Enter to edit, b/Esc to go back")
        height, width = stdscr.getmaxyx()

        layout_lines = tv.LAYOUT_ASCII.get(settings.get("layout_code"), [])

        summary = [
            ("layout", format_settings_value(settings, "layout_code")),
            ("crop", format_settings_value(settings, "crop_mode")),
            ("audio", format_settings_value(settings, "audio_enabled")),
            ("distribution", format_settings_value(settings, "distribution_mode")),
            ("max total", format_settings_value(settings, "max_total_duration")),
        ]

        layout = summary_layout(stdscr)
        draw_summary(stdscr, summary, layout=layout)

        list_x = 2
        list_y = 2
        list_w = width - 4
        list_h = height - 4
        if layout and layout["mode"] == "right":
            list_w = max(24, layout["x"] - list_x - 2)
        if layout and layout["mode"] == "bottom":
            list_h = max(8, layout["y"] - list_y - 2)

        draw_panel(stdscr, list_y, list_x, list_h, list_w, "Settings")

        if layout_lines:
            row = list_y + 1
            max_width = list_w - 4
            remaining = list_y + list_h - 1 - row
            draw_height = min(len(layout_lines), max(0, remaining))
            if draw_height > 0:
                draw_layout_preview(
                    stdscr,
                    settings.get("layout_code"),
                    row,
                    list_x + 2,
                    max_width,
                    draw_height,
                )
                row += draw_height
            if row < list_y + list_h - 1:
                shapes = []
                layout_info = tv.get_layout_info(settings.get("layout_code"))
                if layout_info:
                    for i in range(layout_info["count"]):
                        dims = tv.get_tile_dimensions(settings.get("layout_code"), i, DEFAULT_OUTPUT_WIDTH, DEFAULT_OUTPUT_HEIGHT)
                        if dims and dims[0] > dims[1]:
                            shapes.append(f"{i + 1}:L")
                        else:
                            shapes.append(f"{i + 1}:P")
                if shapes:
                    stdscr.addstr(row, list_x + 2, f"Tile shapes: {', '.join(shapes)}"[:max_width])
                    row += 1
            row += 1
        else:
            row = list_y + 1

        for i, field in enumerate(fields):
            field_style = style(PAIR_HIGHLIGHT, curses.A_REVERSE) if i == selected else curses.A_NORMAL
            if field in ("Save and return", "Cancel"):
                line = field
            else:
                value = format_settings_value(settings, field)
                line = f"{field}: {value}"
            row_index = row + i
            if row_index < list_y + list_h - 1:
                stdscr.addstr(row_index, list_x + 2, line[: list_w - 4], field_style)

        stdscr.refresh()
        key = stdscr.getch()
        if key in (curses.KEY_UP, ord("k")):
            selected = (selected - 1) % len(fields)
        elif key in (curses.KEY_DOWN, ord("j")):
            selected = (selected + 1) % len(fields)
        elif key in (27, ord("b")):
            return None
        elif key in (10, 13):
            field = fields[selected]
            if field == "Cancel":
                return None
            if field == "Save and return":
                return normalize_settings(settings)
            if field == "layout_code":
                code = pick_layout(stdscr)
                if code:
                    settings["layout_code"] = code
                    settings = normalize_settings(settings)
            elif field == "crop_mode":
                mode = pick_crop_mode(stdscr)
                if mode:
                    settings["crop_mode"] = mode
            elif field == "audio_enabled":
                settings["audio_enabled"] = confirm(stdscr, "Include audio?", default=True)
                if not settings["audio_enabled"]:
                    settings["audio_tile"] = None
                    settings["audio_tiles"] = []
            elif field == "audio_tile":
                if settings.get("audio_enabled"):
                    mix_audio = confirm(
                        stdscr,
                        "Mix audio from multiple tiles?",
                        default=len(settings.get("audio_tiles") or []) > 1,
                    )
                    if mix_audio:
                        tiles = pick_audio_tiles(
                            stdscr,
                            settings["tile_folders"],
                            layout_code=settings["layout_code"],
                        )
                        if tiles:
                            settings["audio_tiles"] = tiles
                            settings["audio_tile"] = tiles[0]
                    else:
                        tile = pick_audio_tile(
                            stdscr,
                            settings["tile_folders"],
                            layout_code=settings["layout_code"],
                        )
                        if tile is not None:
                            settings["audio_tile"] = tile
                            settings["audio_tiles"] = [tile]
            elif field == "tile_folders":
                layout_info = tv.get_layout_info(settings["layout_code"])
                num_tiles = layout_info["count"]
                folders = []
                for i in range(num_tiles):
                    folder = pick_folder(
                        stdscr,
                        f"Folder for tile {i + 1}",
                        layout_code=settings["layout_code"],
                    )
                    if not folder:
                        folders = None
                        break
                    folders.append(folder)
                if folders:
                    settings["tile_folders"] = folders
            elif field == "distribution_mode":
                mode = pick_distribution(stdscr, default_key="4")
                if mode:
                    settings["distribution_mode"] = mode
            elif field == "tile_settings":
                edit_tile_settings_menu(stdscr, settings)
            elif field == "max_durations":
                layout_info = tv.get_layout_info(settings["layout_code"])
                num_tiles = layout_info["count"]
                values = []
                for i in range(num_tiles):
                    max_value, cancelled = input_float_optional(
                        stdscr,
                        f"Max duration for tile {i + 1} (blank for no limit):",
                    )
                    if cancelled:
                        values = None
                        break
                    values.append(max_value)
                if values:
                    settings["max_durations"] = values
            elif field == "max_total_duration":
                max_value, cancelled = input_float_optional(
                    stdscr,
                    "Max total duration (blank for no limit):",
                )
                if not cancelled:
                    settings["max_total_duration"] = max_value


def run_with_saved_settings(stdscr, settings, use_temp_settings=False, settings_path=None):
    if not settings:
        text_input(stdscr, "No saved settings. Press Enter.")
        return

    log_dir = ROOT / "outputs" / "tui-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"tui_run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    log_file = open(log_path, "w", encoding="utf-8")

    previous_settings = None
    had_existing_settings = SETTINGS_PATH.exists()
    if use_temp_settings:
        previous_settings = load_settings()
        save_settings(settings)

    try:
        summary = [
            ("layout", format_settings_value(settings, "layout_code")),
            ("crop", format_settings_value(settings, "crop_mode")),
            ("audio", format_settings_value(settings, "audio_enabled")),
            ("distribution", format_settings_value(settings, "distribution_mode")),
            ("max total", format_settings_value(settings, "max_total_duration")),
        ]
        mode = list_select(
            stdscr,
            "Render Mode",
            ["1. Full", "2. Preview", "3. Fast Preview"],
            selected=0,
            help_text="Enter to select, b/Esc to go back",
            summary=summary,
            layout_preview=settings.get("layout_code"),
        )
        if is_back(mode):
            return

        render_choice = str(mode + 1)

        overwrite_ok = confirm(
            stdscr,
            "Overwrite existing output if it exists?",
            default=True,
            summary=summary,
        )
        if is_back(overwrite_ok):
            return

        tile_states = []
        tile_total = 0
        combine_state = "pending"
        if settings:
            layout_info = tv.get_layout_info(settings["layout_code"])
            tile_total = layout_info["count"]
            tile_states = ["pending"] * tile_total

        stdscr.clear()
        draw_header(stdscr, "Running tile_videos")
        draw_footer(stdscr, f"Press 'c' to stop | logging to {log_path.name}")
        stdscr.refresh()

        cmd = [sys.executable, "-m", "video_tiling.tile_videos"]
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        if settings_path:
            env["VIDEO_TILING_SETTINGS_PATH"] = settings_path
        if not overwrite_ok:
            env["VIDEO_TILING_NO_OVERWRITE"] = "1"

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(ROOT),
            env=env,
            bufsize=1,
        )

        sent_use_saved = False
        sent_render_choice = False
        shown_use_saved = False
        shown_mode = False

        log_lines = []
        buffer = ""
        tick = 0
        stdscr.nodelay(True)

        def log_write(line):
            log_file.write(line + "\n")
            log_file.flush()

        fd = proc.stdout.fileno()
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        while True:
            if proc.stdout is None:
                break
            rlist, _, _ = select.select([proc.stdout], [], [], 0.1)
            if rlist:
                try:
                    chunk = os.read(fd, 4096)
                except BlockingIOError:
                    chunk = b""
                if not chunk:
                    if proc.poll() is not None:
                        break
                else:
                    text = chunk.decode(errors="replace")
                    buffer += text

                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        stripped_line = line.rstrip()

                        if "Use these settings?" in stripped_line:
                            if not shown_use_saved:
                                log_lines.append("Using saved settings (auto-accepted)")
                                log_write("Using saved settings (auto-accepted)")
                                shown_use_saved = True
                            continue

                        if "Select mode" in stripped_line:
                            if not shown_mode:
                                mode_label = {
                                    "1": "Full",
                                    "2": "Preview",
                                    "3": "Fast Preview",
                                }.get(render_choice, render_choice)
                                log_lines.append(f"Render mode: {mode_label}")
                                log_write(f"Render mode: {mode_label}")
                                shown_mode = True
                            continue

                        log_lines.append(stripped_line)
                        log_write(stripped_line)

                        tile_idx = extract_tile_index(line)
                        if tile_idx is not None and tile_idx < len(tile_states):
                            if "Processing tile" in line:
                                tile_states[tile_idx] = "running"
                            elif "created" in line and "Tile" in line:
                                tile_states[tile_idx] = "done"
                            elif "Failed to create tile" in line:
                                tile_states[tile_idx] = "failed"

                        if "Combining tiles into final output" in line:
                            combine_state = "running"
                        if "Successfully created" in line:
                            combine_state = "done"
                        if "Error creating tiled video" in line:
                            combine_state = "failed"

                    if proc.stdin:
                        if ("Use these settings?" in buffer) and not sent_use_saved:
                            try:
                                proc.stdin.write("y\n")
                                proc.stdin.flush()
                                sent_use_saved = True
                            except Exception:
                                pass
                        if ("Select mode" in buffer) and not sent_render_choice:
                            try:
                                proc.stdin.write(f"{render_choice}\n")
                                proc.stdin.flush()
                                sent_render_choice = True
                            except Exception:
                                pass

            if proc.poll() is not None and not rlist:
                break

            height, width = stdscr.getmaxyx()
            summary = None
            if settings:
                completed = len([s for s in tile_states if s == "done"]) if tile_states else 0
                progress = render_progress(completed, tile_total) if tile_total else ""
                pulse = pulse_frame(tick)
                summary = [
                    ("layout", format_settings_value(settings, "layout_code")),
                    ("folders", ", ".join(settings.get("tile_folders", []))[:40]),
                    ("audio", format_settings_value(settings, "audio_enabled")),
                    ("max total", format_settings_value(settings, "max_total_duration")),
                    ("tiles", progress),
                    ("combine", f"{combine_state} [{pulse}]"),
                ]

            layout = summary_layout(stdscr) if summary else None
            buffer_line = buffer.rstrip() if buffer.strip() else ""
            if "Use these settings?" in buffer_line or "Select mode" in buffer_line:
                buffer_line = ""
            all_lines = log_lines + ([buffer_line] if buffer_line else [])

            stdscr.erase()
            draw_header(stdscr, "Running tile_videos")
            draw_footer(stdscr, f"Press 'c' to stop | logging to {log_path.name}")

            if summary:
                tile_lines = []
                if tile_states:
                    tile_lines = ["Tiles:"] + render_tile_ascii(settings["layout_code"], tile_states)
                    tile_lines.append("Legend: . pending > running # done ! failed")
                draw_summary(stdscr, summary, layout=layout, extra_lines=tile_lines)

            log_x = 2
            log_y = 2
            log_w = width - 4
            log_h = height - 4
            if layout and layout["mode"] == "right":
                log_w = max(24, layout["x"] - log_x - 2)
            if layout and layout["mode"] == "bottom":
                log_h = max(8, layout["y"] - log_y - 2)

            draw_panel(stdscr, log_y, log_x, log_h, log_w, "Output")

            view_height = log_h - 2
            start = max(0, len(all_lines) - view_height)
            visible = all_lines[start:]
            for i, line in enumerate(visible):
                if i >= view_height:
                    break
                stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4], log_line_style(line))

            stdscr.refresh()

            key = stdscr.getch()
            if key == ord("c"):
                proc.send_signal(signal.SIGINT)
            tick += 1

        stdscr.nodelay(False)
        stdscr.timeout(-1)
        curses.flushinp()

        final_lines = list(log_lines)
        if buffer.strip():
            final_lines.append(buffer.rstrip())
        log_view_offset = max(0, len(final_lines) - 1)

        while True:
            stdscr.clear()
            draw_header(stdscr, "Run finished")
            draw_footer(stdscr, "Up/Down/PgUp/PgDn to scroll | b/Esc to return")
            height, width = stdscr.getmaxyx()

            summary = None
            if settings:
                completed = len([s for s in tile_states if s == "done"]) if tile_states else 0
                progress = render_progress(completed, tile_total) if tile_total else ""
                summary = [
                    ("layout", format_settings_value(settings, "layout_code")),
                    ("folders", ", ".join(settings.get("tile_folders", []))[:40]),
                    ("audio", format_settings_value(settings, "audio_enabled")),
                    ("max total", format_settings_value(settings, "max_total_duration")),
                    ("tiles", progress),
                    ("combine", combine_state),
                    ("log", log_path.name),
                ]

            layout = summary_layout(stdscr) if summary else None
            if summary:
                tile_lines = []
                if tile_states:
                    tile_lines = ["Tiles:"] + render_tile_ascii(settings["layout_code"], tile_states)
                    tile_lines.append("Legend: . pending > running # done ! failed")
                draw_summary(
                    stdscr,
                    summary,
                    layout=layout,
                    extra_lines=tile_lines,
                    layout_preview=settings.get("layout_code"),
                )

            log_x = 2
            log_y = 2
            log_w = width - 4
            log_h = height - 4
            if layout and layout["mode"] == "right":
                log_w = max(24, layout["x"] - log_x - 2)
            if layout and layout["mode"] == "bottom":
                log_h = max(8, layout["y"] - log_y - 2)

            draw_panel(stdscr, log_y, log_x, log_h, log_w, "Log")

            view_height = max(0, log_h - 2)
            max_offset = max(0, len(final_lines) - view_height)
            log_view_offset = max(0, min(log_view_offset, max_offset))
            visible = final_lines[log_view_offset: log_view_offset + view_height]
            for i, line in enumerate(visible):
                if i >= view_height:
                    break
                stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4], log_line_style(line))

            stdscr.refresh()
            key = stdscr.getch()
            if key in (27, ord("b"), ord("q"), 10, 13):
                break
            if key in (curses.KEY_UP, ord("k")):
                log_view_offset -= 1
            elif key in (curses.KEY_DOWN, ord("j")):
                log_view_offset += 1
            elif key == curses.KEY_PPAGE:
                log_view_offset -= max(1, view_height)
            elif key == curses.KEY_NPAGE:
                log_view_offset += max(1, view_height)
            elif key == curses.KEY_HOME:
                log_view_offset = 0
            elif key == curses.KEY_END:
                log_view_offset = max_offset
    finally:
        log_file.close()
        if use_temp_settings:
            if previous_settings is not None:
                save_settings(previous_settings)
            elif had_existing_settings is False and SETTINGS_PATH.exists():
                SETTINGS_PATH.unlink()


def run_in_terminal(stdscr, cmd):
    curses.def_prog_mode()
    curses.endwin()
    try:
        subprocess.run(cmd, check=False)
    finally:
        curses.reset_prog_mode()
        stdscr.clear()
        stdscr.refresh()


def run_command_with_output(stdscr, title, cmd, summary=None):
    stdscr.clear()
    draw_header(stdscr, title)
    draw_footer(stdscr, "Press 'c' to stop")
    stdscr.refresh()

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(ROOT),
        env=env,
        bufsize=1,
    )

    log_lines = []
    buffer = ""
    stdscr.nodelay(True)

    fd = proc.stdout.fileno()
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    while True:
        if proc.stdout is None:
            break
        rlist, _, _ = select.select([proc.stdout], [], [], 0.1)
        if rlist:
            try:
                chunk = os.read(fd, 4096)
            except BlockingIOError:
                chunk = b""
            if chunk:
                text = chunk.decode(errors="replace")
                buffer += text

                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    log_lines.append(line.rstrip())

        if proc.poll() is not None and not rlist:
            break

        height, width = stdscr.getmaxyx()
        layout = summary_layout(stdscr) if summary else None
        all_lines = log_lines + ([buffer.rstrip()] if buffer.strip() else [])

        stdscr.erase()
        draw_header(stdscr, title)
        draw_footer(stdscr, "Press 'c' to stop")
        if summary:
            draw_summary(stdscr, summary, layout=layout)

        log_x = 2
        log_y = 2
        log_w = width - 4
        log_h = height - 4
        if layout and layout["mode"] == "right":
            log_w = max(24, layout["x"] - log_x - 2)
        if layout and layout["mode"] == "bottom":
            log_h = max(8, layout["y"] - log_y - 2)

        draw_panel(stdscr, log_y, log_x, log_h, log_w, "Output")
        view_height = log_h - 2
        start = max(0, len(all_lines) - view_height)
        visible = all_lines[start:]
        for i, line in enumerate(visible):
            if i >= view_height:
                break
            stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4], log_line_style(line))
        stdscr.refresh()

        if stdscr.getch() == ord("c"):
            proc.send_signal(signal.SIGINT)
            break

    stdscr.nodelay(False)


def resolve_folder_names(names):
    resolved = []
    for name in names:
        resolved.append(str(tv.resolve_folder_path(name)))
    return resolved


def list_video_files(folder_path):
    folder = Path(folder_path)
    if not folder.exists():
        return []
    return sorted([f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in tv.VIDEO_EXTENSIONS])


def run_silently(func, *args, **kwargs):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return func(*args, **kwargs)


def check_ffmpeg_tools(stdscr):
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        subprocess.run(["ffprobe", "-version"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        text_input(stdscr, "ffmpeg and ffprobe are required. Install with: brew install ffmpeg")
        return False


def prompt_float_input(stdscr, prompt, default_value, min_value=None):
    while True:
        value = text_input(stdscr, prompt, default_value)
        if value is None:
            return None
        raw = value.strip()
        if not raw:
            raw = str(default_value)
        try:
            parsed = float(raw)
        except ValueError:
            continue
        if min_value is not None and parsed < min_value:
            continue
        return parsed


def prompt_output_dir(stdscr, default_dir):
    use_default = confirm(stdscr, f"Use default output folder? ({default_dir})", default=True)
    if use_default:
        output_dir = Path(default_dir)
    else:
        custom_dir = text_input(stdscr, "Output folder path:", str(default_dir))
        if custom_dir is None:
            return None
        output_dir = Path(custom_dir)
    if not output_dir.is_absolute():
        output_dir = ROOT / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def select_folders_tui(stdscr, title):
    info = get_src_folders_info()
    options = ["Select from src/", "Enter folder path(s)", "Back"]
    selection = list_select(stdscr, title, options)
    if is_back(selection) or options[selection] == "Back":
        return None
    if options[selection].startswith("Select"):
        if not info:
            text_input(stdscr, "No folders in src/. Press Enter.")
            return None
        display = [f"{entry['name']} ({human_size(entry['size'])})" for entry in info]
        values = [entry["name"] for entry in info]
        selected = multi_select(stdscr, "Select folders", display, values=values)
        if is_back(selected) or not selected:
            return None
        return selected

    raw = text_input(stdscr, "Enter folder paths (comma-separated):")
    if raw is None:
        return None
    entries = [item.strip() for item in raw.split(",") if item.strip()]
    return entries if entries else None


def doctor_reencode(stdscr):
    info = get_src_folders_info()
    if not info:
        text_input(stdscr, "No folders in src/. Press Enter.")
        return

    options = [f"{entry['name']} ({human_size(entry['size'])})" for entry in info]
    values = [entry["name"] for entry in info]
    selected = multi_select(stdscr, "Select folders to re-encode", options, values=values)
    if is_back(selected) or not selected:
        return

    fps_value = text_input(stdscr, "Target FPS (default 30):", "30")
    if fps_value is None:
        return
    try:
        fps = float(fps_value) if fps_value else 30.0
    except ValueError:
        fps = 30.0

    audio_keep = confirm(stdscr, "Keep audio?", default=True)

    mode = list_select(
        stdscr,
        "Output Mode",
        ["Write to subfolder (doctor_cfr) (recommended)", "Overwrite originals"],
    )
    if is_back(mode):
        return
    overwrite = mode == 1

    resolved_folders = resolve_folder_names(selected)

    total_files = 0
    for folder in resolved_folders:
        total_files += len(list_video_files(folder))

    if total_files == 0:
        text_input(stdscr, "No video files found. Press Enter.")
        return

    processed = 0
    log_lines = []
    stdscr.nodelay(True)

    for folder in resolved_folders:
        files = list_video_files(folder)
        if not files:
            continue
        out_dir = Path(folder)
        if not overwrite:
            out_dir = Path(folder) / "doctor_cfr"
            out_dir.mkdir(exist_ok=True)

        for video in files:
            processed += 1
            rel_name = f"{Path(folder).name}/{video.name}"
            log_lines.append(f"Re-encoding {rel_name}")

            output_path = video if overwrite else (out_dir / video.name)

            cmd = [
                "ffmpeg",
                "-v", "error",
                "-fflags", "+genpts",
                "-i", str(video),
                "-vf", f"fps={fps}",
                "-vsync", "cfr",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-y",
            ]
            if audio_keep:
                cmd.extend(["-c:a", "aac", "-b:a", "192k"])
            else:
                cmd.append("-an")
            cmd.append(str(output_path))

            result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode != 0:
                log_lines.append(f"Failed: {rel_name}")

            height, width = stdscr.getmaxyx()
            summary = [
                ("folders", ", ".join(selected)[:40]),
                ("fps", str(fps)),
                ("audio", "keep" if audio_keep else "strip"),
                ("mode", "overwrite" if overwrite else "doctor_cfr"),
                ("progress", render_progress(processed, total_files)),
            ]
            layout = summary_layout(stdscr)

            all_lines = log_lines[-200:]
            stdscr.erase()
            draw_header(stdscr, "Doctor: Re-encode CFR")
            draw_footer(stdscr, "Press 'q' to abort")
            draw_summary(stdscr, summary, layout=layout)

            log_x = 2
            log_y = 2
            log_w = width - 4
            log_h = height - 4
            if layout and layout["mode"] == "right":
                log_w = max(24, layout["x"] - log_x - 2)
            if layout and layout["mode"] == "bottom":
                log_h = max(8, layout["y"] - log_y - 2)

            draw_panel(stdscr, log_y, log_x, log_h, log_w, "Output")
            view_height = log_h - 2
            start = max(0, len(all_lines) - view_height)
            visible = all_lines[start:]
            for i, line in enumerate(visible):
                if i >= view_height:
                    break
                stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4])
            stdscr.refresh()

            if stdscr.getch() == ord("q"):
                stdscr.nodelay(False)
                return

    stdscr.nodelay(False)
    text_input(stdscr, "Doctor run complete. Press Enter.")


def doctor_trim_start(stdscr):
    info = get_src_folders_info()
    if not info:
        text_input(stdscr, "No folders in src/. Press Enter.")
        return

    options = [f"{entry['name']} ({human_size(entry['size'])})" for entry in info]
    values = [entry["name"] for entry in info]
    selected = multi_select(stdscr, "Select folders to trim", options, values=values)
    if is_back(selected) or not selected:
        return

    trim_value = text_input(stdscr, "Trim seconds from start (default 1.0):", "1.0")
    if trim_value is None:
        return
    try:
        trim_seconds = float(trim_value) if trim_value else 1.0
    except ValueError:
        trim_seconds = 1.0
    if trim_seconds < 0:
        trim_seconds = 0.0

    audio_keep = confirm(stdscr, "Keep audio?", default=True)

    mode = list_select(
        stdscr,
        "Output Mode",
        ["Write to subfolder (doctor_trim) (recommended)", "Overwrite originals"],
    )
    if is_back(mode):
        return
    overwrite = mode == 1

    resolved_folders = resolve_folder_names(selected)

    total_files = 0
    for folder in resolved_folders:
        total_files += len(list_video_files(folder))

    if total_files == 0:
        text_input(stdscr, "No video files found. Press Enter.")
        return

    processed = 0
    log_lines = []
    stdscr.nodelay(True)

    for folder in resolved_folders:
        files = list_video_files(folder)
        if not files:
            continue
        out_dir = Path(folder)
        if not overwrite:
            out_dir = Path(folder) / "doctor_trim"
            out_dir.mkdir(exist_ok=True)

        for video in files:
            processed += 1
            rel_name = f"{Path(folder).name}/{video.name}"
            log_lines.append(f"Trim {rel_name}")

            output_path = video if overwrite else (out_dir / video.name)
            temp_path = None
            if overwrite:
                temp_file = tempfile.NamedTemporaryFile(
                    delete=False,
                    dir=video.parent,
                    prefix=".doctor_trim_",
                    suffix=video.suffix,
                )
                temp_path = Path(temp_file.name)
                temp_file.close()
                output_path = temp_path

            cmd = [
                "ffmpeg",
                "-v", "error",
                "-i", str(video),
                "-ss", f"{trim_seconds:.3f}",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-y",
            ]
            if audio_keep:
                cmd.extend(["-c:a", "aac", "-b:a", "192k"])
            else:
                cmd.append("-an")
            cmd.append(str(output_path))

            result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode != 0:
                log_lines.append(f"Failed: {rel_name}")
                if temp_path and temp_path.exists():
                    temp_path.unlink(missing_ok=True)
            else:
                if temp_path:
                    os.replace(temp_path, video)

            height, width = stdscr.getmaxyx()
            summary = [
                ("trim", f"{trim_seconds:.3f}s"),
                ("audio", "keep" if audio_keep else "strip"),
                ("mode", "overwrite" if overwrite else "doctor_trim"),
                ("progress", render_progress(processed, total_files)),
            ]
            layout = summary_layout(stdscr)

            all_lines = log_lines[-200:]
            stdscr.erase()
            draw_header(stdscr, "Doctor: Trim Start")
            draw_footer(stdscr, "Press 'q' to abort")
            draw_summary(stdscr, summary, layout=layout)

            log_x = 2
            log_y = 2
            log_w = width - 4
            log_h = height - 4
            if layout and layout["mode"] == "right":
                log_w = max(24, layout["x"] - log_x - 2)
            if layout and layout["mode"] == "bottom":
                log_h = max(8, layout["y"] - log_y - 2)

            draw_panel(stdscr, log_y, log_x, log_h, log_w, "Output")
            view_height = log_h - 2
            start = max(0, len(all_lines) - view_height)
            visible = all_lines[start:]
            for i, line in enumerate(visible):
                if i >= view_height:
                    break
                stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4], log_line_style(line))
            stdscr.refresh()

            if stdscr.getch() == ord("q"):
                stdscr.nodelay(False)
                return

    stdscr.nodelay(False)
    text_input(stdscr, "Doctor run complete. Press Enter.")


def trim_videos_tui(stdscr):
    if not check_ffmpeg_tools(stdscr):
        return

    selected = select_folders_tui(stdscr, "Trim Videos")
    if not selected:
        return

    output_dir = prompt_output_dir(stdscr, ROOT / "outputs" / "trimmed")
    if output_dir is None:
        return

    resolved_folders = resolve_folder_names(selected)
    settings = {}
    for folder in resolved_folders:
        name = Path(folder).name
        trim_start = prompt_float_input(
            stdscr,
            f"{name}: Trim from start (seconds)",
            "0",
            min_value=0.0,
        )
        if trim_start is None:
            return
        trim_end = prompt_float_input(
            stdscr,
            f"{name}: Trim from end (seconds)",
            "0",
            min_value=0.0,
        )
        if trim_end is None:
            return
        settings[folder] = (trim_start, trim_end)

    total_files = 0
    for folder in resolved_folders:
        total_files += len(list_video_files(folder))

    if total_files == 0:
        text_input(stdscr, "No video files found. Press Enter.")
        return

    processed = 0
    log_lines = []
    stdscr.nodelay(True)

    for folder in resolved_folders:
        files = list_video_files(folder)
        if not files:
            log_lines.append(f"No videos: {Path(folder).name}")
            continue

        trim_start, trim_end = settings[folder]
        output_folder = output_dir / Path(folder).name
        output_folder.mkdir(parents=True, exist_ok=True)

        for video in files:
            processed += 1
            rel_name = f"{Path(folder).name}/{video.name}"
            ok = run_silently(trim_tool.trim_video, video, output_folder / video.name, trim_start, trim_end)
            log_lines.append(("✓" if ok else "✗") + f" {rel_name}")

            height, width = stdscr.getmaxyx()
            summary = [
                ("start", f"{trim_start:.3f}s"),
                ("end", f"{trim_end:.3f}s"),
                ("output", str(output_dir.name)),
                ("progress", render_progress(processed, total_files)),
            ]
            layout = summary_layout(stdscr)

            all_lines = log_lines[-200:]
            stdscr.erase()
            draw_header(stdscr, "Trim Videos")
            draw_footer(stdscr, "Press 'q' to abort")
            draw_summary(stdscr, summary, layout=layout)

            log_x = 2
            log_y = 2
            log_w = width - 4
            log_h = height - 4
            if layout and layout["mode"] == "right":
                log_w = max(24, layout["x"] - log_x - 2)
            if layout and layout["mode"] == "bottom":
                log_h = max(8, layout["y"] - log_y - 2)

            draw_panel(stdscr, log_y, log_x, log_h, log_w, "Output")
            view_height = log_h - 2
            start = max(0, len(all_lines) - view_height)
            visible = all_lines[start:]
            for i, line in enumerate(visible):
                if i >= view_height:
                    break
                stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4], log_line_style(line))
            stdscr.refresh()

            if stdscr.getch() == ord("q"):
                stdscr.nodelay(False)
                return

    stdscr.nodelay(False)
    text_input(stdscr, "Trim run complete. Press Enter.")


def concat_videos_tui(stdscr):
    if not check_ffmpeg_tools(stdscr):
        return

    selected = select_folders_tui(stdscr, "Concatenate Videos")
    if not selected:
        return

    output_dir = prompt_output_dir(stdscr, ROOT / "outputs" / "concatenated")
    if output_dir is None:
        return

    resolved_folders = resolve_folder_names(selected)
    settings = {}
    for folder in resolved_folders:
        name = Path(folder).name
        transition = list_select(
            stdscr,
            f"{name}: Transition",
            ["Simple Cut", "Cross-Dissolve", "Fade to Black"],
        )
        if is_back(transition):
            return
        transition_type = ["cut", "fade", "fadeblack"][transition]
        duration = 0.0
        if transition_type != "cut":
            duration = prompt_float_input(
                stdscr,
                f"{name}: Transition duration (seconds)",
                "1.0",
                min_value=0.01,
            )
            if duration is None:
                return
            if duration > 5:
                keep = confirm(stdscr, f"{duration:.2f}s is long. Continue?", default=False)
                if not keep:
                    return
        settings[folder] = (transition_type, duration)

    total_folders = len(resolved_folders)
    processed = 0
    log_lines = []
    stdscr.nodelay(True)

    for folder in resolved_folders:
        processed += 1
        folder_name = Path(folder).name
        video_files = concat_tool.get_video_files(folder)
        if not video_files:
            log_lines.append(f"No videos: {folder_name}")
            continue

        transition_type, duration = settings[folder]
        output_path = output_dir / f"{folder_name}_concatenated.mp4"
        if len(video_files) == 1:
            ok = run_silently(concat_tool.concat_simple_cut, video_files, output_path)
        else:
            if transition_type == "cut":
                ok = run_silently(concat_tool.concat_simple_cut, video_files, output_path)
            else:
                ok = run_silently(concat_tool.concat_with_transitions, video_files, output_path, transition_type, duration)

        log_lines.append(("✓" if ok else "✗") + f" {folder_name}")

        height, width = stdscr.getmaxyx()
        summary = [
            ("transition", transition_type),
            ("output", str(output_dir.name)),
            ("progress", render_progress(processed, total_folders)),
        ]
        layout = summary_layout(stdscr)

        all_lines = log_lines[-200:]
        stdscr.erase()
        draw_header(stdscr, "Concatenate Videos")
        draw_footer(stdscr, "Press 'q' to abort")
        draw_summary(stdscr, summary, layout=layout)

        log_x = 2
        log_y = 2
        log_w = width - 4
        log_h = height - 4
        if layout and layout["mode"] == "right":
            log_w = max(24, layout["x"] - log_x - 2)
        if layout and layout["mode"] == "bottom":
            log_h = max(8, layout["y"] - log_y - 2)

        draw_panel(stdscr, log_y, log_x, log_h, log_w, "Output")
        view_height = log_h - 2
        start = max(0, len(all_lines) - view_height)
        visible = all_lines[start:]
        for i, line in enumerate(visible):
            if i >= view_height:
                break
            stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4], log_line_style(line))
        stdscr.refresh()

        if stdscr.getch() == ord("q"):
            stdscr.nodelay(False)
            return

    stdscr.nodelay(False)
    text_input(stdscr, "Concatenation complete. Press Enter.")


def detect_scenes_tui(stdscr):
    if not detect_tool.check_scenedetect():
        if detect_tool.check_venv():
            text_input(
                stdscr,
                "PySceneDetect not available. Run: source venv/bin/activate, then python3 tui/app.py.",
            )
        else:
            text_input(stdscr, "PySceneDetect not installed. Run: pip install scenedetect[opencv]")
        return

    if not check_ffmpeg_tools(stdscr):
        return

    options = ["Select folders from src/", "Enter file/folder paths", "Back"]
    selection = list_select(stdscr, "Detect Scenes", options)
    if is_back(selection) or options[selection] == "Back":
        return

    if options[selection].startswith("Select"):
        info = get_src_folders_info()
        if not info:
            text_input(stdscr, "No folders in src/. Press Enter.")
            return
        display = [f"{entry['name']} ({human_size(entry['size'])})" for entry in info]
        values = [entry["name"] for entry in info]
        selected = multi_select(stdscr, "Select folders", display, values=values)
        if is_back(selected) or not selected:
            return
        inputs = selected
    else:
        raw = text_input(stdscr, "Enter paths (comma-separated):")
        if raw is None:
            return
        inputs = [item.strip() for item in raw.split(",") if item.strip()]
        if not inputs:
            return

    method = list_select(
        stdscr,
        "Detection Method",
        ["Content-aware", "Adaptive"],
    )
    if is_back(method):
        return
    detector_type = "content" if method == 0 else "adaptive"
    default_threshold = 27.0 if detector_type == "content" else 3.0
    threshold = prompt_float_input(
        stdscr,
        f"Threshold (default {default_threshold})",
        str(default_threshold),
        min_value=0.01,
    )
    if threshold is None:
        return

    mode = list_select(
        stdscr,
        "Mode",
        ["Detect + split", "List only"],
    )
    if is_back(mode):
        return
    list_only = mode == 1

    output_dir = None
    if not list_only:
        output_dir = prompt_output_dir(stdscr, ROOT / "outputs" / "scenes")
        if output_dir is None:
            return

    videos_to_process = []
    for input_path in inputs:
        path = Path(input_path)
        if path.exists() and path.is_file() and path.suffix.lower() in detect_tool.VIDEO_EXTENSIONS:
            videos_to_process.append(path)
            continue
        resolved_path = detect_tool.resolve_folder_path(input_path)
        if resolved_path.exists() and resolved_path.is_dir():
            videos_to_process.extend(detect_tool.get_video_files(resolved_path))

    if not videos_to_process:
        text_input(stdscr, "No videos found. Press Enter.")
        return

    processed = 0
    total_files = len(videos_to_process)
    log_lines = []
    stdscr.nodelay(True)

    for video in videos_to_process:
        processed += 1
        log_lines.append(f"Analyze {video.name}")
        scene_list = run_silently(detect_tool.detect_scenes, video, detector_type, threshold)
        if scene_list is None:
            log_lines.append(f"✗ Failed: {video.name}")
        else:
            log_lines.append(f"Scenes: {len(scene_list)}")
            if not list_only and scene_list:
                video_output_dir = output_dir / video.stem
                video_output_dir.mkdir(parents=True, exist_ok=True)
                ok = run_silently(detect_tool.split_video_into_scenes, video, scene_list, video_output_dir)
                if ok:
                    log_lines.append(f"✓ Saved: {video_output_dir}")
                else:
                    log_lines.append(f"✗ Split failed: {video.name}")

        height, width = stdscr.getmaxyx()
        summary = [
            ("method", detector_type),
            ("threshold", f"{threshold:.2f}"),
            ("mode", "list" if list_only else "split"),
            ("progress", render_progress(processed, total_files)),
        ]
        layout = summary_layout(stdscr)

        all_lines = log_lines[-200:]
        stdscr.erase()
        draw_header(stdscr, "Detect Scenes")
        draw_footer(stdscr, "Press 'q' to abort")
        draw_summary(stdscr, summary, layout=layout)

        log_x = 2
        log_y = 2
        log_w = width - 4
        log_h = height - 4
        if layout and layout["mode"] == "right":
            log_w = max(24, layout["x"] - log_x - 2)
        if layout and layout["mode"] == "bottom":
            log_h = max(8, layout["y"] - log_y - 2)

        draw_panel(stdscr, log_y, log_x, log_h, log_w, "Output")
        view_height = log_h - 2
        start = max(0, len(all_lines) - view_height)
        visible = all_lines[start:]
        for i, line in enumerate(visible):
            if i >= view_height:
                break
            stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4], log_line_style(line))
        stdscr.refresh()

        if stdscr.getch() == ord("q"):
            stdscr.nodelay(False)
            return

    stdscr.nodelay(False)
    text_input(stdscr, "Scene detection complete. Press Enter.")


def organize_landscape(stdscr):
    info = get_src_folders_info()
    if not info:
        text_input(stdscr, "No folders in src/. Press Enter.")
        return

    options = [f"{entry['name']} ({human_size(entry['size'])})" for entry in info]
    values = [entry["name"] for entry in info]
    selected = multi_select(stdscr, "Select folders to split landscape", options, values=values)
    if is_back(selected) or not selected:
        return

    resolved_folders = resolve_folder_names(selected)
    moved = 0
    skipped = 0
    log_lines = []

    for folder in resolved_folders:
        out_dir = Path(folder) / "landscape"
        out_dir.mkdir(exist_ok=True)
        for video in list_video_files(folder):
            info = tv.get_video_info(video)
            if not info:
                skipped += 1
                log_lines.append(f"Skip (no dims): {video.name}")
                continue
            if info["width"] > info["height"]:
                target = out_dir / video.name
                if target.exists():
                    skipped += 1
                    log_lines.append(f"Skip exists: {video.name}")
                    continue
                video.rename(target)
                moved += 1
                log_lines.append(f"Moved: {video.name}")

    text_input(stdscr, f"Moved {moved} videos, skipped {skipped}. Press Enter.")


def clean_folders_tui(stdscr):
    info = get_src_folders_info()
    if not info:
        text_input(stdscr, "No folders in src/. Press Enter.")
        return

    options = [f"{entry['name']} ({human_size(entry['size'])})" for entry in info]
    values = [entry["name"] for entry in info]
    selected = multi_select(stdscr, "Select folders to clean", options, values=values)
    if is_back(selected) or not selected:
        return

    mode_choice = list_select(
        stdscr,
        "Clean Mode",
        [
            "1. Remove duplicates only",
            "2. Rename by date only",
            "3. Both (duplicates then rename)",
        ],
    )
    if is_back(mode_choice):
        return
    mode = str(mode_choice + 1)

    add_number = False
    if mode in ("2", "3"):
        add_number = confirm(stdscr, "Add sequential numbering?", default=False)

    resolved = resolve_folder_names(selected)
    cmd = [sys.executable, "-m", "video_tiling.clean_folder", "-m", mode]
    if add_number:
        cmd.append("-n")
    cmd.extend(resolved)

    summary = [
        ("mode", mode),
        ("numbering", "yes" if add_number else "no"),
        ("folders", ", ".join(selected)[:40]),
    ]
    run_command_with_output(stdscr, "Clean Folders", cmd, summary=summary)


def slow_motion_tui(stdscr):
    info = get_src_folders_info()
    if not info:
        text_input(stdscr, "No folders in src/. Press Enter.")
        return

    options = [f"{entry['name']} ({human_size(entry['size'])})" for entry in info]
    values = [entry["name"] for entry in info]
    selected = multi_select(stdscr, "Select folders for slow motion", options, values=values)
    if is_back(selected) or not selected:
        return

    factor_value = text_input(stdscr, "Speed factor (e.g. 0.5 for 2x slow):", "0.5")
    if factor_value is None:
        return
    try:
        factor = float(factor_value) if factor_value else 0.5
    except ValueError:
        factor = 0.5
    if factor <= 0:
        factor = 0.5

    audio_keep = confirm(stdscr, "Keep audio?", default=True)

    mode = list_select(
        stdscr,
        "Output Mode",
        ["Write to subfolder (slowmo)", "Overwrite originals"],
    )
    if is_back(mode):
        return
    overwrite = mode == 1

    resolved_folders = resolve_folder_names(selected)

    total_files = 0
    for folder in resolved_folders:
        total_files += len(list_video_files(folder))

    if total_files == 0:
        text_input(stdscr, "No video files found. Press Enter.")
        return

    processed = 0
    log_lines = []
    stdscr.nodelay(True)

    for folder in resolved_folders:
        files = list_video_files(folder)
        if not files:
            continue
        out_dir = Path(folder)
        if not overwrite:
            out_dir = Path(folder) / "slowmo"
            out_dir.mkdir(exist_ok=True)

        for video in files:
            processed += 1
            rel_name = f"{Path(folder).name}/{video.name}"
            log_lines.append(f"Slowmo {rel_name}")

            output_path = video if overwrite else (out_dir / video.name)

            cmd = [
                "ffmpeg",
                "-v", "error",
                "-i", str(video),
                "-filter:v", f"setpts={1/factor:.6f}*PTS",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-y",
            ]
            if audio_keep:
                # atempo supports 0.5-2.0, so chain if needed
                tempo = factor
                filters = []
                while tempo < 0.5:
                    filters.append("atempo=0.5")
                    tempo /= 0.5
                while tempo > 2.0:
                    filters.append("atempo=2.0")
                    tempo /= 2.0
                filters.append(f"atempo={tempo:.3f}")
                cmd.extend(["-filter:a", ",".join(filters), "-c:a", "aac", "-b:a", "192k"])
            else:
                cmd.append("-an")
            cmd.append(str(output_path))

            result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode != 0:
                log_lines.append(f"Failed: {rel_name}")

            height, width = stdscr.getmaxyx()
            summary = [
                ("factor", str(factor)),
                ("audio", "keep" if audio_keep else "strip"),
                ("mode", "overwrite" if overwrite else "slowmo"),
                ("progress", render_progress(processed, total_files)),
            ]
            layout = summary_layout(stdscr)

            all_lines = log_lines[-200:]
            stdscr.erase()
            draw_header(stdscr, "Slow Motion")
            draw_footer(stdscr, "Press 'q' to stop")
            draw_summary(stdscr, summary, layout=layout)

            log_x = 2
            log_y = 2
            log_w = width - 4
            log_h = height - 4
            if layout and layout["mode"] == "right":
                log_w = max(24, layout["x"] - log_x - 2)
            if layout and layout["mode"] == "bottom":
                log_h = max(8, layout["y"] - log_y - 2)

            draw_panel(stdscr, log_y, log_x, log_h, log_w, "Output")
            view_height = log_h - 2
            start = max(0, len(all_lines) - view_height)
            visible = all_lines[start:]
            for i, line in enumerate(visible):
                if i >= view_height:
                    break
                stdscr.addstr(log_y + 1 + i, log_x + 2, line[: log_w - 4], log_line_style(line))
            stdscr.refresh()

            if stdscr.getch() == ord("q"):
                stdscr.nodelay(False)
                return

    stdscr.nodelay(False)


def tools_menu(stdscr):
    options = [
        "Doctor: Re-encode CFR (fix freezes)",
        "Doctor: Trim start (seconds)",
        "Organize: Split landscape videos",
        "Make slow motion",
        "Clean folders",
        "Trim videos",
        "Concatenate videos",
        "Detect scenes",
        "Back",
    ]

    while True:
        selection = list_select(stdscr, "Tools and Doctor", options)
        if is_back(selection) or options[selection] == "Back":
            return
        choice = options[selection]
        if choice.startswith("Doctor:"):
            if "Trim start" in choice:
                doctor_trim_start(stdscr)
            else:
                doctor_reencode(stdscr)
        elif choice.startswith("Organize:"):
            organize_landscape(stdscr)
        elif choice == "Make slow motion":
            slow_motion_tui(stdscr)
        elif choice == "Clean folders":
            clean_folders_tui(stdscr)
        elif choice == "Trim videos":
            trim_videos_tui(stdscr)
        elif choice == "Concatenate videos":
            concat_videos_tui(stdscr)
        elif choice == "Detect scenes":
            detect_scenes_tui(stdscr)


def show_help(stdscr):
    lines = [
        "Overview:",
        "  - This TUI builds tiled videos from folders in src/",
        "  - Settings are saved to configs/tile_videos_settings.json",
        "  - Outputs go to outputs/tiled by default",
        "",
        "Quick start:",
        "  1) Put videos in src/<folder>/",
        "  2) Create new settings",
        "  3) Run saved settings",
        "  4) Check outputs/tiled for results",
        "",
        "Navigation:",
        "  - Up/Down or k/j: move",
        "  - Enter: select",
        "  - b or Esc: back",
        "",
        "Running a render:",
        "  - Run saved settings: uses configs/tile_videos_settings.json",
        "  - Random settings (YOLO): generates random settings from src/ contents",
        "  - Render mode: Full / Preview / Fast Preview",
        "  - Overwrite prompt: choose to avoid clobbering output",
        "  - Preview uses fewer clips and lower resolution",
        "",
        "Inputs:",
        "  - Folders without slashes resolve under src/",
        "  - One folder can be distributed across tiles",
        "  - Landscape override: src/<folder>/landscape",
        "  - Image tiles use src/<folder>/images when available",
        "",
        "Layouts:",
        "  - 2x1, 1x2, 2x2, 3x1, 1x3, 3x3",
        "  - PiP (picture-in-picture)",
        "  - 1+2, 2+1, 1+3 (split layouts)",
        "",
        "Layout + distribution:",
        "  - Layout defines tile count and placement",
        "  - Distribution applies when using one folder",
        "  - Round-robin cycles clips across tiles",
        "  - Sequential splits clips into contiguous blocks",
        "  - Shuffle modes randomize before distributing",
        "",
        "Crop + fit:",
        "  - Crop fills tiles by cutting edges",
        "  - Pad preserves full frame with bars",
        "  - Stretch fills with distortion",
        "  - Crop position controls where trimming happens",
        "",
        "Audio:",
        "  - Choose a single tile or mix multiple tiles",
        "  - Disable audio for silent renders",
        "",
        "Outputs:",
        "  - outputs/tiled: final tiles",
        "  - outputs/trimmed, outputs/concatenated, outputs/scenes",
        "  - outputs/tui-logs: session logs",
        "",
        "During a run:",
        "  - Press 'c' to stop",
        "  - Combine status shows a pulse while active",
        "",
        "Run finished screen:",
        "  - Scroll log: Up/Down, PgUp/PgDn, Home/End",
        "  - b/Esc/Enter: return",
        "",
        "Tools and Doctor:",
        "  - Trim/Concat/Detect run entirely in the TUI",
        "  - Detect scenes requires PySceneDetect",
        "  - Doctor tools write to subfolders unless you overwrite",
        "",
        "Dependencies:",
        "  - ffmpeg + ffprobe required for all video tools",
        "  - Detect scenes needs venv active with scenedetect installed",
        "  - Activate: source venv/bin/activate",
        "",
        "CLI options:",
        "  - --no-overwrite: add numeric suffix to output",
        "  - VIDEO_TILING_NO_OVERWRITE=1: same as --no-overwrite",
    ]

    offset = 0
    while True:
        stdscr.clear()
        draw_header(stdscr, "Help")
        draw_footer(stdscr, "Up/Down/PgUp/PgDn to scroll | b/Esc to return")
        height, width = stdscr.getmaxyx()

        panel_y = 2
        panel_x = 2
        panel_h = height - 4
        panel_w = width - 4
        draw_panel(stdscr, panel_y, panel_x, panel_h, panel_w, "Help")

        view_height = max(0, panel_h - 2)
        max_offset = max(0, len(lines) - view_height)
        offset = max(0, min(offset, max_offset))
        visible = lines[offset: offset + view_height]
        for i, line in enumerate(visible):
            if i >= view_height:
                break
            stdscr.addstr(panel_y + 1 + i, panel_x + 2, line[: panel_w - 4])

        stdscr.refresh()
        key = stdscr.getch()
        if key in (27, ord("b"), ord("q"), 10, 13):
            return
        if key in (curses.KEY_UP, ord("k")):
            offset -= 1
        elif key in (curses.KEY_DOWN, ord("j")):
            offset += 1
        elif key == curses.KEY_PPAGE:
            offset -= max(1, view_height)
        elif key == curses.KEY_NPAGE:
            offset += max(1, view_height)
        elif key == curses.KEY_HOME:
            offset = 0
        elif key == curses.KEY_END:
            offset = max_offset


def main(stdscr):
    curses.curs_set(0)
    stdscr.keypad(True)
    init_colors()

    selected = 0
    while True:
        try:
            stdscr.clear()
            draw_header(stdscr, "Video Tiling TUI")
            draw_footer(stdscr, "Use arrows, Enter to select, q to quit")
            height, width = stdscr.getmaxyx()

            draw_panel(stdscr, 2, 2, height - 4, width - 4, "Main Menu")

            for i, item in enumerate(MAIN_MENU):
                row = 3 + i
                if row >= height - 2:
                    break
                item_style = style(PAIR_HIGHLIGHT, curses.A_REVERSE) if i == selected else curses.A_NORMAL
                stdscr.addstr(row, 4, item[: width - 8], item_style)

            stdscr.refresh()
            key = stdscr.getch()
            if key in (curses.KEY_UP, ord("k")):
                selected = (selected - 1) % len(MAIN_MENU)
            elif key in (curses.KEY_DOWN, ord("j")):
                selected = (selected + 1) % len(MAIN_MENU)
            elif key in (10, 13):
                choice = MAIN_MENU[selected]
                if choice == "Exit":
                    break
                if choice == "Create new settings":
                    settings = wizard(stdscr)
                    if settings:
                        save_settings(settings)
                elif choice == "Edit saved settings":
                    settings = edit_settings(stdscr, load_settings())
                    if settings:
                        save_settings(settings)
                elif choice == "Random settings (YOLO)":
                    yolo_mode(stdscr)
                elif choice == "Help":
                    show_help(stdscr)
                elif choice == "Run saved settings":
                    run_with_saved_settings(stdscr, load_settings())
                elif choice == "Tools and Doctor":
                    tools_menu(stdscr)
            elif key in (ord("q"),):
                break
        except KeyboardInterrupt:
            break
        except Exception as exc:
            text_input(stdscr, f"TUI error: {exc}. Press Enter to continue.")


if __name__ == "__main__":
    curses.wrapper(main)
