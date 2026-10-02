export function LegalLinks() {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <a
        className="min-h-11 self-start inline-flex items-center text-[#526780] underline underline-offset-4"
        href="https://digifender.com/"
      >
        A Digifender product
      </a>
      <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href="https://digifender.com/legal/whumpo/terms"
        >
          Draft terms
        </a>
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href="https://digifender.com/legal/whumpo/privacy"
        >
          Draft privacy policy
        </a>
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href="https://digifender.com/legal/whumpo"
        >
          More Whumpo policies
        </a>
      </nav>
    </div>
  );
}
