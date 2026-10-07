import { PlanGrid } from "@/components/studio/PlanGrid";

export function PayPills({ email }: { email?: string | null }) {
  return <PlanGrid email={email ?? null} signedIn={Boolean(email)} />;
}
