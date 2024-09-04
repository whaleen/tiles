#!/usr/bin/env python3
"""
Scene Detection Tool
Automatically detects scene changes in videos and optionally splits them into separate clips.
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

def check_scenedetect():
    """Check if scenedetect is installed."""
    try:
        from scenedetect import detect, ContentDetector
        return True
    except ImportError:
        return False

def check_venv():
    """Check if a venv exists in the project directory."""
    script_dir = Path(__file__).parent
    venv_path = script_dir / 'venv'
    return venv_path.exists() and (venv_path / 'bin' / 'activate').exists()

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
    """Get all video files in the specified folder, sorted alphabetically."""
    folder = Path(folder_path)
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist.")
        return []

    video_files = [f for f in folder.iterdir()
                   if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
    return sorted(video_files, key=lambda x: x.name.lower())

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
    except (subprocess.CalledProcessError, ValueError):
        return None

def detect_scenes(video_path, detector_type='content', threshold=27.0):
    """Detect scenes in a video using PySceneDetect."""
    from scenedetect import detect, ContentDetector, AdaptiveDetector

    print(f"\n  Analyzing video: {video_path.name}")
    print(f"  Detector: {detector_type}, Threshold: {threshold}")

    try:
        if detector_type == 'content':
            detector = ContentDetector(threshold=threshold)
        elif detector_type == 'adaptive':
            detector = AdaptiveDetector(adaptive_threshold=threshold)
        else:
            detector = ContentDetector(threshold=threshold)

        scene_list = detect(str(video_path), detector, show_progress=True)
        return scene_list

    except Exception as e:
        print(f"  ✗ Error detecting scenes: {e}")
        return None

def split_video_into_scenes(video_path, scene_list, output_dir, video_name_prefix=None):
    """Split video into individual scene clips using ffmpeg directly."""
    if not scene_list:
        print("  No scenes detected - video will not be split")
        return False

    if video_name_prefix is None:
        video_name_prefix = video_path.stem

    print(f"\n  Splitting into {len(scene_list)} scene(s)...")

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    success_count = 0
    total_scenes = len(scene_list)

    for i, (start_time, end_time) in enumerate(scene_list, 1):
        scene_filename = f"{video_name_prefix}-Scene-{i:03d}.mp4"
        scene_output = output_path / scene_filename

        start_sec = start_time.get_seconds()
        end_sec = end_time.get_seconds()

        # Build ffmpeg command for this scene
        cmd = [
            'ffmpeg',
            '-i', str(video_path),
            '-ss', str(start_sec),
            '-to', str(end_sec),
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-y',
            str(scene_output)
        ]

        try:
            subprocess.run(cmd, capture_output=True, check=True)
            success_count += 1

            # Show progress
            if i % 10 == 0 or i == total_scenes:
                print(f"  Progress: {i}/{total_scenes} scenes...")

        except subprocess.CalledProcessError as e:
            print(f"  ✗ Failed to create scene {i}: {scene_filename}")
            continue

    if success_count == total_scenes:
        print(f"  ✓ Successfully created {success_count}/{total_scenes} scene file(s)")
        return True
    elif success_count > 0:
        print(f"  ⚠ Created {success_count}/{total_scenes} scene file(s) (some failed)")
        return True
    else:
        print(f"  ✗ Failed to create any scene files")
        return False

def format_timecode(seconds):
    """Format seconds as HH:MM:SS.mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"

def display_scene_info(scene_list, video_duration=None):
    """Display information about detected scenes."""
    if not scene_list:
        print("  No scenes detected")
        return

    print(f"\n  Detected {len(scene_list)} scene(s):\n")
    print(f"  {'Scene':<8} {'Start':<14} {'End':<14} {'Duration':<12}")
    print(f"  {'-'*50}")

    for i, (start_time, end_time) in enumerate(scene_list, 1):
        start_sec = start_time.get_seconds()
        end_sec = end_time.get_seconds()
        duration = end_sec - start_sec

        print(f"  {i:<8} {format_timecode(start_sec):<14} {format_timecode(end_sec):<14} {duration:>8.2f}s")

    # Calculate statistics
    total_scene_time = sum((end.get_seconds() - start.get_seconds()) for start, end in scene_list)
    avg_scene_duration = total_scene_time / len(scene_list) if scene_list else 0

    print(f"\n  Statistics:")
    print(f"    Total scenes: {len(scene_list)}")
    print(f"    Average scene duration: {avg_scene_duration:.2f}s")
    if video_duration:
        print(f"    Total video duration: {video_duration:.2f}s")

def get_detector_settings():
    """Prompt user for detector type and threshold."""
    print("\nDetection method:")
    print("  1. Content-aware (default) - Best for most videos")
    print("  2. Adaptive - Better for videos with gradual lighting changes")

    while True:
        choice = input("\nSelect detection method (1-2, default 1): ").strip() or '1'
        if choice in ['1', '2']:
            detector_type = 'content' if choice == '1' else 'adaptive'
            break
        print("Invalid choice. Please enter 1 or 2.")

    # Get threshold
    if detector_type == 'content':
        print("\nContent detection threshold (default: 27.0)")
        print("  Lower values (15-25): More sensitive, detects subtle changes")
        print("  Higher values (30-40): Only detects clear scene changes")
    else:
        print("\nAdaptive threshold (default: 3.0)")
        print("  Lower values (1-2): More sensitive")
        print("  Higher values (4-6): Less sensitive")

    default_threshold = 27.0 if detector_type == 'content' else 3.0

    while True:
        threshold_input = input(f"\nThreshold (default {default_threshold}): ").strip()
        if not threshold_input:
            threshold = default_threshold
            break
        try:
            threshold = float(threshold_input)
            if threshold > 0:
                break
            print("Threshold must be positive.")
        except ValueError:
            print("Please enter a valid number.")

    return detector_type, threshold

def process_video(video_path, detector_type, threshold, output_dir, split_mode='both'):
    """Process a single video: detect scenes and optionally split."""
    print(f"\n{'='*60}")
    print(f"Processing: {video_path.name}")
    print('='*60)

    # Get video duration
    duration = get_video_duration(video_path)

    # Detect scenes
    scene_list = detect_scenes(video_path, detector_type, threshold)

    if scene_list is None:
        return False

    # Display scene information
    display_scene_info(scene_list, duration)

    # Split if requested
    if split_mode in ['split', 'both'] and scene_list:
        # Create output subdirectory for this video
        video_output_dir = output_dir / video_path.stem
        video_output_dir.mkdir(parents=True, exist_ok=True)

        success = split_video_into_scenes(video_path, scene_list, video_output_dir)

        if success:
            print(f"\n  ✓ Scenes saved to: {video_output_dir}")
            return True
        else:
            return False
    elif not scene_list:
        print("\n  ℹ No scenes to split")
        return False
    else:
        print("\n  ℹ List-only mode - video not split")
        return True

def main():
    parser = argparse.ArgumentParser(
        description='Detect scenes in videos and optionally split them into clips.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s video.mp4
  %(prog)s folder1 folder2
  %(prog)s video.mp4 --list-only

Note: Requires PySceneDetect to be installed.
      Install with: pip install scenedetect[opencv]
        '''
    )

    parser.add_argument('inputs', nargs='+',
                        help='Video file(s) or folder(s) to process')
    parser.add_argument('-o', '--output', default='scenes_output',
                        help='Output directory for scene clips (default: scenes_output)')
    parser.add_argument('--list-only', action='store_true',
                        help='Only list detected scenes, do not split videos')
    parser.add_argument('-t', '--threshold', type=float,
                        help='Detection threshold (skips interactive prompt)')
    parser.add_argument('-m', '--method', choices=['content', 'adaptive'],
                        help='Detection method (skips interactive prompt)')

    args = parser.parse_args()

    # Check if scenedetect is installed
    if not check_scenedetect():
        print("Error: PySceneDetect is not installed.")

        # Check if venv exists but isn't activated
        if check_venv():
            print("\n⚠️  A virtual environment exists but may not be activated.")
            print("\nActivate it with:")
            print("  source venv/bin/activate")
            print("\nThen run this script again.")
        else:
            print("\nInstall with:")
            print("  pip install 'scenedetect[opencv]'")
            print("\nOr for basic installation:")
            print("  pip install scenedetect")
        sys.exit(1)

    # Check if ffmpeg is available
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        subprocess.run(['ffprobe', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: ffmpeg and ffprobe must be installed.")
        print("Install with: brew install ffmpeg  (on macOS)")
        sys.exit(1)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("Scene Detection Tool")
    print("=" * 60)
    print(f"Output directory: {output_dir.absolute()}")
    print(f"Mode: {'List only' if args.list_only else 'Detect and split'}")
    print(f"Note: Folder names without '/' are looked up in '{SRC_FOLDER}/' first\n")

    # Get detector settings if not provided via command line
    if args.method and args.threshold is not None:
        detector_type = args.method
        threshold = args.threshold
        print(f"Using: {detector_type} detection with threshold {threshold}\n")
    else:
        detector_type, threshold = get_detector_settings()

    split_mode = 'list' if args.list_only else 'both'

    # Collect all videos to process
    videos_to_process = []

    for input_path in args.inputs:
        path = Path(input_path)

        # Try to resolve as folder first
        if not path.exists() or not path.is_file():
            resolved_path = resolve_folder_path(input_path)
            if resolved_path.exists() and resolved_path.is_dir():
                # It's a folder
                folder_videos = get_video_files(resolved_path)
                videos_to_process.extend(folder_videos)
                continue

        # Try as direct file path
        if path.exists() and path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
            videos_to_process.append(path)
        else:
            print(f"Warning: '{input_path}' is not a valid video file or folder")

    if not videos_to_process:
        print("\nNo videos found to process.")
        sys.exit(1)

    print(f"\nFound {len(videos_to_process)} video(s) to process\n")

    # Process each video
    success_count = 0
    for video in videos_to_process:
        if process_video(video, detector_type, threshold, output_dir, split_mode):
            success_count += 1

    # Summary
    print(f"\n{'='*60}")
    print(f"Completed: {success_count}/{len(videos_to_process)} video(s) processed successfully")
    if split_mode in ['split', 'both']:
        print(f"Scene clips saved to: {output_dir.absolute()}")
    print('='*60)

if __name__ == '__main__':
    main()
