#!/usr/bin/env python3
"""
Folder Cleaning Tool
Remove duplicate videos and/or rename files by modification date.
"""

import os
import sys
import argparse
import hashlib
from pathlib import Path
from datetime import datetime
from collections import defaultdict

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
    """Get all video files in the specified folder, sorted alphabetically."""
    folder = Path(folder_path)
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist.")
        return []

    video_files = [f for f in folder.iterdir()
                   if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
    return sorted(video_files, key=lambda x: x.name.lower())

def compute_file_hash(file_path, chunk_size=8192):
    """Compute MD5 hash of a file."""
    hasher = hashlib.md5()
    try:
        with open(file_path, 'rb') as f:
            while chunk := f.read(chunk_size):
                hasher.update(chunk)
        return hasher.hexdigest()
    except Exception as e:
        print(f"  Warning: Could not hash {file_path.name}: {e}")
        return None

def find_duplicates(video_files):
    """Find duplicate videos by content hash."""
    print("\nScanning for duplicates...")

    hash_to_files = defaultdict(list)

    for i, video_file in enumerate(video_files, 1):
        print(f"  Hashing: {video_file.name} ({i}/{len(video_files)})", end='\r')
        file_hash = compute_file_hash(video_file)
        if file_hash:
            hash_to_files[file_hash].append(video_file)

    print()  # New line after progress

    # Find groups with duplicates
    duplicates = {h: files for h, files in hash_to_files.items() if len(files) > 1}

    return duplicates

def remove_duplicates(folder_path):
    """Find and remove duplicate videos, keeping first alphabetically."""
    video_files = get_video_files(folder_path)

    if not video_files:
        print(f"No video files found in '{folder_path}'")
        return 0

    print(f"\nProcessing {len(video_files)} video(s) in '{folder_path}'")

    duplicates = find_duplicates(video_files)

    if not duplicates:
        print("\n✓ No duplicates found")
        return 0

    # Show duplicates and remove
    total_removed = 0
    total_freed = 0

    print(f"\nFound {len(duplicates)} group(s) of duplicates:\n")

    for i, (file_hash, files) in enumerate(duplicates.items(), 1):
        # Sort alphabetically to determine which to keep
        sorted_files = sorted(files, key=lambda x: x.name.lower())
        keep_file = sorted_files[0]
        remove_files = sorted_files[1:]

        print(f"Group {i}:")
        print(f"  Keeping: {keep_file.name}")
        print(f"  Removing:")

        for dup_file in remove_files:
            file_size = dup_file.stat().st_size
            try:
                dup_file.unlink()
                print(f"    ✓ {dup_file.name} ({file_size / 1024 / 1024:.2f} MB)")
                total_removed += 1
                total_freed += file_size
            except Exception as e:
                print(f"    ✗ {dup_file.name} - Error: {e}")
        print()

    print(f"{'='*60}")
    print(f"Removed {total_removed} duplicate file(s)")
    print(f"Freed {total_freed / 1024 / 1024:.2f} MB")
    print('='*60)

    return total_removed

def rename_by_date(folder_path, add_number=False):
    """Rename video files based on last modified date."""
    video_files = get_video_files(folder_path)

    if not video_files:
        print(f"No video files found in '{folder_path}'")
        return 0

    print(f"\nRenaming {len(video_files)} video(s) in '{folder_path}'")
    if add_number:
        print(f"Format: NNN_YYYY-MM-DD_HH-MM-SS.ext\n")
    else:
        print(f"Format: YYYY-MM-DD_HH-MM-SS.ext\n")

    renamed_count = 0
    skipped_count = 0

    # Calculate number of digits needed for numbering
    num_digits = len(str(len(video_files)))

    for i, video_file in enumerate(video_files, 1):
        # Get last modified time
        mtime = video_file.stat().st_mtime
        dt = datetime.fromtimestamp(mtime)

        # Format: 2024-01-15_14-30-45
        date_str = dt.strftime("%Y-%m-%d_%H-%M-%S")

        # Add number prefix if requested
        if add_number:
            number_prefix = f"{i:0{num_digits}d}_"
            new_name = f"{number_prefix}{date_str}{video_file.suffix}"
        else:
            new_name = f"{date_str}{video_file.suffix}"

        new_path = video_file.parent / new_name

        # Handle conflicts - add counter if file exists
        counter = 1
        while new_path.exists() and new_path != video_file:
            new_name = f"{date_str}_{counter:02d}{video_file.suffix}"
            new_path = video_file.parent / new_name
            counter += 1

        # Skip if name is already correct
        if new_path == video_file:
            print(f"  ⊘ {video_file.name} (already named correctly)")
            skipped_count += 1
            continue

        try:
            video_file.rename(new_path)
            print(f"  ✓ {video_file.name} → {new_name}")
            renamed_count += 1
        except Exception as e:
            print(f"  ✗ {video_file.name} - Error: {e}")

    print(f"\n{'='*60}")
    print(f"Renamed {renamed_count} file(s)")
    if skipped_count > 0:
        print(f"Skipped {skipped_count} file(s) (already named correctly)")
    print('='*60)

    return renamed_count

def get_operation_mode():
    """Prompt user for operation mode."""
    print("\nClean Folder Options:")
    print("  1. Remove duplicates only")
    print("  2. Rename by date only")
    print("  3. Both - remove duplicates, then rename remaining files")

    while True:
        choice = input("\nSelect operation (1-3): ").strip()
        if choice in ['1', '2', '3']:
            return choice
        print("Invalid choice. Please enter 1, 2, or 3.")

def process_folder(folder_path, operation_mode, add_number=False):
    """Process a folder based on operation mode."""
    print(f"\n{'='*60}")
    print(f"Processing: {folder_path}")
    print('='*60)

    if operation_mode == '1':
        # Duplicates only
        remove_duplicates(folder_path)
    elif operation_mode == '2':
        # Rename only
        rename_by_date(folder_path, add_number)
    elif operation_mode == '3':
        # Both
        removed = remove_duplicates(folder_path)
        if removed > 0:
            print("\nNow renaming remaining files...\n")
        rename_by_date(folder_path, add_number)

def main():
    parser = argparse.ArgumentParser(
        description='Clean video folders: remove duplicates and/or rename by date.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s folder1
  %(prog)s folder1 folder2 folder3
  %(prog)s /path/to/videos

Operations:
  - Remove duplicates: Keeps first file alphabetically when duplicates found
  - Rename by date: Renames to YYYY-MM-DD_HH-MM-SS.ext format using last modified date

Note: Folder names without '/' are looked up in 'src/' first
        '''
    )

    parser.add_argument('folders', nargs='+',
                        help='One or more folders to clean')
    parser.add_argument('-m', '--mode', choices=['1', '2', '3'],
                        help='Operation mode: 1=duplicates, 2=rename, 3=both (skips prompt)')
    parser.add_argument('-n', '--number', action='store_true',
                        help='Add sequential number prefix when renaming (001_, 002_, etc.)')

    args = parser.parse_args()

    print("=" * 60)
    print("Folder Cleaning Tool")
    print("=" * 60)
    print(f"Note: Folder names without '/' are looked up in '{SRC_FOLDER}/' first\n")

    # Get operation mode
    if args.mode:
        operation_mode = args.mode
        mode_names = {'1': 'Remove duplicates', '2': 'Rename by date', '3': 'Both'}
        print(f"Mode: {mode_names[operation_mode]}\n")
    else:
        operation_mode = get_operation_mode()

    # Process each folder
    for folder in args.folders:
        resolved_folder = resolve_folder_path(folder)
        process_folder(str(resolved_folder), operation_mode, args.number)

    print(f"\n{'='*60}")
    print("All done!")
    print('='*60)

if __name__ == '__main__':
    main()
