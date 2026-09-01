import { deauthorizeBySignedRequest } from "@/server/accounts";
import { readSmallUrlEncodedForm } from "@/server/request";

export async function POST(request: Request) {
  try {
    const formData = await readSmallUrlEncodedForm(request);
    const signedRequest = formData.get("signed_request");
    if (!signedRequest) throw new Error("signed_request ausente");
    await deauthorizeBySignedRequest(signedRequest);
    return Response.json({ success: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ success: false }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
