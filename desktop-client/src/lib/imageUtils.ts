/**
 * Resizes an image file down to fit within maxDim (longest side) and
 * re-encodes it as JPEG at the given quality, returning a data URL.
 * Keeps chat images small enough to reliably send over a WebRTC data
 * channel in a single message, even on a shaky connection.
 */
export function resizeImageToDataUrl(file: File, maxDim = 900, quality = 0.72, maxLength = 170_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }
        let currentQuality = quality;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          const encoded = canvas.toDataURL('image/jpeg', currentQuality);
          if (encoded.length <= maxLength) {
            resolve(encoded);
            return;
          }
          width = Math.max(320, Math.round(width * 0.8));
          height = Math.max(240, Math.round(height * 0.8));
          currentQuality = Math.max(0.48, currentQuality - 0.05);
        }
        reject(new Error('The image remains too large after compression.'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
