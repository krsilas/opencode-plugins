import { Schema } from "effect"

export const CheckState = Schema.Literals(["success", "failure", "pending", "neutral"])

export type CheckState = typeof CheckState.Type

export const PullState = Schema.Literals(["open", "draft", "merged", "closed"])

export type PullState = typeof PullState.Type

export const Author = Schema.Struct({
	login: Schema.String,
	name: Schema.optional(Schema.String),
	avatar: Schema.optional(Schema.String),
	bot: Schema.optional(Schema.Boolean),
})

export type Author = typeof Author.Type

export const Check = Schema.Struct({
	name: Schema.String,
	workflow: Schema.optional(Schema.String),
	state: CheckState,
	url: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
})

export type Check = typeof Check.Type

export const Commit = Schema.Struct({
	oid: Schema.String,
	short: Schema.String,
	headline: Schema.String,
	body: Schema.String,
	date: Schema.String,
	url: Schema.String,
	author: Author,
	parents: Schema.Array(Schema.String),
	checks: Schema.optional(CheckState),
	verified: Schema.optional(Schema.Boolean),
})

export type Commit = typeof Commit.Type

export const Viewer = Schema.Struct({
	update: Schema.Boolean,
	delete: Schema.Boolean,
	minimize: Schema.Boolean,
})

export type Viewer = typeof Viewer.Type

export const CommentKind = Schema.Literals(["pull", "issue", "review", "review-comment"])

export type CommentKind = typeof CommentKind.Type

export const HIDE_REASONS = ["SPAM", "ABUSE", "OFF_TOPIC", "OUTDATED", "DUPLICATE", "RESOLVED"] as const

export const HideReason = Schema.Literals(HIDE_REASONS)

export type HideReason = typeof HideReason.Type

export const CommentAction = Schema.Union([
	Schema.Struct({ action: Schema.Literal("edit"), kind: CommentKind, id: Schema.String, body: Schema.String }),
	Schema.Struct({ action: Schema.Literal("delete"), kind: CommentKind, id: Schema.String }),
	Schema.Struct({ action: Schema.Literal("hide"), id: Schema.String, reason: HideReason }),
	Schema.Struct({ action: Schema.Literal("unhide"), id: Schema.String }),
])

export type CommentAction = typeof CommentAction.Type

export const Comment = Schema.Struct({
	id: Schema.String,
	kind: CommentKind,
	body: Schema.String,
	html: Schema.String,
	author: Author,
	date: Schema.String,
	url: Schema.String,
	viewer: Viewer,
	minimized: Schema.optional(Schema.String),
})

export type Comment = typeof Comment.Type

export const ReviewState = Schema.Literals(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"])

export type ReviewState = typeof ReviewState.Type

export const Review = Schema.Struct({
	...Comment.fields,
	state: ReviewState,
})

export type Review = typeof Review.Type

export const Thread = Schema.Struct({
	id: Schema.String,
	resolved: Schema.Boolean,
	outdated: Schema.Boolean,
	path: Schema.String,
	line: Schema.optional(Schema.Number),
	startLine: Schema.optional(Schema.Number),
	hunk: Schema.optional(Schema.String),
	comments: Schema.Array(Comment),
})

export type Thread = typeof Thread.Type

export const ReviewerState = Schema.Literals(["REQUESTED", "APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"])

export type ReviewerState = typeof ReviewerState.Type

export const Reviewer = Schema.Struct({
	author: Author,
	state: ReviewerState,
	team: Schema.optional(Schema.Boolean),
})

export type Reviewer = typeof Reviewer.Type

export const Label = Schema.Struct({
	name: Schema.String,
	color: Schema.String,
	description: Schema.optional(Schema.String),
})

export type Label = typeof Label.Type

export const ReviewDecision = Schema.Literals(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])

export type ReviewDecision = typeof ReviewDecision.Type

export const MergeableState = Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"])

export type MergeableState = typeof MergeableState.Type

export const Pull = Schema.Struct({
	id: Schema.String,
	number: Schema.Number,
	title: Schema.String,
	body: Schema.String,
	html: Schema.String,
	url: Schema.String,
	viewer: Viewer,
	state: PullState,
	base: Schema.String,
	head: Schema.String,
	author: Author,
	created: Schema.String,
	updated: Schema.String,
	additions: Schema.Number,
	deletions: Schema.Number,
	files: Schema.Number,
	review: Schema.optional(ReviewDecision),
	reviewers: Schema.Array(Reviewer),
	approval: Schema.Literals(["available", "approved", "unavailable"]),
	mergeable: Schema.optional(MergeableState),
	labels: Schema.Array(Label),
	headOwner: Schema.optional(Schema.String),
	headOid: Schema.String,
	sync: Schema.optional(Schema.Struct({ ahead: Schema.Number, behind: Schema.Number })),
	commits: Schema.Array(Commit),
	commitTotal: Schema.Number,
	checks: Schema.Struct({ state: Schema.optional(CheckState), list: Schema.Array(Check) }),
	comments: Schema.Array(Comment),
	reviews: Schema.Array(Review),
	threads: Schema.Array(Thread),
	counts: Schema.Struct({ comments: Schema.Number, unresolved: Schema.Number }),
})

export type Pull = typeof Pull.Type

export const Repo = Schema.Struct({
	host: Schema.String,
	owner: Schema.String,
	name: Schema.String,
	url: Schema.String,
	base: Schema.String,
})

export type Repo = typeof Repo.Type

export const Suggestion = Schema.Struct({
	title: Schema.String,
	body: Schema.String,
	ahead: Schema.Number,
})

export type Suggestion = typeof Suggestion.Type

export const PullSummary = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	state: PullState,
	url: Schema.String,
	base: Schema.String,
	updated: Schema.String,
})

export type PullSummary = typeof PullSummary.Type

export const Attachment = Schema.Struct({
	path: Schema.String,
	name: Schema.String,
	alt: Schema.optional(Schema.String),
})

export type Attachment = typeof Attachment.Type

export const CreateDraft = Schema.Struct({
	title: Schema.optional(Schema.String),
	body: Schema.optional(Schema.String),
	base: Schema.optional(Schema.String),
	draft: Schema.optional(Schema.Boolean),
	reviewers: Schema.optional(Schema.Array(Schema.String)),
	labels: Schema.optional(Schema.Array(Schema.String)),
	attachments: Schema.optional(Schema.Array(Attachment)),
})

export type CreateDraft = typeof CreateDraft.Type

export const CreateOptions = Schema.Struct({
	branches: Schema.Array(Schema.String),
	labels: Schema.Array(Label),
	reviewers: Schema.Array(Author),
})

export type CreateOptions = typeof CreateOptions.Type

export const RepoRef = Schema.Struct({
	host: Schema.String,
	owner: Schema.String,
	name: Schema.String,
})

export type RepoRef = typeof RepoRef.Type

export const PullRef = Schema.Struct({
	...RepoRef.fields,
	number: Schema.Number,
})

export type PullRef = typeof PullRef.Type

export type Source = { directory: string } | { ref: PullRef }

export const repoKey = (repo: RepoRef) => `${repo.host}/${repo.owner}/${repo.name}`

export const sourceKey = (source: Source) =>
	"ref" in source ? `${repoKey(source.ref)}#${source.ref.number}` : source.directory

export const PullItem = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	url: Schema.String,
	state: PullState,
	author: Author,
	head: Schema.String,
	base: Schema.String,
	headOwner: Schema.optional(Schema.String),
	created: Schema.String,
	updated: Schema.String,
	review: Schema.optional(ReviewDecision),
	checks: Schema.optional(CheckState),
	comments: Schema.Number,
	additions: Schema.Number,
	deletions: Schema.Number,
})

export type PullItem = typeof PullItem.Type

export const PullList = Schema.Struct({
	total: Schema.Number,
	open: Schema.Number,
	items: Schema.Array(PullItem),
})

export type PullList = typeof PullList.Type

export const PullTab = Schema.Literals(["mine", "open", "merged"])

export type PullTab = typeof PullTab.Type

export const PullRepo = Schema.Struct({
	repo: Schema.Struct({ ...RepoRef.fields, url: Schema.String }),
	viewer: Schema.String,
})

export type PullRepo = typeof PullRepo.Type

export const Located = Schema.Struct({
	directory: Schema.String,
	repo: RepoRef,
	branch: Schema.optional(Schema.String),
	head: Schema.optional(Schema.String),
})

export type Located = typeof Located.Type

export const StatusError = Schema.Struct({
	type: Schema.Literals(["git", "auth", "api"]),
	message: Schema.String,
})

export type StatusError = typeof StatusError.Type

export const Status = Schema.Struct({
	directory: Schema.String,
	branch: Schema.optional(Schema.String),
	repo: Schema.optional(Repo),
	pull: Schema.optional(Pull),
	pulls: Schema.optional(Schema.Array(PullSummary)),
	pushed: Schema.Boolean,
	suggestion: Schema.optional(Suggestion),
	error: Schema.optional(StatusError),
	fetched: Schema.Number,
})

export type Status = typeof Status.Type
