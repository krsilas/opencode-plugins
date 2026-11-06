import { Octokit } from "@octokit/core"
import { uploadsUrl } from "./attachments.ts"

export class AuthError extends Error {}

export interface Tokens {
	get(host: string): Promise<string | undefined>
}

export const client = (host: string, auth: Tokens) => {
	const baseUrl =
		host === "github.com"
			? "https://api.github.com"
			: host.endsWith(".ghe.com")
				? `https://api.${host}`
				: `https://${host}/api/v3`
	const octokit = new Octokit({ baseUrl })

	octokit.hook.wrap("request", async (request, options) => {
		const token = await auth.get(host)

		if (!token) throw new AuthError(`Add a personal access token for ${host} in Settings > GitHub`)
		options.headers.authorization = `Bearer ${token}`
		options.headers["x-github-api-version"] = "2022-11-28"

		try {
			return await request(options)
		} catch (cause) {
			if (cause instanceof Error && "status" in cause && cause.status === 401)
				throw new AuthError(`GitHub rejected the token for ${host}. Replace it in Settings > GitHub.`)
			throw cause
		}
	})

	return {
		rest: octokit.request,
		graphql: octokit.graphql,
		async upload(repositoryId: number | bigint, name: string, type: string, bytes: Blob, signal?: AbortSignal) {
			const url = new URL(uploadsUrl(host))
			url.searchParams.set("name", name)
			url.searchParams.set("content_type", type)
			url.searchParams.set("repository_id", String(repositoryId))

			try {
				const response = await octokit.request<{ url?: unknown }>({
					method: "POST",
					url: url.toString(),
					data: bytes,
					headers: { "content-type": "application/octet-stream" },
					request: { signal },
				})

				if (typeof response.data?.url !== "string" || !response.data.url)
					throw new Error("GitHub returned no asset URL")

				return response.data.url
			} catch (cause) {
				if (cause instanceof AuthError) throw cause
				const message = cause instanceof Error ? cause.message : String(cause)

				if (cause instanceof Error && "status" in cause && cause.status === 404)
					throw new Error(`Could not upload ${name}: attaching files requires write access to the repository`)

				throw new Error(`Could not upload ${name}: ${message}`)
			}
		},
	}
}

export type Client = ReturnType<typeof client>
