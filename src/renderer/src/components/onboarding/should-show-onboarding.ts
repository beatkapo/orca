import type { OnboardingState } from '../../../../shared/types'

// Why: split out so App.tsx can gate the lazy <OnboardingFlow> without an
// eager static import path that pulls the whole flow into the main chunk.
export function shouldShowOnboarding(onboarding: OnboardingState | null): boolean {
  if (onboarding === null) {
    return false
  }
  if (onboarding.closedAt !== null) {
    return false
  }
  // Why: PR #1677 made the repo step unskippable. The persistence migration
  // marks in-flight rows from the previous soft-skip build as
  // legacySoftSkipEligible so we can auto-suppress the wizard for them
  // rather than trapping them on the now-unskippable gate. App.tsx
  // separately persists closedAt for these users so the suppression sticks.
  if (onboarding.legacySoftSkipEligible === true) {
    return false
  }
  return true
}
