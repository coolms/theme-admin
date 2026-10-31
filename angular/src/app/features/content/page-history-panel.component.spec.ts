import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { DateTimeFormatService } from '@coolms/ui-angular';
import { PageHistoryPanelComponent } from './page-history-panel.component';
import { PageVersionsService } from './page-versions.service';
import { type PageBlameDto, type PageVersionDiffDto, type PageVersionDto, type PageVersionsDto } from './page-versions';

/**
 * The page's history panel: the versions grouped, a group opening to its versions, older ones asked for by the oldest
 * shown, and a failed read shown in the banner rather than as an empty list.
 */
describe('PageHistoryPanelComponent', () => {
    const ann = { id: 'ann', name: 'Ann' };
    const version = (seq: number, at: string, changes: string[]): PageVersionDto =>
        ({ id: 'v' + seq, seq, recordedAt: '2026-10-31T' + at + ':00Z', author: ann, message: null, changes });

    let answers: Array<() => Observable<PageVersionsDto>>;
    let asked: Array<number | null>;
    let diffsAsked: number[];
    let blameAsked: string[];
    const diffOf = (seq: number): PageVersionDiffDto => ({
        path: '/content/site/about.page', version: version(seq, '14:00', ['blocks (1 changed)']), previous: seq - 1,
        changes: {
            created: false, fields: [], languages: [], frame: null, properties: [], other: [],
            records: { blocks: { matchedBy: 'id', counts: { added: 0, removed: 0, moved: 0, changed: 1 }, records: [{
                status: 'changed', moved: false, id: 'b1', type: 'hero', from: 0, to: 0,
                fields: [{ name: 'title', kind: 'text', old: 'Book a call', new: 'Book a demo', words: [
                    { op: 'equal', text: 'Book a ' }, { op: 'delete', text: 'call' }, { op: 'insert', text: 'demo' },
                ] }],
            }] } },
        },
        bodies: [],
    });
    const blame: PageBlameDto = {
        path: '/content/site/about.page', complete: false,
        blocks: [{ id: 'b1', type: 'faq_list', index: 0, seq: 3, fields: { title: 3, items: null } }],
        versions: { '3': { recordedAt: '2026-10-31T14:11:00Z', author: ann } },
    };
    let fixture: ComponentFixture<PageHistoryPanelComponent>;

    function open(compact = false): HTMLElement {
        asked = [];
        diffsAsked = [];
        blameAsked = [];
        TestBed.configureTestingModule({
            imports: [PageHistoryPanelComponent],
            providers: [{
                provide: DateTimeFormatService,
                useValue: { time: (iso: string) => iso.slice(11, 16), dateTime: (iso: string) => iso.slice(0, 16) },
            }, {
                provide: PageVersionsService,
                useValue: {
                    list: (_path: string, before: number | null) => {
                        asked.push(before);
                        return answers[Math.min(asked.length - 1, answers.length - 1)]();
                    },
                    diff: (_path: string, seq: number) => {
                        diffsAsked.push(seq);
                        return of(diffOf(seq));
                    },
                    blame: (path: string) => {
                        blameAsked.push(path);
                        return of(blame);
                    },
                },
            }],
        });
        fixture = TestBed.createComponent(PageHistoryPanelComponent);
        fixture.componentRef.setInput('path', '/content/site/about.page');
        fixture.componentRef.setInput('compact', compact);
        fixture.detectChanges();

        return fixture.nativeElement as HTMLElement;
    }

    it('lists consecutive saves as one group that opens to its versions', () => {
        answers = [() => of({
            path: '/content/site/about.page', hasMore: false,
            versions: [
                version(3, '14:11', ['tags']), version(2, '14:05', ['blocks']), version(1, '14:02', ['created']),
            ],
        })];
        const el = open();

        const groups = el.querySelectorAll('[data-test="history-group"]');
        expect(groups.length).toBe(1);
        expect(groups[0].textContent).toContain('3 saves');
        expect(groups[0].textContent).toContain('tags');
        expect(el.querySelector('[data-test="history-versions"]')).toBeNull();

        (groups[0].querySelector('button') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(el.querySelectorAll('[data-test="history-versions"] li').length).toBe(3);
    });

    it('asks for older versions before the oldest shown, and adds them below', () => {
        answers = [
            () => of({ path: '/p', hasMore: true, versions: [version(9, '15:00', ['tags'])] }),
            () => of({ path: '/p', hasMore: false, versions: [version(4, '09:00', ['created'])] }),
        ];
        const el = open();

        (el.querySelector('[data-test="history-more"]') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(asked).toEqual([null, 9]);
        expect(fixture.componentInstance.versions().map(v => v.seq)).toEqual([9, 4]);
        expect(el.querySelector('[data-test="history-more"]')).toBeNull();
    });

    it('keeps the versions read when an older page fails, and its Retry asks for that same page', () => {
        answers = [
            () => of({ path: '/p', hasMore: true, versions: [version(9, '15:00', ['tags'])] }),
            () => throwError(() => new HttpErrorResponse({ status: 500 })),
            () => of({ path: '/p', hasMore: false, versions: [version(4, '09:00', ['created'])] }),
        ];
        const el = open();

        (el.querySelector('[data-test="history-more"]') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(fixture.componentInstance.versions().map(v => v.seq)).toEqual([9]);
        expect(el.querySelectorAll('[data-test="history-group"]').length).toBe(1);
        expect(el.querySelector('app-error-banner')).not.toBeNull();

        fixture.componentInstance.more();
        fixture.detectChanges();

        expect(asked).toEqual([null, 9, 9]);
        expect(fixture.componentInstance.versions().map(v => v.seq)).toEqual([9, 4]);
        expect(el.querySelector('app-error-banner')).toBeNull();
    });

    it('drops a late answer for a path no longer asked about', () => {
        const old = new Subject<PageVersionsDto>();
        answers = [() => old, () => of({ path: '/b', hasMore: false, versions: [version(7, '12:00', ['frame'])] })];
        open();

        fixture.componentRef.setInput('path', '/content/site/other.page');
        fixture.detectChanges();
        old.next({ path: '/a', hasMore: false, versions: [version(1, '08:00', ['created'])] });
        old.complete();

        expect(fixture.componentInstance.versions().map(v => v.seq)).toEqual([7]);
    });

    it('drops an older page still on its way when the list is read again', () => {
        const late = new Subject<PageVersionsDto>();
        answers = [
            () => of({ path: '/p', hasMore: true, versions: [version(9, '15:00', ['tags'])] }),
            () => late,
            () => of({
                path: '/p', hasMore: true,
                versions: [version(10, '15:30', ['blocks']), version(9, '15:00', ['tags'])],
            }),
        ];
        open();
        fixture.componentInstance.more();

        fixture.componentInstance.reload();
        late.next({ path: '/p', hasMore: false, versions: [version(4, '09:00', ['created'])] });
        late.complete();

        expect(fixture.componentInstance.versions().map(v => v.seq)).toEqual([10, 9]);
    });

    it('clears the old page versions at once when it is asked about another one', () => {
        const pending = new Subject<PageVersionsDto>();
        answers = [
            () => of({ path: '/a', hasMore: false, versions: [version(1, '08:00', ['created'])] }),
            () => pending,
        ];
        const el = open();
        expect(el.querySelectorAll('[data-test="history-group"]').length).toBe(1);

        fixture.componentRef.setInput('path', '/content/site/other.page');
        fixture.detectChanges();

        expect(fixture.componentInstance.versions()).toEqual([]);
        expect(el.querySelector('[data-test="history-group"]')).toBeNull();
    });

    it('opens a single version straight to what changed in it, word by word', () => {
        answers = [() => of({ path: '/p', hasMore: false, versions: [version(5, '14:00', ['blocks (1 changed)'])] })];
        const el = open();

        (el.querySelector('[data-test="history-group"] button') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(diffsAsked).toEqual([5]);
        const section = el.querySelector('[data-test="diff-section"]') as HTMLElement;
        expect(section.textContent).toContain('Hero');
        expect(section.querySelector('.vd__run--delete')?.textContent).toBe('call');
        expect(section.querySelector('.vd__run--insert')?.textContent).toBe('demo');
    });

    it('opens one version of a group to its changes, read once however often it is opened', () => {
        answers = [() => of({
            path: '/p', hasMore: false,
            versions: [version(3, '14:11', ['tags']), version(2, '14:05', ['blocks'])],
        })];
        const el = open();
        (el.querySelector('[data-test="history-group"] button') as HTMLButtonElement).click();
        fixture.detectChanges();
        const second = el.querySelectorAll('[data-test="history-version"]')[1] as HTMLButtonElement;

        second.click();
        fixture.detectChanges();
        second.click();
        fixture.detectChanges();
        second.click();
        fixture.detectChanges();

        expect(diffsAsked).toEqual([2]);
        expect(el.querySelector('app-page-version-diff')).not.toBeNull();
    });

    it('says by section who last changed each section and each field, and "earlier" past what was read', () => {
        answers = [() => of({ path: '/p', hasMore: false, versions: [version(3, '14:11', ['blocks'])] })];
        const el = open();

        (el.querySelector('[data-test="history-view-blame"]') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(blameAsked).toEqual(['/content/site/about.page']);
        const section = el.querySelector('[data-test="blame-section"]') as HTMLElement;
        expect(section.textContent).toContain('1. Faq list');
        expect(section.textContent).toContain('Ann');
        (section.querySelector('button') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(section.querySelector('[data-test="blame-fields"]')?.textContent).toContain('earlier');
        expect(el.querySelector('[data-test="blame-incomplete"]')).not.toBeNull();
    });

    it('shows the latest rows only when compact, with Show all, and no By section', () => {
        const ids = [1, 2, 3, 4, 5, 6, 7];
        answers = [() => of({
            path: '/f', hasMore: false,
            // An hour apart, newest first: each its own row.
            versions: ids.map(n => version(10 - n, String(18 - n) + ':00', ['frame'])),
        })];
        const el = open(true);

        expect(el.querySelectorAll('[data-test="history-group"]').length).toBe(5);
        expect(el.querySelector('[data-test="history-view-blame"]')).toBeNull();
        (el.querySelector('[data-test="history-show-all"]') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(el.querySelectorAll('[data-test="history-group"]').length).toBe(7);
    });

    it('keeps the versions paged in when the view goes to By section and back, reading nothing again', () => {
        answers = [
            () => of({ path: '/p', hasMore: true, versions: [version(9, '15:00', ['tags'])] }),
            () => of({ path: '/p', hasMore: false, versions: [version(4, '09:00', ['created'])] }),
        ];
        open();
        fixture.componentInstance.more();
        fixture.detectChanges();

        fixture.componentInstance.show('blame');
        fixture.detectChanges();
        TestBed.tick();
        fixture.componentInstance.show('versions');
        fixture.detectChanges();
        TestBed.tick();

        expect(asked).toEqual([null, 9]);
        expect(fixture.componentInstance.versions().map(v => v.seq)).toEqual([9, 4]);
        expect(blameAsked.length).toBe(1);
    });

    it('says when there is no version yet', () => {
        answers = [() => of({ path: '/p', hasMore: false, versions: [] })];

        expect(open().querySelector('[data-test="history-empty"]')).not.toBeNull();
    });

    it('shows a failed read in the banner, never as an empty history', () => {
        answers = [() => throwError(() => new HttpErrorResponse({ status: 500 }))];
        const el = open();

        expect(el.querySelector('app-error-banner')).not.toBeNull();
        expect(el.querySelector('[data-test="history-empty"]')).toBeNull();
    });
});
