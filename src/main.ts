import { MarkdownView, Plugin } from 'obsidian';
import { checkboxShortcuts } from './checkbox-shortcuts';
import {
	MONKI_OUTLINE_VIEW_TYPE,
	MonkiOutlineView,
	processRenderedOutlineSection,
} from './monki-outline-view';

export default class MonkiPlugin extends Plugin {
	onload() {
		this.registerEditorExtension(checkboxShortcuts);
		this.registerView(
			MONKI_OUTLINE_VIEW_TYPE,
			(leaf) => new MonkiOutlineView(leaf),
		);
		this.registerMarkdownPostProcessor((element, context) => {
			processRenderedOutlineSection(this.app, element, context);
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
	}
}
