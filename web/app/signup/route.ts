import { redirectToAuthKit } from "@/lib/auth/start-authkit";

export async function GET(request: Request) {
  return redirectToAuthKit(request, "sign-up");
}
