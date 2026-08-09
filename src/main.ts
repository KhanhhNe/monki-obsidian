import { MarkdownView, normalizePath, Plugin } from 'obsidian';
import { checkboxShortcuts } from './checkbox-shortcuts';
import {
	MONKI_OUTLINE_VIEW_TYPE,
	MonkiOutlineView,
	processRenderedOutlineSection,
} from './monki-outline-view';
import {
	getOrCreateMoodCalendarDataFile,
	MOOD_CALENDAR_VIEW_TYPE,
	MoodCalendarView,
} from './mood-calendar-view';

export default class MonkiPlugin extends Plugin {
	onload() {
		this.registerEditorExtension(checkboxShortcuts);
		this.registerView(MONKI_OUTLINE_VIEW_TYPE, (leaf) => {
			const pluginDirectory =
				this.manifest.dir ??
				`${this.app.vault.configDir}/plugins/${this.manifest.id}`;
			const emptyStateImageUrl = this.app.vault.adapter.getResourcePath(
				normalizePath(`${pluginDirectory}/assets/outline-dog.png`),
			);
			return new MonkiOutlineView(leaf, emptyStateImageUrl);
		});
		this.registerView(
			MOOD_CALENDAR_VIEW_TYPE,
			(leaf) => new MoodCalendarView(leaf),
		);
		this.registerMarkdownPostProcessor((element, context) => {
			if (!processRenderedOutlineSection(this.app, element, context)) {
				return;
			}
			for (const leaf of this.app.workspace.getLeavesOfType(
				MONKI_OUTLINE_VIEW_TYPE,
			)) {
				if (leaf.view instanceof MonkiOutlineView) {
					leaf.view.refreshSource(context.sourcePath);
				}
			}
		});

		this.addCommand({
			id: 'open-monki-outline',
			name: 'Open Monki Outline',
			hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'O' }],
			callback: async () => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				let leaf = this.app.workspace.getLeavesOfType(
					MONKI_OUTLINE_VIEW_TYPE,
				)[0];

				if (!leaf) {
					leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
					await leaf?.setViewState({
						type: MONKI_OUTLINE_VIEW_TYPE,
						active: true,
					});
				}

				if (leaf) {
					if (markdownView && leaf.view instanceof MonkiOutlineView) {
						leaf.view.setSourceView(markdownView);
					}
					this.app.workspace.rightSplit.expand();
					this.app.workspace.setActiveLeaf(leaf, { focus: true });
				}
			},
		});

		this.addCommand({
			id: 'show-mood-data',
			name: 'Show mood data',
			callback: async () => {
				const dataFile = await getOrCreateMoodCalendarDataFile(
					this.app,
				);
				let leaf = this.app.workspace
					.getLeavesOfType('markdown')
					.find(
						(candidate) =>
							candidate.view instanceof MarkdownView &&
							candidate.view.file === dataFile,
					);
				if (!leaf) {
					leaf = this.app.workspace.getLeaf('tab');
					await leaf.openFile(dataFile);
				}

				this.app.workspace.setActiveLeaf(leaf, { focus: true });
			},
		});

		this.addCommand({
			id: 'show-mood-calendar',
			name: 'Show mood calendar',
			callback: async () => {
				let leaf = this.app.workspace.getLeavesOfType(
					MOOD_CALENDAR_VIEW_TYPE,
				)[0];
				if (!leaf) {
					leaf = this.app.workspace.getLeaf('tab');
					await leaf.setViewState({
						type: MOOD_CALENDAR_VIEW_TYPE,
						active: true,
					});
				}

				this.app.workspace.setActiveLeaf(leaf, { focus: true });
			},
		});
	}
}
