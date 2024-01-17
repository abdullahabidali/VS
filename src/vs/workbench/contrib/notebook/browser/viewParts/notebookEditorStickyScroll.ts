/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { INotebookCellList } from 'vs/workbench/contrib/notebook/browser/view/notebookRenderingCommon';
import { OutlineEntry } from 'vs/workbench/contrib/notebook/browser/viewModel/OutlineEntry';
import { NotebookCellOutlineProvider } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookOutlineProvider';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export class ToggleNotebookStickyScroll extends Action2 {

	constructor() {
		super({
			id: 'notebook.action.toggleNotebookStickyScroll',
			title: {
				value: localize('toggleStickyScroll', "Toggle Notebook Sticky Scroll"),
				mnemonicTitle: localize({ key: 'mitoggleStickyScroll', comment: ['&& denotes a mnemonic'] }, "&&Toggle Notebook Sticky Scroll"),
				original: 'Toggle Notebook Sticky Scroll',
			},
			category: Categories.View,
			toggled: {
				condition: ContextKeyExpr.equals('config.notebook.stickyScroll.enabled', true),
				title: localize('notebookStickyScroll', "Notebook Sticky Scroll"),
				mnemonicTitle: localize({ key: 'miNotebookStickyScroll', comment: ['&& denotes a mnemonic'] }, "&&Notebook Sticky Scroll"),
			},
			menu: [
				{ id: MenuId.CommandPalette },
				{ id: MenuId.NotebookStickyScrollContext }
			]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const newValue = !configurationService.getValue('notebook.stickyScroll.enabled');
		return configurationService.updateValue('notebook.stickyScroll.enabled', newValue);
	}
}

export class NotebookStickyLine extends Disposable {
	constructor(
		public readonly element: HTMLElement,
		public readonly entry: OutlineEntry,
		public readonly notebookEditor: INotebookEditor,
	) {
		super();
		this._register(DOM.addDisposableListener(this.element, DOM.EventType.CLICK, () => {
			this.focusCell();
		}));
	}

	private focusCell() {
		this.notebookEditor.focusNotebookCell(this.entry.cell, 'container');
		const cellScrollTop = this.notebookEditor.getAbsoluteTopOfElement(this.entry.cell);
		const parentCount = this.getParentCount();
		// 1.1 addresses visible cell padding, to make sure we don't focus md cell and also render its sticky line
		this.notebookEditor.setScrollTop(cellScrollTop - (parentCount + 1.1) * 22);
	}

	private getParentCount() {
		let count = 0;
		let entry = this.entry;
		while (entry.parent) {
			count++;
			entry = entry.parent;
		}
		return count;
	}
}

export class NotebookStickyScroll extends Disposable {
	private readonly _disposables = new DisposableStore();
	private currentStickyLines = new Map<OutlineEntry, { line: NotebookStickyLine; rendered: boolean }>();
	private renderedStickyLines: NotebookStickyLine[] = [];
	private filteredOutlineEntries: OutlineEntry[] = [];

	private readonly _onDidChangeNotebookStickyScroll = this._register(new Emitter<number>());
	readonly onDidChangeNotebookStickyScroll: Event<number> = this._onDidChangeNotebookStickyScroll.event;


	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getCurrentStickyHeight() {
		let height = 0;
		this.currentStickyLines.forEach((value) => {
			if (value.rendered) {
				height += 22;
			}
		});
		return height;
	}

	private setCurrentStickyLines(newStickyLines: Map<OutlineEntry, { line: NotebookStickyLine; rendered: boolean }>) {
		this.currentStickyLines = newStickyLines;
	}

	private compareStickyLineMaps(mapA: Map<OutlineEntry, { line: NotebookStickyLine; rendered: boolean }>, mapB: Map<OutlineEntry, { line: NotebookStickyLine; rendered: boolean }>): boolean {
		if (mapA.size !== mapB.size) {
			return false;
		}

		for (const [key, value] of mapA) {
			const otherValue = mapB.get(key);
			if (!otherValue || value.rendered !== otherValue.rendered) {
				return false;
			}
		}

		return true;
	}

	constructor(
		private readonly domNode: HTMLElement,
		private readonly notebookEditor: INotebookEditor,
		private readonly notebookOutline: NotebookCellOutlineProvider,
		private readonly notebookCellList: INotebookCellList,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
	) {
		super();

		if (this.notebookEditor.notebookOptions.getDisplayOptions().stickyScroll) {
			this.init();
		}

		this._register(this.notebookEditor.notebookOptions.onDidChangeOptions((e) => {
			if (e.stickyScroll) {
				this.updateConfig();
			}
		}));

		this._register(DOM.addDisposableListener(this.domNode, DOM.EventType.CONTEXT_MENU, async (event: MouseEvent) => {
			this.onContextMenu(event);
		}));
	}

	private onContextMenu(e: MouseEvent) {
		const event = new StandardMouseEvent(DOM.getWindow(this.domNode), e);
		this._contextMenuService.showContextMenu({
			menuId: MenuId.NotebookStickyScrollContext,
			getAnchor: () => event,
		});
	}

	private updateConfig() {
		if (this.notebookEditor.notebookOptions.getDisplayOptions().stickyScroll) {
			this.init();
		} else {
			this._disposables.clear();
			this.disposeCurrentStickyLines();
			DOM.clearNode(this.domNode);
			this.updateDisplay();
		}
	}

	private init() {
		this.notebookOutline.init();
		this.filteredOutlineEntries = this.notebookOutline.entries.filter(entry => entry.level !== 7);

		this._disposables.add(this.notebookOutline.onDidChange(() => {
			this.filteredOutlineEntries = this.notebookOutline.entries.filter(entry => entry.level !== 7);
			const recompute = computeContent(this.notebookEditor, this.notebookCellList, this.filteredOutlineEntries, this.getCurrentStickyHeight(), this.renderedStickyLines);
			if (!this.compareStickyLineMaps(recompute, this.currentStickyLines)) {
				this.updateContent(recompute);
			}
		}));

		this._disposables.add(this.notebookEditor.onDidAttachViewModel(() => {
			this.notebookOutline.init();
			this.updateContent(computeContent(this.notebookEditor, this.notebookCellList, this.filteredOutlineEntries, this.getCurrentStickyHeight(), this.renderedStickyLines));
		}));

		this._disposables.add(this.notebookEditor.onDidScroll(() => {
			const recompute = computeContent(this.notebookEditor, this.notebookCellList, this.filteredOutlineEntries, this.getCurrentStickyHeight(), this.renderedStickyLines);
			if (!this.compareStickyLineMaps(recompute, this.currentStickyLines)) {
				this.updateContent(recompute);
			}
		}));
	}

	// take in an cell index, and get the corresponding outline entry
	static getVisibleOutlineEntry(visibleIndex: number, notebookOutlineEntries: OutlineEntry[]): OutlineEntry | undefined {
		let left = 0;
		let right = notebookOutlineEntries.length - 1;
		let bucket = -1;

		while (left <= right) {
			const mid = Math.floor((left + right) / 2);
			if (notebookOutlineEntries[mid].index === visibleIndex) {
				bucket = mid;
				break;
			} else if (notebookOutlineEntries[mid].index < visibleIndex) {
				bucket = mid;
				left = mid + 1;
			} else {
				right = mid - 1;
			}
		}

		if (bucket !== -1) {
			const rootEntry = notebookOutlineEntries[bucket];
			const flatList: OutlineEntry[] = [];
			rootEntry.asFlatList(flatList);
			return flatList.find(entry => entry.index === visibleIndex);
		}
		return undefined;
	}

	private updateContent(newMap: Map<OutlineEntry, { line: NotebookStickyLine; rendered: boolean }>) {
		DOM.clearNode(this.domNode);
		this.disposeCurrentStickyLines();
		this.renderStickyLines(newMap, this.domNode);

		const oldStickyHeight = this.getCurrentStickyHeight();
		this.setCurrentStickyLines(newMap);
		this.renderedStickyLines = Array.from(newMap.values())
			.filter(value => value.rendered)
			.map(value => value.line);

		// (+) = sticky height increased
		// (-) = sticky height decreased
		const sizeDelta = this.getCurrentStickyHeight() - oldStickyHeight;
		if (sizeDelta !== 0) {
			this._onDidChangeNotebookStickyScroll.fire(sizeDelta);
		}
		this.updateDisplay();
	}

	private updateDisplay() {
		const hasSticky = this.getCurrentStickyHeight() > 0;
		if (!hasSticky) {
			this.domNode.style.display = 'none';
		} else {
			this.domNode.style.display = 'block';
		}
	}

	static computeStickyHeight(entry: OutlineEntry) {
		let height = 0;
		if (entry.cell.cellKind === CellKind.Markup && entry.level !== 7) {
			height += 22;
		}
		while (entry.parent) {
			height += 22;
			entry = entry.parent;
		}
		return height;
	}

	static checkCollapsedStickyLines(entry: OutlineEntry | undefined, numLinesToRender: number, notebookEditor: INotebookEditor) {
		let currentEntry = entry;
		const newMap = new Map<OutlineEntry, { line: NotebookStickyLine; rendered: boolean }>();

		const elementsToRender = [];
		while (currentEntry) {
			if (currentEntry.level === 7) {
				// level 7 represents a non-header entry, which we don't want to render
				currentEntry = currentEntry.parent;
				continue;
			}
			const lineToRender = NotebookStickyScroll.createStickyElement(currentEntry, notebookEditor);
			newMap.set(currentEntry, { line: lineToRender, rendered: false });
			elementsToRender.unshift(lineToRender);
			currentEntry = currentEntry.parent;
		}

		// iterate over elements to render, and append to container
		// break when we reach numLinesToRender
		for (let i = 0; i < elementsToRender.length; i++) {
			if (i >= numLinesToRender) {
				break;
			}
			newMap.set(elementsToRender[i].entry, { line: elementsToRender[i], rendered: true });
		}
		return newMap;
	}

	private renderStickyLines(stickyMap: Map<OutlineEntry, { line: NotebookStickyLine; rendered: boolean }>, containerElement: HTMLElement) {
		const reversedEntries = Array.from(stickyMap.entries()).reverse();
		for (const [, value] of reversedEntries) {
			if (!value.rendered) {
				continue;
			}
			containerElement.append(value.line.element);
		}
	}

	static createStickyElement(entry: OutlineEntry, notebookEditor: INotebookEditor) {
		const stickyElement = document.createElement('div');
		stickyElement.classList.add('notebook-sticky-scroll-line');
		stickyElement.innerText = '#'.repeat(entry.level) + ' ' + entry.label;
		return new NotebookStickyLine(stickyElement, entry, notebookEditor);
	}

	private disposeCurrentStickyLines() {
		this.currentStickyLines.forEach((value) => {
			value.line.dispose();
		});
	}

	override dispose() {
		this._disposables.dispose();
		this.disposeCurrentStickyLines();
		super.dispose();
	}
}

export function computeContent(notebookEditor: INotebookEditor, notebookCellList: INotebookCellList, notebookOutlineEntries: OutlineEntry[], renderedStickyHeight: number, renderedLines: NotebookStickyLine[]): Map<OutlineEntry, { line: NotebookStickyLine; rendered: boolean }> {
	// get data about the cell list within viewport ----------------------------------------------------------------------------------------
	const editorScrollTop = notebookEditor.scrollTop - renderedStickyHeight;
	const visibleRange = notebookEditor.visibleRanges[0];
	if (!visibleRange) {
		return new Map();
	}

	const startIndex = visibleRange.start > 0 ? visibleRange.start - 1 : visibleRange.start;

	// iterate over cells in viewport ------------------------------------------------------------------------------------------------------
	let cell;
	let cellEntry;
	for (let currentIndex = startIndex; currentIndex < visibleRange.end; currentIndex++) {
		// store data for current cell, and next cell
		cell = notebookEditor.cellAt(currentIndex);
		if (!cell) {
			return new Map();
		}
		cellEntry = NotebookStickyScroll.getVisibleOutlineEntry(currentIndex, notebookOutlineEntries);
		if (!cellEntry) {
			return new Map();
		}

		const nextCell = notebookEditor.cellAt(currentIndex + 1);
		if (!nextCell) {
			const sectionBottom = notebookEditor.getLayoutInfo().scrollHeight;
			const linesToRender = Math.floor((sectionBottom) / 22);
			const newMap = NotebookStickyScroll.checkCollapsedStickyLines(cellEntry, linesToRender, notebookEditor);
			return newMap;
		}
		const nextCellEntry = NotebookStickyScroll.getVisibleOutlineEntry(currentIndex + 1, notebookOutlineEntries);
		if (!nextCellEntry) {
			return new Map();
		}

		// check next cell, if markdown with non level 7 entry, that means this is the end of the section (new header) ---------------------
		if (nextCell.cellKind === CellKind.Markup && nextCellEntry.level !== 7) {
			const sectionBottom = notebookCellList.getCellViewScrollTop(nextCell);
			const currentSectionStickyHeight = NotebookStickyScroll.computeStickyHeight(cellEntry);
			const nextSectionStickyHeight = NotebookStickyScroll.computeStickyHeight(nextCellEntry);

			// case: we can render the all sticky lines for the current section ------------------------------------------------------------
			if (editorScrollTop + currentSectionStickyHeight < sectionBottom) {
				const linesToRender = Math.floor((sectionBottom - editorScrollTop) / 22);
				const newMap = NotebookStickyScroll.checkCollapsedStickyLines(cellEntry, linesToRender, notebookEditor);
				return newMap;
			}

			// cases: next section has a parent, so adjust based on find the shared parent -------------------------------------------------
			// shrink until sizes are the same, then render the next section
			else if (nextSectionStickyHeight === currentSectionStickyHeight) {
				const newMap = NotebookStickyScroll.checkCollapsedStickyLines(nextCellEntry, 100, notebookEditor); // !document why I use 100 and don't compute linesToRender
				return newMap;
			}
			// next section is larger than current section, don't shrink, render another
			else if (nextSectionStickyHeight > currentSectionStickyHeight) {
				// if the difference is greater than 22, throw an error. this shouldn't be possible
				if (nextSectionStickyHeight - currentSectionStickyHeight > 22) {
					throw new Error('next > curr, but diff > 22');
				}
				const newMap = NotebookStickyScroll.checkCollapsedStickyLines(nextCellEntry, 100, notebookEditor); // !document why I use 100 and don't compute linesToRender
				return newMap;
			}
			// next section is smaller than current section, shrink until the you find the shared node then re-render
			else if (nextSectionStickyHeight < currentSectionStickyHeight) {
				const availableSpace = sectionBottom - editorScrollTop;

				if (nextSectionStickyHeight === renderedLines.length * 22) {
					if (availableSpace > (renderedLines.length + 1) * 22) {
						const linesToRender = Math.floor((availableSpace) / 22);
						const newMap = NotebookStickyScroll.checkCollapsedStickyLines(cellEntry, linesToRender, notebookEditor);
						return newMap;
					} else {
						const newMap = NotebookStickyScroll.checkCollapsedStickyLines(nextCellEntry, 100, notebookEditor);
						return newMap;
					}
				} else {
					const linesToRender = Math.floor((availableSpace) / 22);
					const newMap = NotebookStickyScroll.checkCollapsedStickyLines(cellEntry, linesToRender, notebookEditor);
					return newMap;
				}
			}
		}
	} // visible range loop close

	// case: all visible cells were non-header cells, so render any headers relevant to their section --------------------------------------
	const sectionBottom = notebookEditor.getLayoutInfo().scrollHeight;
	const linesToRender = Math.floor((sectionBottom - editorScrollTop) / 22);
	const newMap = NotebookStickyScroll.checkCollapsedStickyLines(cellEntry, linesToRender, notebookEditor);
	return newMap;
}

registerAction2(ToggleNotebookStickyScroll);
