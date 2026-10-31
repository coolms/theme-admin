import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
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
            versions: [version(3, '14:11', ['tags']), version(2, '14:05', ['blocks']), version(1, '14:02', ['created'])],
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
