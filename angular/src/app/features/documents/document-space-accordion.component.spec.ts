import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { ContextMenuService, SpaceSelectionStore } from '@coolms/ui-angular';

import { DocumentSpaceAccordionComponent } from './document-space-accordion.component';
import { DocumentPageStateService } from './explorer/document-page-state.service';

/**
 * The manifest reports an ABSENT url as `''`, not as a missing key.
 *
 * The producer declares both space urls as non-nullable strings defaulting to
 * empty, while the client type marks them optional. The two disagree about
 * which absence they model, so the optional marker never fires: on an older
 * backend these arrive as empty strings that are present.
 *
 * Every call site therefore guards on FALSINESS rather than on `undefined`,
 * and there is a comment at the type declaration saying so. !! A comment
 * cannot fail. This is what fails when somebody rewrites the guard as
 * `url === undefined`, which reads as more precise, passes review, and turns
 * an empty string into a POST to `''`.
 *
 * !! Mutation-proved, and the first mutation was the WRONG one. Adding
 * `?? '/api/v1/document/spaces/available'` -- the rewrite that looks most
 * dangerous -- changed nothing, because `'' ?? x` is `''` and the falsiness
 * guard still caught it. Only when the three guards were changed to test for
 * `undefined` did this spec go red, on two of its three cases. A regression
 * test written against the plausible-sounding mutation rather than the
 * measured one would have been green in both directions.
 *
 * !! The second case is the denominator. A test that only asserts "no request
 * was made" passes just as well when the component is broken, when the harness
 * never wired the http client, or when the method under test was renamed. The
 * pair is the evidence: silent on empty, and calling on present.
 *
 * !! MUTATE ONE GUARD AT A TIME. Mutating all three together proved only that
 * AT LEAST ONE was pinned, and the suite went red on the other two while
 * `loadAvailable()` -- reachable only through `openPicker()`, which the spec
 * did not call -- was covered by nothing. A red suite under a multi-site
 * mutation cannot attribute coverage to any single site; it has a denominator
 * problem of exactly the kind this file is about. Each of the three guards is
 * now individually mutation-proved: change any one to `=== undefined` and this
 * spec fails.
 */
describe('DocumentSpaceAccordionComponent — an absent manifest url is empty, not undefined', () => {
    const ENABLEMENT = '/api/v1/document/spaces/enablement';
    const AVAILABLE = '/api/v1/document/spaces/available';

    function build(spacesAvailableUrl: string, spaceEnablementUrl: string): {
        component: DocumentSpaceAccordionComponent;
        http: HttpTestingController;
    } {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withXhr()),
                provideHttpClientTesting(),
                // Only what the field initialisers reach for. The component is
                // constructed directly rather than rendered, so the template and
                // ngOnInit stay out of it -- this is about the three guards.
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: () => ({
                            document: { spacesAvailableUrl, spaceEnablementUrl },
                        }),
                    },
                },
                {
                    provide: SpaceSelectionStore,
                    useValue: {
                        spaces: signal([]),
                        activeKey: signal(null),
                        activeRootPath: signal(null),
                        load: (): void => {},
                        select: (): null => null,
                    },
                },
                { provide: ContextMenuService, useValue: {} },
                {
                    provide: DocumentPageStateService,
                    useValue: {
                        spaceRoot: signal(''),
                        currentPath: signal(''),
                        selectFolder: (): void => {},
                        enterSpaceDocuments: (): void => {},
                    },
                },
            ],
        });

        const component = TestBed.runInInjectionContext(
            () => new DocumentSpaceAccordionComponent(),
        );

        return { component, http: TestBed.inject(HttpTestingController) };
    }

    it('offers nothing and calls nothing when the urls arrive empty', () => {
        const { component, http } = build('', '');

        expect(component.canAddSpace()).toBe(false);

        component.enable('coolms-site');

        // !! openPicker() is the only caller of the third guard, and without
        // this line that guard is unpinned: mutating it alone leaves the whole
        // spec green while the component fires GET '' the moment a user opens
        // the picker on a half-configured backend.
        component.openPicker();

        // No request at all -- not a request to '' that happens to fail.
        http.verify();
    });

    it('offers the action, loads the sites and posts, all to manifest urls', () => {
        const { component, http } = build(AVAILABLE, ENABLEMENT);

        expect(component.canAddSpace()).toBe(true);

        component.openPicker();

        const load = http.expectOne(AVAILABLE);
        expect(load.request.method).toBe('GET');
        load.flush({ member: [] });

        component.enable('coolms-site');

        const req = http.expectOne(ENABLEMENT);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual({ site: 'coolms-site', enabled: true });
        req.flush({});

        http.verify();
    });

    it('stays silent when only one of the two arrives', () => {
        // Half-configured is the shape an older backend actually produces while
        // a newer one is rolled out, and it must not offer an action that needs
        // both urls to complete.
        const { component, http } = build(AVAILABLE, '');

        expect(component.canAddSpace()).toBe(false);

        component.enable('coolms-site');
        http.verify();
    });
});
