#!/bin/bash
echo "🔄 Converting uploaded images to WebP and replacing originals..."

find static/uploads -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | while read img; do
  webp_file="${img%.*}.webp"
  echo "Creating WebP: $webp_file"
  cwebp -quiet -q 85 "$img" -o "$webp_file"
  
  # Replace original file with WebP version (same name)
  cp "$webp_file" "$img"
done