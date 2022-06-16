/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Promises } from 'vs/base/common/async';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { joinPath } from 'vs/base/common/resources';
import { IStorage, Storage } from 'vs/base/parts/storage/common/storage';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/services';
import { AbstractStorageService, StorageScope, WillSaveStateReason } from 'vs/platform/storage/common/storage';
import { ApplicationStorageDatabaseClient, GlobalStorageDatabaseClient, WorkspaceStorageDatabaseClient } from 'vs/platform/storage/common/storageIpc';
import { isUserDataProfile, IUserDataProfile, IUserDataProfilesService } from 'vs/platform/userDataProfile/common/userDataProfile';
import { IAnyWorkspaceIdentifier, IEmptyWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from 'vs/platform/workspace/common/workspace';

export class NativeStorageService extends AbstractStorageService {

	// Application Storage is readonly and shared across
	// windows and profiles.
	private readonly applicationStorage: IStorage;

	// Global Storage is scoped to a profile of the window
	// but can change in the current window when changing the
	// profile of the window.
	private globalStorage: IStorage;
	private globalStorageDisposables = this._register(new DisposableStore());

	// Workspace Storage is scoped to a window but can change
	// in the current window, when entering a workspace.
	private workspaceStorage: IStorage | undefined = undefined;
	private workspaceStorageId: string | undefined = undefined;
	private workspaceStorageDisposables = this._register(new DisposableStore());

	constructor(
		workspace: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined,
		private readonly mainProcessService: IMainProcessService,
		private readonly userDataProfilesService: IUserDataProfilesService,
		private readonly environmentService: IEnvironmentService
	) {
		super();

		this.applicationStorage = this.createApplicationStorage();
		this.globalStorage = this.createGlobalStorage(this.userDataProfilesService.currentProfile);
		this.workspaceStorage = this.createWorkspaceStorage(workspace);
	}

	private createApplicationStorage(): IStorage {
		const storageDataBaseClient = this._register(new ApplicationStorageDatabaseClient(this.mainProcessService.getChannel('storage')));
		const applicationStorage = this._register(new Storage(storageDataBaseClient));

		this._register(applicationStorage.onDidChangeStorage(key => this.emitDidChangeValue(StorageScope.APPLICATION, key)));

		return applicationStorage;
	}

	private createGlobalStorage(profile: IUserDataProfile): IStorage {

		// First clear any previously associated disposables
		this.globalStorageDisposables.clear();

		let globalStorage: IStorage;
		if (profile.isDefault) {

			// If we are in default profile, the global storage is
			// actually the same as application storage. As such we
			// avoid creating the storage library a second time on
			// the same DB.

			globalStorage = this.applicationStorage;
		} else {
			const storageDataBaseClient = this.globalStorageDisposables.add(new GlobalStorageDatabaseClient(this.mainProcessService.getChannel('storage'), profile));
			globalStorage = this.globalStorageDisposables.add(new Storage(storageDataBaseClient));
		}

		this.globalStorageDisposables.add(globalStorage.onDidChangeStorage(key => this.emitDidChangeValue(StorageScope.GLOBAL, key)));

		return globalStorage;
	}

	private createWorkspaceStorage(workspace: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier): IStorage;
	private createWorkspaceStorage(workspace: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined): IStorage | undefined;
	private createWorkspaceStorage(workspace: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined): IStorage | undefined {

		// First clear any previously associated disposables
		this.workspaceStorageDisposables.clear();

		this.workspaceStorageId = workspace?.id;

		let workspaceStorage: IStorage | undefined = undefined;
		if (workspace) {
			const storageDataBaseClient = this.workspaceStorageDisposables.add(new WorkspaceStorageDatabaseClient(this.mainProcessService.getChannel('storage'), workspace));
			workspaceStorage = this.workspaceStorageDisposables.add(new Storage(storageDataBaseClient));

			this.workspaceStorageDisposables.add(workspaceStorage.onDidChangeStorage(key => this.emitDidChangeValue(StorageScope.WORKSPACE, key)));
		}

		return workspaceStorage;
	}

	protected async doInitialize(): Promise<void> {

		// Init all storage locations
		await Promises.settled([
			this.applicationStorage.init(),
			this.globalStorage.init(),
			this.workspaceStorage?.init() ?? Promise.resolve()
		]);
	}

	protected getStorage(scope: StorageScope): IStorage | undefined {
		switch (scope) {
			case StorageScope.APPLICATION:
				return this.applicationStorage;
			case StorageScope.GLOBAL:
				return this.globalStorage;
			default:
				return this.workspaceStorage;
		}
	}

	protected getLogDetails(scope: StorageScope): string | undefined {
		switch (scope) {
			case StorageScope.APPLICATION:
				return this.userDataProfilesService.defaultProfile.globalStorageHome.fsPath;
			case StorageScope.GLOBAL:
				return this.userDataProfilesService.currentProfile.globalStorageHome.fsPath;
			default:
				return this.workspaceStorageId ? `${joinPath(this.environmentService.workspaceStorageHome, this.workspaceStorageId, 'state.vscdb').fsPath}` : undefined;
		}
	}

	async close(): Promise<void> {

		// Stop periodic scheduler and idle runner as we now collect state normally
		this.stopFlushWhenIdle();

		// Signal as event so that clients can still store data
		this.emitWillSaveState(WillSaveStateReason.SHUTDOWN);

		// Do it
		await Promises.settled([
			this.applicationStorage.close(),
			this.globalStorage.close(),
			this.workspaceStorage?.close() ?? Promise.resolve()
		]);
	}

	async switch(to: IAnyWorkspaceIdentifier | IUserDataProfile, preserveData: boolean): Promise<void> {

		// Profile migration
		if (isUserDataProfile(to)) {
			return this.migrateToProfile(to, preserveData);
		}

		// Workspace migration
		return this.migrateToWorkspace(to, preserveData);
	}

	private async migrateToProfile(toProfile: IUserDataProfile, preserveData: boolean): Promise<void> {
		const oldGlobalStorage = this.globalStorage;
		const oldItems = oldGlobalStorage.items;

		// Close old global storage but only if this is
		// different from application storage!
		if (oldGlobalStorage !== this.applicationStorage) {
			await oldGlobalStorage.close();
		}

		// Create new global storage & init
		this.globalStorage = this.createGlobalStorage(toProfile);
		await this.globalStorage.init();

		// Handle data migration and eventing
		this.migrateData(oldItems, this.globalStorage, StorageScope.GLOBAL, preserveData);
	}

	private async migrateToWorkspace(toWorkspace: IAnyWorkspaceIdentifier, preserveData: boolean): Promise<void> {
		const oldWorkspaceStorage = this.workspaceStorage;
		const oldItems = oldWorkspaceStorage?.items ?? new Map();

		// Close old workspace storage
		await oldWorkspaceStorage?.close();

		// Create new workspace storage & init
		this.workspaceStorage = this.createWorkspaceStorage(toWorkspace);
		await this.workspaceStorage.init();

		// Handle data migration and eventing
		this.migrateData(oldItems, this.workspaceStorage, StorageScope.WORKSPACE, preserveData);
	}
}
