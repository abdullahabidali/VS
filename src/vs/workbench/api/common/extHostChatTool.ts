/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ExtHostChatToolsShape, IMainContext, MainContext, MainThreadChatToolsShape } from 'vs/workbench/api/common/extHost.protocol';
import { IChatToolData, IChatToolDelta } from 'vs/workbench/contrib/chat/common/chatToolsService';
import type * as vscode from 'vscode';

export class ExtHostChatTools implements ExtHostChatToolsShape {
	/** A map of tools that were registered in this EH */
	private readonly _registeredTools = new Map<string, { extension: IExtensionDescription; tool: vscode.ChatTool }>();
	private readonly _proxy: MainThreadChatToolsShape;

	/** A map of all known tools, from other EHs or registered in vscode core */
	private readonly _allTools = new Map<string, IChatToolData>();

	constructor(mainContext: IMainContext) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadChatTools);

		this._proxy.$getTools().then(tools => {
			for (const tool of tools) {
				this._allTools.set(tool.id, tool);
			}
		});
	}

	async invokeTool(name: string, parameters: any, token: CancellationToken): Promise<any> {
		// Making the round trip here because not all tools were necessarily registered in this EH
		return await this._proxy.$invokeTool(name, parameters, token);
	}

	async $acceptToolDelta(delta: IChatToolDelta): Promise<void> {
		if (delta.added) {
			this._allTools.set(delta.added.id, delta.added);
		}

		if (delta.removed) {
			this._allTools.delete(delta.removed);
		}
	}

	get tools(): vscode.ChatToolDescription[] {
		return Array.from(this._allTools.values());
	}

	async $invokeTool(name: string, parameters: any, token: CancellationToken): Promise<any> {
		const item = this._registeredTools.get(name);
		if (!item) {
			return;
		}
		try {
			return await item.tool.invoke(parameters, token);
		} catch (err) {
			onUnexpectedExternalError(err);
		}
	}

	registerChatTool(extension: IExtensionDescription, tool: vscode.ChatTool): IDisposable {
		this._registeredTools.set(tool.id, { extension, tool });
		this._proxy.$registerTool(tool);

		return toDisposable(() => {
			this._registeredTools.delete(tool.id);
			this._proxy.$unregisterTool(tool.id);
		});
	}
}
