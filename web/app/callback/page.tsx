import type { Metadata } from "next";
import { CallbackFlash } from "@/components/CallbackFlash";

export const metadata: Metadata = {
  title: "Signing you in",
  robots: { index: false, follow: false },
};

export default function CallbackPage() {
  return <CallbackFlash />;
}
