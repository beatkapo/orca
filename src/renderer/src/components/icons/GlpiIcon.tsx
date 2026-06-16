// Why: GLPI ships only a branded multi-color logo. To match Orca's monochrome
// provider icons (JiraIcon/LinearIcon), render a clean lifebuoy/ticket glyph in
// `currentColor` so callers pick size/color, avoiding trademark complexity.
export function GlpiIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 .75a11.25 11.25 0 1 0 0 22.5 11.25 11.25 0 0 0 0-22.5Zm0 2.5a8.75 8.75 0 0 1 6.187 14.937l-2.652-2.652a5 5 0 0 0 0-7.07L18.187 5.81A8.72 8.72 0 0 1 12 3.25Zm0 6.25a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM5.813 5.813l2.652 2.652a5 5 0 0 0 0 7.07l-2.652 2.652a8.75 8.75 0 0 1 0-12.374Zm12.374 12.374A8.72 8.72 0 0 1 12 20.75a8.72 8.72 0 0 1-6.187-2.563l2.652-2.652a5 5 0 0 0 7.07 0l2.652 2.652Z" />
    </svg>
  )
}
