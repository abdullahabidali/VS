/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { importCss } from 'vs/base/browser/importCss.js';

importCss('./mouseCursor.css', import.meta.url)

export const MOUSE_CURSOR_TEXT_CSS_CLASS_NAME = `monaco-mouse-cursor-text`;
