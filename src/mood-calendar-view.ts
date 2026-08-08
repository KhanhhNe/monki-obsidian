import {
	App,
	ItemView,
	Menu,
	normalizePath,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

export const MOOD_CALENDAR_VIEW_TYPE = 'monki-mood-calendar';

const MOOD_CALENDAR_NOTE_PATH = normalizePath('Mood Calendar.md');
const MOOD_CALENDAR_ID_PROPERTY = 'monkiMoodCalendarId';
const MOOD_CALENDAR_ID = 'monki-obsidian-mood-calendar-v1';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_MOOD_OPTIONS = [
	'😍 rất zuiii',
	'😊 zuii',
	'😉 bth',
	'😢 hơi bùn',
	'😣 bùnn',
	'😴 bùn ngủ',
];
const DEFAULT_MOOD_OPTIONS_PROPERTY = DEFAULT_MOOD_OPTIONS.join(', ');
const MOOD_RECORD_PATTERN =
	/^#(\d{2})\/(\d{2})\/(\d{4})(?:[ \t]+([^\r\n]*))?[ \t]*$/gm;

export async function getOrCreateMoodCalendarDataFile(app: App) {
	const identifiedFile = app.vault
		.getMarkdownFiles()
		.find(
			(file) =>
				app.metadataCache.getFileCache(file)?.frontmatter?.[
					MOOD_CALENDAR_ID_PROPERTY
				] === MOOD_CALENDAR_ID,
		);
	if (identifiedFile) {
		return identifiedFile;
	}

	const existingFile = app.vault.getAbstractFileByPath(
		MOOD_CALENDAR_NOTE_PATH,
	);
	if (existingFile instanceof TFile) {
		return existingFile;
	}
	if (existingFile) {
		throw new Error(
			`Cannot create ${MOOD_CALENDAR_NOTE_PATH}: that path is already in use.`,
		);
	}

	const legacyMovedFile = await findLegacyMovedDataFile(app);
	if (legacyMovedFile) {
		return legacyMovedFile;
	}

	return app.vault.create(
		MOOD_CALENDAR_NOTE_PATH,
		`---\n${MOOD_CALENDAR_ID_PROPERTY}: ${MOOD_CALENDAR_ID}\nmoodOptions: ${DEFAULT_MOOD_OPTIONS_PROPERTY}\n---\n\n# Mood calendar\n`,
	);
}

async function findLegacyMovedDataFile(app: App) {
	const candidates = app.vault
		.getMarkdownFiles()
		.filter(
			(file) =>
				file.path !== MOOD_CALENDAR_NOTE_PATH &&
				file.name === 'Mood Calendar.md' &&
				parseMoodOptions(
					app.metadataCache.getFileCache(file)?.frontmatter
						?.moodOptions,
				).length > 0,
		);

	for (const file of candidates) {
		const content = await app.vault.cachedRead(file);
		if (
			/^# Mood calendar\s*$/im.test(content) ||
			parseMoodRecords(content).length > 0
		) {
			return file;
		}
	}

	return undefined;
}

interface MoodRecord {
	dateKey: string;
	mood: string;
	start: number;
	end: number;
}

export class MoodCalendarView extends ItemView {
	private calendarEl?: HTMLDivElement;
	private dataFile?: TFile;
	private displayedMonth = startOfMonth(new Date());
	private moodOptions = DEFAULT_MOOD_OPTIONS;
	private moods = new Map<string, string>();

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return MOOD_CALENDAR_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Mood calendar';
	}

	getIcon() {
		return 'calendar-days';
	}

	async onOpen() {
		this.contentEl.empty();
		this.calendarEl = this.contentEl.createDiv({
			cls: 'monki-mood-calendar',
		});
		this.registerDomEvent(this.calendarEl, 'click', (event) => {
			const target = event.target as HTMLElement;
			const actionEl = target.closest<HTMLElement>(
				'[data-calendar-action]',
			);
			if (actionEl) {
				this.handleCalendarAction(actionEl.dataset.calendarAction);
				return;
			}

			const dayEl = target.closest<HTMLButtonElement>(
				'.monki-mood-day[data-date]',
			);
			if (dayEl?.dataset.date) {
				this.showMoodMenu(event, dayEl.dataset.date);
			}
		});

		this.dataFile = await getOrCreateMoodCalendarDataFile(this.app);
		await this.ensureDataFileIdentity();
		await this.ensureMoodOptionsProperty();
		await this.migrateLegacyMoods();
		await this.app.vault.process(this.dataFile, ensureMoodRecordSpacing);
		await this.loadMoods();
		this.renderCalendar();
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file.path === this.dataFile?.path) {
					void this.reloadCalendar();
				}
			}),
		);
	}

	private async ensureDataFileIdentity() {
		if (!this.dataFile) {
			return;
		}

		const frontmatter = this.app.metadataCache.getFileCache(
			this.dataFile,
		)?.frontmatter;
		if (frontmatter?.[MOOD_CALENDAR_ID_PROPERTY] === MOOD_CALENDAR_ID) {
			return;
		}

		await this.app.fileManager.processFrontMatter(
			this.dataFile,
			(frontmatterValue: unknown) => {
				if (isRecord(frontmatterValue)) {
					frontmatterValue[MOOD_CALENDAR_ID_PROPERTY] =
						MOOD_CALENDAR_ID;
				}
			},
		);
	}

	private async ensureMoodOptionsProperty() {
		if (!this.dataFile) {
			return;
		}

		const frontmatter = this.app.metadataCache.getFileCache(
			this.dataFile,
		)?.frontmatter;
		if (parseMoodOptions(frontmatter?.moodOptions).length > 0) {
			return;
		}

		await this.app.fileManager.processFrontMatter(
			this.dataFile,
			(frontmatterValue: unknown) => {
				if (isRecord(frontmatterValue)) {
					frontmatterValue.moodOptions =
						DEFAULT_MOOD_OPTIONS_PROPERTY;
				}
			},
		);
	}

	private async migrateLegacyMoods() {
		if (!this.dataFile) {
			return;
		}

		const frontmatter = this.app.metadataCache.getFileCache(
			this.dataFile,
		)?.frontmatter;
		const storedMoods: unknown = frontmatter?.moods;
		if (!isRecord(storedMoods)) {
			return;
		}

		const legacyMoods = Object.entries(storedMoods).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === 'string' &&
				Boolean(entry[1].trim()) &&
				isDateKey(entry[0]),
		);
		await this.app.fileManager.processFrontMatter(
			this.dataFile,
			(frontmatterValue: unknown) => {
				if (isRecord(frontmatterValue)) {
					delete frontmatterValue.moods;
				}
			},
		);
		if (legacyMoods.length === 0) {
			return;
		}

		await this.app.vault.process(this.dataFile, (content) => {
			let updatedContent = content;
			for (const [dateKey, mood] of legacyMoods.sort(([left], [right]) =>
				left.localeCompare(right),
			)) {
				if (
					!parseMoodRecords(updatedContent).some(
						(record) => record.dateKey === dateKey,
					)
				) {
					updatedContent = updateMoodRecord(
						updatedContent,
						dateKey,
						mood.trim(),
					);
				}
			}
			return updatedContent;
		});
	}

	private async loadMoods() {
		this.moods.clear();
		if (!this.dataFile) {
			return;
		}

		const frontmatter = this.app.metadataCache.getFileCache(
			this.dataFile,
		)?.frontmatter;
		const configuredMoodOptions = parseMoodOptions(
			frontmatter?.moodOptions,
		);
		this.moodOptions =
			configuredMoodOptions.length > 0
				? configuredMoodOptions
				: DEFAULT_MOOD_OPTIONS;
		const content = await this.app.vault.cachedRead(this.dataFile);
		for (const record of parseMoodRecords(content)) {
			if (record.mood) {
				this.moods.set(record.dateKey, record.mood);
			} else {
				this.moods.delete(record.dateKey);
			}
		}
	}

	private async reloadCalendar() {
		await this.loadMoods();
		this.renderCalendar();
	}

	private renderCalendar() {
		if (!this.calendarEl) {
			return;
		}

		this.calendarEl.empty();
		const toolbarEl = this.calendarEl.createDiv({
			cls: 'monki-mood-calendar-toolbar',
		});
		this.createIconButton(
			toolbarEl,
			'chevron-left',
			'Previous month',
			'previous',
		);
		toolbarEl.createEl('h2', {
			cls: 'monki-mood-calendar-title',
			text: this.displayedMonth.toLocaleDateString(undefined, {
				month: 'long',
				year: 'numeric',
			}),
		});
		this.createIconButton(toolbarEl, 'chevron-right', 'Next month', 'next');
		toolbarEl.createEl('button', {
			cls: 'monki-mood-calendar-today',
			text: 'Today',
			attr: { 'data-calendar-action': 'today', type: 'button' },
		});

		const gridEl = this.calendarEl.createDiv({
			cls: 'monki-mood-calendar-grid',
		});
		for (const weekday of WEEKDAYS) {
			gridEl.createDiv({
				cls: 'monki-mood-weekday',
				text: weekday,
			});
		}

		const year = this.displayedMonth.getFullYear();
		const month = this.displayedMonth.getMonth();
		const firstWeekday = this.displayedMonth.getDay();
		const dayCount = new Date(year, month + 1, 0).getDate();
		for (let index = 0; index < firstWeekday; index++) {
			gridEl.createDiv({ cls: 'monki-mood-day-placeholder' });
		}

		const todayKey = formatDateKey(new Date());
		for (let day = 1; day <= dayCount; day++) {
			const date = new Date(year, month, day);
			const dateKey = formatDateKey(date);
			const mood = this.moods.get(dateKey);
			const moodParts = splitMood(mood);
			const dayEl = gridEl.createEl('button', {
				cls: `monki-mood-day${dateKey === todayKey ? ' is-today' : ''}${mood ? ' has-mood' : ''}`,
				attr: {
					'aria-label': `${date.toLocaleDateString()}${mood ? `, ${mood}` : ''}`,
					'data-date': dateKey,
					type: 'button',
				},
			});
			dayEl.createSpan({
				cls: 'monki-mood-day-number',
				text: String(day),
			});
			const moodEl = dayEl.createSpan({ cls: 'monki-mood-day-value' });
			moodEl.createSpan({
				cls: 'monki-mood-day-icon',
				text: moodParts.icon,
			});
			moodEl.createSpan({
				cls: 'monki-mood-day-text',
				text: moodParts.text,
			});
		}
	}

	private createIconButton(
		containerEl: HTMLElement,
		icon: string,
		label: string,
		action: string,
	) {
		const buttonEl = containerEl.createEl('button', {
			cls: 'clickable-icon monki-mood-calendar-nav',
			attr: {
				'aria-label': label,
				'data-calendar-action': action,
				title: label,
				type: 'button',
			},
		});
		setIcon(buttonEl, icon);
	}

	private handleCalendarAction(action?: string) {
		switch (action) {
			case 'previous':
				this.displayedMonth = new Date(
					this.displayedMonth.getFullYear(),
					this.displayedMonth.getMonth() - 1,
					1,
				);
				break;
			case 'next':
				this.displayedMonth = new Date(
					this.displayedMonth.getFullYear(),
					this.displayedMonth.getMonth() + 1,
					1,
				);
				break;
			case 'today':
				this.displayedMonth = startOfMonth(new Date());
				break;
			default:
				return;
		}
		this.renderCalendar();
	}

	private showMoodMenu(event: MouseEvent, dateKey: string) {
		const activeMood = this.moods.get(dateKey);
		const menu = new Menu();
		for (const mood of this.moodOptions) {
			menu.addItem((item) =>
				item
					.setTitle(mood)
					.setChecked(activeMood === mood)
					.onClick(() => this.setMood(dateKey, mood)),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Clear')
				.setIcon('eraser')
				.setDisabled(!activeMood)
				.onClick(() => this.setMood(dateKey, '')),
		);

		menu.showAtMouseEvent(event);
	}

	private async setMood(dateKey: string, mood: string) {
		if (!this.dataFile || this.moods.get(dateKey) === mood) {
			return;
		}

		await this.app.vault.process(this.dataFile, (content) =>
			updateMoodRecord(content, dateKey, mood),
		);
		if (mood) {
			this.moods.set(dateKey, mood);
		} else {
			this.moods.delete(dateKey);
		}
		this.renderCalendar();
	}
}

function startOfMonth(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatDateKey(date: Date) {
	return [
		String(date.getFullYear()).padStart(4, '0'),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('/');
}

function isDateKey(value: string) {
	const [yearValue, monthValue, dayValue] = value.split('/');
	if (!yearValue || !monthValue || !dayValue) {
		return false;
	}

	const year = Number(yearValue);
	const month = Number(monthValue);
	const day = Number(dayValue);
	const date = new Date(year, month - 1, day);
	return (
		date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day
	);
}

function parseMoodRecords(content: string) {
	const records: MoodRecord[] = [];
	for (const match of content.matchAll(MOOD_RECORD_PATTERN)) {
		const [, day, month, year, mood = ''] = match;
		const dateKey = `${year}/${month}/${day}`;
		if (!isDateKey(dateKey) || match.index === undefined) {
			continue;
		}

		records.push({
			dateKey,
			mood: mood.trim(),
			start: match.index,
			end: match.index + match[0].length,
		});
	}
	return records;
}

function updateMoodRecord(content: string, dateKey: string, mood: string) {
	const [year, month, day] = dateKey.split('/');
	const marker = `#${day}/${month}/${year}`;
	const recordLine = mood.trim() ? `${marker} ${mood.trim()}` : marker;
	const records = parseMoodRecords(content);
	const existingRecord = records
		.slice()
		.reverse()
		.find((record) => record.dateKey === dateKey);
	if (existingRecord) {
		return ensureMoodRecordSpacing(
			`${content.slice(0, existingRecord.start)}${recordLine}${content.slice(existingRecord.end)}`,
		);
	}
	if (!mood.trim()) {
		return content;
	}

	const lineBreak = content.includes('\r\n') ? '\r\n' : '\n';
	const nextRecord = records.find((record) => record.dateKey > dateKey);
	if (nextRecord) {
		return ensureMoodRecordSpacing(
			`${content.slice(0, nextRecord.start)}${recordLine}${lineBreak}${content.slice(nextRecord.start)}`,
		);
	}

	const separator =
		content.length === 0 || content.endsWith('\n') ? '' : lineBreak;
	return ensureMoodRecordSpacing(
		`${content}${separator}${recordLine}${lineBreak}`,
	);
}

function ensureMoodRecordSpacing(content: string) {
	const records = parseMoodRecords(content);
	let updatedContent = content;
	for (let index = records.length - 1; index > 0; index--) {
		const previousRecord = records[index - 1]!;
		const currentRecord = records[index]!;
		const separator = content.slice(
			previousRecord.end,
			currentRecord.start,
		);
		if (separator === '\n' || separator === '\r\n') {
			updatedContent = `${updatedContent.slice(0, currentRecord.start)}${separator}${updatedContent.slice(currentRecord.start)}`;
		}
	}
	return updatedContent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMoodOptions(value: unknown) {
	if (typeof value !== 'string') {
		return [];
	}

	return value
		.split(',')
		.map((mood) => mood.trim())
		.filter(Boolean);
}

function splitMood(mood?: string) {
	const value = mood?.trim() ?? '';
	const iconMatch = value.match(
		/^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)\s*/u,
	);

	return {
		icon: iconMatch?.[1] ?? '',
		text: iconMatch ? value.slice(iconMatch[0].length).trim() : value,
	};
}
