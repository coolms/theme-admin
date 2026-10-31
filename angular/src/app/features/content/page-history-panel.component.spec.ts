import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { DateTimeFormatService } from '@coolms/ui-angular';
import { PageHistoryPanelComponent } from './page-history-panel.component';
import { PageVersionsService } from './page-versions.service';
import { type PageVersionDto, type PageVersionsDto } from './page-versions';

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
    let fixture: ComponentFixture<PageHistoryPanelComponent>;

    function open(): HTMLElement {
        asked = [];
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
                },
            }],
        });
        fixture = TestBed.createComponent(PageHistoryPanelComponent);
        fixture.componentRef.setInput('path', '/content/site/about.page');
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
