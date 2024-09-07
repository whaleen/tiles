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

# Settings file (in project directory)
SETTINGS_FILE = Path('tile_videos_settings.json')

# Default source folder for videos
SRC_FOLDER = Path('src')

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
    '3': 'random'
}

DISTRIBUTION_MODE_NAMES = {
    'round-robin': 'Round-Robin (cycling) - Each tile gets every Nth clip',
    'sequential': 'Sequential Blocks - Divide clips into continuous chunks',
    'random': 'Random Distribution - Shuffle and distribute randomly'
}

def save_settings(settings):
    """Save settings to file."""
    try:
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

def display_saved_settings(settings):
    """Display saved settings in a readable format."""
    print("\nSaved settings:")
    print(f"  Layout: {settings['layout_code']}")
    print(f"  Crop mode: {CROP_MODE_NAMES[settings['crop_mode']]}")

    # Check if distribution mode was used
    if settings.get('distribution_mode'):
        print(f"  Distribution: {DISTRIBUTION_MODE_NAMES[settings['distribution_mode']]} (single folder)")
        display_layout(settings['layout_code'], tile_folders=[settings['tile_folders'][0]] * len(settings['tile_folders']))
    else:
        display_layout(settings['layout_code'], tile_folders=settings['tile_folders'])

    print("  Tile configurations:")
    for i, tile_cfg in enumerate(settings['tile_settings']):
        print(f"    Tile {i + 1} ({settings['tile_folders'][i]}):")
        print(f"      Transition: {TRANSITION_NAMES[tile_cfg['trans_type']]}")
        if tile_cfg['trans_duration'] > 0:
            print(f"      Duration: {tile_cfg['trans_duration']}s")
        if settings['crop_mode'] == 'crop':
            print(f"      Crop position: {CROP_POSITION_NAMES[tile_cfg['crop_position']]}")

    print(f"\n  Audio from: {settings['tile_folders'][settings['audio_tile']]}")
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

        return f'scale={width}:{height}:force_original_aspect_ratio=increase,{crop_filter},fps={fps}'
    elif crop_mode == 'pad':
        # Pad to fit - scale to fit inside, then add black bars
        return f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps={fps}'
    elif crop_mode == 'stretch':
        # Stretch to fill - ignore aspect ratio
        return f'scale={width}:{height},fps={fps}'
    else:
        return f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},fps={fps}'

def get_video_files(folder_path):
    """Get all video files in the specified folder, sorted alphabetically."""
    folder = Path(folder_path)
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist.")
        return []

    video_files = [f for f in folder.iterdir()
                   if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
    return sorted(video_files, key=lambda x: x.name.lower())

def distribute_videos(video_files, num_tiles, mode='round-robin'):
    """Distribute videos across tiles using specified mode."""
    import random

    total_videos = len(video_files)

    if mode == 'round-robin':
        # Each tile gets every Nth video
        distributed = [[] for _ in range(num_tiles)]
        for i, video in enumerate(video_files):
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
        random.shuffle(shuffled)

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

def create_tile_video(video_files, transition_type, duration, output_path, width, height, crop_mode='crop', crop_position='center'):
    """Create a single tile video by concatenating videos from a folder."""
    if not video_files:
        print("No videos to process for this tile")
        return None

    print(f"  Creating tile with {len(video_files)} video(s)...")

    scale_filter = get_scale_filter(width, height, crop_mode, crop_position)

    if len(video_files) == 1 and transition_type == 'cut':
        # Single video, just scale it
        cmd = [
            'ffmpeg',
            '-i', str(video_files[0]),
            '-vf', scale_filter,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-y',
            str(output_path)
        ]
    elif transition_type == 'cut':
        # Multiple videos, simple concatenation
        concat_list = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
        try:
            for video in video_files:
                escaped_path = str(video.absolute()).replace("'", "'\\''")
                concat_list.write(f"file '{escaped_path}'\n")
            concat_list.close()

            cmd = [
                'ffmpeg',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_list.name,
                '-vf', scale_filter,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-y',
                str(output_path)
            ]
        finally:
            pass  # We'll delete after ffmpeg runs
    else:
        # With transitions - use complex filter
        cmd = build_tile_with_transitions(video_files, transition_type, duration, output_path, width, height, crop_mode, crop_position)
        concat_list = None

    try:
        subprocess.run(cmd, capture_output=True, check=True)
        if concat_list:
            os.unlink(concat_list.name)

        # Get the duration of created tile
        info = get_video_info(output_path)
        return info['duration'] if info else 0
    except subprocess.CalledProcessError as e:
        print(f"  Error creating tile: {e}")
        if concat_list:
            os.unlink(concat_list.name)
        return None

def build_tile_with_transitions(video_files, transition_type, duration, output_path, width, height, crop_mode='crop', crop_position='center'):
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
        filter_parts.append(f"[{i}:v]{scale_base},setsar=1,fps=30[v{i}]")
        filter_parts.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a{i}]")

    if transition_type == 'fade':
        # Cross-dissolve transitions
        offsets = [0]
        for i, video in enumerate(video_files[:-1]):
            info = get_video_info(video)
            if info:
                offsets.append(offsets[-1] + info['duration'] - duration)

        current_v = 'v0'
        current_a = 'a0'

        for i in range(1, num_videos):
            next_label_v = f'v{i}{i}' if i < num_videos - 1 else 'outv'
            next_label_a = f'a{i}{i}' if i < num_videos - 1 else 'outa'

            filter_parts.append(
                f"[{current_v}][v{i}]xfade=transition=fade:duration={duration}:offset={offsets[i]:.3f}[{next_label_v}]"
            )
            filter_parts.append(f"[{current_a}][a{i}]acrossfade=d={duration}[{next_label_a}]")

            current_v = next_label_v
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
                filter_parts.append(
                    f"[a{i}]afade=t=out:st={vid_duration - fade_time}:d={fade_time}[af{i}]"
                )
            elif i == num_videos - 1:
                filter_parts.append(
                    f"[v{i}]fade=t=in:st=0:d={fade_time}[vf{i}]"
                )
                filter_parts.append(
                    f"[a{i}]afade=t=in:st=0:d={fade_time}[af{i}]"
                )
            else:
                filter_parts.append(
                    f"[v{i}]fade=t=in:st=0:d={fade_time},fade=t=out:st={vid_duration - fade_time}:d={fade_time}[vf{i}]"
                )
                filter_parts.append(
                    f"[a{i}]afade=t=in:st=0:d={fade_time},afade=t=out:st={vid_duration - fade_time}:d={fade_time}[af{i}]"
                )

            concat_inputs.append(f"[vf{i}][af{i}]")

        filter_parts.append(f"{''.join(concat_inputs)}concat=n={num_videos}:v=1:a=1[outv][outa]")

    filter_complex = ';'.join(filter_parts)

    # Build command
    cmd = ['ffmpeg']
    for video in video_files:
        cmd.extend(['-i', str(video)])

    cmd.extend([
        '-filter_complex', filter_complex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-y',
        str(output_path)
    ])

    return cmd

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

def build_xstack_layout(layout_code, tile_paths, audio_tile, output_width=1920, output_height=1080):
    """Build the final tiled composition using xstack or overlay."""
    layout_info = get_layout_info(layout_code)

    if layout_info['type'] == 'grid':
        return build_grid_layout(layout_info['rows'], layout_info['cols'], tile_paths, audio_tile, output_width, output_height)
    else:
        return build_special_layout(layout_code, tile_paths, audio_tile, output_width, output_height)

def build_grid_layout(rows, cols, tile_paths, audio_tile, output_width, output_height):
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
    filter_complex = f"{inputs}xstack=inputs={len(tile_paths)}:layout={layout_str}[outv]"

    # Build command
    cmd = ['ffmpeg']
    for tile_path in tile_paths:
        cmd.extend(['-i', str(tile_path)])

    cmd.extend([
        '-filter_complex', filter_complex,
        '-map', '[outv]',
        '-map', f'{audio_tile}:a',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-y'
    ])

    return cmd

def build_special_layout(layout_code, tile_paths, audio_tile, output_width, output_height):
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
        left_w = (output_width * 2) // 3
        right_w = output_width // 3
        right_h = output_height // 2

        filter_parts.append(
            f"[0:v]scale={left_w}:{output_height}:force_original_aspect_ratio=increase,"
            f"crop={left_w}:{output_height}[left]"
        )
        filter_parts.append(
            f"[1:v]scale={right_w}:{right_h}:force_original_aspect_ratio=increase,"
            f"crop={right_w}:{right_h}[top_right]"
        )
        filter_parts.append(
            f"[2:v]scale={right_w}:{right_h}:force_original_aspect_ratio=increase,"
            f"crop={right_w}:{right_h}[bottom_right]"
        )
        filter_parts.append(f"[top_right][bottom_right]vstack[right]")
        filter_parts.append(f"[left][right]hstack[outv]")

    elif layout_code == '2+1':
        # Two stacked left (1/3 width), one large right (2/3 width)
        left_w = output_width // 3
        left_h = output_height // 2
        right_w = (output_width * 2) // 3

        filter_parts.append(
            f"[0:v]scale={left_w}:{left_h}:force_original_aspect_ratio=increase,"
            f"crop={left_w}:{left_h}[top_left]"
        )
        filter_parts.append(
            f"[1:v]scale={left_w}:{left_h}:force_original_aspect_ratio=increase,"
            f"crop={left_w}:{left_h}[bottom_left]"
        )
        filter_parts.append(
            f"[2:v]scale={right_w}:{output_height}:force_original_aspect_ratio=increase,"
            f"crop={right_w}:{output_height}[right]"
        )
        filter_parts.append(f"[top_left][bottom_left]vstack[left]")
        filter_parts.append(f"[left][right]hstack[outv]")

    elif layout_code == '1+3':
        # One large top (2/3 height), three small bottom (1/3 height)
        top_h = (output_height * 2) // 3
        bottom_h = output_height // 3
        bottom_w = output_width // 3

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
            f"[3:v]scale={bottom_w}:{bottom_h}:force_original_aspect_ratio=increase,"
            f"crop={bottom_w}:{bottom_h}[b3]"
        )
        filter_parts.append(f"[b1][b2][b3]hstack=inputs=3[bottom]")
        filter_parts.append(f"[top][bottom]vstack[outv]")

    filter_complex = ';'.join(filter_parts)

    # Build command
    cmd = ['ffmpeg']
    for tile_path in tile_paths:
        cmd.extend(['-i', str(tile_path)])

    cmd.extend([
        '-filter_complex', filter_complex,
        '-map', '[outv]',
        '-map', f'{audio_tile}:a',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-y'
    ])

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
    parser.add_argument('-w', '--width', type=int, default=1920,
                        help='Output video width (default: 1920)')
    parser.add_argument('--height', type=int, default=1080,
                        help='Output video height (default: 1080)')

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

    if use_saved:
        # Use saved settings
        layout_code = saved_settings['layout_code']
        crop_mode = saved_settings['crop_mode']
        tile_folders = saved_settings['tile_folders']
        audio_tile = saved_settings['audio_tile']
        distribution_mode = saved_settings.get('distribution_mode')

        layout_info = get_layout_info(layout_code)
        num_tiles = layout_info['count']

        # Reconstruct tile_settings - need to get fresh video lists
        tile_settings = []

        if distribution_mode:
            # Distribute videos from single folder
            all_videos = get_video_files(tile_folders[0])
            distributed_videos = distribute_videos(all_videos, num_tiles, distribution_mode)

            for i, tile_cfg in enumerate(saved_settings['tile_settings']):
                videos = distributed_videos[i]
                tile_settings.append((videos, tile_cfg['trans_type'], tile_cfg['trans_duration'], tile_cfg['crop_position']))
        else:
            # Get videos from each folder separately
            for i, tile_cfg in enumerate(saved_settings['tile_settings']):
                videos = get_video_files(tile_folders[i])
                tile_settings.append((videos, tile_cfg['trans_type'], tile_cfg['trans_duration'], tile_cfg['crop_position']))

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

        # Get folders for each tile
        tile_folders = []
        print(f"\nNote: Folder names without '/' are looked up in '{SRC_FOLDER}/' first")

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

        # Check if all folders are the same - offer distribution mode
        unique_folders = list(set(tile_folders))
        distribution_mode = None

        if len(unique_folders) == 1:
            # All tiles use the same folder
            all_videos = get_video_files(unique_folders[0])

            print(f"\n{'='*60}")
            print(f"All tiles use the same folder: {unique_folders[0]}")
            print(f"Found {len(all_videos)} total video(s)")
            print('='*60)

            print("\nDistribution mode:")
            print("  1. Round-Robin (cycling) - Each tile gets every Nth clip")
            print("     Example: Tile1=[1,5,9...] Tile2=[2,6,10...] Tile3=[3,7,11...]")
            print("  2. Sequential Blocks - Divide clips into continuous chunks")
            print("     Example: Tile1=[1-24] Tile2=[25-48] Tile3=[49-71]")
            print("  3. Random Distribution - Shuffle and distribute randomly")

            while True:
                choice = input("\nSelect distribution mode (1-3): ").strip()
                if choice in DISTRIBUTION_MODES:
                    distribution_mode = DISTRIBUTION_MODES[choice]
                    break
                print("Invalid choice. Please enter 1, 2, or 3.")

            print(f"\nUsing: {DISTRIBUTION_MODE_NAMES[distribution_mode]}")

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
                print(f"\nTile {i + 1}: {len(videos)} video(s) (distributed from '{folder}')")
            else:
                videos = get_video_files(folder)
                print(f"\nTile {i + 1}: {len(videos)} video(s) from '{folder}'")

            if len(videos) > 1:
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

            tile_settings.append((videos, trans_type, trans_duration, crop_position))

        # Select audio tile
        print("\nWhich folder's audio should be used?")
        for i, folder in enumerate(tile_folders):
            print(f"  {i + 1}. {folder}")

        while True:
            audio_choice = input(f"Audio from folder (1-{num_tiles}): ").strip()
            try:
                audio_tile = int(audio_choice) - 1
                if 0 <= audio_tile < num_tiles:
                    break
            except ValueError:
                pass
            print("Invalid choice.")

        # Save settings for next time
        settings_to_save = {
            'layout_code': layout_code,
            'crop_mode': crop_mode,
            'tile_folders': tile_folders,
            'audio_tile': audio_tile,
            'tile_settings': [
                {
                    'trans_type': ts[1],
                    'trans_duration': ts[2],
                    'crop_position': ts[3]
                }
                for ts in tile_settings
            ]
        }

        # Add distribution mode if used
        if distribution_mode:
            settings_to_save['distribution_mode'] = distribution_mode

        save_settings(settings_to_save)
        print("\n✓ Settings saved for next time!")

    # Generate output filename if not specified
    if args.output is None:
        # Create output directory
        output_dir = Path('output')
        output_dir.mkdir(exist_ok=True)

        # Generate filename from layout and folder names
        folder_names = '_'.join([Path(f).name for f in tile_folders])
        # Limit filename length
        if len(folder_names) > 100:
            folder_names = folder_names[:100]

        output_filename = f"{layout_code}_{folder_names}.mp4"
        args.output = str(output_dir / output_filename)
        print(f"\nOutput will be saved to: {args.output}")

    # Preview or full render?
    print("\n" + "=" * 60)
    print("Render mode:")
    print("  1. Full - Process all videos (default)")
    print("  2. Preview - Use only 2-3 videos per folder for quick test")

    while True:
        render_choice = input("\nSelect mode (1-2, default 1): ").strip() or '1'
        if render_choice in ['1', '2']:
            preview_mode = (render_choice == '2')
            break
        print("Invalid choice.")

    if preview_mode:
        print("\nPreview mode: Using 2-3 videos per folder")
        # Limit videos in each tile to 2-3 for preview
        tile_settings = [
            (videos[:3], trans_type, trans_duration, crop_position)
            for videos, trans_type, trans_duration, crop_position in tile_settings
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
    if layout_info['type'] == 'grid':
        tile_width = args.width // layout_info['cols']
        tile_height = args.height // layout_info['rows']
    else:
        # For special layouts, we'll use full resolution and let the layout handle scaling
        tile_width = args.width
        tile_height = args.height

    tile_durations = []
    for i, (videos, trans_type, trans_duration, crop_position) in enumerate(tile_settings):
        print(f"\nProcessing tile {i + 1}...")
        temp_tile = Path(temp_dir) / f"tile_{i}.mp4"
        duration = create_tile_video(videos, trans_type, trans_duration, temp_tile, tile_width, tile_height, crop_mode, crop_position)

        if duration is not None:
            tile_paths.append(temp_tile)
            tile_durations.append(duration)
            print(f"  ✓ Tile {i + 1} created ({duration:.2f}s)")
        else:
            print(f"  ✗ Failed to create tile {i + 1}")
            sys.exit(1)

    # Find max duration and loop shorter tiles
    max_duration = max(tile_durations)
    print(f"\nLongest tile: {max_duration:.2f}s")

    for i, (tile_path, duration) in enumerate(zip(tile_paths, tile_durations)):
        if duration < max_duration - 0.1:  # If significantly shorter
            print(f"Looping tile {i + 1} ({duration:.2f}s -> {max_duration:.2f}s)...")

            # Create a looped version
            looped_tile = Path(temp_dir) / f"tile_{i}_looped.mp4"

            # Calculate how many times to repeat the input
            loops_needed = int(max_duration / duration) + 1

            # Build concat file
            concat_file = Path(temp_dir) / f"tile_{i}_concat.txt"
            with open(concat_file, 'w') as f:
                for _ in range(loops_needed):
                    escaped_path = str(tile_path.absolute()).replace("'", "'\\''")
                    f.write(f"file '{escaped_path}'\n")

            # Concat and trim to exact duration
            try:
                cmd = [
                    'ffmpeg',
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', str(concat_file),
                    '-t', str(max_duration),
                    '-c', 'copy',
                    '-y',
                    str(looped_tile)
                ]
                subprocess.run(cmd, capture_output=True, check=True)

                # Replace original with looped version
                tile_path.unlink()
                looped_tile.rename(tile_path)
                concat_file.unlink()

                print(f"  ✓ Tile {i + 1} looped successfully")
            except subprocess.CalledProcessError as e:
                print(f"  ✗ Error looping tile {i + 1}: {e}")
                sys.exit(1)

    # Create final tiled composition
    print("\nCombining tiles into final output...")
    output_path = Path(args.output)

    cmd = build_xstack_layout(layout_code, tile_paths, audio_tile, args.width, args.height)
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
