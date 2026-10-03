import { handleStripeWebhookRequest } from "@/lib/billing/webhook";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleStripeWebhookRequest(request);
}
