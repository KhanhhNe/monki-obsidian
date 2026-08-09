import {
	App,
	Component,
	ItemView,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownView,
	setIcon,
	TFile,
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

interface OutlineParseResult {
	entries: OutlineEntry[];
	sourcePath: string | undefined;
}

const documentIdsBySource = new Map<string, string>();
const sectionsBySource = new Map<string, Map<number, OutlineSection>>();
const internalRenderCountsBySource = new Map<string, number>();

export function invalidateOutlineSource(sourcePath: string) {
	documentIdsBySource.delete(sourcePath);
	sectionsBySource.delete(sourcePath);
}

export function processRenderedOutlineSection(
	app: App,
	containerEl: HTMLElement,
	context: MarkdownPostProcessorContext,
) {
	if ((internalRenderCountsBySource.get(context.sourcePath) ?? 0) > 0) {
		return false;
	}

	const sectionInfo = context.getSectionInfo(containerEl);
	if (!sectionInfo) {
		return false;
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
	return true;
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
	private lastParseResult?: OutlineParseResult;
	private pinnedTarget?: OutlineEntry;
	private renderedEntries: { entry: OutlineEntry; rowEl: HTMLElement }[] = [];
	private readonly collapsedEntriesBySource = new Map<string, Set<string>>();
	private completedSource?: { markdown: string; sourcePath: string };
	private pendingSource?: { markdown: string; sourcePath: string };
	private selectedSourcePath?: string;
	private sourceView?: MarkdownView;
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
			const mode = this.sourceView?.currentMode as
				| { setHighlight?: (target: { line: number }) => void }
				| undefined;
			if (mode?.setHighlight) {
				mode.setHighlight({ line });
				this.setActiveRow(rowEl);
				return;
			}

			const targetPosition = { line, ch: 0 };
			const editor = this.sourceView?.editor;
			editor?.setCursor(targetPosition);
			editor?.scrollIntoView(
				{
					from: targetPosition,
					to: { line, ch: editor.getLine(line).length },
				},
				true,
			);
			this.setActiveRow(rowEl);
		});
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (
					leaf &&
					leaf !== this.leaf &&
					leaf.getRoot() === this.app.workspace.rootSplit &&
					leaf.view instanceof MarkdownView &&
					leaf.view.file
				) {
					this.setSourceView(leaf.view);
					return;
				}

				this.clearHiddenSource();
			}),
		);
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.clearHiddenSource();
			}),
		);
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				const latestView = this.getLatestSourceView();
				if (latestView?.file === file) {
					this.setSourceView(latestView);
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				if (info !== this.sourceView) {
					return;
				}

				this.refreshTargets(true);
			}),
		);
		this.registerDomEvent(
			this.containerEl.ownerDocument.defaultView ?? window,
			'focus',
			() => {
				if (this.clearHiddenSource()) {
					return;
				}

				this.refreshTargets();
			},
		);
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
		if (
			recentView instanceof MarkdownView &&
			recentView.file &&
			recentView.containerEl.isShown()
		) {
			return recentView;
		}

		return this.app.workspace
			.getLeavesOfType('markdown')
			.filter((leaf) => leaf.getRoot() === this.app.workspace.rootSplit)
			.map((leaf) => leaf.view)
			.find(
				(view): view is MarkdownView =>
					view instanceof MarkdownView &&
					view.file !== null &&
					view.containerEl.isShown(),
			);
	}

	private getLatestSourceView() {
		const recentView = this.app.workspace.getMostRecentLeaf(
			this.app.workspace.rootSplit,
		)?.view;
		return recentView instanceof MarkdownView &&
			recentView.file &&
			recentView.containerEl.isShown()
			? recentView
			: undefined;
	}

	private isSourceVisible() {
		const view = this.sourceView;
		return Boolean(
			view?.file &&
				view.leaf.view === view &&
				view.leaf.getRoot() === this.app.workspace.rootSplit &&
				view.containerEl.isShown(),
		);
	}

	private clearHiddenSource() {
		if (!this.sourceView || this.isSourceVisible()) {
			return false;
		}

		this.sourceRenderGeneration++;
		this.sourceView = undefined;
		this.selectedSourcePath = undefined;
		this.completedSource = undefined;
		this.pendingSource = undefined;
		this.renderOutline();
		return true;
	}

	setSourceView(view: MarkdownView, useEditorContents = false) {
		const file = view.file;
		if (
			!file ||
			(view === this.sourceView && file.path === this.selectedSourcePath)
		) {
			return;
		}

		if (file.path !== this.selectedSourcePath) {
			this.pinnedTarget = undefined;
		}
		this.sourceView = view;
		this.selectedSourcePath = file.path;
		this.observeSourceScroll(view);
		invalidateOutlineSource(file.path);
		this.renderOutline();
		this.refreshTargets(useEditorContents);
	}

	refreshSource(sourcePath: string) {
		if (sourcePath === this.selectedSourcePath) {
			void this.refreshFileSourceIfChanged();
		}
	}

	private async refreshFileSourceIfChanged() {
		if (this.clearHiddenSource()) {
			return;
		}

		const view = this.sourceView;
		const file = view?.file;
		if (!view || !file) {
			return;
		}

		const markdown = await this.app.vault.cachedRead(file);
		if (
			view !== this.sourceView ||
			view.file !== file ||
			file.path !== this.selectedSourcePath ||
			(this.completedSource?.sourcePath === file.path &&
				this.completedSource.markdown === markdown) ||
			(this.pendingSource?.sourcePath === file.path &&
				this.pendingSource.markdown === markdown)
		) {
			return;
		}

		invalidateOutlineSource(file.path);
		const generation = ++this.sourceRenderGeneration;
		await this.populateRenderedSource(view, file, markdown, generation);
	}

	private renderOutline() {
		if (!this.outlineEl) {
			return;
		}

		const parseResult = this.getOutlineParseResult();
		if (!parseResult) {
			this.lastParseResult = undefined;
			this.outlineEl.empty();
			this.renderedEntries = [];
			this.pinnedTarget = undefined;
			return;
		}

		const previousParseResult = this.lastParseResult;
		this.lastParseResult = parseResult;
		if (
			previousParseResult &&
			this.isSameParseResult(previousParseResult, parseResult)
		) {
			return;
		}

		const nextOutlineEl = this.outlineEl.ownerDocument.createElement('div');
		const nextRenderedEntries: {
			entry: OutlineEntry;
			rowEl: HTMLElement;
		}[] = [];
		const entries = parseResult.entries;
		if (entries.length === 0) {
			this.renderEmptyState(nextOutlineEl);
			this.outlineEl.replaceChildren(
				...Array.from(nextOutlineEl.childNodes),
			);
			this.renderedEntries = nextRenderedEntries;
			this.pinnedTarget = undefined;
			return;
		}
		const collapsedEntries =
			this.collapsedEntriesBySource.get(parseResult.sourcePath!) ??
			new Set();
		const parentStack: {
			childrenEl: HTMLElement;
			depth: number;
		}[] = [{ childrenEl: nextOutlineEl, depth: -1 }];
		for (const [index, entry] of entries.entries()) {
			const hasChildren = (entries[index + 1]?.depth ?? -1) > entry.depth;
			const isCollapsible = entry.type === 'heading' && hasChildren;
			const isCollapsed =
				isCollapsible && collapsedEntries.has(this.getEntryKey(entry));
			while (parentStack[parentStack.length - 1]!.depth >= entry.depth) {
				parentStack.pop();
			}
			const treeItemEl = parentStack[
				parentStack.length - 1
			]!.childrenEl.createDiv({
				cls: `tree-item monki-outline-${entry.type}${isCollapsed ? ' is-collapsed' : ''}`,
			});
			const rowEl = treeItemEl.createDiv({
				cls: `tree-item-self is-clickable${isCollapsible ? ' mod-collapsible' : ''}`,
				attr: { 'data-line': String(entry.line) },
			});
			if (entry.type === 'link') {
				const pageIconEl = rowEl.createDiv({
					cls: 'tree-item-icon',
					attr: { 'aria-hidden': 'true' },
				});
				setIcon(pageIconEl, 'file-minus');
			} else if (isCollapsible) {
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
			nextRenderedEntries.push({ entry, rowEl });
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
		this.outlineEl.replaceChildren(...Array.from(nextOutlineEl.childNodes));
		this.renderedEntries = nextRenderedEntries;
		for (const { rowEl } of this.renderedEntries) {
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

	private getOutlineParseResult(): OutlineParseResult | undefined {
		const sourcePath = this.selectedSourcePath;
		const sections = sourcePath ? sectionsBySource.get(sourcePath) : undefined;
		if (!sourcePath || !sections) {
			return undefined;
		}

		const entries = [...sections.values()]
			.sort((left, right) => left.lineStart - right.lineStart)
			.flatMap((section) => section.entries)
			.map((entry) => ({ ...entry }));
		return { entries, sourcePath };
	}

	private isSameParseResult(
		left: OutlineParseResult,
		right: OutlineParseResult,
	) {
		return (
			left.sourcePath === right.sourcePath &&
			left.entries.length === right.entries.length &&
			left.entries.every((entry, index) =>
				this.isSameEntry(entry, right.entries[index]!),
			)
		);
	}

	private renderEmptyState(containerEl: HTMLElement) {
		const emptyStateEl = containerEl.createDiv({
			cls: 'monki-outline-empty',
		});
		emptyStateEl.createEl('img', {
			cls: 'monki-outline-empty-image',
			attr: {
				alt: '',
				draggable: 'false',
				src: this.emptyStateImageUrl,
			},
		});
		emptyStateEl.createEl('p', {
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

	private async populateFileSource(
		view: MarkdownView,
		file: TFile,
		generation: number,
	) {
		const markdown = await this.app.vault.cachedRead(file);
		if (!this.isCurrentSource(view, file, generation)) {
			return;
		}
		await this.populateRenderedSource(view, file, markdown, generation);
	}

	private async populateRenderedSource(
		view: MarkdownView,
		file: TFile,
		markdown: string,
		generation: number,
	) {
		if (!this.isCurrentSource(view, file, generation)) {
			return;
		}

		const pendingSource = { markdown, sourcePath: file.path };
		this.pendingSource = pendingSource;
		const renderComponent = new Component();
		renderComponent.load();
		internalRenderCountsBySource.set(
			file.path,
			(internalRenderCountsBySource.get(file.path) ?? 0) + 1,
		);
		try {
			const renderedEl = createDiv();
			await MarkdownRenderer.render(
				this.app,
				markdown,
				renderedEl,
				file.path,
				renderComponent,
			);
			if (!this.isCurrentSource(view, file, generation)) {
				return;
			}
			processRenderedOutlineDocument(this.app, renderedEl, file);
			this.completedSource = { markdown, sourcePath: file.path };
			this.renderOutline();
		} finally {
			if (this.pendingSource === pendingSource) {
				this.pendingSource = undefined;
			}
			const remainingInternalRenders =
				(internalRenderCountsBySource.get(file.path) ?? 1) - 1;
			if (remainingInternalRenders === 0) {
				internalRenderCountsBySource.delete(file.path);
			} else {
				internalRenderCountsBySource.set(
					file.path,
					remainingInternalRenders,
				);
			}
			renderComponent.unload();
		}
	}

	private isCurrentSource(
		view: MarkdownView,
		file: TFile,
		generation: number,
	) {
		return (
			generation === this.sourceRenderGeneration &&
			view === this.sourceView &&
			view.file === file &&
			file.path === this.selectedSourcePath
		);
	}

	private refreshTargets(useEditorContents = false) {
		if (this.clearHiddenSource()) {
			return;
		}

		const view = this.sourceView;
		const file = view?.file;
		if (!view || !file) {
			return;
		}

		this.pinnedTarget = undefined;
		invalidateOutlineSource(file.path);
		const generation = ++this.sourceRenderGeneration;
		if (useEditorContents) {
			void this.populateRenderedSource(
				view,
				file,
				view.editor.getValue(),
				generation,
			);
		} else {
			void this.populateFileSource(view, file, generation);
		}
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
