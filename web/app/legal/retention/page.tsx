import type { Metadata } from "next";
import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = { title: "Data retention" };

export default function RetentionPage() {
  return <LegalArticle slug="retention" />;
}
