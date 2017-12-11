/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { TPromise } from 'vs/base/common/winjs.base';
import { IReadOnlyModel } from 'vs/editor/common/editorCommon';
import { registerDefaultLanguageCommand } from 'vs/editor/browser/editorExtensions';
import LanguageFeatureRegistry from 'vs/editor/common/modes/languageFeatureRegistry';
import { DefinitionProviderRegistry, ImplementationProviderRegistry, TypeDefinitionProviderRegistry, Location, DefinitionAndSpan } from 'vs/editor/common/modes';
import { CancellationToken } from 'vs/base/common/cancellation';
import { asWinJsPromise } from 'vs/base/common/async';
import { Position } from 'vs/editor/common/core/position';

function locationToDefinitionAndSpan(location: Location): DefinitionAndSpan {
	return {
		definition: location
	};
}

function outputResults(promises: TPromise<Location | Location[] | DefinitionAndSpan[]>[]): TPromise<DefinitionAndSpan[]> {
	return TPromise.join(promises).then(allReferences => {
		let result: DefinitionAndSpan[] = [];
		for (let references of allReferences) {
			if (!references) {
				continue;
			}

			if (Array.isArray(references)) {
				for (const item of references) {
					if ((item as DefinitionAndSpan).definition) {
						result.push(item as DefinitionAndSpan);
					} else {
						result.push(locationToDefinitionAndSpan(item as Location));
					}
				}
			} else {
				result.push(locationToDefinitionAndSpan(references as Location));
			}
		}
		return result;
	});
}

function getDefinitions<T>(
	model: IReadOnlyModel,
	position: Position,
	registry: LanguageFeatureRegistry<T>,
	provide: (provider: T, model: IReadOnlyModel, position: Position, token: CancellationToken) => Location | Location[] | DefinitionAndSpan | Thenable<Location | Location[] | DefinitionAndSpan>
): TPromise<DefinitionAndSpan[]> {
	const provider = registry.ordered(model);

	// get results
	const promises = provider.map((provider, idx) => {
		return asWinJsPromise((token) => {
			return provide(provider, model, position, token);
		}).then(undefined, err => {
			onUnexpectedExternalError(err);
			return null;
		});
	});
	return outputResults(promises);
}


export function getDefinitionsAtPosition(model: IReadOnlyModel, position: Position): TPromise<DefinitionAndSpan[]> {
	return getDefinitions(model, position, DefinitionProviderRegistry, (provider, model, position, token) => {
		return provider.provideDefinition(model, position, token);
	});
}

export function getImplementationsAtPosition(model: IReadOnlyModel, position: Position): TPromise<DefinitionAndSpan[]> {
	return getDefinitions(model, position, ImplementationProviderRegistry, (provider, model, position, token) => {
		return provider.provideImplementation(model, position, token);
	});
}

export function getTypeDefinitionsAtPosition(model: IReadOnlyModel, position: Position): TPromise<DefinitionAndSpan[]> {
	return getDefinitions(model, position, TypeDefinitionProviderRegistry, (provider, model, position, token) => {
		return provider.provideTypeDefinition(model, position, token);
	});
}

registerDefaultLanguageCommand('_executeDefinitionProvider', getDefinitionsAtPosition);
registerDefaultLanguageCommand('_executeImplementationProvider', getImplementationsAtPosition);
registerDefaultLanguageCommand('_executeTypeDefinitionProvider', getTypeDefinitionsAtPosition);
