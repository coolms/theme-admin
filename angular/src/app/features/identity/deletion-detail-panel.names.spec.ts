import { TestBed } from '@angular/core/testing';
import { UserCalendarPreferencesService } from '@coolms/ui-angular';
import { DeletionDetailPanelComponent } from './deletion-detail-panel.component';
import { AccountDeletionDto } from './identity.types';

/** A deletion names the people in it by the name they gave; a person with none reads "No name" in a field, "Someone" in a sentence. */
describe('DeletionDetailPanelComponent names', () => {
    const deletion = (over: Partial<AccountDeletionDto> = {}): AccountDeletionDto => ({
        id: 'd1', userId: 'u1', accountLabel: null, requestedByKind: 'administrator', requestedBy: 'u9',
        requestedByLabel: null, requestedAt: '2026-11-01T10:00:00+00:00', dueAt: '2026-12-01T10:00:00+00:00',
        state: 'held',
        hold: { id: 'h1', reason: 'A court order', placedBy: 'u8', placedByLabel: null, placedAt: '2026-11-02T10:00:00+00:00',
            active: false, releasedAt: '2026-11-03T10:00:00+00:00', releasedBy: 'u7', releasedByLabel: null },
        ...over,
    });

    const render = (d: AccountDeletionDto): string => {
        TestBed.configureTestingModule({
            imports: [DeletionDetailPanelComponent],
            providers: [{
                provide: UserCalendarPreferencesService,
                useValue: {
                    ensureLoaded: () => undefined, tz: () => 'UTC', dateFormat: () => 'yyyy-MM-dd',
                    timeFormat: () => '24h', language: () => 'en-GB', dateFormatChosen: () => true,
                },
            }],
        });
        const fixture = TestBed.createComponent(DeletionDetailPanelComponent);
        fixture.componentRef.setInput('deletion', d);
        fixture.detectChanges();
        // Each term, value and paragraph on its own, so a term and its value read "Account No name".
        return [...(fixture.nativeElement as HTMLElement).querySelectorAll('dt, dd, p')]
            .map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' ');
    };

    it('reads "No name" in the account and requester fields, "Someone" in the hold\'s sentences, when they gave no name', () => {
        const text = render(deletion());
        expect(text).toContain('Account No name');
        expect(text).toContain('Requested by No name');
        expect(text).toContain('Placed by Someone on');
        expect(text).toContain('Released by Someone on');
        expect(text).not.toContain('a deleted user');
    });

    it('shows the names the server gives, a gone account\'s label included', () => {
        const text = render(deletion({
            accountLabel: 'a deleted user', requestedByLabel: 'Grace Hopper',
            hold: { id: 'h1', reason: 'r', placedBy: 'u8', placedByLabel: 'Ada Lovelace', placedAt: '2026-11-02T10:00:00+00:00', active: true },
        }));
        expect(text).toContain('Account a deleted user');
        expect(text).toContain('Requested by Grace Hopper');
        expect(text).toContain('Placed by Ada Lovelace on');
        expect(text).not.toContain('No name');
        expect(text).not.toContain('Someone');
    });
});
