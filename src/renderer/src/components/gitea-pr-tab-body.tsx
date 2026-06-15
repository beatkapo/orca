import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { GiteaIssueComments } from '@/components/gitea-issue-comments'
import { GiteaPrChecks } from '@/components/gitea-pr-checks'
import { GiteaPrFileDiff } from '@/components/gitea-pr-file-diff'
import { Button } from '@/components/ui/button'
import type {
  GiteaComment,
  GiteaPRCheck,
  GiteaPRFile,
  GiteaPRReviewComment
} from '../../../shared/types'
import type { GiteaIssueScope } from '@/store/slices/gitea'
import { translate } from '@/i18n/i18n'

type GiteaPrTabBodyProps = {
  tab: 'conversation' | 'files' | 'checks'
  body?: string
  comments: GiteaComment[]
  files: GiteaPRFile[]
  checks: GiteaPRCheck[]
  scope: GiteaIssueScope
  baseSha: string
  headSha: string
  isDark: boolean
  sideBySide: boolean
  onToggleSideBySide: () => void
  reviewComments: GiteaPRReviewComment[]
  onAddReviewComment: (path: string, line: number, body: string) => Promise<boolean>
}

export function GiteaPrTabBody({
  tab,
  body,
  comments,
  files,
  checks,
  scope,
  baseSha,
  headSha,
  isDark,
  sideBySide,
  onToggleSideBySide,
  reviewComments,
  onAddReviewComment
}: GiteaPrTabBodyProps): React.JSX.Element {
  if (tab === 'conversation') {
    return (
      <>
        <section className="border-b border-border/40 px-4 py-4">
          {body ? (
            <CommentMarkdown content={body} className="text-[14px] leading-relaxed" />
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {translate(
                'auto.components.giteaPrTabBody.noDescription',
                'No description provided.'
              )}
            </p>
          )}
        </section>
        <GiteaIssueComments comments={comments} />
      </>
    )
  }
  if (tab === 'files') {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-end">
          <Button variant="outline" size="xs" onClick={onToggleSideBySide}>
            {sideBySide
              ? translate('auto.components.giteaPrTabBody.inline', 'Inline')
              : translate('auto.components.giteaPrTabBody.sideBySide', 'Side by side')}
          </Button>
        </div>
        {files.length === 0 ? (
          <p className="px-1 py-6 text-sm text-muted-foreground">
            {translate('auto.components.giteaPrTabBody.noFiles', 'No changed files.')}
          </p>
        ) : (
          files.map((file) => (
            <GiteaPrFileDiff
              key={file.path}
              file={file}
              scope={scope}
              baseSha={baseSha}
              headSha={headSha}
              isDark={isDark}
              sideBySide={sideBySide}
              reviewComments={reviewComments.filter((c) => c.path === file.path)}
              onAddReviewComment={onAddReviewComment}
            />
          ))
        )}
      </div>
    )
  }
  return <GiteaPrChecks checks={checks} />
}
