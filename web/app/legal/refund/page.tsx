import type { Metadata } from "next";
import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = { title: "Refund" };

export default function RefundPage() {
  return <LegalArticle slug="refund" />;
}
