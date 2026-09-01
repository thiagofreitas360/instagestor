export async function readSmallUrlEncodedForm(request: Request, maximumBytes = 65_536) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new Error("Content-Type inválido");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("Requisição muito grande");
  if (!request.body) return new URLSearchParams();

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Requisição muito grande");
    }
    chunks.push(Buffer.from(value));
  }
  return new URLSearchParams(Buffer.concat(chunks, total).toString("utf8"));
}
