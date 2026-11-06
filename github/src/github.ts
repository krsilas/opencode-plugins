import type { Client } from "./api"
import {
	HIDE_REASONS,
	type MergeableState,
	type ReviewDecision,
	type ReviewState,
	type Author,
	type Check,
	type CheckState,
	type Comment,
	type CommentAction,
	type CommentKind,
	type Commit,
	type CreateOptions,
	type Pull,
	type PullItem,
	type PullList,
	type PullState,
	type PullSummary,
	type Review,
	type Reviewer,
	type Thread,
	type Viewer,
} from "./types.ts"

type Nodes<T> = { nodes?: readonly (T | null)[] | null }
type Counted<T> = Nodes<T> & { totalCount?: number | null }

const nodes = <T>(connection: Nodes<T> | null | undefined): T[] =>
	(connection?.nodes ?? []).filter((node): node is T => node != null)

type RawAuthor = {
	__typename?: string | null
	login?: string | null
	name?: string | null
	avatarUrl?: string | null
}

type RawViewer = {
	viewerCanUpdate?: boolean | null
	viewerCanDelete?: boolean | null
	viewerCanMinimize?: boolean | null
}

type RawComment = RawViewer & {
	id: string
	body?: string | null
	bodyHTML?: string | null
	createdAt: string
	url: string
	isMinimized?: boolean | null
	minimizedReason?: string | null
	diffHunk?: string | null
	author?: RawAuthor | null
}

type RawCheckNode = {
	__typename?: string | null
	name?: string | null
	status?: string | null
	conclusion?: string | null
	detailsUrl?: string | null
	checkSuite?: { workflowRun?: { workflow?: { name?: string | null } | null } | null } | null
	context?: string | null
	state?: string | null
	targetUrl?: string | null
	description?: string | null
}

type RawRollup = { state?: string | null; contexts?: Nodes<RawCheckNode> | null }
type RawCommitStatus = { commit?: { statusCheckRollup?: RawRollup | null } | null }

type RawCommitNode = {
	commit: {
		oid: string
		abbreviatedOid: string
		messageHeadline: string
		messageBody?: string | null
		committedDate: string
		url: string
		author?: { name?: string | null; user?: RawAuthor | null } | null
		parents?: Nodes<{ oid: string }> | null
		statusCheckRollup?: RawRollup | null
		signature?: { isValid?: boolean | null } | null
	}
}

type RawRequestedReviewer = RawAuthor & { slug?: string | null }
type RawLatestReview = { state: ReviewState; author?: RawAuthor | null }

type RawReview = RawLatestReview & {
	id: string
	body?: string | null
	bodyHTML?: string | null
	submittedAt?: string | null
	url: string
	viewerCanUpdate?: boolean | null
}

type RawThread = {
	id: string
	isResolved: boolean
	isOutdated: boolean
	path: string
	line?: number | null
	startLine?: number | null
	originalLine?: number | null
	originalStartLine?: number | null
	comments?: Nodes<RawComment> | null
}

type RawLabel = { name: string; color: string; description?: string | null }

export type RawItem = {
	number?: number
	title?: string
	url?: string
	state?: string
	isDraft?: boolean | null
	merged?: boolean | null
	createdAt?: string
	updatedAt?: string
	headRefName?: string
	baseRefName?: string
	reviewDecision?: ReviewDecision | null
	additions?: number | null
	deletions?: number | null
	author?: RawAuthor | null
	headRepositoryOwner?: { login: string } | null
	comments?: { totalCount?: number | null } | null
	commits?: Nodes<RawCommitStatus> | null
}

export interface RawPull extends Omit<RawItem, "comments"> {
	id: string
	number: number
	title: string
	body?: string | null
	bodyHTML?: string | null
	url: string
	state: string
	baseRefName: string
	headRefName: string
	headRefOid: string
	createdAt: string
	updatedAt: string
	additions: number
	deletions: number
	changedFiles: number
	mergeable?: MergeableState | null
	viewerCanUpdate?: boolean | null
	viewerDidAuthor?: boolean | null
	labels?: Nodes<RawLabel> | null
	viewerLatestReview?: { state?: string | null } | null
	reviewRequests?: Nodes<{ requestedReviewer?: RawRequestedReviewer | null }> | null
	latestReviews?: Nodes<RawLatestReview> | null
	commits?: Counted<RawCommitNode> | null
	head?: Nodes<RawCommitStatus> | null
	comments?: Nodes<RawComment> | null
	reviews?: Nodes<RawReview> | null
	reviewThreads?: Nodes<RawThread> | null
}

type RawSearchList = Nodes<RawItem> & { issueCount?: number | null }
type RawRepository = { url: string; defaultBranchRef?: { name: string } | null }
type RawQueryViewer = { viewer?: { login: string } | null }

export type PullQueryData = {
	repository?: (RawRepository & { pullRequests?: Nodes<RawPull> | null }) | null
}

export type PullNumberQueryData = {
	repository?: (RawRepository & { pullRequest?: RawPull | null }) | null
}

export type OptionsQueryData = RawQueryViewer & {
	repository?: {
		refs?: Nodes<{ name: string }> | null
		labels?: Nodes<RawLabel> | null
		assignableUsers?: Nodes<RawAuthor> | null
	} | null
}

export type RepoQueryData = RawQueryViewer & {
	repository?: { url: string; nameWithOwner: string } | null
}

export type ListQueryData = { list?: RawSearchList | null }

export type NumberQueryData = RawQueryViewer & {
	repository?: { pullRequest?: RawItem | null } | null
}

export type MineQueryData = { mineOpen?: RawSearchList | null; mineClosed?: RawSearchList | null }

type MergeQueryData = {
	repository?: {
		mergeCommitAllowed?: boolean | null
		squashMergeAllowed?: boolean | null
		rebaseMergeAllowed?: boolean | null
	} | null
}

const AUTHOR = `author { __typename login avatarUrl }`

const VIEWER = `viewerCanUpdate viewerCanDelete viewerCanMinimize`

const COMMENT = `id body bodyHTML createdAt url isMinimized minimizedReason ${VIEWER} ${AUTHOR}`

const PULL = `
  id number title body bodyHTML url state isDraft merged
  baseRefName headRefName headRefOid createdAt updatedAt additions deletions changedFiles
  reviewDecision mergeable viewerCanUpdate viewerDidAuthor
  headRepositoryOwner { login }
  labels(first: 50) { nodes { name color description } }
  viewerLatestReview { state }
  reviewRequests(first: 20) {
    nodes { requestedReviewer { __typename ... on User { login name avatarUrl } ... on Team { slug name avatarUrl } } }
  }
  latestReviews(first: 20) { nodes { state author { __typename login avatarUrl ... on User { name } } } }
  ${AUTHOR}
  commits(last: 100) {
    totalCount
    nodes {
      commit {
        oid abbreviatedOid messageHeadline messageBody committedDate url
        author { name user { login avatarUrl } }
        parents(first: 4) { nodes { oid } }
        statusCheckRollup { state }
        signature { isValid }
      }
    }
  }
  head: commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun {
                name status conclusion detailsUrl
                checkSuite { workflowRun { workflow { name } } }
              }
              ... on StatusContext { context state targetUrl description }
            }
          }
        }
      }
    }
  }
  comments(first: 100) { nodes { ${COMMENT} } }
  reviews(first: 50) { nodes { id state body bodyHTML submittedAt url viewerCanUpdate ${AUTHOR} } }
  reviewThreads(first: 100) {
    nodes {
      id isResolved isOutdated path line startLine originalLine originalStartLine
      comments(first: 50) { nodes { ${COMMENT} diffHunk } }
    }
  }
`

export const PULL_QUERY = `
  query ($owner: String!, $name: String!, $head: String!) {
    repository(owner: $owner, name: $name) {
      url
      defaultBranchRef { name }
      pullRequests(headRefName: $head, first: 10, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes { ${PULL} }
      }
    }
  }
`

export const OPTIONS_QUERY = `
  query ($owner: String!, $name: String!) {
    viewer { login }
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/heads/", first: 100, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { nodes { name } }
      labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color description } }
      assignableUsers(first: 100) { nodes { __typename login name avatarUrl } }
    }
  }
`

export const options = (raw: OptionsQueryData): CreateOptions => {
	const viewerLogin = raw.viewer?.login
	const repository = raw.repository

	return {
		branches: nodes(repository?.refs).map((node) => node.name),
		labels: nodes(repository?.labels).map((node) => ({
			name: node.name,
			color: node.color,
			description: node.description ?? undefined,
		})),
		reviewers: nodes(repository?.assignableUsers)
			.filter((node) => node.login !== viewerLogin)
			.map(author),
	}
}

export const PULL_NUMBER_QUERY = `
  query ($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      url
      defaultBranchRef { name }
      pullRequest(number: $number) { ${PULL} }
    }
  }
`

const ITEM = `
  fragment Item on PullRequest {
    number title url state isDraft merged createdAt updatedAt
    headRefName baseRefName reviewDecision additions deletions
    author { __typename login avatarUrl }
    headRepositoryOwner { login }
    comments { totalCount }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }
`

export const REPO_QUERY = `
  query ($owner: String!, $name: String!) {
    viewer { login }
    repository(owner: $owner, name: $name) { url nameWithOwner }
  }
`

export const LIST_QUERY = `
  query ($search: String!) {
    list: search(query: $search, type: ISSUE, first: 50) { issueCount nodes { ...Item } }
  }
  ${ITEM}
`

export const NUMBER_QUERY = `
  query ($owner: String!, $name: String!, $number: Int!) {
    viewer { login }
    repository(owner: $owner, name: $name) { pullRequest(number: $number) { ...Item } }
  }
  ${ITEM}
`

export const MINE_QUERY = `
  query ($mineOpen: String!, $mineClosed: String!) {
    mineOpen: search(query: $mineOpen, type: ISSUE, first: 50) { issueCount nodes { ...Item } }
    mineClosed: search(query: $mineClosed, type: ISSUE, first: 30) { issueCount nodes { ...Item } }
  }
  ${ITEM}
`

const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export const listQueries = (owner: string, name: string, search = "", now = Date.now()) => {
	const repo = `repo:${owner}/${name} is:pr sort:updated-desc`
	const since = new Date(now - RECENT_WINDOW_MS).toISOString().slice(0, 10)
	const text = search.trim().replace(/^#(?=\d+$)/, "")

	return {
		mineOpen: `${repo} author:@me is:open ${text || `updated:>=${since}`}`,
		mineClosed: `${repo} author:@me is:closed ${text || `closed:>=${since}`}`,
		open: `${repo} is:open ${text || `involves:@me updated:>=${since}`}`,
		merged: `${repo} is:merged ${text || `involves:@me updated:>=${since}`}`,
	}
}

export const item = (raw: RawItem): PullItem => ({
	number: raw.number ?? 0,
	title: raw.title ?? "",
	url: raw.url ?? "",
	state: state(raw),
	author: author(raw.author),
	head: raw.headRefName ?? "",
	base: raw.baseRefName ?? "",
	headOwner: raw.headRepositoryOwner?.login ?? undefined,
	created: raw.createdAt ?? "",
	updated: raw.updatedAt ?? "",
	review: raw.reviewDecision ?? undefined,
	checks: rollup(nodes(raw.commits)[0]?.commit?.statusCheckRollup?.state ?? undefined),
	comments: raw.comments?.totalCount ?? 0,
	additions: raw.additions ?? 0,
	deletions: raw.deletions ?? 0,
})

export const items = (result: RawSearchList | null | undefined): Omit<PullList, "open"> => ({
	total: result?.issueCount ?? 0,
	items: nodes(result).flatMap((node) => (node.headRefName !== undefined ? [item(node)] : [])),
})

const author = (raw: RawAuthor | null | undefined): Author => ({
	login: raw?.login ?? "ghost",
	name: raw?.name || undefined,
	avatar: raw?.avatarUrl ?? undefined,
	bot: raw?.__typename === "Bot" || undefined,
})

const viewer = (raw: RawViewer): Viewer => ({
	update: !!raw.viewerCanUpdate,
	delete: !!raw.viewerCanDelete,
	minimize: !!raw.viewerCanMinimize,
})

const comment = (raw: RawComment, kind: CommentKind): Comment => ({
	id: raw.id,
	kind,
	viewer: viewer(raw),
	minimized: raw.isMinimized
		? String(raw.minimizedReason ?? "hidden")
				.toLowerCase()
				.replace(/-/g, "_")
		: undefined,
	body: raw.body ?? "",
	html: raw.bodyHTML ?? "",
	author: author(raw.author),
	date: raw.createdAt,
	url: raw.url,
})

const rollup = (value: string | undefined): CheckState | undefined => {
	if (!value) return undefined

	if (value === "SUCCESS") return "success"

	if (value === "FAILURE" || value === "ERROR") return "failure"

	if (value === "PENDING" || value === "EXPECTED") return "pending"

	return "neutral"
}

const run = (raw: RawCheckNode): CheckState => {
	if (raw.status !== "COMPLETED") return "pending"

	if (raw.conclusion === "SUCCESS") return "success"

	if (
		raw.conclusion &&
		["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(raw.conclusion)
	)
		return "failure"

	return "neutral"
}

const check = (raw: RawCheckNode): Check =>
	raw.__typename === "CheckRun"
		? {
				name: raw.name ?? "",
				workflow: raw.checkSuite?.workflowRun?.workflow?.name ?? undefined,
				state: run(raw),
				url: raw.detailsUrl ?? undefined,
			}
		: {
				name: raw.context ?? "",
				state: rollup(raw.state ?? undefined) ?? "neutral",
				url: raw.targetUrl ?? undefined,
				description: raw.description ?? undefined,
			}

const ORDER: Record<CheckState, number> = { failure: 0, pending: 1, success: 2, neutral: 3 }

const state = (raw: { merged?: boolean | null; state?: string; isDraft?: boolean | null }): PullState => {
	if (raw.merged) return "merged"

	if (raw.state === "CLOSED") return "closed"

	return raw.isDraft ? "draft" : "open"
}

const reviewers = (raw: RawPull): Reviewer[] => {
	const requested: Reviewer[] = nodes(raw.reviewRequests).flatMap((node): Reviewer[] => {
		const who = node.requestedReviewer

		if (!who) return []

		if (who.__typename === "Team")
			return [
				{
					author: { login: who.slug ?? "", name: who.name ?? undefined, avatar: who.avatarUrl ?? undefined },
					state: "REQUESTED" as const,
					team: true,
				},
			]

		return [{ author: author(who), state: "REQUESTED" as const }]
	})

	const reviewed: Reviewer[] = nodes(raw.latestReviews).flatMap((node) => {
		if (node.state === "PENDING") return []

		return [{ author: author(node.author), state: node.state }]
	})

	const pending = new Set(requested.map((entry) => entry.author.login))

	return [...requested, ...reviewed.filter((entry) => !pending.has(entry.author.login))]
}

export const pull = (raw: RawPull): Pull => {
	const commits: Commit[] = nodes(raw.commits).map((entry) => {
		const node = entry.commit

		return {
			oid: node.oid,
			short: node.abbreviatedOid,
			headline: node.messageHeadline,
			body: node.messageBody ?? "",
			date: node.committedDate,
			url: node.url,
			author: node.author?.user
				? author(node.author.user)
				: { login: node.author?.name ?? "unknown", avatar: undefined },
			parents: nodes(node.parents).map((parent) => parent.oid),
			checks: rollup(node.statusCheckRollup?.state ?? undefined),
			verified: !!node.signature?.isValid,
		}
	})

	const head = nodes(raw.head)[0]?.commit?.statusCheckRollup

	const checks = nodes(head?.contexts)
		.filter((node) => node.__typename === "CheckRun" || node.__typename === "StatusContext")
		.map(check)
		.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name))

	const comments: Comment[] = nodes(raw.comments).map((node) => comment(node, "issue"))

	const reviews: Review[] = nodes(raw.reviews).flatMap((review) => {
		if (review.state === "PENDING") return []

		return [
			{
				id: review.id,
				kind: "review" as const,
				viewer: { update: !!review.viewerCanUpdate, delete: false, minimize: false },
				state: review.state,
				body: review.body ?? "",
				html: review.bodyHTML ?? "",
				author: author(review.author),
				date: review.submittedAt ?? "",
				url: review.url,
			},
		]
	})

	const threads: Thread[] = nodes(raw.reviewThreads).flatMap((thread) => {
		const rawComments = nodes(thread.comments)
		const threadComments = rawComments.map((node) => comment(node, "review-comment"))

		if (threadComments.length === 0) return []

		return [
			{
				id: thread.id,
				resolved: thread.isResolved,
				outdated: thread.isOutdated,
				path: thread.path,
				line: thread.line ?? thread.originalLine ?? undefined,
				startLine: thread.startLine ?? thread.originalStartLine ?? undefined,
				hunk: rawComments[0]?.diffHunk ?? undefined,
				comments: threadComments,
			},
		]
	})

	const threadComments = threads.reduce((sum, thread) => sum + thread.comments.length, 0)

	return {
		id: raw.id,
		number: raw.number,
		title: raw.title,
		body: raw.body ?? "",
		html: raw.bodyHTML ?? "",
		url: raw.url,
		viewer: { update: !!raw.viewerCanUpdate, delete: false, minimize: false },
		state: state(raw),
		base: raw.baseRefName,
		head: raw.headRefName,
		author: author(raw.author),
		created: raw.createdAt,
		updated: raw.updatedAt,
		additions: raw.additions,
		deletions: raw.deletions,
		files: raw.changedFiles,
		review: raw.reviewDecision ?? undefined,
		reviewers: reviewers(raw),
		approval:
			raw.viewerLatestReview?.state === "APPROVED"
				? "approved"
				: !raw.viewerDidAuthor && !raw.isDraft && raw.state === "OPEN"
					? "available"
					: "unavailable",
		mergeable: raw.mergeable ?? undefined,
		labels: nodes(raw.labels).map((node) => ({
			name: node.name,
			color: node.color,
			description: node.description ?? undefined,
		})),
		headOwner: raw.headRepositoryOwner?.login ?? undefined,
		headOid: raw.headRefOid,
		commits,
		commitTotal: raw.commits?.totalCount ?? commits.length,
		checks: { state: rollup(head?.state ?? undefined), list: checks },
		comments,
		reviews,
		threads,
		counts: {
			comments: comments.length + threadComments + reviews.filter((review) => review.body.trim()).length,
			unresolved: threads.filter((thread) => !thread.resolved).length,
		},
	}
}

export const pick = (entries: readonly (RawPull | null)[]) =>
	entries.find((node) => node?.state === "OPEN") ?? entries.find((node) => node != null)

export const summary = (raw: RawPull): PullSummary => ({
	number: raw.number,
	title: raw.title,
	state: state(raw),
	url: raw.url,
	base: raw.baseRefName,
	updated: raw.updatedAt,
})

export const replyThread = (api: Client, thread: string, body: string, signal?: AbortSignal) =>
	api.graphql(
		`mutation ($thread: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { clientMutationId }
    }`,
		{ thread, body, request: { signal } },
	)

export const addComment = (api: Client, subject: string, body: string, signal?: AbortSignal) =>
	api.graphql(
		`mutation ($subject: ID!, $body: String!) {
      addComment(input: { subjectId: $subject, body: $body }) { clientMutationId }
    }`,
		{ subject, body, request: { signal } },
	)

export const approve = (api: Client, pullId: string, signal?: AbortSignal) =>
	api.graphql(
		`mutation ($pull: ID!) { addPullRequestReview(input: { pullRequestId: $pull, event: APPROVE }) { clientMutationId } }`,
		{ pull: pullId, request: { signal } },
	)

export const merge = async (api: Client, owner: string, name: string, pullId: string, head: string) => {
	const data = await api.graphql<MergeQueryData>(
		`query ($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed }
    }`,
		{ owner, name },
	)

	const repo = data.repository

	const method = repo?.mergeCommitAllowed
		? "MERGE"
		: repo?.squashMergeAllowed
			? "SQUASH"
			: repo?.rebaseMergeAllowed
				? "REBASE"
				: undefined

	if (!method) throw new Error("The repository allows no merge method")
	await api.graphql(
		`mutation ($pull: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
      mergePullRequest(input: { pullRequestId: $pull, mergeMethod: $method, expectedHeadOid: $head }) { clientMutationId }
    }`,
		{ pull: pullId, method, head },
	)
}

export const resolveThread = (api: Client, thread: string, resolved: boolean, signal?: AbortSignal) =>
	api.graphql(
		resolved
			? `mutation ($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { clientMutationId } }`
			: `mutation ($thread: ID!) { unresolveReviewThread(input: { threadId: $thread }) { clientMutationId } }`,
		{ thread, request: { signal } },
	)

const EDIT: Record<CommentKind, string> = {
	pull: `mutation ($id: ID!, $body: String!) { updatePullRequest(input: { pullRequestId: $id, body: $body }) { clientMutationId } }`,
	issue: `mutation ($id: ID!, $body: String!) { updateIssueComment(input: { id: $id, body: $body }) { clientMutationId } }`,
	review: `mutation ($id: ID!, $body: String!) { updatePullRequestReview(input: { pullRequestReviewId: $id, body: $body }) { clientMutationId } }`,
	"review-comment": `mutation ($id: ID!, $body: String!) { updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) { clientMutationId } }`,
}

const DELETE: Partial<Record<CommentKind, string>> = {
	issue: `mutation ($id: ID!) { deleteIssueComment(input: { id: $id }) { clientMutationId } }`,
	"review-comment": `mutation ($id: ID!) { deletePullRequestReviewComment(input: { id: $id }) { clientMutationId } }`,
}

export const commentAction = (api: Client, input: CommentAction, signal?: AbortSignal) => {
	switch (input.action) {
		case "edit":
			return api.graphql(EDIT[input.kind], { id: input.id, body: input.body, request: { signal } })
		case "delete": {
			const mutation = DELETE[input.kind]

			if (!mutation) throw new Error(`A ${input.kind} cannot be deleted`)

			return api.graphql(mutation, { id: input.id, request: { signal } })
		}

		case "hide":
			if (!HIDE_REASONS.includes(input.reason)) throw new Error(`Unknown reason ${input.reason}`)

			return api.graphql(
				`mutation ($id: ID!, $reason: ReportedContentClassifiers!) { minimizeComment(input: { subjectId: $id, classifier: $reason }) { clientMutationId } }`,
				{ id: input.id, reason: input.reason, request: { signal } },
			)
		case "unhide":
			return api.graphql(`mutation ($id: ID!) { unminimizeComment(input: { subjectId: $id }) { clientMutationId } }`, {
				id: input.id,
				request: { signal },
			})
	}
}
