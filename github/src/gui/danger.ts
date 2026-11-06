// Tags the danger menu item on open because the app's Menu component has no danger variant.
export const createDanger = (label: () => string) => {
	let armed = 0

	const tag = (root: ParentNode) => {
		root.querySelectorAll<HTMLElement>('[data-component="menu-v2-item"]').forEach((item) => {
			if (item.textContent?.trim() === label()) item.dataset.ghpDanger = ""
		})
	}

	const observer = new MutationObserver((records) => {
		if (Date.now() > armed) return

		for (const record of records) {
			for (const node of record.addedNodes) {
				if (!(node instanceof HTMLElement)) continue

				const menu = node.matches('[data-component="menu-v2-content"]')
					? node
					: node.querySelector('[data-component="menu-v2-content"]')

				if (menu) tag(menu)
			}
		}
	})

	observer.observe(document.body, { childList: true, subtree: true })

	return {
		arm: () => {
			armed = Date.now() + 1000
		},
		dispose: () => observer.disconnect(),
	}
}

export type Danger = ReturnType<typeof createDanger>
