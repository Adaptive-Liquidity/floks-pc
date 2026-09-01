import type { Metadata } from "next";
import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = {
  title: "FLOKS policies",
};

export default function LegalIndexPage() {
  return <LegalArticle slug="index" />;
}
