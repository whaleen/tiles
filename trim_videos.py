#!/usr/bin/env python3
"""
Video Trimming Tool
Trims videos in specified folders with custom start/end trim values per folder.
"""

import os
import sys
import argparse
import subprocess
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

def get_video_files(folder_path):
    """Get all video files in the specified folder."""
    folder = Path(folder_path)
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist.")
        return []

    video_files = [f for f in folder.iterdir()
                   if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
    return sorted(video_files)

def get_video_duration(video_path):
    """Get the duration of a video in seconds using ffprobe."""
    try:
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            str(video_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(result.stdout.strip())
    except (subprocess.CalledProcessError, ValueError) as e:
        print(f"Warning: Could not determine duration for {video_path.name}")
        return None

def trim_video(input_path, output_path, trim_start, trim_end):
    """Trim a video using ffmpeg."""
    duration = get_video_duration(input_path)

    if duration is None:
        print(f"Skipping {input_path.name} (could not determine duration)")
        return False

    # Calculate the new duration
    new_duration = duration - trim_start - trim_end

    if new_duration <= 0:
        print(f"Skipping {input_path.name} (trim values exceed video duration)")
        return False

    print(f"  Trimming {input_path.name} ({duration:.2f}s -> {new_duration:.2f}s)...")

    # Build ffmpeg command
    cmd = [
        'ffmpeg',
        '-i', str(input_path),
        '-ss', str(trim_start),
        '-t', str(new_duration),
        '-c:v', 'libx264',  # Re-encode video
        '-preset', 'medium',  # Encoding speed/quality balance
        '-crf', '23',  # Quality (lower = better, 23 is good default)
        '-c:a', 'aac',  # Re-encode audio
        '-b:a', '192k',  # Audio bitrate
        '-y',  # Overwrite output file if it exists
        str(output_path)
    ]

    try:
        subprocess.run(cmd, capture_output=True, check=True)
        print(f"  ✓ Saved to {output_path}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ✗ Error trimming {input_path.name}: {e}")
        return False

def process_folder(folder_path, trim_start, trim_end, output_dir):
    """Process all videos in a folder with specified trim values."""
    video_files = get_video_files(folder_path)

    if not video_files:
        print(f"No video files found in '{folder_path}'")
        return

    print(f"\nFound {len(video_files)} video(s) in '{folder_path}'")
    print(f"Trim settings: {trim_start}s from start, {trim_end}s from end\n")

    # Create output subdirectory based on input folder name
    folder_name = Path(folder_path).name
    output_folder = output_dir / folder_name
    output_folder.mkdir(parents=True, exist_ok=True)

    success_count = 0
    for video_file in video_files:
        output_path = output_folder / video_file.name
        if trim_video(video_file, output_path, trim_start, trim_end):
            success_count += 1

    print(f"\nCompleted: {success_count}/{len(video_files)} videos trimmed successfully")

def get_trim_values(folder_path):
    """Prompt user for trim values for a specific folder."""
    print(f"\n{'='*60}")
    print(f"Folder: {folder_path}")
    print('='*60)

    while True:
        try:
            trim_start = float(input("Trim from start (seconds, 0 for none): "))
            if trim_start < 0:
                print("Please enter a non-negative number.")
                continue
            break
        except ValueError:
            print("Please enter a valid number.")

    while True:
        try:
            trim_end = float(input("Trim from end (seconds, 0 for none): "))
            if trim_end < 0:
                print("Please enter a non-negative number.")
                continue
            break
        except ValueError:
            print("Please enter a valid number.")

    return trim_start, trim_end

def main():
    parser = argparse.ArgumentParser(
        description='Trim videos in folders with custom start/end trim values per folder.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s folder1 folder2 folder3
  %(prog)s /path/to/videos --output /path/to/output
        '''
    )

    parser.add_argument('folders', nargs='+', help='One or more folders containing videos to trim')
    parser.add_argument('-o', '--output', default='trimmed_output',
                        help='Output directory for trimmed videos (default: trimmed_output)')

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

    print(f"Video Trimming Tool")
    print(f"Output directory: {output_dir.absolute()}")
    print(f"Note: Folder names without '/' are looked up in '{SRC_FOLDER}/' first\n")

    for folder in args.folders:
        resolved_folder = resolve_folder_path(folder)
        trim_start, trim_end = get_trim_values(str(resolved_folder))
        process_folder(str(resolved_folder), trim_start, trim_end, output_dir)

    print(f"\n{'='*60}")
    print(f"All done! Trimmed videos saved to: {output_dir.absolute()}")
    print('='*60)

if __name__ == '__main__':
    main()
