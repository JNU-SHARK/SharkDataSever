from PIL import Image
import os

file_path = 'png_max.png'
target_size = 3 * 1024  # 3KB

def compress_smart(path, target_bytes):
    if not os.path.exists(path):
        print(f"Error: {path} not found.")
        return

    img = Image.open(path)
    original_size = img.size
    print(f"Original Size: {original_size}, Mode: {img.mode}")

    # Strategy 1: Convert to 1-bit (Monochrome) with Threshold
    # This is best for line drawings (white lines on black bg)
    
    # Convert to grayscale first
    img_gray = img.convert('L')
    
    # Thresholding to create binary image (adjust threshold as needed, 128 is standard)
    threshold = 128
    img_1bit = img_gray.point(lambda x: 255 if x > threshold else 0, '1')
    
    # Save and check size
    temp_path = 'png_max_1bit.png'
    img_1bit.save(temp_path, format='PNG', optimize=True)
    size = os.path.getsize(temp_path)
    print(f"1-bit Mode (Original Res): {original_size}, Size: {size} bytes")
    
    if size < target_bytes:
        print(f"Success! 1-bit mode achieved target size with original resolution.")
        os.replace(temp_path, path)
        return

    # Strategy 2: If 1-bit at full res is still too big, resize while keeping 1-bit
    print("1-bit full res is too big, trying to resize in 1-bit mode...")
    
    width, height = original_size
    # Try reducing scale
    for scale in [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.33, 0.25]:
        new_width = int(width * scale)
        new_height = int(height * scale)
        
        # Resize the grayscale image first (better quality) then threshold
        resized_gray = img_gray.resize((new_width, new_height), Image.Resampling.LANCZOS)
        resized_1bit = resized_gray.point(lambda x: 255 if x > threshold else 0, '1')
        
        resized_1bit.save(temp_path, format='PNG', optimize=True)
        size = os.path.getsize(temp_path)
        print(f"Scale: {scale}, Size: {new_width}x{new_height}, File Size: {size} bytes")
        
        if size < target_bytes:
            print(f"Success! Saved to {path}")
            os.replace(temp_path, path)
            return
            
    print("Could not compress to under 3KB even with resizing.")

if __name__ == "__main__":
    compress_smart(file_path, target_size)
