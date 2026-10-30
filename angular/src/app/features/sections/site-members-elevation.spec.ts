import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { provideStore } from '@ngxs/store';
import { Observable, of, Subject, throwError } from 'rxjs';
import {
    ConfigService, ELEVATION_REQUIRED_PROBLEM_TYPE, ElevationService, ErrorHandlerService, type ElevationChange,
} from '@coolms/core-angular';
import { SiteMembersPageComponent } from './site-members.page';
import { SectionsApiService } from './sections-api.service';
import { type SiteDto, type SiteMemberDto } from './sections.types';

/**
 * A site's members are people's data, read in an elevated session only. Refused for want of elevation -- on a
 * reload, a link, the back button, or a refresh after the elevation ended -- the page shows the Elevate state in
 * their place, never the error banner, and loads again once the session is elevated.
 */
describe('SiteMembersPageComponent -- refused for want of elevation', () => {
    const site = {
        sectionId: '1', slug: 'acme', label: 'Acme', host: null, pathPrefix: null, priority: null, themeSlug: null,
        defaultLocale: null, feStack: null, isActive: true, naviTrees: [], contentRoot: null,
        currentUserMembership: null,
    } as SiteDto;
    const members: SiteMemberDto[] = [{ userId: 'u1', username: 'ann', email: null, isOwner: true, isEditor: false }];

    const stamped = () => new HttpErrorResponse({
        status: 403, error: { type: ELEVATION_REQUIRED_PROBLEM_TYPE, elevationGate: 'identity.administrator_role' },
    });
    const otherForbidden = () => new HttpErrorResponse({
        status: 403, error: { type: '/errors/403', detail: 'Not yours.' }, headers: new HttpHeaders(),
    });

    let fixture: ComponentFixture<SiteMembersPageComponent>;
    let answers: Array<() => Observable<SiteMemberDto[]>>;
    let membersAsked: number;
    let changes: Subject<ElevationChange>;
    let elevated: ReturnType<typeof signal<boolean>>;

    function setup(first: () => Observable<SiteMemberDto[]>): void {
        answers = [first];
        membersAsked = 0;
        changes = new Subject<ElevationChange>();
        elevated = signal(false);
        const api = {
            getSite: () => of(site),
            listSiteMembers: () => {
                const answer = answers[Math.min(membersAsked, answers.length - 1)];
                membersAsked++;
                return answer();
            },
        };
        const params = convertToParamMap({ slug: 'acme' });

        TestBed.configureTestingModule({
            imports: [SiteMembersPageComponent],
            providers: [
                provideStore([]),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: SectionsApiService, useValue: api },
                { provide: ConfigService, useValue: { layout: () => of(null) } },
                { provide: ErrorHandlerService, useValue: { humanize: (e: HttpErrorResponse) => e.error?.detail ?? 'failed' } },
                { provide: ActivatedRoute, useValue: { paramMap: of(params), snapshot: { paramMap: params } } },
                { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
                {
                    provide: ElevationService,
                    useValue: {
                        changes$: changes, elevated: () => elevated(), available: true,
                        offerFor: () => { elevated.set(true); return of(true); },
                    },
                },
            ],
        });
        fixture = TestBed.createComponent(SiteMembersPageComponent);
        fixture.detectChanges();
    }

    const el = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

    it('shows the Elevate state in place of the members, not the error banner', () => {
        setup(() => throwError(stamped));

        expect(el('[data-test="members-elevation-required"]')).not.toBeNull();
        expect(el('app-error-banner')).toBeNull();
    });

    it('loads again once the session is elevated from it, and shows the members', () => {
        setup(() => throwError(stamped));
        answers.push(() => of(members));

        (el('[data-test="elevate"]') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(membersAsked).toBe(2);
        expect(el('[data-test="members-elevation-required"]')).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('1 member');
    });

    it('keeps the error banner for a refusal elevation would not lift', () => {
        setup(() => throwError(otherForbidden));

        expect(el('[data-test="members-elevation-required"]')).toBeNull();
        expect(el('app-error-banner')).not.toBeNull();
    });

    it('asks again when the elevation ends while the members are shown, and shows the Elevate state if refused', () => {
        setup(() => of(members));
        expect(fixture.nativeElement.textContent).toContain('1 member');
        answers.push(() => throwError(stamped));

        changes.next({ kind: 'expired' } as ElevationChange);
        fixture.detectChanges();

        expect(membersAsked).toBe(2);
        expect(el('[data-test="members-elevation-required"]')).not.toBeNull();
    });

    it('loads again when another tab elevates the session while the Elevate state is shown', () => {
        setup(() => throwError(stamped));
        answers.push(() => of(members));

        elevated.set(true);
        changes.next({ kind: 'granted' } as ElevationChange);
        fixture.detectChanges();

        expect(membersAsked).toBe(2);
        expect(el('[data-test="members-elevation-required"]')).toBeNull();
    });
});
