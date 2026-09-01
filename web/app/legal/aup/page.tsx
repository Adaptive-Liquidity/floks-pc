import type { Metadata } from "next";
import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = { title: "Acceptable Use" };

export default function AupPage() {
  return <LegalArticle slug="aup" />;
}
