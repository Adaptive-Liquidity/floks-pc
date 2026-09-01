import type { Metadata } from "next";
import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = { title: "Cancellation" };

export default function CancellationPage() {
  return <LegalArticle slug="cancellation" />;
}
