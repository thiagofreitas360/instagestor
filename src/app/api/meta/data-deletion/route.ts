import { deleteDataBySignedRequest } from "@/server/accounts";
import { readSmallUrlEncodedForm } from "@/server/request";

export async function POST(request: Request) {
  try {
    const formData = await readSmallUrlEncodedForm(request);
    const signedRequest = formData.get("signed_request");
    if (!signedRequest) throw new Error("signed_request ausente");
    const result = await deleteDataBySignedRequest(signedRequest);
    return Response.json(
      { url: result.url, confirmation_code: result.confirmationCode },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
