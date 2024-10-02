#!/usr/bin/env python3
"""
Video Tiling Tool
Creates tiled video layouts with multiple videos playing simultaneously.
Each tile can contain multiple videos from a folder (played sequentially).
"""

import os
import sys
import argparse
import subprocess
import tempfile
import json
from pathlib import Path

# Common video file extensions
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v', '.webm'}

# Common image file extensions
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif'}

ROOT = Path(__file__).resolve().parents[1]

# Settings file (in project directory)
SETTINGS_FILE = Path(
    os.environ.get(
        "VIDEO_TILING_SETTINGS_PATH",
        str(ROOT / "configs" / "tile_videos_settings.json"),
    )
)

# Default source folder for videos
SRC_FOLDER = ROOT / "src"

# Layout definitions: (rows, cols, description, special_layout_function)
LAYOUTS = {
    '1': ('2x1', 'Two tiles side-by-side'),
    '2': ('1x2', 'Two tiles stacked vertically'),
    '3': ('2x2', 'Four tiles in 2x2 grid'),
    '4': ('3x1', 'Three tiles side-by-side'),
    '5': ('1x3', 'Three tiles stacked vertically'),
    '6': ('3x3', 'Nine tiles in 3x3 grid'),
    '7': ('pip', 'Picture-in-Picture (1 large + 1 small overlay)'),
    '8': ('1+2', 'One large left, two stacked right'),
    '9': ('2+1', 'Two stacked left, one large right'),
    '10': ('1+3', 'One large top, three small bottom'),
}

TRANSITIONS = {
    '1': 'cut',
    '2': 'fade',
    '3': 'fadeblack'
}

TRANSITION_NAMES = {
    'cut': 'Simple Cut',
    'fade': 'Cross-Dissolve',
    'fadeblack': 'Fade to Black'
}

# ASCII art layouts
LAYOUT_ASCII = {
    '2x1': [
        "┌──────────┬──────────┐",
        "│          │          │",
        "│    1     │    2     │",
        "│          │          │",
        "└──────────┴──────────┘"
    ],
    '1x2': [
        "┌────────────────────┐",
        "│         1          │",
        "├────────────────────┤",
        "│         2          │",
        "└────────────────────┘"
    ],
    '2x2': [
        "┌──────────┬──────────┐",
        "│    1     │    2     │",
        "├──────────┼──────────┤",
        "│    3     │    4     │",
        "└──────────┴──────────┘"
    ],
    '3x1': [
        "┌──────┬──────┬──────┐",
        "│  1   │  2   │  3   │",
        "└──────┴──────┴──────┘"
    ],
    '1x3': [
        "┌────────────────────┐",
        "│         1          │",
        "├────────────────────┤",
        "│         2          │",
        "├────────────────────┤",
        "│         3          │",
        "└────────────────────┘"
    ],
    '3x3': [
        "┌──────┬──────┬──────┐",
        "│  1   │  2   │  3   │",
        "├──────┼──────┼──────┤",
        "│  4   │  5   │  6   │",
        "├──────┼──────┼──────┤",
        "│  7   │  8   │  9   │",
        "└──────┴──────┴──────┘"
    ],
    'pip': [
        "┌────────────────────┐",
        "│ ┌────┐             │",
        "│ │ 2  │      1      │",
        "│ └────┘             │",
        "└────────────────────┘"
    ],
    '1+2': [
        "┌─────────────┬──────┐",
        "│             │  2   │",
        "│      1      ├──────┤",
        "│             │  3   │",
        "└─────────────┴──────┘"
    ],
    '2+1': [
        "┌──────┬─────────────┐",
        "│  1   │             │",
        "├──────┤      3      │",
        "│  2   │             │",
        "└──────┴─────────────┘"
    ],
    '1+3': [
        "┌────────────────────┐",
        "│         1          │",
        "├──────┬──────┬──────┤",
        "│  2   │  3   │  4   │",
        "└──────┴──────┴──────┘"
    ]
}

CROP_MODES = {
    '1': 'crop',
    '2': 'pad',
    '3': 'stretch'
}

CROP_MODE_NAMES = {
    'crop': 'Crop to fill (no padding, may cut edges)',
    'pad': 'Pad to fit (black bars if needed)',
    'stretch': 'Stretch to fill (may distort)'
}

CROP_POSITIONS = {
    '1': 'center',
    '2': 'top',
    '3': 'bottom',
    '4': 'left',
    '5': 'right',
    '6': 'top-left',
    '7': 'top-right',
    '8': 'bottom-left',
    '9': 'bottom-right'
}

CROP_POSITION_NAMES = {
    'center': 'Center (default - crop evenly from all sides)',
    'top': 'Top (keep top, crop bottom)',
    'bottom': 'Bottom (keep bottom, crop top)',
    'left': 'Left (keep left, crop right)',
    'right': 'Right (keep right, crop left)',
    'top-left': 'Top-Left corner',
    'top-right': 'Top-Right corner',
    'bottom-left': 'Bottom-Left corner',
    'bottom-right': 'Bottom-Right corner'
}

DISTRIBUTION_MODES = {
    '1': 'round-robin',
    '2': 'sequential',
    '3': 'random',
    '4': 'shuffle-round-robin'
}

DISTRIBUTION_MODE_NAMES = {
    'round-robin': 'Round-Robin (cycling) - Each tile gets every Nth clip',
    'sequential': 'Sequential Blocks - Divide clips into continuous chunks',
    'random': 'Random Distribution - Shuffle and distribute randomly',
    'shuffle-round-robin': 'Shuffle then Round-Robin - Random order, evenly cycled'
}

def save_settings(settings):
    """Save settings to file."""
    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        print(f"Warning: Could not save settings: {e}")

def load_settings():
    """Load settings from file."""
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, 'r') as f:
                return json.load(f)
    except Exception as e:
        print(f"Warning: Could not load settings: {e}")
    return None

def normalize_audio_tiles(audio_tiles, audio_tile, num_tiles):
    tiles = []
    if audio_tiles is None:
        if audio_tile is not None:
            tiles = [audio_tile]
    elif isinstance(audio_tiles, int):
        tiles = [audio_tiles]
    else:
        try:
            tiles = [int(x) for x in audio_tiles]
        except Exception:
            tiles = []

    seen = set()
    normalized = []
    for idx in tiles:
        if 0 <= idx < num_tiles and idx not in seen:
            normalized.append(idx)
            seen.add(idx)
    return normalized


def display_saved_settings(settings):
    """Display saved settings in a readable format."""
    print("\nSaved settings:")
    print(f"  Layout: {settings['layout_code']}")
    print(f"  Crop mode: {CROP_MODE_NAMES[settings['crop_mode']]}")
    if settings.get('max_durations'):
        print("  Max video duration per folder:")
        for folder, duration in zip(settings['tile_folders'], settings['max_durations']):
            if duration is None:
                print(f"    {folder}: no limit")
            else:
                print(f"    {folder}: {duration}s")
    elif settings.get('max_duration') is not None:
        print(f"  Max video duration: {settings['max_duration']}s")
    if settings.get('max_total_duration') is not None:
        print(f"  Max total duration: {settings['max_total_duration']}s")

    # Check if distribution mode was used
    if settings.get('distribution_mode'):
        print(f"  Distribution: {DISTRIBUTION_MODE_NAMES[settings['distribution_mode']]}")
        if len(set(settings['tile_folders'])) == 1:
            display_layout(settings['layout_code'], tile_folders=[settings['tile_folders'][0]] * len(settings['tile_folders']))
        else:
            display_layout(settings['layout_code'], tile_folders=settings['tile_folders'])
    else:
        display_layout(settings['layout_code'], tile_folders=settings['tile_folders'])

    print("  Tile configurations:")
    for i, tile_cfg in enumerate(settings['tile_settings']):
        print(f"    Tile {i + 1} ({settings['tile_folders'][i]}):")
        print(f"      Mode: {tile_cfg.get('mode', 'video')}")
        print(f"      Transition: {TRANSITION_NAMES[tile_cfg['trans_type']]}")
        if tile_cfg['trans_duration'] > 0:
            print(f"      Duration: {tile_cfg['trans_duration']}s")
        if settings['crop_mode'] == 'crop':
            print(f"      Crop position: {CROP_POSITION_NAMES[tile_cfg['crop_position']]}")
        print(f"      Speed: {tile_cfg.get('speed', 1.0)}x")
        if tile_cfg.get('mode', 'video') == 'image':
            print(f"      Image duration: {tile_cfg.get('image_duration', 3.0)}s")
        if tile_cfg.get('use_landscape'):
            print("      Landscape folder: yes")

    if settings.get('audio_enabled') is False:
        print("\n  Audio: disabled")
    else:
        num_tiles = len(settings['tile_folders'])
        audio_tiles = normalize_audio_tiles(
            settings.get('audio_tiles'),
            settings.get('audio_tile'),
            num_tiles
        )
        if len(audio_tiles) > 1:
            labels = [settings['tile_folders'][i] for i in audio_tiles]
            print(f"\n  Audio mix from: {', '.join(labels)}")
        elif audio_tiles:
            print(f"\n  Audio from: {settings['tile_folders'][audio_tiles[0]]}")
        else:
            print("\n  Audio: disabled")
    print()

def resolve_folder_path(folder_input):
    """Resolve folder path, prepending src/ if it's a relative name."""
    folder_path = Path(folder_input)

    # If it's an absolute path or starts with ./ or ../, use as-is
    if folder_path.is_absolute() or str(folder_input).startswith(('./', '../')):
        return folder_path

    # Otherwise, check if it exists in src/ folder
    src_path = SRC_FOLDER / folder_input
    if src_path.exists():
        return src_path

    # If neither exists, return the src path (will show error later)
    if not folder_path.exists():
        return src_path

    # Original path exists, use it
    return folder_path

def display_layout(layout_code, tile_folders=None, num_tiles=None):
    """Display ASCII art layout with optional folder assignments."""
    ascii_art = LAYOUT_ASCII.get(layout_code, [])

    print()
    for line in ascii_art:
        print(f"  {line}")

    if tile_folders:
        print("\n  Assigned folders:")
        for i, folder in enumerate(tile_folders):
            print(f"    Tile {i + 1}: {folder}")
    elif num_tiles:
        print(f"\n  Total tiles: {num_tiles}")
    print()

def get_scale_filter(width, height, crop_mode='crop', crop_position='center', fps=30):
    """Generate ffmpeg scale filter based on crop mode and position."""
    if crop_mode == 'crop':
        # Crop to fill - scale to cover entire area, then crop with position
        # Calculate crop position
        if crop_position == 'center':
            crop_filter = f'crop={width}:{height}'
        elif crop_position == 'top':
            crop_filter = f'crop={width}:{height}:0:0'
        elif crop_position == 'bottom':
            crop_filter = f'crop={width}:{height}:0:ih-{height}'
        elif crop_position == 'left':
            crop_filter = f'crop={width}:{height}:0:0'
        elif crop_position == 'right':
            crop_filter = f'crop={width}:{height}:iw-{width}:0'
        elif crop_position == 'top-left':
            crop_filter = f'crop={width}:{height}:0:0'
        elif crop_position == 'top-right':
            crop_filter = f'crop={width}:{height}:iw-{width}:0'
        elif crop_position == 'bottom-left':
            crop_filter = f'crop={width}:{height}:0:ih-{height}'
        elif crop_position == 'bottom-right':
            crop_filter = f'crop={width}:{height}:iw-{width}:ih-{height}'
        else:
            crop_filter = f'crop={width}:{height}'  # default to center

        base = f'scale={width}:{height}:force_original_aspect_ratio=increase,{crop_filter}'
    elif crop_mode == 'pad':
        # Pad to fit - scale to fit inside, then add black bars
        base = f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2'
    elif crop_mode == 'stretch':
        # Stretch to fill - ignore aspect ratio
        base = f'scale={width}:{height}'
    else:
        base = f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}'

    if fps is None:
        return base
    return f"{base},fps={fps}"

def get_video_files(folder_path, max_duration=None, duration_cache=None):
    """Get all video files in the specified folder, sorted alphabetically."""
    folder = Path(folder_path)
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist.")
        return []

    video_files = [f for f in folder.iterdir()
                   if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
    video_files = sorted(video_files, key=lambda x: x.name.lower())

    if max_duration is None:
        return video_files

    filtered = []
    for video in video_files:
        duration = None
        if duration_cache is not None and video in duration_cache:
            duration = duration_cache[video]
        else:
            info = get_video_info(video)
            duration = info['duration'] if info else None
            if duration_cache is not None:
                duration_cache[video] = duration

        if duration is None:
            print(f"Warning: Could not read duration for '{video}', keeping it")
            filtered.append(video)
            continue

        if duration <= max_duration:
            filtered.append(video)

    return filtered


def get_video_files_with_trim(folder_path, max_duration=None, duration_cache=None):
    video_files = get_video_files(folder_path, max_duration, duration_cache)
    trim_duration = None
    if max_duration is not None and not video_files:
        all_videos = get_video_files(folder_path, None, duration_cache)
        if all_videos:
            trim_duration = max_duration
            video_files = all_videos
            print(f"Warning: No clips <= {max_duration}s in '{folder_path}'; trimming longer clips")
    return video_files, trim_duration


def resolve_video_folder(base_folder, use_landscape=False):
    folder = Path(base_folder)
    if use_landscape:
        landscape_dir = folder / 'landscape'
        if landscape_dir.exists():
            has_videos = any(
                f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS
                for f in landscape_dir.iterdir()
            )
            if has_videos:
                return landscape_dir
            print(f"Warning: Landscape folder is empty; using '{folder}' instead")
    return folder


def get_image_files(folder_path):
    """Get all image files in the specified folder, sorted alphabetically."""
    folder = Path(folder_path)
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist.")
        return []

    image_files = [f for f in folder.iterdir()
                   if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS]
    return sorted(image_files, key=lambda x: x.name.lower())


def get_shuffle_rng():
    import random

    seed = os.environ.get("VIDEO_TILING_SEED")
    if seed is None:
        return random.SystemRandom()
    rng = random.Random()
    rng.seed(seed)
    return rng


def env_truthy(value):
    if value is None:
        return False
    return value.strip().lower() not in ("", "0", "false", "no", "off")


def resolve_output_path(output_path, no_overwrite=False):
    if not output_path:
        return output_path
    path = Path(output_path)
    if not no_overwrite or not path.exists():
        return str(path)

    base = path.with_suffix("")
    suffix = path.suffix
    counter = 1
    candidate = path
    while candidate.exists():
        candidate = path.with_name(f"{base.name}_{counter}{suffix}")
        counter += 1
    print(f"Output exists; writing to: {candidate}")
    return str(candidate)

def distribute_videos(video_files, num_tiles, mode='round-robin'):
    """Distribute videos across tiles using specified mode."""
    rng = get_shuffle_rng()

    total_videos = len(video_files)

    if mode == 'round-robin':
        # Each tile gets every Nth video
        distributed = [[] for _ in range(num_tiles)]
        for i, video in enumerate(video_files):
            tile_idx = i % num_tiles
            distributed[tile_idx].append(video)
        return distributed

    elif mode == 'shuffle-round-robin':
        shuffled = video_files.copy()
        rng.shuffle(shuffled)
        distributed = [[] for _ in range(num_tiles)]
        for i, video in enumerate(shuffled):
            tile_idx = i % num_tiles
            distributed[tile_idx].append(video)
        return distributed

    elif mode == 'sequential':
        # Divide into continuous chunks
        videos_per_tile = total_videos // num_tiles
        remainder = total_videos % num_tiles

        distributed = []
        start_idx = 0

        for i in range(num_tiles):
            # Give extra videos to first tiles if there's a remainder
            chunk_size = videos_per_tile + (1 if i < remainder else 0)
            end_idx = start_idx + chunk_size
            distributed.append(video_files[start_idx:end_idx])
            start_idx = end_idx

        return distributed

    elif mode == 'random':
        # Shuffle and distribute
        shuffled = video_files.copy()
        rng.shuffle(shuffled)

        videos_per_tile = total_videos // num_tiles
        remainder = total_videos % num_tiles

        distributed = []
        start_idx = 0

        for i in range(num_tiles):
            chunk_size = videos_per_tile + (1 if i < remainder else 0)
            end_idx = start_idx + chunk_size
            distributed.append(shuffled[start_idx:end_idx])
            start_idx = end_idx

        return distributed

    else:
        # Default to round-robin
        return distribute_videos(video_files, num_tiles, 'round-robin')


def order_videos(video_files, mode='round-robin'):
    """Order a single tile's videos based on distribution mode."""
    rng = get_shuffle_rng()

    if mode in ('random', 'shuffle-round-robin'):
        shuffled = video_files.copy()
        rng.shuffle(shuffled)
        return shuffled
    return video_files


def select_preview_items(video_files, limit, distribution_mode=None):
    if not video_files or limit is None:
        return video_files
    if distribution_mode in ('random', 'shuffle-round-robin'):
        rng = get_shuffle_rng()
        if len(video_files) <= limit:
            return video_files
        return rng.sample(video_files, limit)
    return video_files[:limit]


def build_atempo_filter(speed_factor):
    if speed_factor is None or speed_factor <= 0:
        speed_factor = 1.0

    if abs(speed_factor - 1.0) < 1e-6:
        return "atempo=1.0"

    filters = []
    tempo = speed_factor
    while tempo < 0.5:
        filters.append("atempo=0.5")
        tempo /= 0.5
    while tempo > 2.0:
        filters.append("atempo=2.0")
        tempo /= 2.0
    filters.append(f"atempo={tempo:.3f}")
    return ",".join(filters)


def limit_videos_by_duration(video_files, target_duration, transition_type, transition_duration, speed_factor=1.0, duration_cache=None):
    if target_duration is None:
        return video_files

    limited = []
    total = 0.0
    overlap = transition_duration if transition_type == 'fade' else 0.0

    for video in video_files:
        if duration_cache is not None and video in duration_cache:
            duration = duration_cache[video]
        else:
            info = get_video_info(video)
            duration = info['duration'] if info else None
            if duration_cache is not None:
                duration_cache[video] = duration

        limited.append(video)

        if duration is None:
            continue

        effective_duration = duration / speed_factor if speed_factor else duration
        if limited and len(limited) > 1:
            total = total + effective_duration - overlap
        else:
            total = total + effective_duration

        if total >= target_duration:
            break

    return limited


def limit_images_by_duration(image_files, target_duration, image_duration):
    if target_duration is None:
        return image_files
    if image_duration <= 0:
        return image_files

    max_count = int(target_duration / image_duration)
    if max_count <= 0:
        return image_files[:1]
    return image_files[:max_count]

def get_video_info(video_path):
    """Get video duration and properties using ffprobe."""
    try:
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
            '-of', 'default=noprint_wrappers=1',
            str(video_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        info = {}
        for line in result.stdout.strip().split('\n'):
            if '=' in line:
                key, value = line.split('=', 1)
                info[key] = value

        return {
            'duration': float(info.get('duration', 0)),
            'width': int(info.get('width', 1920)),
            'height': int(info.get('height', 1080))
        }
    except (subprocess.CalledProcessError, ValueError, KeyError):
        return None


def has_audio_stream(video_path):
    try:
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0',
            str(video_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip() != ''
    except subprocess.CalledProcessError:
        return False

def create_tile_video(video_files, transition_type, duration, output_path, width, height, crop_mode='crop', crop_position='center', include_audio=True, speed_factor=1.0, tile_mode='video', image_duration=3.0, force_cfr=False, trim_duration=None):
    """Create a single tile video by concatenating videos from a folder."""
    if not video_files:
        print("No videos to process for this tile")
        return None

    concat_list = None

    if tile_mode == 'image':
        print(f"  Creating tile with {len(video_files)} image(s)...")
    else:
        print(f"  Creating tile with {len(video_files)} video(s)...")

    audio_presence = None
    audio_durations = None
    if include_audio and tile_mode == 'video':
        audio_presence = [has_audio_stream(video) for video in video_files]
        if not all(audio_presence):
            print("  Warning: One or more clips have no audio; filling with silence")
            audio_durations = []
            for video in video_files:
                info = get_video_info(video)
                audio_durations.append(info['duration'] if info else None)

    if speed_factor and abs(speed_factor - 1.0) > 1e-6:
        scale_filter = get_scale_filter(width, height, crop_mode, crop_position, fps=None)
        scale_filter = f"{scale_filter},setsar=1,setpts=PTS/{speed_factor:.6f},fps=30"
    else:
        scale_filter = get_scale_filter(width, height, crop_mode, crop_position)
        scale_filter = f"{scale_filter},setsar=1"

    if tile_mode == 'image':
        image_scale_filter = get_scale_filter(width, height, crop_mode, crop_position, fps=None)
        return create_tile_slideshow(video_files, image_duration, output_path, image_scale_filter, force_cfr)

    if len(video_files) == 1 and transition_type == 'cut':
        # Single video, just scale it
        cmd = ['ffmpeg']
        if force_cfr:
            cmd.extend(['-fflags', '+genpts'])
        if trim_duration is not None:
            cmd.extend(['-t', f"{trim_duration:.6f}"])
        cmd.extend(['-i', str(video_files[0])])
        if include_audio and audio_presence is not None and not audio_presence[0]:
            cmd.extend(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'])
        cmd.extend([
            '-vf', scale_filter,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-y'
        ])
        if force_cfr:
            cmd.extend(['-fps_mode', 'cfr'])
        if include_audio:
            cmd.extend(['-filter:a', build_atempo_filter(speed_factor), '-c:a', 'aac', '-b:a', '192k'])
            if audio_presence is not None and not audio_presence[0]:
                cmd.extend(['-map', '0:v', '-map', '1:a', '-shortest'])
        else:
            cmd.append('-an')
        cmd.append(str(output_path))
    elif transition_type == 'cut':
        # Multiple videos, simple concatenation via concat filter
        cmd = ['ffmpeg']
        if force_cfr:
            cmd.extend(['-fflags', '+genpts'])
        for video in video_files:
            if trim_duration is not None:
                cmd.extend(['-t', f"{trim_duration:.6f}"])
            cmd.extend(['-i', str(video)])

        filter_parts = []
        concat_inputs = []
        base_filter = get_scale_filter(width, height, crop_mode, crop_position, fps=None)
        base_filter = f"{base_filter},setsar=1"

        for i in range(len(video_files)):
            if speed_factor and abs(speed_factor - 1.0) > 1e-6:
                video_chain = f"{base_filter},setpts=PTS/{speed_factor:.6f},fps=30"
            else:
                video_chain = f"{base_filter},fps=30"
            filter_parts.append(f"[{i}:v]{video_chain}[v{i}]")
            concat_inputs.append(f"[v{i}]")

            if include_audio:
                if audio_presence is not None and not audio_presence[i]:
                    duration_value = None
                    if audio_durations is not None:
                        duration_value = audio_durations[i]
                    audio_chain = "anullsrc=r=48000:cl=stereo"
                    if duration_value:
                        audio_chain = f"{audio_chain},atrim=duration={duration_value:.6f}"
                    audio_chain = f"{audio_chain},asetpts=PTS-STARTPTS"
                    if speed_factor and abs(speed_factor - 1.0) > 1e-6:
                        audio_chain = f"{audio_chain},{build_atempo_filter(speed_factor)}"
                    filter_parts.append(f"{audio_chain}[a{i}]")
                else:
                    audio_chain = "aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS"
                    if speed_factor and abs(speed_factor - 1.0) > 1e-6:
                        audio_chain = f"{audio_chain},{build_atempo_filter(speed_factor)}"
                    filter_parts.append(f"[{i}:a]{audio_chain}[a{i}]")
                concat_inputs.append(f"[a{i}]")

        if include_audio:
            filter_parts.append(f"{''.join(concat_inputs)}concat=n={len(video_files)}:v=1:a=1[outv][outa]")
        else:
            filter_parts.append(f"{''.join(concat_inputs)}concat=n={len(video_files)}:v=1:a=0[outv]")

        filter_complex = ';'.join(filter_parts)

        cmd.extend([
            '-filter_complex', filter_complex,
            '-map', '[outv]'
        ])
        if include_audio:
            cmd.extend(['-map', '[outa]'])

        cmd.extend([
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23'
        ])
        if force_cfr:
            cmd.extend(['-fps_mode', 'cfr'])
        if include_audio:
            cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
        else:
            cmd.append('-an')
        cmd.extend(['-y', str(output_path)])
    else:
        # With transitions - use complex filter
        cmd = build_tile_with_transitions(
            video_files,
            transition_type,
            duration,
            output_path,
            width,
            height,
            crop_mode,
            crop_position,
            include_audio,
            speed_factor,
            force_cfr,
            audio_presence=audio_presence,
            audio_durations=audio_durations,
            trim_duration=trim_duration,
        )
    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
        # Get the duration of created tile
        info = get_video_info(output_path)
        return info['duration'] if info else 0
    except subprocess.CalledProcessError as e:
        print(f"  Error creating tile: {e}")
        if e.stderr:
            for line in e.stderr.splitlines():
                if line.strip():
                    print(f"    ffmpeg: {line}")
        return None

def build_tile_with_transitions(video_files, transition_type, duration, output_path, width, height, crop_mode='crop', crop_position='center', include_audio=True, speed_factor=1.0, force_cfr=True, audio_presence=None, audio_durations=None, trim_duration=None):
    """Build ffmpeg command for tile with transitions."""
    num_videos = len(video_files)

    # Build filter complex
    filter_parts = []

    # Get scale filter without fps (we'll add it separately for transitions)
    if crop_mode == 'crop':
        # Build crop filter with position
        if crop_position == 'center':
            crop_filter = f'crop={width}:{height}'
        elif crop_position == 'top':
            crop_filter = f'crop={width}:{height}:0:0'
        elif crop_position == 'bottom':
            crop_filter = f'crop={width}:{height}:0:ih-{height}'
        elif crop_position == 'left':
            crop_filter = f'crop={width}:{height}:0:0'
        elif crop_position == 'right':
            crop_filter = f'crop={width}:{height}:iw-{width}:0'
        elif crop_position == 'top-left':
            crop_filter = f'crop={width}:{height}:0:0'
        elif crop_position == 'top-right':
            crop_filter = f'crop={width}:{height}:iw-{width}:0'
        elif crop_position == 'bottom-left':
            crop_filter = f'crop={width}:{height}:0:ih-{height}'
        elif crop_position == 'bottom-right':
            crop_filter = f'crop={width}:{height}:iw-{width}:ih-{height}'
        else:
            crop_filter = f'crop={width}:{height}'

        scale_base = f'scale={width}:{height}:force_original_aspect_ratio=increase,{crop_filter}'
    elif crop_mode == 'pad':
        scale_base = f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2'
    elif crop_mode == 'stretch':
        scale_base = f'scale={width}:{height}'
    else:
        scale_base = f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}'

    # Scale all videos
    for i in range(num_videos):
        video_chain = f"{scale_base},setsar=1"
        if speed_factor and abs(speed_factor - 1.0) > 1e-6:
            video_chain = f"{video_chain},setpts=PTS/{speed_factor:.6f},fps=30"
        else:
            video_chain = f"{video_chain},fps=30"
        filter_parts.append(f"[{i}:v]{video_chain}[v{i}]")
        if include_audio:
            if audio_presence is not None and not audio_presence[i]:
                duration_value = None
                if audio_durations is not None:
                    duration_value = audio_durations[i]
                audio_chain = "anullsrc=r=48000:cl=stereo"
                if duration_value:
                    audio_chain = f"{audio_chain},atrim=duration={duration_value:.6f}"
                audio_chain = f"{audio_chain},asetpts=PTS-STARTPTS"
                if speed_factor and abs(speed_factor - 1.0) > 1e-6:
                    audio_chain = f"{audio_chain},{build_atempo_filter(speed_factor)}"
                filter_parts.append(f"{audio_chain}[a{i}]")
            else:
                audio_chain = "aformat=sample_rates=48000:channel_layouts=stereo"
                if speed_factor and abs(speed_factor - 1.0) > 1e-6:
                    audio_chain = f"{audio_chain},{build_atempo_filter(speed_factor)}"
                filter_parts.append(f"[{i}:a]{audio_chain}[a{i}]")

    if transition_type == 'fade':
        # Cross-dissolve transitions
        offsets = [0]
        for i, video in enumerate(video_files[:-1]):
            info = get_video_info(video)
            if info:
                offsets.append(offsets[-1] + info['duration'] - duration)

        current_v = 'v0'
        current_a = 'a0' if include_audio else None

        for i in range(1, num_videos):
            next_label_v = f'v{i}{i}' if i < num_videos - 1 else 'outv'
            next_label_a = f'a{i}{i}' if i < num_videos - 1 else 'outa'

            filter_parts.append(
                f"[{current_v}][v{i}]xfade=transition=fade:duration={duration}:offset={offsets[i]:.3f}[{next_label_v}]"
            )
            if include_audio:
                filter_parts.append(f"[{current_a}][a{i}]acrossfade=d={duration}[{next_label_a}]")

            current_v = next_label_v
            if include_audio:
                current_a = next_label_a

    else:  # fadeblack
        fade_time = duration / 2
        concat_inputs = []

        for i, video in enumerate(video_files):
            info = get_video_info(video)
            if not info:
                continue
            vid_duration = info['duration']

            if i == 0:
                filter_parts.append(
                    f"[v{i}]fade=t=out:st={vid_duration - fade_time}:d={fade_time}[vf{i}]"
                )
                if include_audio:
                    filter_parts.append(
                        f"[a{i}]afade=t=out:st={vid_duration - fade_time}:d={fade_time}[af{i}]"
                    )
            elif i == num_videos - 1:
                filter_parts.append(
                    f"[v{i}]fade=t=in:st=0:d={fade_time}[vf{i}]"
                )
                if include_audio:
                    filter_parts.append(
                        f"[a{i}]afade=t=in:st=0:d={fade_time}[af{i}]"
                    )
            else:
                filter_parts.append(
                    f"[v{i}]fade=t=in:st=0:d={fade_time},fade=t=out:st={vid_duration - fade_time}:d={fade_time}[vf{i}]"
                )
                if include_audio:
                    filter_parts.append(
                        f"[a{i}]afade=t=in:st=0:d={fade_time},afade=t=out:st={vid_duration - fade_time}:d={fade_time}[af{i}]"
                    )

            if include_audio:
                concat_inputs.append(f"[vf{i}][af{i}]")
            else:
                concat_inputs.append(f"[vf{i}]")

        if include_audio:
            filter_parts.append(f"{''.join(concat_inputs)}concat=n={num_videos}:v=1:a=1[outv][outa]")
        else:
            filter_parts.append(f"{''.join(concat_inputs)}concat=n={num_videos}:v=1:a=0[outv]")

    filter_complex = ';'.join(filter_parts)

    # Build command
    cmd = ['ffmpeg']
    for video in video_files:
        if force_cfr:
            cmd.extend(['-fflags', '+genpts'])
        if trim_duration is not None:
            cmd.extend(['-t', f"{trim_duration:.6f}"])
        cmd.extend(['-i', str(video)])

    cmd.extend([
        '-filter_complex', filter_complex,
        '-map', '[outv]'
    ])

    if include_audio:
        cmd.extend(['-map', '[outa]'])

    cmd.extend([
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23'
    ])

    if force_cfr:
        cmd.extend(['-fps_mode', 'cfr'])

    if include_audio:
        cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
    else:
        cmd.append('-an')

    cmd.extend(['-y', str(output_path)])

    return cmd


def create_tile_slideshow(image_files, image_duration, output_path, scale_filter, force_cfr=True):
    """Create a video slideshow from images."""
    if not image_files:
        return None

    if image_duration <= 0:
        image_duration = 3.0

    concat_list = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
    try:
        for image in image_files:
            escaped_path = str(image.absolute()).replace("'", "'\\''")
            concat_list.write(f"file '{escaped_path}'\n")
            concat_list.write(f"duration {image_duration}\n")
        # ffmpeg concat requires the last file to be repeated without duration
        last_image = image_files[-1]
        escaped_last = str(last_image.absolute()).replace("'", "'\\''")
        concat_list.write(f"file '{escaped_last}'\n")
        concat_list.close()

        cmd = ['ffmpeg']
        if force_cfr:
            cmd.extend(['-fflags', '+genpts'])
        cmd.extend([
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_list.name,
            '-vf', f"{scale_filter},fps=30",
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-an',
            '-y'
        ])
        if force_cfr:
            cmd.extend(['-fps_mode', 'cfr'])
        cmd.append(str(output_path))

        subprocess.run(cmd, capture_output=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"  Error creating slideshow: {e}")
        return None
    finally:
        try:
            Path(concat_list.name).unlink()
        except Exception:
            pass

    return len(image_files) * image_duration

def get_layout_info(layout_code):
    """Get number of tiles and their positions for a layout."""
    layouts = {
        '2x1': {'count': 2, 'type': 'grid', 'rows': 1, 'cols': 2},
        '1x2': {'count': 2, 'type': 'grid', 'rows': 2, 'cols': 1},
        '2x2': {'count': 4, 'type': 'grid', 'rows': 2, 'cols': 2},
        '3x1': {'count': 3, 'type': 'grid', 'rows': 1, 'cols': 3},
        '1x3': {'count': 3, 'type': 'grid', 'rows': 3, 'cols': 1},
        '3x3': {'count': 9, 'type': 'grid', 'rows': 3, 'cols': 3},
        'pip': {'count': 2, 'type': 'special'},
        '1+2': {'count': 3, 'type': 'special'},
        '2+1': {'count': 3, 'type': 'special'},
        '1+3': {'count': 4, 'type': 'special'},
    }
    return layouts.get(layout_code, None)


def even_floor(value):
    return value - (value % 2)


def get_tile_dimensions(layout_code, tile_index, output_width, output_height):
    layout_info = get_layout_info(layout_code)
    if not layout_info:
        return None

    if layout_info['type'] == 'grid':
        tile_width = output_width // layout_info['cols']
        tile_height = output_height // layout_info['rows']
        return tile_width, tile_height

    if layout_code == 'pip':
        if tile_index == 0:
            return output_width, output_height
        pip_w = output_width // 4
        pip_h = output_height // 4
        return pip_w, pip_h

    if layout_code == '1+2':
        left_w = even_floor((output_width * 2) // 3)
        right_w = output_width - left_w
        if right_w % 2 != 0:
            right_w -= 2
            left_w = output_width - right_w
        right_h = even_floor(output_height // 2)
        bottom_right_h = output_height - right_h
        if bottom_right_h % 2 != 0:
            bottom_right_h -= 2
            right_h = output_height - bottom_right_h
        if tile_index == 0:
            return left_w, output_height
        return right_w, right_h

    if layout_code == '2+1':
        left_w = even_floor(output_width // 3)
        right_w = output_width - left_w
        if right_w % 2 != 0:
            right_w -= 2
            left_w = output_width - right_w
        left_h = even_floor(output_height // 2)
        bottom_left_h = output_height - left_h
        if bottom_left_h % 2 != 0:
            bottom_left_h -= 2
            left_h = output_height - bottom_left_h
        if tile_index in (0, 1):
            return left_w, left_h
        return right_w, output_height

    if layout_code == '1+3':
        top_h = even_floor((output_height * 2) // 3)
        bottom_h = output_height - top_h
        if bottom_h % 2 != 0:
            bottom_h -= 2
            top_h = output_height - bottom_h
        bottom_w = even_floor(output_width // 3)
        if tile_index == 0:
            return output_width, top_h
        return bottom_w, bottom_h

    return None

def build_xstack_layout(layout_code, tile_paths, audio_tiles, output_width=1920, output_height=1080, include_audio=True, target_duration=None, loop_inputs=True):
    """Build the final tiled composition using xstack or overlay."""
    layout_info = get_layout_info(layout_code)

    if layout_info['type'] == 'grid':
        return build_grid_layout(layout_info['rows'], layout_info['cols'], tile_paths, audio_tiles, output_width, output_height, include_audio, target_duration, loop_inputs)
    else:
        return build_special_layout(layout_code, tile_paths, audio_tiles, output_width, output_height, include_audio, target_duration, loop_inputs)

def build_grid_layout(rows, cols, tile_paths, audio_tiles, output_width, output_height, include_audio=True, target_duration=None, loop_inputs=True):
    """Build a grid layout using xstack."""
    tile_width = output_width // cols
    tile_height = output_height // rows

    # Build xstack layout string
    layout_positions = []
    for row in range(rows):
        for col in range(cols):
            x = col * tile_width
            y = row * tile_height
            layout_positions.append(f"{x}_{y}")

    layout_str = '|'.join(layout_positions)

    # Tiles are already the same duration (looped earlier), just stack them
    inputs = ''.join([f"[{i}:v]" for i in range(len(tile_paths))])
    filter_parts = [f"{inputs}xstack=inputs={len(tile_paths)}:layout={layout_str}[outv]"]

    # Build command
    cmd = ['ffmpeg']
    for tile_path in tile_paths:
        if loop_inputs:
            cmd.extend(['-stream_loop', '-1', '-i', str(tile_path)])
        else:
            cmd.extend(['-i', str(tile_path)])

    if include_audio and audio_tiles:
        audio_parts = []
        audio_inputs = []
        for idx in audio_tiles:
            label = f"a{idx}"
            audio_parts.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[{label}]")
            audio_inputs.append(f"[{label}]")
        mix = ''.join(audio_inputs) + f"amix=inputs={len(audio_inputs)}:duration=longest:dropout_transition=0[outa]"
        filter_parts.extend(audio_parts)
        filter_parts.append(mix)

    filter_complex = ';'.join(filter_parts)

    cmd.extend(['-filter_complex', filter_complex, '-map', '[outv]'])

    if include_audio:
        if audio_tiles and len(audio_tiles) > 1:
            cmd.extend(['-map', '[outa]'])
        elif audio_tiles:
            cmd.extend(['-map', f'{audio_tiles[0]}:a?'])

    cmd.extend([
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23'
    ])

    if include_audio:
        cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
    else:
        cmd.append('-an')

    cmd.append('-y')

    if target_duration is not None:
        cmd.extend(['-t', str(target_duration)])

    return cmd

def build_special_layout(layout_code, tile_paths, audio_tiles, output_width, output_height, include_audio=True, target_duration=None, loop_inputs=True):
    """Build special layouts like PIP, 1+2, etc."""
    filter_parts = []

    # Tiles are already the same duration (looped earlier)
    if layout_code == 'pip':
        # Large background + small overlay in top-right
        main_w, main_h = output_width, output_height
        pip_w, pip_h = output_width // 4, output_height // 4
        pip_x, pip_y = output_width - pip_w - 20, 20  # 20px margin

        filter_parts.append(
            f"[0:v]scale={main_w}:{main_h}:force_original_aspect_ratio=increase,"
            f"crop={main_w}:{main_h}[main]"
        )
        filter_parts.append(
            f"[1:v]scale={pip_w}:{pip_h}:force_original_aspect_ratio=increase,"
            f"crop={pip_w}:{pip_h}[pip]"
        )
        filter_parts.append(f"[main][pip]overlay={pip_x}:{pip_y}[outv]")

    elif layout_code == '1+2':
        # One large left (2/3 width), two stacked right (1/3 width)
        left_w = even_floor((output_width * 2) // 3)
        right_w = output_width - left_w
        if right_w % 2 != 0:
            right_w -= 2
            left_w = output_width - right_w
        top_right_h = even_floor(output_height // 2)
        bottom_right_h = output_height - top_right_h
        if bottom_right_h % 2 != 0:
            bottom_right_h -= 2
            top_right_h = output_height - bottom_right_h

        filter_parts.append(
            f"[0:v]scale={left_w}:{output_height}:force_original_aspect_ratio=increase,"
            f"crop={left_w}:{output_height}[left]"
        )
        filter_parts.append(
            f"[1:v]scale={right_w}:{top_right_h}:force_original_aspect_ratio=increase,"
            f"crop={right_w}:{top_right_h}[top_right]"
        )
        filter_parts.append(
            f"[2:v]scale={right_w}:{bottom_right_h}:force_original_aspect_ratio=increase,"
            f"crop={right_w}:{bottom_right_h}[bottom_right]"
        )
        filter_parts.append(f"[top_right][bottom_right]vstack[right]")
        filter_parts.append(f"[left][right]hstack[outv]")

    elif layout_code == '2+1':
        # Two stacked left (1/3 width), one large right (2/3 width)
        left_w = even_floor(output_width // 3)
        right_w = output_width - left_w
        if right_w % 2 != 0:
            right_w -= 2
            left_w = output_width - right_w
        top_left_h = even_floor(output_height // 2)
        bottom_left_h = output_height - top_left_h
        if bottom_left_h % 2 != 0:
            bottom_left_h -= 2
            top_left_h = output_height - bottom_left_h

        filter_parts.append(
            f"[0:v]scale={left_w}:{top_left_h}:force_original_aspect_ratio=increase,"
            f"crop={left_w}:{top_left_h}[top_left]"
        )
        filter_parts.append(
            f"[1:v]scale={left_w}:{bottom_left_h}:force_original_aspect_ratio=increase,"
            f"crop={left_w}:{bottom_left_h}[bottom_left]"
        )
        filter_parts.append(
            f"[2:v]scale={right_w}:{output_height}:force_original_aspect_ratio=increase,"
            f"crop={right_w}:{output_height}[right]"
        )
        filter_parts.append(f"[top_left][bottom_left]vstack[left]")
        filter_parts.append(f"[left][right]hstack[outv]")

    elif layout_code == '1+3':
        # One large top (2/3 height), three small bottom (1/3 height)
        top_h = even_floor((output_height * 2) // 3)
        bottom_h = output_height - top_h
        if bottom_h % 2 != 0:
            bottom_h -= 2
            top_h = output_height - bottom_h
        bottom_w = even_floor(output_width // 3)
        bottom_w_last = output_width - (bottom_w * 2)
        if bottom_w_last % 2 != 0:
            bottom_w_last -= 2
            bottom_w = even_floor((output_width - bottom_w_last) // 2)

        filter_parts.append(
            f"[0:v]scale={output_width}:{top_h}:force_original_aspect_ratio=increase,"
            f"crop={output_width}:{top_h}[top]"
        )
        filter_parts.append(
            f"[1:v]scale={bottom_w}:{bottom_h}:force_original_aspect_ratio=increase,"
            f"crop={bottom_w}:{bottom_h}[b1]"
        )
        filter_parts.append(
            f"[2:v]scale={bottom_w}:{bottom_h}:force_original_aspect_ratio=increase,"
            f"crop={bottom_w}:{bottom_h}[b2]"
        )
        filter_parts.append(
            f"[3:v]scale={bottom_w_last}:{bottom_h}:force_original_aspect_ratio=increase,"
            f"crop={bottom_w_last}:{bottom_h}[b3]"
        )
        filter_parts.append(f"[b1][b2][b3]hstack=inputs=3[bottom]")
        filter_parts.append(f"[top][bottom]vstack[outv]")

    if include_audio and audio_tiles:
        audio_parts = []
        audio_inputs = []
        for idx in audio_tiles:
            label = f"a{idx}"
            audio_parts.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[{label}]")
            audio_inputs.append(f"[{label}]")
        mix = ''.join(audio_inputs) + f"amix=inputs={len(audio_inputs)}:duration=longest:dropout_transition=0[outa]"
        filter_parts.extend(audio_parts)
        filter_parts.append(mix)

    filter_complex = ';'.join(filter_parts)

    # Build command
    cmd = ['ffmpeg']
    for tile_path in tile_paths:
        if loop_inputs:
            cmd.extend(['-stream_loop', '-1', '-i', str(tile_path)])
        else:
            cmd.extend(['-i', str(tile_path)])

    cmd.extend(['-filter_complex', filter_complex, '-map', '[outv]'])

    if include_audio:
        if audio_tiles and len(audio_tiles) > 1:
            cmd.extend(['-map', '[outa]'])
        elif audio_tiles:
            cmd.extend(['-map', f'{audio_tiles[0]}:a?'])

    cmd.extend([
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23'
    ])

    if include_audio:
        cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
    else:
        cmd.append('-an')

    cmd.append('-y')

    if target_duration is not None:
        cmd.extend(['-t', str(target_duration)])

    return cmd

def main():
    parser = argparse.ArgumentParser(
        description='Create tiled video layouts with multiple videos playing simultaneously.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s --layout 2x2
  %(prog)s --layout pip --output my_tiled_video.mp4

Note: Requires ffmpeg to be installed.
        '''
    )

    parser.add_argument('-o', '--output', default=None,
                        help='Output video file (default: auto-generated based on settings)')
    parser.add_argument('--no-overwrite', action='store_true',
                        help='Avoid overwriting existing output; add a numeric suffix')
    parser.add_argument('-w', '--width', type=int, default=1920,
                        help='Output video width (default: 1920)')
    parser.add_argument('--height', type=int, default=1080,
                        help='Output video height (default: 1080)')
    parser.add_argument('--max-duration', type=float, default=None,
                        help='Ignore videos longer than N seconds (default: no limit)')
    parser.add_argument('--max-total-duration', type=float, default=None,
                        help='Limit final output duration in seconds (default: no limit)')
    parser.add_argument('--no-audio', action='store_true',
                        help='Disable audio output')
    parser.add_argument('--force-cfr', action='store_true',
                        help='Force CFR + regenerate timestamps during tile render (slower)')

    args = parser.parse_args()

    # Check if ffmpeg and ffprobe are available
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        subprocess.run(['ffprobe', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: ffmpeg and ffprobe must be installed.")
        print("Install with: brew install ffmpeg  (on macOS)")
        sys.exit(1)

    print("=" * 60)
    print("Video Tiling Tool")
    print("=" * 60)

    # Check for saved settings
    use_saved = False
    saved_settings = load_settings()

    if saved_settings:
        display_saved_settings(saved_settings)
        while True:
            choice = input("Use these settings? (y/n): ").strip().lower()
            if choice in ['y', 'n']:
                use_saved = (choice == 'y')
                break
            print("Please enter 'y' or 'n'")

    max_duration_override = args.max_duration
    max_total_duration = args.max_total_duration
    if max_total_duration is not None and max_total_duration <= 0:
        print("Error: --max-total-duration must be positive.")
        sys.exit(1)

    audio_enabled = not args.no_audio
    force_cfr = args.force_cfr

    if use_saved:
        # Use saved settings
        layout_code = saved_settings['layout_code']
        crop_mode = saved_settings['crop_mode']
        tile_folders = saved_settings['tile_folders']
        audio_tiles = normalize_audio_tiles(
            saved_settings.get('audio_tiles'),
            saved_settings.get('audio_tile'),
            len(tile_folders),
        )
        distribution_mode = saved_settings.get('distribution_mode')
        if args.no_audio:
            audio_enabled = False
        else:
            audio_enabled = saved_settings.get('audio_enabled', True)
        if not audio_enabled:
            audio_tiles = []
        if max_total_duration is None:
            max_total_duration = saved_settings.get('max_total_duration')
        max_duration_global = None
        max_durations = saved_settings.get('max_durations') or None
        if max_duration_override is None:
            max_duration_global = saved_settings.get('max_duration')

        layout_info = get_layout_info(layout_code)
        num_tiles = layout_info['count']

        if not audio_tiles and audio_enabled:
            audio_tiles = [0]

        unique_folders = list(set(tile_folders))

        duration_cache = {}

        def get_max_duration_for_index(index):
            if max_duration_override is not None:
                return max_duration_override
            if max_durations and index < len(max_durations):
                return max_durations[index]
            return max_duration_global

        # Reconstruct tile_settings - need to get fresh video lists
        tile_settings = []

        if distribution_mode and len(unique_folders) == 1:
            # Distribute videos from single folder
            all_videos, trim_duration = get_video_files_with_trim(
                tile_folders[0],
                get_max_duration_for_index(0),
                duration_cache,
            )
            distributed_videos = distribute_videos(all_videos, num_tiles, distribution_mode)

            for i, tile_cfg in enumerate(saved_settings['tile_settings']):
                tile_trim_duration = trim_duration
                speed_factor = tile_cfg.get('speed', 1.0)
                tile_mode = tile_cfg.get('mode', 'video')
                image_duration = tile_cfg.get('image_duration', 3.0)
                use_landscape = tile_cfg.get('use_landscape', False)
                pre_count = len(distributed_videos[i])
                if tile_mode == 'image':
                    images_dir = Path(tile_folders[0]) / 'images'
                    images_folder = images_dir if images_dir.exists() else Path(tile_folders[0])
                    images = get_image_files(images_folder)
                    images = order_videos(images, distribution_mode)
                    pre_count = len(images)
                    images = limit_images_by_duration(images, max_total_duration, image_duration)
                    if pre_count <= 1:
                        print(f"  Warning: Tile {i + 1} has {pre_count} image(s) in '{images_folder}'")
                    if pre_count == 0:
                        print(f"  No images found for tile {i + 1}; switching to video mode")
                        tile_mode = 'video'
                        use_landscape = tile_cfg.get('use_landscape', False)
                        video_folder = resolve_video_folder(tile_folders[0], use_landscape)
                        distributed_videos[i], tile_trim_duration = get_video_files_with_trim(
                            video_folder,
                            get_max_duration_for_index(0),
                            duration_cache,
                        )
                        distributed_videos[i] = order_videos(distributed_videos[i], distribution_mode)
                        videos = limit_videos_by_duration(
                            distributed_videos[i],
                            max_total_duration,
                            tile_cfg['trans_type'],
                            tile_cfg['trans_duration'],
                            speed_factor,
                            duration_cache,
                        )
                    else:
                        videos = images
                else:
                    video_folder = resolve_video_folder(tile_folders[0], use_landscape)
                    if video_folder != Path(tile_folders[0]):
                        distributed_videos[i], tile_trim_duration = get_video_files_with_trim(
                            video_folder,
                            get_max_duration_for_index(0),
                            duration_cache,
                        )
                        distributed_videos[i] = order_videos(distributed_videos[i], distribution_mode)
                    videos = limit_videos_by_duration(
                        distributed_videos[i],
                        max_total_duration,
                        tile_cfg['trans_type'],
                        tile_cfg['trans_duration'],
                        speed_factor,
                        duration_cache,
                    )
                if max_total_duration is not None and len(videos) < pre_count:
                    print(f"  Trimmed tile {i + 1} to {len(videos)} video(s) for {max_total_duration:.2f}s target")
                tile_settings.append((videos, tile_cfg['trans_type'], tile_cfg['trans_duration'], tile_cfg['crop_position'], speed_factor, tile_mode, image_duration, use_landscape, tile_trim_duration))
        else:
            # Get videos from each folder separately
            for i, tile_cfg in enumerate(saved_settings['tile_settings']):
                trim_duration = None
                speed_factor = tile_cfg.get('speed', 1.0)
                tile_mode = tile_cfg.get('mode', 'video')
                image_duration = tile_cfg.get('image_duration', 3.0)
                use_landscape = tile_cfg.get('use_landscape', False)
                if tile_mode == 'image':
                    images_dir = Path(tile_folders[i]) / 'images'
                    images_folder = images_dir if images_dir.exists() else Path(tile_folders[i])
                    images = get_image_files(images_folder)
                    if distribution_mode:
                        images = order_videos(images, distribution_mode)
                    pre_count = len(images)
                    videos = limit_images_by_duration(images, max_total_duration, image_duration)
                    if pre_count <= 1:
                        print(f"  Warning: Tile {i + 1} has {pre_count} image(s) in '{images_folder}'")
                    if pre_count == 0:
                        print(f"  No images found for tile {i + 1}; switching to video mode")
                        tile_mode = 'video'
                        use_landscape = tile_cfg.get('use_landscape', False)
                        video_folder = resolve_video_folder(tile_folders[i], use_landscape)
                        videos, trim_duration = get_video_files_with_trim(
                            video_folder,
                            get_max_duration_for_index(i),
                            duration_cache,
                        )
                        if distribution_mode:
                            videos = order_videos(videos, distribution_mode)
                        pre_count = len(videos)
                        videos = limit_videos_by_duration(
                            videos,
                            max_total_duration,
                            tile_cfg['trans_type'],
                            tile_cfg['trans_duration'],
                            speed_factor,
                            duration_cache,
                        )
                else:
                    video_folder = resolve_video_folder(tile_folders[i], use_landscape)
                    videos, trim_duration = get_video_files_with_trim(
                        video_folder,
                        get_max_duration_for_index(i),
                        duration_cache,
                    )
                    if distribution_mode:
                        videos = order_videos(videos, distribution_mode)
                    pre_count = len(videos)
                    videos = limit_videos_by_duration(
                        videos,
                        max_total_duration,
                        tile_cfg['trans_type'],
                        tile_cfg['trans_duration'],
                        speed_factor,
                        duration_cache,
                    )
                if max_total_duration is not None and len(videos) < pre_count:
                    print(f"  Trimmed tile {i + 1} to {len(videos)} video(s) for {max_total_duration:.2f}s target")
                tile_settings.append((videos, tile_cfg['trans_type'], tile_cfg['trans_duration'], tile_cfg['crop_position'], speed_factor, tile_mode, image_duration, use_landscape, trim_duration))

        print("\nUsing saved settings!")

    else:
        # New configuration
        # Select layout
        print("\nAvailable layouts:")
        for key, (code, desc) in LAYOUTS.items():
            print(f"  {key}. {code} - {desc}")

        while True:
            choice = input("\nSelect layout (1-10): ").strip()
            if choice in LAYOUTS:
                layout_code, layout_desc = LAYOUTS[choice]
                break
            print("Invalid choice. Please enter a number between 1 and 10.")

        layout_info = get_layout_info(layout_code)
        num_tiles = layout_info['count']

        print(f"\nLayout: {layout_code} - {layout_desc}")
        display_layout(layout_code, num_tiles=num_tiles)

        # Get crop mode
        print("How should videos be fitted to tiles?")
        for key, mode in CROP_MODES.items():
            print(f"  {key}. {CROP_MODE_NAMES[mode]}")

        while True:
            crop_choice = input("\nSelect fit mode (1-3, default 1): ").strip() or '1'
            if crop_choice in CROP_MODES:
                crop_mode = CROP_MODES[crop_choice]
                break
            print("Invalid choice.")

        print(f"Using: {CROP_MODE_NAMES[crop_mode]}\n")

        if not args.no_audio:
            while True:
                audio_choice = input("Include audio? (y/n, default y): ").strip().lower()
                if audio_choice in ['', 'y', 'n']:
                    audio_enabled = (audio_choice != 'n')
                    break
                print("Please enter 'y' or 'n'.")
        else:
            audio_enabled = False

        max_durations = []
        if max_duration_override is None:
            print("\nOptional: set a max video duration per folder (blank for no limit)")

        duration_cache = {}

        # Get folders for each tile
        tile_folders = []
        print(f"\nNote: Folder names without '/' are looked up in '{SRC_FOLDER}/' first")

        use_single_folder = False
        if num_tiles > 1:
            while True:
                single_choice = input("Use one folder for all tiles? (y/n, default n): ").strip().lower()
                if single_choice in ['', 'y', 'n']:
                    use_single_folder = (single_choice == 'y')
                    break
                print("Please enter 'y' or 'n'.")

        if use_single_folder:
            while True:
                folder = input("Folder for all tiles: ").strip()
                resolved_folder = resolve_folder_path(folder)

                if resolved_folder.exists():
                    tile_folders = [str(resolved_folder)] * num_tiles
                    break
                print(f"Folder '{resolved_folder}' does not exist. Please try again.")

            if max_duration_override is None:
                while True:
                    max_input = input("  Max duration for this folder (seconds, blank for no limit): ").strip()
                    if not max_input:
                        max_durations = [None] * num_tiles
                        break
                    try:
                        max_value = float(max_input)
                        if max_value > 0:
                            max_durations = [max_value] * num_tiles
                            break
                        print("  Duration must be positive.")
                    except ValueError:
                        print("  Please enter a valid number.")
        else:
            for i in range(num_tiles):
                if tile_folders:
                    print(f"\n{('='*60)}")
                    print("Current layout:")
                    display_layout(layout_code, tile_folders=tile_folders)
                    print('='*60)

                while True:
                    folder = input(f"Folder for tile {i + 1}: ").strip()
                    resolved_folder = resolve_folder_path(folder)

                    if resolved_folder.exists():
                        tile_folders.append(str(resolved_folder))
                        break
                    print(f"Folder '{resolved_folder}' does not exist. Please try again.")

                if max_duration_override is None:
                    while True:
                        max_input = input("  Max duration for this folder (seconds, blank for no limit): ").strip()
                        if not max_input:
                            max_durations.append(None)
                            break
                        try:
                            max_value = float(max_input)
                            if max_value > 0:
                                max_durations.append(max_value)
                                break
                            print("  Duration must be positive.")
                        except ValueError:
                            print("  Please enter a valid number.")

        # Offer distribution mode
        unique_folders = list(set(tile_folders))
        distribution_mode = None

        all_videos = []
        distribution_trim_duration = None
        if len(unique_folders) == 1:
            # All tiles use the same folder
            per_folder_max = max_duration_override
            if per_folder_max is None and max_durations:
                per_folder_max = max_durations[0]
            all_videos, distribution_trim_duration = get_video_files_with_trim(
                unique_folders[0],
                per_folder_max,
                duration_cache,
            )

            print(f"\n{'='*60}")
            print(f"All tiles use the same folder: {unique_folders[0]}")
            print(f"Found {len(all_videos)} total video(s)")
            print('='*60)

        print("\nDistribution mode:")
        print("  1. Round-Robin (cycling) - Each tile gets every Nth clip")
        print("  2. Sequential Blocks - Divide clips into continuous chunks")
        print("  3. Random Distribution - Shuffle and distribute randomly")
        print("  4. Shuffle then Round-Robin - Random order, evenly cycled")
        print("  (blank = none)")

        default_distribution = '4' if use_single_folder else None
        prompt_suffix = " (1-4" + (", default 4" if default_distribution else "") + "): "

        while True:
            choice = input(f"\nSelect distribution mode{prompt_suffix}").strip()
            if not choice:
                if default_distribution:
                    choice = default_distribution
                else:
                    break
            if choice in DISTRIBUTION_MODES:
                distribution_mode = DISTRIBUTION_MODES[choice]
                break
            print("Invalid choice. Please enter 1, 2, 3, or 4, or blank for none.")

        if distribution_mode:
            print(f"\nUsing: {DISTRIBUTION_MODE_NAMES[distribution_mode]}")

        if distribution_mode and len(unique_folders) == 1:
            # Distribute videos across tiles
            distributed_videos = distribute_videos(all_videos, num_tiles, distribution_mode)

            # Show distribution
            print("\nDistribution:")
            for i, videos in enumerate(distributed_videos, 1):
                print(f"  Tile {i}: {len(videos)} video(s)")
                if len(videos) > 0:
                    print(f"    First: {videos[0].name}")
                    if len(videos) > 1:
                        print(f"    Last:  {videos[-1].name}")
        else:
            distributed_videos = None

        # Get transition settings for each tile
        tile_settings = []
        for i, folder in enumerate(tile_folders):
            if distributed_videos:
                videos = distributed_videos[i]
                trim_duration = distribution_trim_duration
                print(f"\nTile {i + 1}: {len(videos)} video(s) (distributed from '{folder}')")
            else:
                per_folder_max = max_duration_override
                if per_folder_max is None and max_durations:
                    per_folder_max = max_durations[i]
                videos, trim_duration = get_video_files_with_trim(folder, per_folder_max, duration_cache)
                if distribution_mode:
                    videos = order_videos(videos, distribution_mode)
                print(f"\nTile {i + 1}: {len(videos)} video(s) from '{folder}'")

            tile_mode = 'video'
            trim_duration = None
            while True:
                mode_input = input("  Tile mode (1=video, 2=images, default 1): ").strip()
                if not mode_input:
                    tile_mode = 'video'
                    break
                if mode_input in ['1', '2']:
                    tile_mode = 'video' if mode_input == '1' else 'image'
                    break
                print("  Invalid choice.")

            use_landscape = False
            if tile_mode == 'video':
                landscape_dir = Path(folder) / 'landscape'
                tile_dims = get_tile_dimensions(layout_code, i, args.width, args.height)
                is_landscape = tile_dims and tile_dims[0] > tile_dims[1]
                if landscape_dir.exists() and is_landscape:
                    while True:
                        land_input = input("  Use landscape subfolder? (y/n, default n): ").strip().lower()
                        if land_input in ['', 'y', 'n']:
                            use_landscape = (land_input == 'y')
                            break
                        print("  Please enter 'y' or 'n'.")

            image_duration = 3.0
            if tile_mode == 'image':
                while True:
                    img_input = input("  Image duration seconds (default 3): ").strip()
                    if not img_input:
                        image_duration = 3.0
                        break
                    try:
                        image_duration = float(img_input)
                        if image_duration > 0:
                            break
                        print("  Duration must be positive.")
                    except ValueError:
                        print("  Please enter a valid number.")

                images_dir = Path(folder) / 'images'
                images_folder = images_dir if images_dir.exists() else Path(folder)
                videos = get_image_files(images_folder)
                if distribution_mode:
                    videos = order_videos(videos, distribution_mode)
                print(f"  Using images from '{images_folder}'")
                print(f"  {len(videos)} image(s) found")
                if len(videos) == 0:
                    print("  No images found. Switching tile mode to video.")
                    tile_mode = 'video'
                    videos, trim_duration = get_video_files_with_trim(folder, per_folder_max, duration_cache)

            if tile_mode == 'image':
                trans_type = 'cut'
                trans_duration = 0
            elif len(videos) > 1:
                print("  1. Simple Cut")
                print("  2. Cross-Dissolve")
                print("  3. Fade to Black")

                while True:
                    trans_choice = input(f"Transition for tile {i + 1} (1-3): ").strip()
                    if trans_choice in TRANSITIONS:
                        trans_type = TRANSITIONS[trans_choice]
                        break
                    print("Invalid choice.")

                trans_duration = 0
                if trans_type != 'cut':
                    while True:
                        try:
                            trans_duration = float(input("Transition duration (seconds): "))
                            if trans_duration > 0:
                                break
                            print("Duration must be positive.")
                        except ValueError:
                            print("Please enter a valid number.")
            else:
                trans_type = 'cut'
                trans_duration = 0

            # Get crop position if using crop mode
            crop_position = 'center'
            if crop_mode == 'crop':
                print(f"\n  Crop position for tile {i + 1}:")
                for key, pos in CROP_POSITIONS.items():
                    print(f"    {key}. {CROP_POSITION_NAMES[pos]}")

                while True:
                    pos_choice = input(f"  Select crop position (1-9, default 1): ").strip() or '1'
                    if pos_choice in CROP_POSITIONS:
                        crop_position = CROP_POSITIONS[pos_choice]
                        break
                    print("  Invalid choice.")

                print(f"  Using: {CROP_POSITION_NAMES[crop_position]}")

            speed_factor = 1.0
            while True:
                speed_input = input("  Playback speed (e.g. 0.5=slow, 1=normal, 1.5=fast, default 1): ").strip()
                if not speed_input:
                    speed_factor = 1.0
                    break
                try:
                    speed_factor = float(speed_input)
                    if speed_factor > 0:
                        break
                    print("  Speed must be positive.")
                except ValueError:
                    print("  Please enter a valid number.")

            if tile_mode == 'image':
                pre_count = len(videos)
                videos = limit_images_by_duration(videos, max_total_duration, image_duration)
                if max_total_duration is not None and len(videos) < pre_count:
                    print(f"  Trimmed tile {i + 1} to {len(videos)} image(s) for {max_total_duration:.2f}s target")
            else:
                pre_count = len(videos)
                video_folder = resolve_video_folder(folder, use_landscape)
                if video_folder != Path(folder):
                    videos = get_video_files(video_folder, per_folder_max, duration_cache)
                videos = limit_videos_by_duration(
                    videos,
                    max_total_duration,
                    trans_type,
                    trans_duration,
                    speed_factor,
                    duration_cache,
                )
                if max_total_duration is not None and len(videos) < pre_count:
                    print(f"  Trimmed tile {i + 1} to {len(videos)} video(s) for {max_total_duration:.2f}s target")
                tile_settings.append((videos, trans_type, trans_duration, crop_position, speed_factor, tile_mode, image_duration, use_landscape, trim_duration))

        # Select audio tiles
        if audio_enabled:
            print("\nAudio source:")
            print("  1. Single folder")
            print("  2. Mix multiple folders")
            while True:
                audio_mode = input("Select audio mode (1-2, default 1): ").strip() or '1'
                if audio_mode in ('1', '2'):
                    break
                print("Invalid choice.")

            print("\nAvailable folders:")
            for i, folder in enumerate(tile_folders):
                print(f"  {i + 1}. {folder}")

            audio_tiles = []
            if audio_mode == '1':
                while True:
                    audio_choice = input(f"Audio from folder (1-{num_tiles}): ").strip()
                    try:
                        idx = int(audio_choice) - 1
                        if 0 <= idx < num_tiles:
                            audio_tiles = [idx]
                            break
                    except ValueError:
                        pass
                    print("Invalid choice.")
            else:
                while True:
                    raw = input(f"Audio mix folders (comma-separated 1-{num_tiles}): ").strip()
                    if not raw:
                        print("Please enter at least one folder number.")
                        continue
                    parts = [p.strip() for p in raw.split(",") if p.strip()]
                    try:
                        picks = [int(p) - 1 for p in parts]
                    except ValueError:
                        print("Please enter valid numbers.")
                        continue
                    audio_tiles = normalize_audio_tiles(picks, None, num_tiles)
                    if audio_tiles:
                        break
                    print("Please enter at least one valid folder number.")
        else:
            audio_tiles = []

        if max_total_duration is None:
            while True:
                total_input = input("Max total output duration (seconds, blank for no limit): ").strip()
                if not total_input:
                    max_total_duration = None
                    break
                try:
                    max_value = float(total_input)
                    if max_value > 0:
                        max_total_duration = max_value
                        break
                    print("Duration must be positive.")
                except ValueError:
                    print("Please enter a valid number.")

        # Save settings for next time
        settings_to_save = {
            'layout_code': layout_code,
            'crop_mode': crop_mode,
            'tile_folders': tile_folders,
            'audio_tiles': audio_tiles,
            'audio_tile': audio_tiles[0] if audio_tiles else None,
            'audio_enabled': audio_enabled,
            'tile_settings': [
                {
                    'trans_type': ts[1],
                    'trans_duration': ts[2],
                    'crop_position': ts[3],
                    'speed': ts[4],
                    'mode': ts[5],
                    'image_duration': ts[6],
                    'use_landscape': ts[7]
                }
                for ts in tile_settings
            ]
        }

        if max_duration_override is not None:
            settings_to_save['max_duration'] = max_duration_override
        elif max_durations:
            settings_to_save['max_durations'] = max_durations
        if max_total_duration is not None:
            settings_to_save['max_total_duration'] = max_total_duration

        # Add distribution mode if used
        if distribution_mode:
            settings_to_save['distribution_mode'] = distribution_mode

        save_settings(settings_to_save)
        print("\n✓ Settings saved for next time!")

    # Generate output filename if not specified
    no_overwrite = args.no_overwrite or env_truthy(os.environ.get("VIDEO_TILING_NO_OVERWRITE"))

    if args.output is None:
        # Create output directory
        output_dir = ROOT / "outputs" / "tiled"
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate filename from layout and folder names
        folder_names = '_'.join([Path(f).name for f in tile_folders])
        # Limit filename length
        if len(folder_names) > 100:
            folder_names = folder_names[:100]

        output_filename = f"{layout_code}_{folder_names}.mp4"
        args.output = str(output_dir / output_filename)
        args.output = resolve_output_path(args.output, no_overwrite)
        print(f"\nOutput will be saved to: {args.output}")
    else:
        args.output = resolve_output_path(args.output, no_overwrite)

    # Preview or full render?
    print("\n" + "=" * 60)
    print("Render mode:")
    print("  1. Full - Process all videos (default)")
    print("  2. Preview - Use only 2-3 videos per folder for quick test")
    print("  3. Fast Preview - Low-res, fewer clips, faster encode")

    while True:
        render_choice = input("\nSelect mode (1-3, default 1): ").strip() or '1'
        if render_choice in ['1', '2', '3']:
            preview_mode = (render_choice == '2')
            fast_preview_mode = (render_choice == '3')
            break
        print("Invalid choice.")

    if fast_preview_mode:
        print("\nFast preview mode: Low-res, 1-2 videos per folder")
        # Limit videos in each tile to 1-2 for fast preview
        tile_settings = [
            (select_preview_items(videos, 2, distribution_mode), trans_type, trans_duration, crop_position, speed_factor, tile_mode, image_duration, use_landscape, trim_duration)
            for videos, trans_type, trans_duration, crop_position, speed_factor, tile_mode, image_duration, use_landscape, trim_duration in tile_settings
        ]
    elif preview_mode:
        print("\nPreview mode: Using 2-3 videos per folder")
        # Limit videos in each tile to 2-3 for preview
        tile_settings = [
            (select_preview_items(videos, 3, distribution_mode), trans_type, trans_duration, crop_position, speed_factor, tile_mode, image_duration, use_landscape, trim_duration)
            for videos, trans_type, trans_duration, crop_position, speed_factor, tile_mode, image_duration, use_landscape, trim_duration in tile_settings
        ]
    else:
        print("\nFull mode: Processing all videos")

    print("\n" + "=" * 60)
    print("Creating tiled video...")
    print("=" * 60)

    # Create temporary tile videos
    temp_dir = tempfile.mkdtemp()
    tile_paths = []

    # Calculate tile dimensions
    output_width = args.width
    output_height = args.height
    if fast_preview_mode:
        output_width = 640
        output_height = 360

    if layout_info['type'] == 'grid':
        tile_width = output_width // layout_info['cols']
        tile_height = output_height // layout_info['rows']
    else:
        # For special layouts, we'll use full resolution and let the layout handle scaling
        tile_width = output_width
        tile_height = output_height

    tile_durations = []
    for i, (videos, trans_type, trans_duration, crop_position, speed_factor, tile_mode, image_duration, use_landscape, trim_duration) in enumerate(tile_settings):
        print(f"\nProcessing tile {i + 1}...")
        temp_tile = Path(temp_dir) / f"tile_{i}.mp4"
        duration = create_tile_video(
            videos,
            trans_type,
            trans_duration,
            temp_tile,
            tile_width,
            tile_height,
            crop_mode,
            crop_position,
            include_audio=audio_enabled,
            speed_factor=speed_factor,
            tile_mode=tile_mode,
            image_duration=image_duration,
            force_cfr=force_cfr,
            trim_duration=trim_duration
        )

        if duration is not None:
            tile_paths.append(temp_tile)
            tile_durations.append(duration)
            print(f"  ✓ Tile {i + 1} created ({duration:.2f}s)")
        else:
            print(f"  ✗ Failed to create tile {i + 1}")
            sys.exit(1)

    # Find target duration and loop tiles at final render
    max_duration = max(tile_durations)
    target_duration = max_duration
    if max_total_duration is not None:
        target_duration = min(max_duration, max_total_duration)
    print(f"\nTarget duration: {target_duration:.2f}s")

    if audio_enabled and not audio_tiles:
        print("Error: Audio is enabled but no audio tiles were selected.")
        sys.exit(1)

    # Create final tiled composition
    print("\nCombining tiles into final output...")
    output_path = Path(args.output)

    cmd = build_xstack_layout(
        layout_code,
        tile_paths,
        audio_tiles,
        output_width,
        output_height,
        include_audio=audio_enabled,
        target_duration=target_duration,
        loop_inputs=True
    )
    cmd.append(str(output_path))

    try:
        subprocess.run(cmd, check=True)
        print(f"\n✓ Successfully created: {output_path.absolute()}")

        # Get output info
        info = get_video_info(output_path)
        if info:
            print(f"  Duration: {info['duration']:.2f}s")
            print(f"  Resolution: {info['width']}x{info['height']}")
    except subprocess.CalledProcessError as e:
        print(f"\n✗ Error creating tiled video: {e}")
        sys.exit(1)
    finally:
        # Cleanup temp files
        for tile_path in tile_paths:
            if tile_path.exists():
                tile_path.unlink()
        os.rmdir(temp_dir)

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)

if __name__ == '__main__':
    main()
