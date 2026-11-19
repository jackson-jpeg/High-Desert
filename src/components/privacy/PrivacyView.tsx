import { Crumbs } from "@/components/topics/TopicView";
import { breadcrumbJsonLd, jsonLdScript, type Crumb } from "@/lib/shows/jsonld";
import {
  PRIVACY_EFFECTIVE,
  PRIVACY_EFFECTIVE_LABEL,
  PRIVACY_INTRO,
  PRIVACY_PATH,
  PRIVACY_SECTIONS,
  PRIVACY_TITLE,
} from "@/lib/privacy/policy";

/**
 * /privacy (docs/privacy.md): the policy as server HTML in the show pages'
 * frame and class hooks, so it reads with JavaScript off. The words are in
 * src/lib/privacy/policy.ts.
 */

export const PRIVACY_CRUMBS: Crumb[] = [
  { name: "High Desert", path: "/" },
  { name: PRIVACY_TITLE, path: PRIVACY_PATH },
];

export function PrivacyView() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(PRIVACY_CRUMBS)) }} />
      <Crumbs crumbs={PRIVACY_CRUMBS} />
      <article
        className="hd-show-article hd-topic hd-privacy w98-raised-dark bg-raised-surface p-4 md:p-6"
        data-testid="privacy-policy"
      >
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">{PRIVACY_TITLE}</h1>
        <p className="hd-show-series text-hd-caption text-desert-amber mt-1">
          Effective <time dateTime={PRIVACY_EFFECTIVE}>{PRIVACY_EFFECTIVE_LABEL}</time>
        </p>
        <p className="hd-topic-intro text-hd-body text-desktop-gray mt-3">{PRIVACY_INTRO}</p>
        {PRIVACY_SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="mt-5" aria-labelledby={`privacy-${s.id}`}>
            <h2 id={`privacy-${s.id}`} className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
              {s.heading}
            </h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="text-hd-body text-desktop-gray mt-2 leading-relaxed">
                {p}
              </p>
            ))}
          </section>
        ))}
      </article>
    </>
  );
}
