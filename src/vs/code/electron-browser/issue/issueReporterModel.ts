/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { assign } from 'vs/base/common/objects';
import { ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';

export enum IssueType {
	Bug,
	PerformanceIssue,
	FeatureRequest
}

export interface IssueReporterData {
	issueType?: IssueType;
	issueDescription?: string;
	versionInfo?: any;
	systemInfo?: any;
	processInfo?: any;
	workspaceInfo?: any;
	includeSystemInfo?: boolean;
	includeWorkspaceInfo?: boolean;
	includeProcessInfo?: boolean;
	includeExtensions?: boolean;
	numberOfThemeExtesions?: number;
	enabledNonThemeExtesions?: ILocalExtension[];
}

export class IssueReporterModel {
	private _data: IssueReporterData;

	constructor(initialData?: IssueReporterData) {
		this._data = initialData || {};
	}

	getData(): IssueReporterData {
		return this._data;
	}

	update(newData: IssueReporterData): void {
		assign(this._data, newData);
	}

	serialize(): string {
		return `
### Issue Type
${this.getIssueTypeTitle()}

### Description

${this._data.issueDescription}

### VS Code Info

VS Code version: ${this._data.versionInfo && this._data.versionInfo.vscodeVersion}
OS version: ${this._data.versionInfo && this._data.versionInfo.os}

${this.getInfos()}

<!-- Generated by VS Code Issue Helper -->
`;
	}

	private getIssueTypeTitle(): string {
		if (this._data.issueType === IssueType.Bug) {
			return 'Bug';
		} else if (this._data.issueType === IssueType.PerformanceIssue) {
			return 'Performance Issue';
		} else {
			return 'Feature Request';
		}
	}

	private getInfos(): string {
		let info = '';

		if (this._data.includeSystemInfo) {
			info += this.generateSystemInfoMd();
		}

		if (this._data.issueType === IssueType.Bug) {
			if (this._data.includeExtensions) {
				info += this.generateExtensionsMd();
			}
		}

		if (this._data.issueType === IssueType.PerformanceIssue) {

			if (this._data.includeProcessInfo) {
				info += this.generateProcessInfoMd();
			}

			if (this._data.includeWorkspaceInfo) {
				info += this.generateWorkspaceInfoMd();
			}

			if (this._data.includeExtensions) {
				info += this.generateExtensionsMd();
			}
		}

		return info;
	}

	private generateSystemInfoMd(): string {
		let md = `<details>
<summary>System Info</summary>

|Item|Value|
|---|---|
`;

		Object.keys(this._data.systemInfo).forEach(k => {
			md += `|${k}|${this._data.systemInfo[k]}|\n`;
		});

		md += '\n</details>';

		return md;
	}

	private generateProcessInfoMd(): string {
		let md = `<details>
<summary>Process Info</summary>

|pid|CPU|Memory (MB)|Name|
|---|---|---|---|
`;

		this._data.processInfo.forEach(p => {
			md += `|${p.pid}|${p.cpu}|${p.memory}|${p.name}|\n`;
		});

		md += '\n</details>';

		return md;
	}

	private generateWorkspaceInfoMd(): string {
		return `<details>
<summary>Workspace Info</summary>

\`\`\`
${this._data.workspaceInfo};
\`\`\`

</details>
`;
	}

	private generateExtensionsMd(): string {
		const themeExclusionStr = this._data.numberOfThemeExtesions ? `\n(${this._data.numberOfThemeExtesions} theme extensions excluded)` : '';

		if (!this._data.enabledNonThemeExtesions) {
			return 'Extensions: none' + themeExclusionStr;
		}

		let tableHeader = `Extension|Author (truncated)|Version
---|---|---`;
		const table = this._data.enabledNonThemeExtesions.map(e => {
			return `${e.manifest.name}|${e.manifest.publisher.substr(0, 3)}|${e.manifest.version}`;
		}).join('\n');

		const extensionTable = `<details><summary>Extensions (${this._data.enabledNonThemeExtesions.length})</summary>

${tableHeader}
${table}
${themeExclusionStr}

</details>`;

		// 2000 chars is browsers de-facto limit for URLs, 400 chars are allowed for other string parts of the issue URL
		// http://stackoverflow.com/questions/417142/what-is-the-maximum-length-of-a-url-in-different-browsers
		if (encodeURIComponent(extensionTable).length > 1600) {
			return 'the listing length exceeds browsers\' URL characters limit';
		}

		return extensionTable;
	}
}