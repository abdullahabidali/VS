/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IListService, WorkbenchList } from 'vs/platform/list/browser/listService';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ITerminalInstance, ITerminalInstanceService, ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { MenuItemAction } from 'vs/platform/actions/common/actions';
import { MenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { KEYBINDING_CONTEXT_TERMINAL_TABS_SINGULAR_SELECTION, TerminalCommandId } from 'vs/workbench/contrib/terminal/common/terminal';
import { TerminalSettingId } from 'vs/platform/terminal/common/terminal';
import { Codicon, iconRegistry } from 'vs/base/common/codicons';
import { Action } from 'vs/base/common/actions';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { TerminalDecorationsProvider } from 'vs/workbench/contrib/terminal/browser/terminalDecorationsProvider';
import { DEFAULT_LABELS_CONTAINER, IResourceLabel, ResourceLabels } from 'vs/workbench/browser/labels';
import { IDecorationsService } from 'vs/workbench/services/decorations/browser/decorations';
import { IHoverAction, IHoverService } from 'vs/workbench/services/hover/browser/hover';
import Severity from 'vs/base/common/severity';
import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { IListDragAndDrop, IListRenderer } from 'vs/base/browser/ui/list/list';
import { DataTransfers, IDragAndDropData } from 'vs/base/browser/dnd';
import { disposableTimeout } from 'vs/base/common/async';
import { ElementsDragAndDropData } from 'vs/base/browser/ui/list/listView';
import { URI } from 'vs/base/common/uri';
import { ColorScheme } from 'vs/platform/theme/common/theme';

const $ = DOM.$;
const TAB_HEIGHT = 22;
export const MIN_TABS_LIST_WIDTH = 46;
export const DEFAULT_TABS_LIST_WIDTH = 80;
export const MIDPOINT_LIST_WIDTH = (MIN_TABS_LIST_WIDTH + DEFAULT_TABS_LIST_WIDTH) / 2;
export const THRESHOLD_ACTIONBAR_WIDTH = 105;

export class TerminalTabList extends WorkbenchList<ITerminalInstance> {
	private _decorationsProvider: TerminalDecorationsProvider | undefined;
	private _terminalTabsSingleSelectedContextKey: IContextKey<boolean>;

	constructor(
		container: HTMLElement,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ITerminalService private _terminalService: ITerminalService,
		@ITerminalInstanceService _terminalInstanceService: ITerminalInstanceService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IDecorationsService _decorationsService: IDecorationsService,
		@IThemeService _themeService: IThemeService
	) {
		super('TerminalTabsTree', container,
			{
				getHeight: () => TAB_HEIGHT,
				getTemplateId: () => 'terminal.tabs'
			},
			[instantiationService.createInstance(TerminalTabsRenderer, container, instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER), () => this.getSelectedElements())],
			{
				horizontalScrolling: false,
				supportDynamicHeights: false,
				identityProvider: {
					getId: e => e?.instanceId
				},
				accessibilityProvider: instantiationService.createInstance(TerminalTabsAccessibilityProvider),
				smoothScrolling: configurationService.getValue<boolean>('workbench.list.smoothScrolling'),
				multipleSelectionSupport: true,
				additionalScrollHeight: TAB_HEIGHT,
				dnd: new TerminalTabsDragAndDrop(_terminalService, _terminalInstanceService)
			},
			contextKeyService,
			listService,
			themeService,
			configurationService,
			keybindingService,
		);
		this._terminalService.onInstancesChanged(() => this.render());
		this._terminalService.onInstanceTitleChanged(() => this.render());
		this._terminalService.onInstanceIconChanged(() => {
			this.render();
		});
		this._terminalService.onInstancePrimaryStatusChanged(() => this.render());

		_themeService.onDidColorThemeChange(() => this.render());
		this._terminalService.onActiveInstanceChanged(e => {
			if (e) {
				const i = this._terminalService.terminalInstances.indexOf(e);
				this.setSelection([i]);
				this.reveal(i);
			}
		});

		this.onMouseDblClick(async () => {
			if (this.getFocus().length === 0) {
				const instance = this._terminalService.createTerminal();
				this._terminalService.setActiveInstance(instance);
				await instance.focusWhenReady();
			}
		});

		// on left click, if focus mode = single click, focus the element
		// unless multi-selection is in progress
		this.onMouseClick(e => {
			const focusMode = configurationService.getValue<'singleClick' | 'doubleClick'>(TerminalSettingId.TabsFocusMode);
			if (e.browserEvent.altKey && e.element) {
				this._terminalService.splitInstance(e.element);
			} else if (focusMode === 'singleClick') {
				if (this.getSelection().length <= 1) {
					e.element?.focus(true);
				}
			}
		});

		// on right click, set the focus to that element
		// unless multi-selection is in progress
		this.onContextMenu(e => {
			if (!e.element) {
				this.setSelection([]);
				return;
			}
			const selection = this.getSelectedElements();
			if (!selection || !selection.find(s => e.element === s)) {
				this.setFocus(e.index !== undefined ? [e.index] : []);
			}
		});

		this._terminalTabsSingleSelectedContextKey = KEYBINDING_CONTEXT_TERMINAL_TABS_SINGULAR_SELECTION.bindTo(contextKeyService);

		this.onDidChangeSelection(e => {
			this._terminalTabsSingleSelectedContextKey.set(e.elements.length === 1);
		});

		this.onDidChangeFocus(e => {
			this._terminalTabsSingleSelectedContextKey.set(e.elements.length === 1);
		});

		this.onDidOpen(async e => {
			const instance = e.element;
			if (!instance) {
				return;
			}
			this._terminalService.setActiveInstance(instance);
			if (!e.editorOptions.preserveFocus) {
				await instance.focusWhenReady();
			}
		});
		if (!this._decorationsProvider) {
			this._decorationsProvider = instantiationService.createInstance(TerminalDecorationsProvider);
			_decorationsService.registerDecorationsProvider(this._decorationsProvider);
		}
		this.render();
	}

	render(): void {
		this.splice(0, this.length, this._terminalService.terminalInstances);
	}
}

class TerminalTabsRenderer implements IListRenderer<ITerminalInstance, ITerminalTabEntryTemplate> {
	templateId = 'terminal.tabs';

	constructor(
		private readonly _container: HTMLElement,
		private readonly _labels: ResourceLabels,
		private readonly _getSelection: () => ITerminalInstance[],
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IListService private readonly _listService: IListService,
		@IThemeService private readonly _themeService: IThemeService
	) {
	}

	renderTemplate(container: HTMLElement): ITerminalTabEntryTemplate {
		const element = DOM.append(container, $('.terminal-tabs-entry'));
		const context: { hoverActions?: IHoverAction[] } = {};
		const label = this._labels.create(element, {
			supportHighlights: true,
			supportDescriptionHighlights: true,
			supportIcons: true,
			hoverDelegate: {
				delay: this._configurationService.getValue<number>('workbench.hover.delay'),
				showHover: options => {
					return this._hoverService.showHover({
						...options,
						actions: context.hoverActions,
						hideOnHover: true
					});
				}
			}
		});

		const actionsContainer = DOM.append(label.element, $('.actions'));

		const actionBar = new ActionBar(actionsContainer, {
			actionViewItemProvider: action =>
				action instanceof MenuItemAction
					? this._instantiationService.createInstance(MenuEntryActionViewItem, action)
					: undefined
		});

		return {
			element,
			label,
			actionBar,
			context
		};
	}

	shouldHideText(): boolean {
		return this._container ? this._container.clientWidth < MIDPOINT_LIST_WIDTH : false;
	}

	shouldHideActionBar(): boolean {
		return this._container ? this._container.clientWidth <= THRESHOLD_ACTIONBAR_WIDTH : false;
	}

	renderElement(instance: ITerminalInstance, index: number, template: ITerminalTabEntryTemplate): void {
		const group = this._terminalService.getGroupForInstance(instance);
		if (!group) {
			throw new Error(`Could not find group for instance "${instance.instanceId}"`);
		}

		const hasText = !this.shouldHideText();
		template.element.classList.toggle('has-text', hasText);

		let prefix: string = '';
		if (group.terminalInstances.length > 1) {
			const terminalIndex = group.terminalInstances.indexOf(instance);
			if (terminalIndex === 0) {
				prefix = `┌ `;
			} else if (terminalIndex === group!.terminalInstances.length - 1) {
				prefix = `└ `;
			} else {
				prefix = `├ `;
			}
		}

		let title = instance.title;
		const statuses = instance.statusList.statuses;
		template.context.hoverActions = [];
		for (const status of statuses) {
			title += `\n\n---\n\n${status.tooltip || status.id}`;
			if (status.hoverActions) {
				template.context.hoverActions.push(...status.hoverActions);
			}
		}
		const iconClass = typeof instance.icon === 'object' && 'id' in instance.icon ? instance.icon?.id
			: typeof instance.icon === 'string' && iconRegistry.get(instance.icon) ? instance.icon
				: Codicon.terminal.id;
		const hasActionbar = !this.shouldHideActionBar();
		let label: string = '';
		if (!hasText) {
			const primaryStatus = instance.statusList.primary;
			if (primaryStatus && primaryStatus.severity >= Severity.Warning) {
				label = `${prefix}$(${primaryStatus.icon?.id || iconClass})`;
			} else {
				label = `${prefix}$(${iconClass})`;
			}
		} else {
			this.fillActionBar(instance, template);
			label = `${prefix}$(${iconClass})`;
			// Only add the title if the icon is set, this prevents the title jumping around for
			// example when launching with a ShellLaunchConfig.name and no icon
			if (instance.icon) {
				label += ` ${instance.title}`;
			}
		}

		if (!hasActionbar) {
			template.actionBar.clear();
		}

		if (!template.elementDispoables) {
			template.elementDispoables = new DisposableStore();
		}

		// Kill terminal on middle click
		template.elementDispoables.add(DOM.addDisposableListener(template.element, DOM.EventType.AUXCLICK, e => {
			if (e.button === 1/*middle*/) {
				instance.dispose();
			}
		}));
		const icon = this._getIcon(instance.icon);
		const color = instance.color ? `terminal-icon-${instance.color}` : typeof icon === 'object' && 'color' in icon ? `terminal-icon-${icon?.color?.id}`.replace('.', '_') : undefined;
		const extras = [];
		if (typeof icon === 'string' && icon.startsWith('url')) {
			const codicon = template.element.querySelector<HTMLElement>('.codicon');
			if (codicon) {
				codicon.style.backgroundImage = icon;
				codicon.style.backgroundSize = '16px';
				codicon.style.color = 'transparent';
				codicon.style.content = '';
			}
		}
		if (color) {
			extras.push(color);
		}
		template.label.setResource({
			resource: instance.resource,
			name: label,
			description: hasText ? instance.shellLaunchConfig.description : undefined
		}, {
			fileDecorations: {
				colors: true,
				badges: hasText
			},
			title: {
				markdown: new MarkdownString(title),
				markdownNotSupportedFallback: undefined
			},
			extraClasses: extras
		});
	}

	disposeElement(instance: ITerminalInstance, index: number, templateData: ITerminalTabEntryTemplate): void {
		templateData.elementDispoables?.dispose();
		templateData.elementDispoables = undefined;
	}

	disposeTemplate(templateData: ITerminalTabEntryTemplate): void {
	}

	fillActionBar(instance: ITerminalInstance, template: ITerminalTabEntryTemplate): void {
		// If the instance is within the selection, split all selected
		const actions = [
			new Action(TerminalCommandId.SplitInstance, localize('terminal.split', "Split"), ThemeIcon.asClassName(Codicon.splitHorizontal), true, async () => {
				this._runForSelectionOrInstance(instance, e => this._terminalService.splitInstance(e));
			}),
			new Action(TerminalCommandId.KillInstance, localize('terminal.kill', "Kill"), ThemeIcon.asClassName(Codicon.trashcan), true, async () => {
				this._runForSelectionOrInstance(instance, e => e.dispose());
			})
		];
		// TODO: Cache these in a way that will use the correct instance
		template.actionBar.clear();
		for (const action of actions) {
			template.actionBar.push(action, { icon: true, label: false, keybinding: this._keybindingService.lookupKeybinding(action.id)?.getLabel() });
		}
	}

	private _runForSelectionOrInstance(instance: ITerminalInstance, callback: (instance: ITerminalInstance) => void) {
		const selection = this._getSelection();
		if (selection.includes(instance)) {
			for (const s of selection) {
				if (s) {
					callback(s);
				}
			}
		} else {
			callback(instance);
		}
		this._terminalService.focusTabs();
		this._listService.lastFocusedList?.focusNext();
	}

	private _getIcon(iconPath?: any): Codicon | ThemeIcon | undefined | string {
		if (typeof iconPath === 'string') {
			return iconRegistry.get(iconPath);
		} else if ((iconPath as ThemeIcon).color) {
			return iconPath;
		} else if (typeof iconPath === 'object' && 'path' in iconPath) {
			return DOM.asCSSUrl(URI.revive(iconPath));
		} else if (typeof iconPath === 'object' && 'light' in iconPath && 'dark' in iconPath) {
			const uris = this.getIconUris(iconPath);
			if (this._themeService.getColorTheme().type === ColorScheme.LIGHT) {
				return DOM.asCSSUrl(URI.revive(uris.light));
			} else {
				return DOM.asCSSUrl(URI.revive(uris.dark));
			}
		}
		return undefined;
	}

	getIconUris(iconPath: string | { dark: URI, light: URI } | ThemeIcon): { dark: URI, light: URI } {
		const dark = this.getDarkIconUri(iconPath as URI | { light: URI; dark: URI; });
		const light = this.getLightIconUri(iconPath as URI | { light: URI; dark: URI; });
		return {
			dark: typeof dark === 'string' ? URI.file(dark) : dark,
			light: typeof light === 'string' ? URI.file(light) : light
		};
	}

	getLightIconUri(iconPath: URI | { light: URI; dark: URI; }) {
		return typeof iconPath === 'object' && 'light' in iconPath ? iconPath.light : iconPath;
	}

	getDarkIconUri(iconPath: URI | { light: URI; dark: URI; }) {
		return typeof iconPath === 'object' && 'dark' in iconPath ? iconPath.dark : iconPath;
	}
}

interface ITerminalTabEntryTemplate {
	element: HTMLElement;
	label: IResourceLabel;
	actionBar: ActionBar;
	context: {
		hoverActions?: IHoverAction[];
	};
	elementDispoables?: DisposableStore;
}


class TerminalTabsAccessibilityProvider implements IListAccessibilityProvider<ITerminalInstance> {
	constructor(@ITerminalService private readonly _terminalService: ITerminalService) { }

	getWidgetAriaLabel(): string {
		return localize('terminal.tabs', "Terminal tabs");
	}

	getAriaLabel(instance: ITerminalInstance): string {
		let ariaLabel: string = '';
		const tab = this._terminalService.getGroupForInstance(instance);
		if (tab && tab.terminalInstances?.length > 1) {
			const terminalIndex = tab.terminalInstances.indexOf(instance);
			ariaLabel = localize({
				key: 'splitTerminalAriaLabel',
				comment: [
					`The terminal's ID`,
					`The terminal's title`,
					`The terminal's split number`,
					`The terminal group's total split number`
				]
			}, "Terminal {0} {1}, split {2} of {3}", instance.instanceId, instance.title, terminalIndex + 1, tab.terminalInstances.length);
		} else {
			ariaLabel = localize({
				key: 'terminalAriaLabel',
				comment: [
					`The terminal's ID`,
					`The terminal's title`
				]
			}, "Terminal {0} {1}", instance.instanceId, instance.title);
		}
		return ariaLabel;
	}
}

class TerminalTabsDragAndDrop implements IListDragAndDrop<ITerminalInstance> {
	private _autoFocusInstance: ITerminalInstance | undefined;
	private _autoFocusDisposable: IDisposable = Disposable.None;

	constructor(
		private _terminalService: ITerminalService,
		private _terminalInstanceService: ITerminalInstanceService
	) { }

	getDragURI(instance: ITerminalInstance): string | null {
		return null;
	}

	onDragOver(data: IDragAndDropData, targetInstance: ITerminalInstance | undefined, targetIndex: number | undefined, originalEvent: DragEvent): boolean {
		let result = true;

		const didChangeAutoFocusInstance = this._autoFocusInstance !== targetInstance;
		if (didChangeAutoFocusInstance) {
			this._autoFocusDisposable.dispose();
			this._autoFocusInstance = targetInstance;
		}

		if (!targetInstance) {
			return result;
		}

		const isExternalDragOver = !(data instanceof ElementsDragAndDropData);
		if (didChangeAutoFocusInstance && isExternalDragOver) {
			this._autoFocusDisposable = disposableTimeout(() => {
				this._terminalService.setActiveInstance(targetInstance);
				this._autoFocusInstance = undefined;
			}, 500);
		}

		return result;
	}

	drop(data: IDragAndDropData, targetInstance: ITerminalInstance | undefined, targetIndex: number | undefined, originalEvent: DragEvent): void {
		this._autoFocusDisposable.dispose();
		this._autoFocusInstance = undefined;

		const isExternalDrop = !(data instanceof ElementsDragAndDropData);
		if (isExternalDrop) {
			this._handleExternalDrop(targetInstance, originalEvent);
		}
	}

	private async _handleExternalDrop(instance: ITerminalInstance | undefined, e: DragEvent) {
		if (!instance || !e.dataTransfer) {
			return;
		}

		// Check if files were dragged from the tree explorer
		let path: string | undefined;
		const resources = e.dataTransfer.getData(DataTransfers.RESOURCES);
		if (resources) {
			path = URI.parse(JSON.parse(resources)[0]).fsPath;
		} else if (e.dataTransfer.files.length > 0 && e.dataTransfer.files[0].path /* Electron only */) {
			// Check if the file was dragged from the filesystem
			path = URI.file(e.dataTransfer.files[0].path).fsPath;
		}

		if (!path) {
			return;
		}

		this._terminalService.setActiveInstance(instance);

		const preparedPath = await this._terminalInstanceService.preparePathForTerminalAsync(path, instance.shellLaunchConfig.executable, instance.title, instance.shellType, instance.isRemote);
		instance.sendText(preparedPath, false);
		instance.focus();
	}
}
