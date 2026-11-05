import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UserPreferencesService } from '@coolms/core-angular';
import { type ExplorerViewMode } from '@coolms/ui-angular';
import { Store } from '@ngxs/store';

import { DocumentPageStateService } from '../documents/explorer/document-page-state.service';
import { MediaPageStateService } from '../media/media-page-state.service';
import { ConsoleSettingsService } from './console-settings.service';

describe('the default view, on a page with no view of its own remembered', () => {
    function configure(personal: ExplorerViewMode | null, remembered: Record<string, unknown> | null): void {
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                MediaPageStateService,
                { provide: Store, useValue: { selectSnapshot: () => ({ apiBase: '/api/v1' }), select: () => ({}) } },
                { provide: ConsoleSettingsService, useValue: { explorerView: () => personal } },
                {
                    provide: UserPreferencesService,
                    useValue: { getPageState: () => remembered, setPageState: () => undefined },
                },
            ],
        });
    }

    it('media takes the person\'s default', () => {
        configure('details', null);
        expect(TestBed.inject(MediaPageStateService).viewMode()).toBe('details');
    });

    it('media keeps its own when the person chose none', () => {
        configure(null, null);
        expect(TestBed.inject(MediaPageStateService).viewMode()).toBe('medium');
    });

    it('media keeps the view remembered over the default', () => {
        configure('details', { viewMode: 'small' });
        expect(TestBed.inject(MediaPageStateService).viewMode()).toBe('small');
    });

    it('documents take the person\'s default in both zones', () => {
        configure('details', null);
        const state = TestBed.inject(DocumentPageStateService);
        expect(state.viewMode()).toBe('details');
        expect(state.instancesViewMode()).toBe('details');
    });

    it('documents keep the view remembered over the default', () => {
        configure('details', { viewMode: 'small', instancesViewMode: 'content' });
        const state = TestBed.inject(DocumentPageStateService);
        expect(state.viewMode()).toBe('small');
        expect(state.instancesViewMode()).toBe('content');
    });
});
