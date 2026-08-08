import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

const CHECKBOX_MARKER = '- [ ]';
const CHECKBOX_WITH_SPACE = `${CHECKBOX_MARKER} `;

function insertCheckbox(view: EditorView, from: number, to: number, text: string) {
    // Expect the cursor is inserting a <space> after an 'x' in the start of line
    // `from` and `to` should be the same i.e. not selecting text
	if (text !== ' ' || from !== to) {
		return false;
	}

	const line = view.state.doc.lineAt(from);
	if (view.state.doc.sliceString(line.from, from) !== 'x') {
		return false;
	}

	view.dispatch({
		changes: {
			from: line.from,
			to,
			insert: CHECKBOX_WITH_SPACE,
		},
		selection: { anchor: line.from + CHECKBOX_WITH_SPACE.length },
		scrollIntoView: true,
	});
	return true;
}

function deleteCheckbox(view: EditorView) {
	const { selection } = view.state;
	if (selection.ranges.length !== 1 || !selection.main.empty) {
		return false;
	}

	const cursor = selection.main.head;
	const line = view.state.doc.lineAt(cursor);
	const textBeforeCursor = view.state.doc.sliceString(line.from, cursor);
	if (
		textBeforeCursor !== CHECKBOX_MARKER &&
		textBeforeCursor !== CHECKBOX_WITH_SPACE
	) {
		return false;
	}

	view.dispatch({
		changes: { from: line.from, to: cursor },
		selection: { anchor: line.from },
		scrollIntoView: true,
	});
	return true;
}

export const checkboxShortcuts = [
	EditorView.inputHandler.of(insertCheckbox),
	Prec.highest(
		keymap.of([
			{
				key: 'Backspace',
				run: deleteCheckbox,
			},
		]),
	),
];
