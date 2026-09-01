import type { Metadata } from "next";
import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return <LegalArticle slug="terms" />;
}
