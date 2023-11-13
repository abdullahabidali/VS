/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { patchMultiWindowAwareTimeout } from 'vs/base/browser/dom';
import { CodeWindow, mainWindow } from 'vs/base/browser/window';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { runWithFakedTimers } from 'vs/base/test/common/timeTravelScheduler';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';

suite('Window', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('patchMultiWindowAwareTimeout()', async function () {
		return runWithFakedTimers({ useFakeTimers: true }, async () => {
			const disposables = new DisposableStore();

			let windows: { window: CodeWindow; disposables: DisposableStore }[] = [];
			const dom = {
				getWindowsCount: () => windows.length,
				getWindows: () => windows
			};

			const setTimeoutCalls: number[] = [];
			const clearTimeoutCalls: number[] = [];

			function createWindow(id: number, slow?: boolean) {
				const res = {
					setTimeout: function (callback: Function, delay: number, ...args: any[]): number {
						setTimeoutCalls.push(id);

						return mainWindow.setTimeout(() => callback(id), slow ? delay * 2 : delay, ...args);
					},
					clearTimeout: function (timeoutId: number): void {
						clearTimeoutCalls.push(id);

						return mainWindow.clearTimeout(timeoutId);
					}
				} as any;

				patchMultiWindowAwareTimeout(res, dom);

				return res;
			}

			const window1 = createWindow(1);
			windows = [{ window: window1, disposables }];

			// Window Count: 1

			let called = false;
			await new Promise<void>((resolve, reject) => {
				window1.setTimeout(() => {
					if (!called) {
						called = true;
						resolve();
					} else {
						reject(new Error('timeout called twice'));
					}
				}, 1);
			});

			assert.strictEqual(called, true);
			assert.deepStrictEqual(setTimeoutCalls, [1]);
			assert.deepStrictEqual(clearTimeoutCalls, []);
			called = false;
			setTimeoutCalls.length = 0;
			clearTimeoutCalls.length = 0;

			// Window Count: 3

			let window2 = createWindow(2);
			const window3 = createWindow(3);
			windows = [
				{ window: window2, disposables },
				{ window: window1, disposables },
				{ window: window3, disposables }
			];

			await new Promise<void>((resolve, reject) => {
				window1.setTimeout(() => {
					if (!called) {
						called = true;
						resolve();
					} else {
						reject(new Error('timeout called twice'));
					}
				}, 1);
			});

			assert.strictEqual(called, true);
			assert.deepStrictEqual(setTimeoutCalls, [2, 1, 3]);
			assert.deepStrictEqual(clearTimeoutCalls, [2, 1, 3]);
			called = false;
			setTimeoutCalls.length = 0;
			clearTimeoutCalls.length = 0;

			// Window Count: 2 (1 fast, 1 slow)

			window2 = createWindow(2, true);
			windows = [
				{ window: window2, disposables },
				{ window: window1, disposables },
			];

			await new Promise<void>((resolve, reject) => {
				window1.setTimeout((windowId: number) => {
					if (!called && windowId === 1) {
						called = true;
						resolve();
					} else if (called) {
						reject(new Error('timeout called twice'));
					} else {
						reject(new Error('timeout called for wrong window'));
					}
				}, 1);
			});

			assert.strictEqual(called, true);
			assert.deepStrictEqual(setTimeoutCalls, [2, 1]);
			assert.deepStrictEqual(clearTimeoutCalls, [2, 1]);
			called = false;
			setTimeoutCalls.length = 0;
			clearTimeoutCalls.length = 0;

			disposables.dispose();
		});
	});
});
