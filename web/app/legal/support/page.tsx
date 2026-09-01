import type { Metadata } from "next";
import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return <LegalArticle slug="support" />;
}
