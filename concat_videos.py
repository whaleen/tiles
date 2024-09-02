#!/usr/bin/env python3
"""
Video Concatenation Tool
Concatenates all videos in specified folders with custom transitions per folder.
"""

import os
import sys
import argparse
import subprocess
import tempfile
from pathlib import Path

# Default source folder for videos
SRC_FOLDER = Path('src')

# Common video file extensions
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v', '.webm'}

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

# Transition types
TRANSITIONS = {
    '1': 'cut',
    '2': 'fade',
    '3': 'fadeblack'
}

TRANSITION_NAMES = {
    'cut': 'Simple Cut (no transition)',
    'fade': 'Cross-Dissolve (fade between videos)',
    'fadeblack': 'Fade to Black (fade out/in through black)'
}

def get_video_files(folder_path):
    """Get all video files in the specified folder, sorted alphabetically."""
    folder = Path(folder_path)
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist.")
        return []

    video_files = [f for f in folder.iterdir()
                   if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
    return sorted(video_files, key=lambda x: x.name.lower())

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

        duration = float(info.get('duration', 0))
        width = int(info.get('width', 0))
        height = int(info.get('height', 0))

        return {
            'duration': duration,
            'width': width,
            'height': height
        }
    except (subprocess.CalledProcessError, ValueError, KeyError) as e:
        print(f"Warning: Could not get info for {video_path.name}")
        return None

def concat_simple_cut(video_files, output_path):
    """Concatenate videos with simple cuts (no transitions) - fast, no re-encode."""
    print("Using simple cut (fast mode - no re-encoding)...")

    # Create a temporary file list for ffmpeg concat demuxer
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        concat_file = f.name
        for video in video_files:
            # Escape single quotes and wrap path in quotes
            escaped_path = str(video.absolute()).replace("'", "'\\''")
            f.write(f"file '{escaped_path}'\n")

    try:
        cmd = [
            'ffmpeg',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file,
            '-c', 'copy',
            '-y',
            str(output_path)
        ]

        subprocess.run(cmd, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error during concatenation: {e}")
        return False
    finally:
        os.unlink(concat_file)

def concat_with_transitions(video_files, output_path, transition_type, duration):
    """Concatenate videos with transitions - requires re-encoding."""
    print(f"Using {TRANSITION_NAMES[transition_type]} with {duration}s transition...")
    print("Note: This requires re-encoding and may take a while...")

    if len(video_files) < 2:
        print("Note: Only one video found, copying without transitions...")
        return concat_simple_cut(video_files, output_path)

    # Get video info to determine resolution
    first_info = get_video_info(video_files[0])
    if not first_info:
        print("Error: Could not determine video properties")
        return False

    width, height = first_info['width'], first_info['height']

    # Build filter complex for transitions
    if transition_type == 'fade':
        filter_complex = build_xfade_filter(video_files, duration, width, height)
    else:  # fadeblack
        filter_complex = build_fadeblack_filter(video_files, duration, width, height)

    # Build ffmpeg command
    cmd = ['ffmpeg']

    # Add all input files
    for video in video_files:
        cmd.extend(['-i', str(video)])

    # Add filter complex
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

    try:
        subprocess.run(cmd, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error during concatenation: {e}")
        return False

def build_xfade_filter(video_files, duration, width, height):
    """Build ffmpeg filter complex for cross-dissolve transitions."""
    num_videos = len(video_files)

    # Scale all videos to same size and set same framerate
    filter_parts = []
    for i in range(num_videos):
        filter_parts.append(f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{i}]")
        filter_parts.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a{i}]")

    # Get durations and calculate offset times
    offsets = [0]
    for i, video in enumerate(video_files[:-1]):
        info = get_video_info(video)
        if info:
            offsets.append(offsets[-1] + info['duration'] - duration)

    # Build xfade chain
    current_v = 'v0'
    current_a = 'a0'

    for i in range(1, num_videos):
        next_label_v = f'v{i}{i}' if i < num_videos - 1 else 'outv'
        next_label_a = f'a{i}{i}' if i < num_videos - 1 else 'outa'

        filter_parts.append(f"[{current_v}][v{i}]xfade=transition=fade:duration={duration}:offset={offsets[i]:.3f}[{next_label_v}]")
        filter_parts.append(f"[{current_a}][a{i}]acrossfade=d={duration}[{next_label_a}]")

        current_v = next_label_v
        current_a = next_label_a

    return ';'.join(filter_parts)

def build_fadeblack_filter(video_files, duration, width, height):
    """Build ffmpeg filter complex for fade to black transitions."""
    num_videos = len(video_files)
    fade_time = duration / 2  # Half time for fade out, half for fade in

    filter_parts = []
    concat_inputs = []

    for i, video in enumerate(video_files):
        info = get_video_info(video)
        if not info:
            continue

        vid_duration = info['duration']

        # Scale and add fade out/in
        if i == 0:
            # First video: only fade out at end
            filter_parts.append(
                f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"
                f"fade=t=out:st={vid_duration - fade_time}:d={fade_time}[v{i}]"
            )
            filter_parts.append(
                f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
                f"afade=t=out:st={vid_duration - fade_time}:d={fade_time}[a{i}]"
            )
        elif i == num_videos - 1:
            # Last video: only fade in at start
            filter_parts.append(
                f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"
                f"fade=t=in:st=0:d={fade_time}[v{i}]"
            )
            filter_parts.append(
                f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
                f"afade=t=in:st=0:d={fade_time}[a{i}]"
            )
        else:
            # Middle videos: fade in at start and fade out at end
            filter_parts.append(
                f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"
                f"fade=t=in:st=0:d={fade_time},fade=t=out:st={vid_duration - fade_time}:d={fade_time}[v{i}]"
            )
            filter_parts.append(
                f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
                f"afade=t=in:st=0:d={fade_time},afade=t=out:st={vid_duration - fade_time}:d={fade_time}[a{i}]"
            )

        concat_inputs.append(f"[v{i}][a{i}]")

    # Concatenate all faded clips
    concat_filter = f"{''.join(concat_inputs)}concat=n={num_videos}:v=1:a=1[outv][outa]"
    filter_parts.append(concat_filter)

    return ';'.join(filter_parts)

def get_transition_settings(folder_path):
    """Prompt user for transition settings for a specific folder."""
    print(f"\n{'='*60}")
    print(f"Folder: {folder_path}")
    print('='*60)
    print("\nTransition types:")
    print("  1. Simple Cut (no transition) - Fast, no re-encoding")
    print("  2. Cross-Dissolve (fade) - Videos blend into each other")
    print("  3. Fade to Black - Fade out to black, then fade in")

    while True:
        choice = input("\nSelect transition type (1-3): ").strip()
        if choice in TRANSITIONS:
            transition_type = TRANSITIONS[choice]
            break
        print("Invalid choice. Please enter 1, 2, or 3.")

    duration = 0
    if transition_type != 'cut':
        while True:
            try:
                duration = float(input("Transition duration in seconds (e.g., 1.0): "))
                if duration <= 0:
                    print("Duration must be positive.")
                    continue
                if duration > 5:
                    confirm = input(f"{duration}s is quite long. Continue? (y/n): ")
                    if confirm.lower() != 'y':
                        continue
                break
            except ValueError:
                print("Please enter a valid number.")

    return transition_type, duration

def process_folder(folder_path, output_dir):
    """Process all videos in a folder with specified transition settings."""
    video_files = get_video_files(folder_path)

    if not video_files:
        print(f"No video files found in '{folder_path}'")
        return

    if len(video_files) == 1:
        print(f"\nOnly 1 video found in '{folder_path}'")
        print("Copying video to output (no concatenation needed)...")

        folder_name = Path(folder_path).name
        output_path = output_dir / f"{folder_name}_concatenated.mp4"

        try:
            cmd = ['ffmpeg', '-i', str(video_files[0]), '-c', 'copy', '-y', str(output_path)]
            subprocess.run(cmd, check=True)
            print(f"✓ Saved to {output_path}")
        except subprocess.CalledProcessError as e:
            print(f"✗ Error copying video: {e}")
        return

    print(f"\nFound {len(video_files)} video(s) in '{folder_path}'")
    print("Videos in order:")
    for i, vf in enumerate(video_files, 1):
        info = get_video_info(vf)
        duration_str = f"{info['duration']:.2f}s" if info else "unknown"
        print(f"  {i}. {vf.name} ({duration_str})")

    transition_type, duration = get_transition_settings(folder_path)

    # Create output filename
    folder_name = Path(folder_path).name
    output_path = output_dir / f"{folder_name}_concatenated.mp4"

    print(f"\nProcessing {len(video_files)} videos...")

    # Concatenate based on transition type
    if transition_type == 'cut':
        success = concat_simple_cut(video_files, output_path)
    else:
        success = concat_with_transitions(video_files, output_path, transition_type, duration)

    if success:
        output_info = get_video_info(output_path)
        duration_str = f" ({output_info['duration']:.2f}s)" if output_info else ""
        print(f"\n✓ Successfully created: {output_path}{duration_str}")
    else:
        print(f"\n✗ Failed to create concatenated video")

def main():
    parser = argparse.ArgumentParser(
        description='Concatenate videos in folders with custom transitions per folder.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s folder1 folder2 folder3
  %(prog)s /path/to/videos --output /path/to/output

Note: Requires ffmpeg to be installed.
      Videos are concatenated in alphabetical order by filename.
        '''
    )

    parser.add_argument('folders', nargs='+', help='One or more folders containing videos to concatenate')
    parser.add_argument('-o', '--output', default='concatenated_output',
                        help='Output directory for concatenated videos (default: concatenated_output)')

    args = parser.parse_args()

    # Check if ffmpeg and ffprobe are available
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        subprocess.run(['ffprobe', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: ffmpeg and ffprobe must be installed.")
        print("Install with: brew install ffmpeg  (on macOS)")
        sys.exit(1)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Video Concatenation Tool")
    print(f"Output directory: {output_dir.absolute()}")
    print(f"Note: Folder names without '/' are looked up in '{SRC_FOLDER}/' first\n")

    for folder in args.folders:
        resolved_folder = resolve_folder_path(folder)
        process_folder(str(resolved_folder), output_dir)

    print(f"\n{'='*60}")
    print(f"All done! Concatenated videos saved to: {output_dir.absolute()}")
    print('='*60)

if __name__ == '__main__':
    main()
