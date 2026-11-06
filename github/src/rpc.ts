import { Schema } from "effect"
import type { StandardSchemaV1 } from "effect/StandardSchema"
import { Rpc } from "@opencode/plugin/rpc"
import { Sync } from "./git.ts"
import { Account } from "./auth.ts"
import {
	Attachment,
	CommentKind,
	Commit,
	CreateDraft,
	CreateOptions,
	HideReason,
	Located,
	PullList,
	PullRef,
	PullRepo,
	PullTab,
	RepoRef,
	Status,
} from "./types.ts"

const standard = Schema.toStandardSchemaV1

const withoutUndefined = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(withoutUndefined)
	if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, entry]) => entry !== undefined)
			.map(([key, entry]) => [key, withoutUndefined(entry)]),
	)
}

const output = <S extends Schema.Top & { readonly DecodingServices: never }>(
	schema: S,
): StandardSchemaV1<S["Encoded"], S["Type"]> => {
	const base = standard(schema)
	const clean = <T>(result: { value: T; issues?: undefined } | { issues: readonly { message: string }[] }) =>
		result.issues ? result : { value: withoutUndefined(result.value) as T }

	return {
		"~standard": {
			...base["~standard"],
			validate(value: unknown) {
				const result = base["~standard"].validate(value)
				return result instanceof Promise ? result.then(clean) : clean(result)
			},
		},
	}
}

const Empty = standard(Schema.Struct({}))

const StatusOutput = output(Status)

const errors = {
	failed: standard(Schema.Struct({ message: Schema.String })),
} as const

const TargetFields = {
	directory: Schema.optional(Schema.String),
	ref: Schema.optional(PullRef),
}

const SourceInput = standard(
	Schema.Struct({
		...TargetFields,
		force: Schema.optional(Schema.Boolean),
	}),
)

const DirectoryInput = standard(
	Schema.Struct({
		directory: Schema.String,
		force: Schema.optional(Schema.Boolean),
	}),
)

export const PanelTabName = Schema.Literals(["conversation", "commits", "checks", "details"])

export const GitHub = Rpc.define({
	id: "opencode-pull-requests",
	methods: {
		accounts: {
			input: Empty,
			output: output(Schema.Struct({ accounts: Schema.Array(Account) })),
			errors,
		},
		token: {
			input: standard(Schema.Struct({ host: Schema.String, token: Schema.NullOr(Schema.String) })),
			output: output(Schema.Struct({})),
			errors,
		},
		status: { input: SourceInput, output: StatusOutput },
		options: { input: SourceInput, output: output(CreateOptions), errors },
		local: {
			input: DirectoryInput,
			output: output(
				Schema.Struct({
					repo: Schema.Boolean,
					branch: Schema.optional(Schema.String),
					tracked: Schema.Boolean,
					base: Schema.optional(Schema.String),
				}),
			),
		},
		history: {
			input: standard(Schema.Struct({ directory: Schema.String, base: Schema.String })),
			output: output(Schema.Struct({ commits: Schema.Array(Commit) })),
			errors,
		},
		create: {
			input: standard(
				Schema.Struct({
					directory: Schema.String,
					title: Schema.String,
					body: Schema.String,
					base: Schema.String,
					draft: Schema.Boolean,
					reviewers: Schema.optional(Schema.Array(Schema.String)),
					labels: Schema.optional(Schema.Array(Schema.String)),
					attachments: Schema.optional(Schema.Array(Attachment)),
				}),
			),
			output: StatusOutput,
			errors,
		},
		reply: {
			input: standard(
				Schema.Struct({
					...TargetFields,
					thread: Schema.optional(Schema.String),
					body: Schema.String,
				}),
			),
			output: StatusOutput,
			errors,
		},
		comment: {
			input: standard(
				Schema.Struct({
					...TargetFields,
					action: Schema.Literals(["edit", "delete", "hide", "unhide"]),
					kind: Schema.optional(CommentKind),
					id: Schema.String,
					body: Schema.optional(Schema.String),
					reason: Schema.optional(HideReason),
				}),
			),
			output: StatusOutput,
			errors,
		},
		markdown: {
			input: standard(Schema.Struct({ ...TargetFields, text: Schema.String })),
			output: output(Schema.Struct({ html: Schema.String })),
			errors,
		},
		approve: { input: SourceInput, output: StatusOutput, errors },
		merge: { input: SourceInput, output: StatusOutput, errors },
		request: {
			input: standard(
				Schema.Struct({
					...TargetFields,
					reviewers: Schema.Array(Schema.String),
					remove: Schema.optional(Schema.Array(Schema.String)),
				}),
			),
			output: StatusOutput,
			errors,
		},
		update: {
			input: SourceInput,
			output: output(Schema.Struct({ status: Status, sync: Schema.optional(Sync) })),
			errors,
		},
		push: { input: DirectoryInput, output: StatusOutput, errors },
		labels: {
			input: standard(Schema.Struct({ ...TargetFields, labels: Schema.Array(Schema.String) })),
			output: StatusOutput,
			errors,
		},
		resolve: {
			input: standard(Schema.Struct({ ...TargetFields, thread: Schema.String, resolved: Schema.Boolean })),
			output: StatusOutput,
			errors,
		},
		repo: {
			input: standard(RepoRef),
			output: output(PullRepo),
			errors,
		},
		pulls: {
			input: standard(
				Schema.Struct({
					...RepoRef.fields,
					list: PullTab,
					search: Schema.optional(Schema.String),
				}),
			),
			output: output(PullList),
			errors,
		},
		locate: {
			input: standard(Schema.Struct({ directories: Schema.Array(Schema.String) })),
			output: output(Schema.Struct({ located: Schema.Array(Located) })),
		},
	},
	events: {
		auth: { schema: Empty },
		open: {
			schema: standard(
				Schema.Struct({
					sessionID: Schema.String,
					tab: Schema.optional(PanelTabName),
				}),
			),
		},
		create: {
			schema: standard(
				Schema.Struct({
					sessionID: Schema.String,
					...CreateDraft.fields,
				}),
			),
		},
	},
})
