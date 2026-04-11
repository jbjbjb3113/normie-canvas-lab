const FOOTER_CREDIT_LABEL = "@Trailertrsh";
const FOOTER_CREDIT_HREF = "https://x.com/trailertrsh";

export function SiteFooter() {
  return (
    <footer className="footer">
      <p>
        Unofficial fan tool — not affiliated with NORMIES, its creators, or
        any marketplace.
      </p>
      <p>
        Built by{" "}
        <a href={FOOTER_CREDIT_HREF} target="_blank" rel="noreferrer">
          {FOOTER_CREDIT_LABEL}
        </a>
        .
      </p>
    </footer>
  );
}
