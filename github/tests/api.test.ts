import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { AuthError, client } from "../src/api.ts"
import {
	addComment,
	approve,
	commentAction,
	items,
	LIST_QUERY,
	options,
	pick,
	pull,
	replyThread,
	resolveThread,
	type ListQueryData,
	type RawPull,
} from "../src/github.ts"

let fetch: ReturnType<typeof mock.method<typeof globalThis, "fetch">>
const auth = { get: async () => "test-token" }

beforeEach(() => {
	fetch = mock.method(globalThis, "fetch", async () => {
		throw new Error("Unexpected fetch")
	})
})
afterEach(() => fetch.mock.restore())

const rawPull: RawPull = {
	id: "PR_7",
	number: 7,
	title: "Example PR",
	url: "https://github.com/acme/repo/pull/7",
	state: "OPEN",
	baseRefName: "main",
	headRefName: "feature",
	headRefOid: "abc123",
	createdAt: "2026-11-01T10:00:00Z",
	updatedAt: "2026-11-02T10:00:00Z",
	additions: 5,
	deletions: 2,
	changedFiles: 1,
}

for (const [host, rest, graphql] of [
	["github.com", "https://api.github.com", "https://api.github.com/graphql"],
	["acme.ghe.com", "https://api.acme.ghe.com", "https://api.acme.ghe.com/graphql"],
	["git.example.com", "https://git.example.com/api/v3", "https://git.example.com/api/graphql"],
] as const) {
	test(`REST and GraphQL reach the correct endpoints for ${host}`, async () => {
		const api = client(host, auth)
		const controller = new AbortController()
		fetch.mock.mockImplementationOnce(async () => Response.json({ login: "octocat" }))
		assert.strictEqual((await api.rest("GET /user")).data.login, "octocat")
		assert.partialDeepStrictEqual(fetch.mock.calls[0]?.arguments, [
			`${rest}/user`,
			{
				headers: { authorization: "Bearer test-token", "x-github-api-version": "2022-11-28" },
			},
		])
		fetch.mock.mockImplementationOnce(async () => Response.json({ data: { list: { issueCount: 0, nodes: [] } } }))
		const data = await api.graphql<ListQueryData>(LIST_QUERY, {
			search: "repo:acme/repo is:pr",
			request: { signal: controller.signal },
		})
		assert.deepStrictEqual(items(data.list), { total: 0, items: [] })
		assert.strictEqual(fetch.mock.calls[1]?.arguments[0], graphql)
		assert.strictEqual(fetch.mock.calls[1]?.arguments[1]?.signal, controller.signal)
		assert.deepStrictEqual(JSON.parse(String(fetch.mock.calls[1]?.arguments[1]?.body)), {
			query: LIST_QUERY,
			variables: { search: "repo:acme/repo is:pr" },
		})
	})
}

test("GraphQL converts 401 responses into AuthError", async () => {
	const api = client("github.com", auth)
	fetch.mock.mockImplementationOnce(async () => Response.json({ message: "Bad credentials" }, { status: 401 }))
	await assert.rejects(api.graphql("query { viewer { login } }", {}), AuthError)
})

test("pull, pick, items, and options normalize GraphQL data while ignoring null or pending entries", () => {
	const result = pull({
		...rawPull,
		labels: { nodes: [null, { name: "bug", color: "ff0000" }] },
		reviewRequests: { nodes: [null, { requestedReviewer: null }, { requestedReviewer: { login: "octocat" } }] },
		latestReviews: { nodes: [null, { state: "PENDING" }] },
		reviews: {
			nodes: [
				null,
				{ id: "pending", state: "PENDING", submittedAt: null, url: "https://github.com/pending" },
				{
					id: "review",
					state: "APPROVED",
					submittedAt: "2026-11-02T12:00:00Z",
					url: "https://github.com/review",
				},
			],
		},
		head: {
			nodes: [
				null,
				{
					commit: {
						statusCheckRollup: {
							state: "SUCCESS",
							contexts: {
								nodes: [
									null,
									{ __typename: "FutureCheckType" },
									{ __typename: "CheckRun", name: "CI", status: "COMPLETED", conclusion: "SUCCESS" },
								],
							},
						},
					},
				},
			],
		},
		commits: {
			totalCount: 2,
			nodes: [
				null,
				{
					commit: {
						oid: "abc123",
						abbreviatedOid: "abc",
						messageHeadline: "Fix",
						committedDate: rawPull.updatedAt,
						url: "https://github.com/acme/repo/commit/abc123",
						parents: { nodes: [null, { oid: "parent" }] },
					},
				},
			],
		},
		comments: { nodes: [null] },
		reviewThreads: {
			nodes: [
				null,
				{ id: "empty-thread", isResolved: false, isOutdated: false, path: "empty.ts", comments: { nodes: [] } },
				{
					id: "thread",
					isResolved: false,
					isOutdated: false,
					path: "file.ts",
					originalLine: 10,
					comments: {
						nodes: [
							null,
							{
								id: "comment",
								createdAt: rawPull.updatedAt,
								url: "https://github.com/comment",
								diffHunk: "@@ -1 +1 @@",
							},
						],
					},
				},
			],
		},
	})
	assert.strictEqual(result.reviews.length, 1)
	assert.strictEqual(result.reviews[0]?.state, "APPROVED")
	assert.strictEqual(result.reviews[0]?.date, "2026-11-02T12:00:00Z")
	assert.deepStrictEqual(result.checks.list, [{ name: "CI", workflow: undefined, state: "success", url: undefined }])
	assert.deepStrictEqual(result.comments, [])
	assert.deepStrictEqual(result.labels, [{ name: "bug", color: "ff0000", description: undefined }])
	assert.strictEqual(result.reviewers.length, 1)
	assert.strictEqual(result.reviewers[0]?.author.login, "octocat")
	assert.deepStrictEqual(result.commits[0]?.parents, ["parent"])
	assert.strictEqual(result.commitTotal, 2)
	assert.strictEqual(result.threads.length, 1)
	assert.strictEqual(result.threads[0]?.hunk, "@@ -1 +1 @@")
	assert.strictEqual(result.threads[0]?.line, 10)
	assert.strictEqual(pick([null, { ...rawPull, state: "CLOSED" }, rawPull]), rawPull)
	assert.strictEqual(pick([null]), undefined)
	assert.strictEqual(items({ issueCount: 3, nodes: [null, {}, { number: 7, headRefName: "feature" }] }).items.length, 1)
	assert.deepStrictEqual(
		options({
			repository: {
				refs: { nodes: [null, { name: "main" }] },
				labels: { nodes: [null] },
				assignableUsers: { nodes: [null] },
			},
		}),
		{ branches: ["main"], labels: [], reviewers: [] },
	)
})

test("GraphQL mutations use native request options and do not depend on response payloads", async () => {
	const api = client("github.com", auth)
	const controller = new AbortController()
	const signal = controller.signal
	const mutations = [
		{ run: () => replyThread(api, "thread", "reply", signal), variables: { thread: "thread", body: "reply" } },
		{ run: () => addComment(api, "pull", "comment", signal), variables: { subject: "pull", body: "comment" } },
		{ run: () => approve(api, "pull", signal), variables: { pull: "pull" } },
		{ run: () => resolveThread(api, "thread", true, signal), variables: { thread: "thread" } },
		{ run: () => resolveThread(api, "thread", false, signal), variables: { thread: "thread" } },
		{
			run: () => commentAction(api, { action: "edit", kind: "issue", id: "comment", body: "edited" }, signal),
			variables: { id: "comment", body: "edited" },
		},
		{
			run: () => commentAction(api, { action: "delete", kind: "issue", id: "comment" }, signal),
			variables: { id: "comment" },
		},
		{
			run: () => commentAction(api, { action: "hide", id: "comment", reason: "SPAM" }, signal),
			variables: { id: "comment", reason: "SPAM" },
		},
		{ run: () => commentAction(api, { action: "unhide", id: "comment" }, signal), variables: { id: "comment" } },
	]
	for (const mutation of mutations) {
		fetch.mock.mockImplementationOnce(async () => Response.json({ data: {} }))
		await mutation.run()
		const request = fetch.mock.calls.at(-1)?.arguments[1]
		assert.strictEqual(request?.signal, signal)
		const body = JSON.parse(String(request?.body))
		assert.deepStrictEqual(body.variables, mutation.variables)
		assert.ok(body.query.includes("{ clientMutationId }"))
	}
})

test("attachment uploads send binary data and only require an asset URL", async () => {
	const url = "https://github.com/user-attachments/assets/asset"
	const bytes = new Blob(["image"], { type: "image/png" })
	const controller = new AbortController()
	fetch.mock.mockImplementationOnce(async () => Response.json({ url, unused: null }))
	assert.strictEqual(
		await client("github.com", auth).upload(123n, "screen shot.png", "image/png", bytes, controller.signal),
		url,
	)
	const request = new URL(String(fetch.mock.calls[0]?.arguments[0]))
	assert.strictEqual(request.origin + request.pathname, "https://uploads.github.com/user-attachments/assets")
	assert.deepStrictEqual(Object.fromEntries(request.searchParams), {
		name: "screen shot.png",
		content_type: "image/png",
		repository_id: "123",
	})
	assert.partialDeepStrictEqual(fetch.mock.calls[0]?.arguments[1], {
		method: "POST",
		body: bytes,
		signal: controller.signal,
		headers: { "content-type": "application/octet-stream", authorization: "Bearer test-token" },
	})
})

test("attachment uploads still reject missing URLs and explain write access failures", async () => {
	const api = client("github.com", auth)
	const bytes = new Blob(["image"])
	for (const data of [{}, { url: null }, { url: "" }]) {
		fetch.mock.mockImplementationOnce(async () => Response.json(data))
		await assert.rejects(api.upload(123, "image.png", "image/png", bytes), /GitHub returned no asset URL/)
	}
	fetch.mock.mockImplementationOnce(async () =>
		Response.json({ message: "Not Found", documentation_url: "https://docs.github.com" }, { status: 404 }),
	)
	await assert.rejects(api.upload(123, "image.png", "image/png", bytes), /requires write access/)
	fetch.mock.mockImplementationOnce(async () => Response.json({ message: "Bad credentials" }, { status: 401 }))
	await assert.rejects(api.upload(123, "image.png", "image/png", bytes), AuthError)
})
