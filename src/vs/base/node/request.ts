/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Promise, TPromise } from 'vs/base/common/winjs.base';
import { isBoolean } from 'vs/base/common/types';
import https = require('https');
import http = require('http');
import { Stream } from 'stream';
import { parse as parseUrl } from 'url';
import { createWriteStream } from 'fs';
import { assign } from 'vs/base/common/objects';
import { createGunzip } from 'zlib';

export type Agent = any;

export interface IRequestOptions {
	type?: string;
	url?: string;
	user?: string;
	password?: string;
	headers?: any;
	timeout?: number;
	data?: any;
	agent?: Agent;
	followRedirects?: number;
	strictSSL?: boolean;
}

export interface IRequestContext {
	req: http.ClientRequest;
	res: http.ClientResponse;
	stream: Stream;
}

export function request(options: IRequestOptions): TPromise<IRequestContext> {
	let req: http.ClientRequest;

	return new TPromise<IRequestContext>((c, e) => {
		let endpoint = parseUrl(options.url);

		let opts: https.RequestOptions = {
			hostname: endpoint.hostname,
			port: endpoint.port ? parseInt(endpoint.port) : (endpoint.protocol === 'https:' ? 443 : 80),
			path: endpoint.path,
			method: options.type || 'GET',
			headers: options.headers,
			agent: options.agent,
			rejectUnauthorized: isBoolean(options.strictSSL) ? options.strictSSL : true
		};

		if (options.user && options.password) {
			opts.auth = options.user + ':' + options.password;
		}

		let protocol = endpoint.protocol === 'https:' ? https : http;
		req = protocol.request(opts, (res: http.ClientResponse) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && options.followRedirects && options.followRedirects > 0 && res.headers['location']) {
				c(<any> request(assign({}, options, {
					url: res.headers['location'],
					followRedirects: options.followRedirects - 1
				})));
			} else {
				let stream: Stream = res;

				if (res.headers['content-encoding'] === 'gzip') {
					stream = stream.pipe(createGunzip());
				}

				c({ req, res, stream });
			}
		});
		req.on('error', e);

		if (options.timeout) {
			req.setTimeout(options.timeout);
		}
		if (options.data) {
			req.write(options.data);
		}

		req.end();
	},
	() => req && req.abort());
}

export function download(filePath: string, opts: IRequestOptions): TPromise<void> {
	return request(assign(opts, { followRedirects: 3 })).then(pair => new TPromise<void>((c, e) => {
		let out = createWriteStream(filePath);

		out.once('finish', () => c(null));
		pair.stream.once('error', e);
		pair.stream.pipe(out);
	}));
}

export function text(opts: IRequestOptions): TPromise<string> {
	return request(opts).then(pair => new Promise((c, e) => {
		if (!((pair.res.statusCode >= 200 && pair.res.statusCode < 300) || pair.res.statusCode === 1223)) {
			return e('Server returned ' + pair.res.statusCode);
		}

		if (pair.res.statusCode === 204) {
			return c(null);
		}

		let buffer: string[] = [];
		pair.stream.on('data', d => buffer.push(d));
		pair.stream.on('end', () => c(buffer.join('')));
		pair.stream.on('error', e);
	}));
}

export function json<T>(opts: IRequestOptions): TPromise<T> {
	return request(opts).then(pair => new Promise((c, e) => {
		if (!((pair.res.statusCode >= 200 && pair.res.statusCode < 300) || pair.res.statusCode === 1223)) {
			return e('Server returned ' + pair.res.statusCode);
		}

		if (pair.res.statusCode === 204) {
			return c(null);
		}

		if (!/application\/json/.test(pair.res.headers['content-type'])) {
			return e('Response doesn\'t appear to be JSON');
		}

		let buffer: string[] = [];
		pair.stream.on('data', d => buffer.push(d));
		pair.stream.on('end', () => c(JSON.parse(buffer.join(''))));
		pair.stream.on('error', e);
	}));
}