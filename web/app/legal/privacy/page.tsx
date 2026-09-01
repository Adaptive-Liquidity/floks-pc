import type { Metadata } from "next";
import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return <LegalArticle slug="privacy" />;
}
