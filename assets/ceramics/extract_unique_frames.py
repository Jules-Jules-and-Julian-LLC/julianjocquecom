#!/usr/bin/env python3
"""Extract unique frames from a slideshow video."""

import cv2
import numpy as np
from pathlib import Path

def frames_are_similar(frame1, frame2, threshold=0.95):
    """Compare two frames using normalized correlation."""
    if frame1 is None or frame2 is None:
        return False
    # Resize for faster comparison
    small1 = cv2.resize(frame1, (64, 64))
    small2 = cv2.resize(frame2, (64, 64))
    # Convert to grayscale
    gray1 = cv2.cvtColor(small1, cv2.COLOR_BGR2GRAY).flatten()
    gray2 = cv2.cvtColor(small2, cv2.COLOR_BGR2GRAY).flatten()
    # Normalized correlation
    correlation = np.corrcoef(gray1, gray2)[0, 1]
    return correlation > threshold

def extract_unique_frames(video_path, output_dir=None, similarity_threshold=0.95):
    """Extract unique frames from video."""
    video_path = Path(video_path)
    if output_dir is None:
        output_dir = video_path.parent
    output_dir = Path(output_dir)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"Error: Could not open {video_path}")
        return

    unique_frames = []
    frame_count = 0
    saved_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1

        # Check if this frame is similar to any saved frame
        is_duplicate = False
        for saved_frame in unique_frames:
            if frames_are_similar(frame, saved_frame, similarity_threshold):
                is_duplicate = True
                break

        if not is_duplicate:
            saved_count += 1
            unique_frames.append(frame.copy())
            output_path = output_dir / f"slideshow_frame_{saved_count:02d}.webp"
            cv2.imwrite(str(output_path), frame, [cv2.IMWRITE_WEBP_QUALITY, 90])
            print(f"Saved frame {saved_count}: {output_path.name}")

    cap.release()
    print(f"\nProcessed {frame_count} frames, saved {saved_count} unique frames")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        # Default to the slideshow video in this directory
        video = Path(__file__).parent / "julianjocque posts 2023-04-05 12.23 CqqaSlWJLK7iMLTh7EC-3PWIytQmSWZtrtaLCc0_1_1 AQO8rn2NJ2zBrtAoy9S_6sDlrDSDX8pL2BI8GWTmgEiKrcTepdgpxClYm9MTB9XzEtn-sCNUTnCVrs1FQ-DmsaernqD9z79AYVgTdPk.mp4"
    else:
        video = sys.argv[1]

    extract_unique_frames(video)
