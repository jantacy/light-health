// 在浏览器里把照片缩到最长边 1600px 并转成 JPEG：
// iPhone 的 HEIC 由 Safari 原生解码，上传体积也能压到 Vercel 4.5MB 请求限制以内。
export async function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("无法读取这张图片，请换一张试试。"));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("图片压缩失败，请换一张试试。");
    return new File([blob], "meal.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
