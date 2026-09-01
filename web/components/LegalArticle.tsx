import type { ReactNode } from "react";
import { LEGAL_DOCS, LEGAL_NAV, type LegalSlug } from "@/lib/legal";

export function LegalArticle({ slug }: { slug: LegalSlug }) {
  const doc = LEGAL_DOCS[slug];
  return (
    <article className="paper legal-sheet">
      <h1>{doc.headline}</h1>
      {doc.sections.map((section, index) => (
        <section key={`${doc.slug}-${index}`}>
          {section.heading ? <h2>{section.heading}</h2> : null}
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{linkify(paragraph)}</p>
          ))}
          {section.bullets ? (
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{linkify(bullet)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      {slug === "index" ? (
        <ul>
          {LEGAL_NAV.filter((item) => item.href !== "/legal").map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function linkify(text: string): ReactNode {
  const parts = text.split(/(support@floks-pc\.com|\/setup)/g);
  return parts.map((part, index) => {
    if (part === "support@floks-pc.com") {
      return (
        <a key={`${part}-${index}`} href="mailto:support@floks-pc.com">
          {part}
        </a>
      );
    }
    if (part === "/setup") {
      return (
        <a key={`${part}-${index}`} href="/setup">
          /setup
        </a>
      );
    }
    return part;
  });
}
