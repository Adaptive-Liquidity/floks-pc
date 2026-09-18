import { PlanGrid } from "@/components/studio/PlanGrid";

export function PayPills({ email }: { email?: string | null }) {
  return <PlanGrid email={email} signedIn={Boolean(email)} />;
}
