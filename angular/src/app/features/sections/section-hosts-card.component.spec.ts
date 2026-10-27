import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ErrorHandlerService } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { SectionHostsCardComponent } from './section-hosts-card.component';
import { SectionFormComponent } from './section-form.component';
import { SectionsApiService } from './sections-api.service';
import { SiteSectionDto, UpdateSectionDto } from './sections.types';

const SECTION: SiteSectionDto = {
    '@id': '/api/v1/sections/s1',
    id: 's1',
    slug: 'site',
    label: 'Site',
    matchHost: 'coolms.com',
    isActive: true,
    hosts: [{ host: 'www.coolms.com', mode: 'redirect', status: 301 }],
    untrustedHosts: ['new.coolms.com'],
};

describe('SectionHostsCardComponent', () => {
    let sent: UpdateSectionDto[];

    function create(section: SiteSectionDto) {
        sent = [];
        TestBed.configureTestingModule({
            imports: [SectionHostsCardComponent],
            providers: [
                {
                    provide: SectionsApiService,
                    useValue: {
                        getSection: () => of(section),
                        updateSection: (_id: string, dto: UpdateSectionDto) => {
                            sent.push(dto);

                            return of({ ...section, hosts: dto.hosts });
                        },
                    },
                },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'refused' } },
                { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
            ],
        });
        const fixture = TestBed.createComponent(SectionHostsCardComponent);
        fixture.componentRef.setInput('sectionId', 's1');
        fixture.detectChanges();

        return fixture;
    }

    it('shows the stored hosts and the ones the server does not trust', () => {
        const fixture = create(SECTION);
        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

        expect(fixture.componentInstance.rows()).toEqual([{ host: 'www.coolms.com', mode: 'redirect', status: '301' }]);
        expect(text).toContain('does not trust new.coolms.com');
    });

    it('saves the whole list: a serving host without a status, a redirecting one with it, an empty row dropped', () => {
        const fixture = create(SECTION);
        const card = fixture.componentInstance;
        card.rows.update(rows => [...rows.slice(0, 1), { host: ' alt.coolms.com ', mode: 'serve', status: '302' }, { host: '', mode: 'redirect', status: '301' }]);

        card.save();

        expect(sent).toEqual([{
            hosts: [
                { host: 'www.coolms.com', mode: 'redirect', status: 301 },
                { host: 'alt.coolms.com', mode: 'serve' },
            ],
        }]);
    });

    it('reads the section again when the page raises its revision', () => {
        let reads = 0;
        TestBed.configureTestingModule({
            imports: [SectionHostsCardComponent],
            providers: [
                {
                    provide: SectionsApiService,
                    useValue: {
                        getSection: () => {
                            reads += 1;

                            return of(reads === 1 ? SECTION : { ...SECTION, redirectTarget: 'https://lemacs.com/' });
                        },
                    },
                },
                { provide: ErrorHandlerService, useValue: { humanize: () => '' } },
                { provide: ToastService, useValue: { success: () => undefined } },
            ],
        });
        const fixture = TestBed.createComponent(SectionHostsCardComponent);
        fixture.componentRef.setInput('sectionId', 's1');
        fixture.detectChanges();
        fixture.componentRef.setInput('revision', 1);
        fixture.detectChanges();

        expect(reads).toBe(2);
        expect(fixture.componentInstance.redirect()?.target).toBe('https://lemacs.com/');
    });

    it('says when the section is a redirect section', () => {
        const fixture = create({ ...SECTION, redirectTarget: 'https://lemacs.com/', redirectStatus: 302, redirectKeepPath: false });
        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

        expect(text).toContain('every request goes to https://lemacs.com/');
        expect(text).toContain('temporary, 302');
    });
});

describe('SectionFormComponent redirect fields', () => {
    let dispatched: unknown[];
    let shown: string[];

    function form(data: SiteSectionDto | null): SectionFormComponent {
        dispatched = [];
        shown = [];
        // Two forms in one test, each with its own dialog data: a fresh module for each.
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: () => null,
                        dispatch: (action: unknown) => {
                            dispatched.push(action);

                            return of(null);
                        },
                    },
                },
                { provide: ErrorHandlerService, useValue: { humanize: () => '' } },
                { provide: DialogRef, useValue: { close: () => undefined } },
                { provide: DIALOG_DATA, useValue: data },
            ],
        });

        const component = TestBed.runInInjectionContext(() => new SectionFormComponent());
        component.dynamicForm = { setServerError: (message: string) => shown.push(message) } as unknown as SectionFormComponent['dynamicForm'];

        return component;
    }

    it('refuses a redirect without a target, on edit and on create, and sends nothing', () => {
        // An empty target is how a save makes a redirect section a site again: on the redirect switch it must not.
        for (const data of [{ ...SECTION, redirectTarget: 'https://lemacs.com/' }, null]) {
            const component = form(data);
            component.onSubmit({ kind: 'redirect', redirectTarget: '  ', slug: 'new', label: 'New' });

            expect(dispatched).toEqual([]);
            expect(shown).toEqual([SectionFormComponent.TARGET_REQUIRED]);
        }
    });

    it('opens a redirect section on the redirect switch, and a site on the site one', () => {
        expect(form({ ...SECTION, redirectTarget: 'https://lemacs.com/', redirectStatus: 302 }).initialValue)
            .toEqual(jasmine.objectContaining({ kind: 'redirect', redirectStatus: '302' }));
        expect(form(SECTION).initialValue).toEqual(jasmine.objectContaining({ kind: 'site' }));
    });

    it('sends a redirect whole, empties the target of a former redirect, and sends nothing for a site', () => {
        expect(form(SECTION).redirectFrom({ kind: 'redirect', redirectTarget: ' https://lemacs.com/ ', redirectStatus: '302', redirectKeepPath: true }))
            .toEqual({ redirectTarget: 'https://lemacs.com/', redirectStatus: 302, redirectKeepPath: true });
        expect(form({ ...SECTION, redirectTarget: 'https://lemacs.com/' }).redirectFrom({ kind: 'site' }))
            .toEqual({ redirectTarget: '' });
        expect(form(SECTION).redirectFrom({ kind: 'site' })).toEqual({});
    });
});
