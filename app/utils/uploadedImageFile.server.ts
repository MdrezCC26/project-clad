/** Read an image upload from multipart FormData (Node File/Blob — not always `instanceof File`). */
export async function readFormUploadedImage(
  formData: FormData,
  fieldName: string,
): Promise<{ buffer: Buffer; name: string; size: number } | null> {
  const entry = formData.get(fieldName);
  if (!entry || typeof entry !== "object") return null;

  const fileLike = entry as {
    size?: number;
    name?: string;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };

  if (typeof fileLike.arrayBuffer !== "function") return null;

  const size = typeof fileLike.size === "number" ? fileLike.size : 0;
  if (size <= 0) return null;

  const buffer = Buffer.from(await fileLike.arrayBuffer());
  if (buffer.length === 0) return null;

  return {
    buffer,
    name: typeof fileLike.name === "string" ? fileLike.name : "photo.jpg",
    size,
  };
}
