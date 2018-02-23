/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainContext, MainThreadWebviewShape, IMainContext, ExtHostWebviewsShape } from './extHost.protocol';
import * as vscode from 'vscode';
import Event, { Emitter } from 'vs/base/common/event';
import * as typeConverters from 'vs/workbench/api/node/extHostTypeConverters';

export class ExtHostWebview implements vscode.Webview {
	public readonly editorType = 'webview';

	private _title: string;
	private _html: string;
	private _options: vscode.WebviewOptions;
	private _isDisposed: boolean = false;
	private _viewColumn: vscode.ViewColumn;


	public readonly onMessageEmitter = new Emitter<any>();
	public readonly onMessage: Event<any> = this.onMessageEmitter.event;

	constructor(
		private readonly _id: string,
		private readonly _proxy: MainThreadWebviewShape,
		private readonly _handle: string,
		viewColumn: vscode.ViewColumn
	) {
		this._viewColumn = viewColumn;
	}

	public dispose() {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		this._proxy.$disposeWebview(this._handle);
	}

	get id(): string {
		return this._id;
	}

	get title(): string {
		return this._title;
	}

	set title(value: string) {
		if (this._title !== value) {
			this._title = value;
			this._proxy.$setTitle(this._handle, value);
		}
	}

	get html(): string {
		return this._html;
	}

	set html(value: string) {
		if (this._html !== value) {
			this._html = value;
			this._proxy.$setHtml(this._handle, value);
		}
	}

	get options(): vscode.WebviewOptions {
		return this._options;
	}

	set options(value: vscode.WebviewOptions) {
		this._proxy.$setOptions(this._handle, value);
	}

	get viewColumn(): vscode.ViewColumn {
		return this._viewColumn;
	}

	public postMessage(message: any): Thenable<any> {
		return this._proxy.$sendMessage(this._handle, message);
	}
}

export class ExtHostWebviews implements ExtHostWebviewsShape {
	private readonly _proxy: MainThreadWebviewShape;

	private readonly _webviews = new Map<string, ExtHostWebview>();

	constructor(
		mainContext: IMainContext
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadWebview);
	}

	getOrCreateWebview(
		id: string,
		viewColumn: vscode.ViewColumn
	): vscode.Webview {
		const handle = `webview-${id}-${viewColumn}`;
		if (!this._webviews.has(handle)) {
			this._proxy.$createWebview(handle);

			const webview = new ExtHostWebview(id, this._proxy, handle, viewColumn);
			this._webviews.set(handle, webview);
		}

		this._proxy.$show(handle, typeConverters.fromViewColumn(viewColumn));
		return this._webviews.get(handle);
	}

	$onMessage(handle: string, message: any): void {
		const webview = this._webviews.get(handle);
		webview.onMessageEmitter.fire(message);
	}

	$onDidChangeActiveWeview(handle: string | undefined): void {
		const webview = this._webviews.get(handle);
		this._onDidChangeActiveWebview.fire(webview);
	}

	$onDidDisposeWeview(handle: string): void {
		const webview = this._webviews.get(handle);
		if (webview) {
			this._onDidDisposeWebview.fire(webview);
		}
	}

	private readonly _onDidChangeActiveWebview = new Emitter<ExtHostWebview | undefined>();
	public readonly onDidChangeActiveWebview = this._onDidChangeActiveWebview.event;

	private readonly _onDidDisposeWebview = new Emitter<ExtHostWebview | undefined>();
	public readonly onDidDisposeWebview = this._onDidDisposeWebview.event;
}