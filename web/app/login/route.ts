import { authKitScreenHint } from "@/lib/auth/workos";
import { redirectToAuthKit } from "@/lib/auth/start-authkit";

export async function GET(request: Request) {
  const screen = new URL(request.url).searchParams.get("screen");
  return redirectToAuthKit(request, authKitScreenHint(screen));
}
