import {
	App,
	Component,
	getLinkpath,
	ItemView,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownView,
	normalizePath,
	setIcon,
	TFile,
	TFolder,
	WorkspaceLeaf,
} from 'obsidian';

export const MONKI_OUTLINE_VIEW_TYPE = 'monki-outline';

interface OutlineEntry {
	depth: number;
	line: number;
	text: string;
	type: 'heading' | 'link';
}

interface OutlineSection {
	entries: OutlineEntry[];
	lineStart: number;
}

const documentIdsBySource = new Map<string, string>();
const sectionsBySource = new Map<string, Map<number, OutlineSection>>();

export function invalidateOutlineSource(sourcePath: string) {
	documentIdsBySource.delete(sourcePath);
	sectionsBySource.delete(sourcePath);
}

export function processRenderedOutlineSection(
	app: App,
	containerEl: HTMLElement,
	context: MarkdownPostProcessorContext,
) {
	const sectionInfo = context.getSectionInfo(containerEl);
	if (!sectionInfo) {
		return;
	}
	if (documentIdsBySource.get(context.sourcePath) !== context.docId) {
		documentIdsBySource.set(context.sourcePath, context.docId);
		sectionsBySource.delete(context.sourcePath);
	}
	const sourceFile = app.vault.getAbstractFileByPath(context.sourcePath);
	const cache =
		sourceFile instanceof TFile
			? app.metadataCache.getFileCache(sourceFile)
			: null;
	const headings = cache?.headings ?? [];
	const links = cache?.links ?? [];

	const entries = Array.from(
		containerEl.querySelectorAll<HTMLElement>(
			'h1, h2, h3, h4, h5, h6, a.internal-link[data-href]',
		),
	)
		.map((element): OutlineEntry | null => {
			if (element.instanceOf(HTMLAnchorElement)) {
				if (!isPageOrFolderLink(app, element, context.sourcePath)) {
					return null;
				}

				const link = links.find(
					(item) =>
						item.position.start.line >= sectionInfo.lineStart &&
						item.position.start.line <= sectionInfo.lineEnd &&
						item.link === element.dataset.href,
				);
				const line = link?.position.start.line ?? sectionInfo.lineStart;
				const parentHeading = [...headings]
					.reverse()
					.find((heading) => heading.position.start.line <= line);
				return {
					depth: Math.min(parentHeading?.level ?? 1, 6),
					line,
					text: element.innerText,
					type: 'link',
				};
			}

			const level = Number(element.tagName.slice(1));
			const heading = headings.find(
				(item) =>
					item.position.start.line >= sectionInfo.lineStart &&
					item.position.start.line <= sectionInfo.lineEnd &&
					item.level === level &&
					item.heading === element.innerText,
			);
			return {
				depth: level - 1,
				line: heading?.position.start.line ?? sectionInfo.lineStart,
				text: element.innerText,
				type: 'heading',
			};
		})
		.filter((entry): entry is OutlineEntry => entry !== null);

	const sections =
		sectionsBySource.get(context.sourcePath) ??
		new Map<number, OutlineSection>();
	sections.set(sectionInfo.lineStart, {
		entries,
		lineStart: sectionInfo.lineStart,
	});
	sectionsBySource.set(context.sourcePath, sections);
}

function isPageOrFolderLink(
	app: App,
	link: HTMLAnchorElement,
	sourcePath: string,
) {
	const href = link.dataset.href;
	if (!href) {
		return false;
	}

	const linkpath = getLinkpath(href);
	const noteTarget = app.metadataCache.getFirstLinkpathDest(
		linkpath,
		sourcePath,
	);
	if (noteTarget?.extension === 'md') {
		return true;
	}

	const directTarget = app.vault.getAbstractFileByPath(
		normalizePath(linkpath),
	);
	if (directTarget instanceof TFolder) {
		return true;
	}

	const separatorIndex = sourcePath.lastIndexOf('/');
	const sourceFolder =
		separatorIndex === -1 ? '' : sourcePath.slice(0, separatorIndex);
	const relativeTarget = app.vault.getAbstractFileByPath(
		normalizePath(sourceFolder ? `${sourceFolder}/${linkpath}` : linkpath),
	);
	return relativeTarget instanceof TFolder;
}

function processRenderedOutlineDocument(
	app: App,
	containerEl: HTMLElement,
	sourceFile: TFile,
) {
	const cache = app.metadataCache.getFileCache(sourceFile);
	const remainingHeadings = [...(cache?.headings ?? [])];
	const remainingLinks = [...(cache?.links ?? [])];
	const entries = Array.from(
		containerEl.querySelectorAll<HTMLElement>(
			'h1, h2, h3, h4, h5, h6, a.internal-link[data-href]',
		),
	)
		.map((element): OutlineEntry | null => {
			if (element.instanceOf(HTMLAnchorElement)) {
				if (!isPageOrFolderLink(app, element, sourceFile.path)) {
					return null;
				}

				const linkIndex = remainingLinks.findIndex(
					(link) => link.link === element.dataset.href,
				);
				const link =
					linkIndex === -1
						? undefined
						: remainingLinks.splice(linkIndex, 1)[0];
				const line = link?.position.start.line ?? 0;
				const parentHeading = [...(cache?.headings ?? [])]
					.reverse()
					.find((heading) => heading.position.start.line <= line);
				return {
					depth: Math.min(parentHeading?.level ?? 1, 6),
					line,
					text: element.innerText,
					type: 'link',
				};
			}

			const level = Number(element.tagName.slice(1));
			const headingIndex = remainingHeadings.findIndex(
				(heading) =>
					heading.level === level &&
					heading.heading === element.innerText,
			);
			const heading =
				headingIndex === -1
					? undefined
					: remainingHeadings.splice(headingIndex, 1)[0];
			return {
				depth: level - 1,
				line: heading?.position.start.line ?? 0,
				text: element.innerText,
				type: 'heading',
			};
		})
		.filter((entry): entry is OutlineEntry => entry !== null);

	sectionsBySource.set(
		sourceFile.path,
		new Map([[0, { entries, lineStart: 0 }]]),
	);
}

export class MonkiOutlineView extends ItemView {
	private outlineEl?: HTMLDivElement;
	private pinnedTarget?: OutlineEntry;
	private renderedEntries: { entry: OutlineEntry; rowEl: HTMLElement }[] = [];
	private readonly collapsedEntriesBySource = new Map<string, Set<string>>();
	private selectedSourcePath?: string;
	private sourceView?: MarkdownView;
	private editorChangeTimer?: number;
	private sourceRenderGeneration = 0;
	private readonly observedSourceViews = new WeakSet<MarkdownView>();
	private readonly userScrollIntentViews = new WeakSet<MarkdownView>();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly emptyStateImageUrl: string,
	) {
		super(leaf);
	}

	getViewType() {
		return MONKI_OUTLINE_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Monki Outline';
	}

	getIcon() {
		return 'heart';
	}

	async onOpen() {
		this.contentEl.empty();
		this.outlineEl = this.contentEl.createDiv();
		this.registerDomEvent(this.outlineEl, 'click', (event) => {
			const target = event.target as HTMLElement;
			const rowEl = target.closest<HTMLElement>(
				'.tree-item-self[data-line]',
			);
			if (!rowEl || !this.outlineEl?.contains(rowEl)) {
				return;
			}

			const line = Number(rowEl.dataset.line);
			const renderedEntry = this.renderedEntries.find(
				(rendered) => rendered.rowEl === rowEl,
			);
			if (!renderedEntry) {
				return;
			}
			if (target.closest('.tree-item-icon.collapse-icon.is-clickable')) {
				this.toggleCollapsed(renderedEntry.entry);
				return;
			}

			this.pinnedTarget = renderedEntry.entry;
			this.sourceView?.currentMode.applyScroll(line);
			this.setActiveRow(rowEl);
		});
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (
					!leaf ||
					leaf === this.leaf ||
					leaf.getRoot() !== this.app.workspace.rootSplit
				) {
					return;
				}

				if (leaf.view instanceof MarkdownView && leaf.view.file) {
					this.setSourceView(leaf.view);
				} else {
					this.clearSourceView();
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				const markdownView = this.app.workspace
					.getLeavesOfType('markdown')
					.map((leaf) => leaf.view)
					.find(
						(view): view is MarkdownView =>
							view instanceof MarkdownView && view.file === file,
					);
				if (markdownView) {
					this.setSourceView(markdownView);
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				if (info !== this.sourceView) {
					return;
				}

				window.clearTimeout(this.editorChangeTimer);
				this.editorChangeTimer = window.setTimeout(() => {
					this.editorChangeTimer = undefined;
					this.refreshTargets();
				}, 1000);
			}),
		);
		this.registerDomEvent(
			this.containerEl.ownerDocument.defaultView ?? window,
			'focus',
			() => this.refreshTargets(),
		);
		this.register(() => window.clearTimeout(this.editorChangeTimer));

		this.app.workspace.onLayoutReady(() => {
			if (this.sourceView) {
				return;
			}

			const markdownView = this.getInitialSourceView();
			if (markdownView) {
				this.setSourceView(markdownView);
			} else {
				this.renderOutline();
			}
		});
	}

	private getInitialSourceView() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file) {
			return activeView;
		}

		const recentView = this.app.workspace.getMostRecentLeaf(
			this.app.workspace.rootSplit,
		)?.view;
		if (recentView instanceof MarkdownView && recentView.file) {
			return recentView;
		}

		return this.app.workspace
			.getLeavesOfType('markdown')
			.filter((leaf) => leaf.getRoot() === this.app.workspace.rootSplit)
			.map((leaf) => leaf.view)
			.find(
				(view): view is MarkdownView =>
					view instanceof MarkdownView && view.file !== null,
			);
	}

	setSourceView(view: MarkdownView) {
		if (view.file) {
			window.clearTimeout(this.editorChangeTimer);
			this.editorChangeTimer = undefined;
			if (view.file.path !== this.selectedSourcePath) {
				this.pinnedTarget = undefined;
			}
			this.sourceView = view;
			this.selectedSourcePath = view.file.path;
			this.observeSourceScroll(view);
			this.renderOutline();
			this.refreshTargets();
		}
	}

	private clearSourceView() {
		window.clearTimeout(this.editorChangeTimer);
		this.editorChangeTimer = undefined;
		this.sourceRenderGeneration++;
		this.sourceView = undefined;
		this.selectedSourcePath = undefined;
		this.pinnedTarget = undefined;
		this.renderOutline();
	}

	refreshSource(sourcePath: string) {
		if (sourcePath === this.selectedSourcePath) {
			this.renderOutline();
		}
	}

	private renderOutline() {
		this.outlineEl?.empty();
		this.renderedEntries = [];

		if (!this.outlineEl) {
			return;
		}
		if (!this.selectedSourcePath) {
			this.renderEmptyState();
			return;
		}

		const sections = sectionsBySource.get(this.selectedSourcePath);
		const entries = [...(sections?.values() ?? [])]
			.sort((left, right) => left.lineStart - right.lineStart)
			.flatMap((section) => section.entries);
		if (entries.length === 0) {
			this.renderEmptyState();
			return;
		}
		const collapsedEntries =
			this.collapsedEntriesBySource.get(this.selectedSourcePath) ??
			new Set();
		const parentStack: {
			childrenEl: HTMLElement;
			depth: number;
		}[] = [{ childrenEl: this.outlineEl, depth: -1 }];
		for (const [index, entry] of entries.entries()) {
			const hasChildren = (entries[index + 1]?.depth ?? -1) > entry.depth;
			const isCollapsed =
				hasChildren && collapsedEntries.has(this.getEntryKey(entry));
			while (parentStack.at(-1)!.depth >= entry.depth) {
				parentStack.pop();
			}
			const treeItemEl = parentStack.at(-1)!.childrenEl.createDiv({
				cls: `tree-item monki-outline-${entry.type}${isCollapsed ? ' is-collapsed' : ''}`,
			});
			const rowEl = treeItemEl.createDiv({
				cls: `tree-item-self is-clickable${hasChildren ? ' mod-collapsible' : ''}`,
				attr: { 'data-line': String(entry.line) },
			});
			if (hasChildren) {
				const collapseIconEl = rowEl.createDiv({
					cls: 'tree-item-icon collapse-icon is-clickable',
					attr: {
						'aria-expanded': String(!isCollapsed),
						'aria-label': isCollapsed
							? 'Expand item'
							: 'Collapse item',
						role: 'button',
					},
				});
				setIcon(collapseIconEl, 'chevron-down');
			}
			rowEl.createDiv({
				cls: 'tree-item-inner',
				text: entry.text,
			});
			const rowIndent =
				rowEl.getBoundingClientRect().left -
				this.outlineEl.getBoundingClientRect().left;
			rowEl.style.setProperty(
				'margin-inline-start',
				`${-rowIndent}px`,
				'important',
			);
			rowEl.style.setProperty(
				'padding-inline-start',
				`${24 + rowIndent}px`,
				'important',
			);
			this.renderedEntries.push({ entry, rowEl });
			if (hasChildren) {
				const childrenEl = treeItemEl.createDiv({
					cls: 'tree-item-children',
				});
				parentStack.push({
					childrenEl: childrenEl.createDiv({
						cls: 'monki-outline-children-inner',
					}),
					depth: entry.depth,
				});
			}
		}
		const pinnedRow = this.pinnedTarget
			? this.renderedEntries.find(({ entry }) =>
					this.isSameEntry(entry, this.pinnedTarget!),
				)?.rowEl
			: undefined;
		if (pinnedRow && !this.isRowHidden(pinnedRow)) {
			this.setActiveRow(pinnedRow);
		} else {
			this.pinnedTarget = undefined;
			this.updateActiveEntry();
		}
	}

	private renderEmptyState() {
		const emptyStateEl = this.outlineEl?.createDiv({
			cls: 'monki-outline-empty',
		});
		emptyStateEl?.createEl('img', {
			cls: 'monki-outline-empty-image',
			attr: {
				alt: '',
				draggable: 'false',
				src: this.emptyStateImageUrl,
			},
		});
		emptyStateEl?.createEl('p', {
			cls: 'monki-outline-empty-text',
			text: 'The dog ate the headings.',
		});
	}

	private toggleCollapsed(entry: OutlineEntry) {
		if (!this.selectedSourcePath) {
			return;
		}

		const collapsedEntries =
			this.collapsedEntriesBySource.get(this.selectedSourcePath) ??
			new Set();
		const entryKey = this.getEntryKey(entry);
		if (collapsedEntries.has(entryKey)) {
			collapsedEntries.delete(entryKey);
		} else {
			collapsedEntries.add(entryKey);
		}
		this.collapsedEntriesBySource.set(
			this.selectedSourcePath,
			collapsedEntries,
		);

		const renderedEntry = this.renderedEntries.find(
			({ entry: candidate }) => this.isSameEntry(candidate, entry),
		);
		const treeItemEl = renderedEntry?.rowEl.parentElement;
		const collapseIconEl = renderedEntry?.rowEl.querySelector<HTMLElement>(
			'.tree-item-icon.collapse-icon',
		);
		const isCollapsed = collapsedEntries.has(entryKey);
		treeItemEl?.toggleClass('is-collapsed', isCollapsed);
		collapseIconEl?.setAttribute('aria-expanded', String(!isCollapsed));
		collapseIconEl?.setAttribute(
			'aria-label',
			isCollapsed ? 'Expand item' : 'Collapse item',
		);
		this.pinnedTarget = undefined;
		this.updateActiveEntry();
	}

	private isRowHidden(rowEl: HTMLElement) {
		return Boolean(
			rowEl
				.closest('.tree-item-children')
				?.closest('.tree-item.is-collapsed'),
		);
	}

	private getEntryKey(entry: OutlineEntry) {
		return `${entry.type}:${entry.line}:${entry.depth}:${entry.text}`;
	}

	private async populateRenderedSource(
		view: MarkdownView,
		generation: number,
	) {
		const file = view.file;
		if (!file) {
			return;
		}

		const markdown = view.editor.getValue();
		if (
			generation !== this.sourceRenderGeneration ||
			file.path !== this.selectedSourcePath
		) {
			return;
		}

		const renderComponent = new Component();
		renderComponent.load();
		try {
			const renderedEl = createDiv();
			await MarkdownRenderer.render(
				this.app,
				markdown,
				renderedEl,
				file.path,
				renderComponent,
			);
			processRenderedOutlineDocument(this.app, renderedEl, file);
			if (
				generation === this.sourceRenderGeneration &&
				file.path === this.selectedSourcePath
			) {
				this.renderOutline();
			}
		} finally {
			renderComponent.unload();
		}
	}

	private refreshTargets() {
		if (!this.sourceView?.file) {
			return;
		}

		this.pinnedTarget = undefined;
		invalidateOutlineSource(this.sourceView.file.path);
		void this.populateRenderedSource(
			this.sourceView,
			++this.sourceRenderGeneration,
		);
	}

	private observeSourceScroll(view: MarkdownView) {
		if (this.observedSourceViews.has(view)) {
			return;
		}

		this.observedSourceViews.add(view);
		this.registerDomEvent(
			view.containerEl,
			'wheel',
			() => this.releasePinnedTarget(),
			true,
		);
		this.registerDomEvent(
			view.containerEl,
			'touchmove',
			() => this.releasePinnedTarget(),
			true,
		);
		this.registerDomEvent(
			view.containerEl,
			'pointerdown',
			() => this.userScrollIntentViews.add(view),
			true,
		);
		for (const eventName of ['pointerup', 'pointercancel'] as const) {
			this.registerDomEvent(
				view.containerEl,
				eventName,
				() => this.userScrollIntentViews.delete(view),
				true,
			);
		}
		this.registerDomEvent(
			view.containerEl,
			'keydown',
			(event) => {
				if (this.isScrollKey(event)) {
					this.userScrollIntentViews.add(view);
				}
			},
			true,
		);
		this.registerDomEvent(
			view.containerEl,
			'keyup',
			() => this.userScrollIntentViews.delete(view),
			true,
		);
		this.registerDomEvent(
			view.containerEl,
			'scroll',
			() => {
				if (this.sourceView === view) {
					if (this.userScrollIntentViews.has(view)) {
						this.pinnedTarget = undefined;
					}
					if (!this.pinnedTarget) {
						this.updateActiveEntry();
					}
				}
			},
			true,
		);
	}

	private updateActiveEntry(
		scrollLine = this.sourceView?.currentMode.getScroll(),
	) {
		let activeRow: HTMLElement | undefined;
		if (scrollLine !== undefined) {
			for (const { entry, rowEl } of this.renderedEntries) {
				if (entry.line > scrollLine) {
					break;
				}
				if (!this.isRowHidden(rowEl)) {
					activeRow = rowEl;
				}
			}
		}

		this.setActiveRow(activeRow);
	}

	private setActiveRow(activeRow?: HTMLElement) {
		for (const { rowEl } of this.renderedEntries) {
			rowEl.toggleClass('is-active', rowEl === activeRow);
		}
		activeRow?.scrollIntoView({ block: 'nearest' });
	}

	private releasePinnedTarget() {
		this.pinnedTarget = undefined;
	}

	private isScrollKey(event: KeyboardEvent) {
		return [
			'ArrowDown',
			'ArrowUp',
			'End',
			'Home',
			'PageDown',
			'PageUp',
			' ',
		].includes(event.key);
	}

	private isSameEntry(left: OutlineEntry, right: OutlineEntry) {
		return (
			left.depth === right.depth &&
			left.line === right.line &&
			left.text === right.text &&
			left.type === right.type
		);
	}
}
