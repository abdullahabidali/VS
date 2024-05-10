/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-ignore
const { testGlobalRequire } = globalThis;

const modules = [
	'@parcel/watcher',
	'@vscode/ripgrep',
	'@vscode/sqlite3',
	'@vscode/windows-registry',
	'@xterm/headless',
	'@xterm/xterm',
	'assert',
	'child_process',
	'cookie',
	'crypto',
	'electron',
	'events',
	'fs',
	'glob',
	'graceful-fs',
	'inspector',
	'jschardet',
	'kerberos',
	'minimist',
	'native-is-elevated',
	'native-keymap',
	'native-watchdog',
	'net',
	'os',
	'path',
	'sinon-test',
	'sinon',
	'stream',
	'string_decoder',
	'url',
	'util',
	'vscode-regexpp',
	'yauzl',
	'zlib',
]

const createTestGlobals = () => {
	const map = Object.create(null)
	for (const module of modules) {
		Object.defineProperty(map, module, {
			get [module]() {
				return testGlobalRequire(module)
			}
		})
	}
	return map
}

export const testGlobals = createTestGlobals()
