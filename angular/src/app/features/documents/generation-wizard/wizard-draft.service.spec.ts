import { TestBed } from '@angular/core/testing';

import {
    WizardDraft,
    WizardDraftInput,
    WizardDraftService,
} from './wizard-draft.service';

/**
 *-2.6a — behaviour spec for WizardDraftService.
 *
 * Coverage:
 *   1. save() round-trips through localStorage.
 *   2. maybeRestore() invokes `apply` only after `confirmFn` true.
 *   3. maybeRestore() with declined confirm clears the draft.
 *   4. version mismatch silently discards the draft.
 *   5. TTL-exceeded draft is silently discarded.
 *   6. Corrupt JSON is silently discarded.
 *   7. clear() removes the entry.
 */

const TEMPLATE_ID = 'abc-123';
const sampleInput = (): WizardDraftInput => ({
    currentStepId: 'audience',
    mode: 'filter',
    recipientsRql: 'filter=isActive eq true',
    recipientsCount: 12,
    audience: { org: 'org-uuid-1' },
    plainVariables: { topic: 'X' },
    outputBasePath: '/docs/out',
    filenamePattern: '{{name}}.docx',
});

describe('WizardDraftService', () => {
    let service: WizardDraftService;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [WizardDraftService] });
        service = TestBed.inject(WizardDraftService);
        localStorage.clear();
    });

    afterEach(() => localStorage.clear());

 it('round-trips a saved draft through localStorage', () => {
        service.save(TEMPLATE_ID, sampleInput());
        const raw = localStorage.getItem(`wizard-draft-${TEMPLATE_ID}`);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!) as WizardDraft;
 // Asserted as a literal on purpose: when the draft shape changes and
 // `VERSION` is bumped, this fails and makes whoever bumped it decide
 // what happens to drafts already sitting in users' localStorage.
        expect(parsed.version).toBe(2);
        expect(parsed.templateId).toBe(TEMPLATE_ID);
        expect(parsed.mode).toBe('filter');
        expect(parsed.outputBasePath).toBe('/docs/out');
        expect(parsed.recipientsRql).toBe('filter=isActive eq true');
        expect(parsed.recipientsCount).toBe(12);
        expect(parsed.audience).toEqual({ org: 'org-uuid-1' });
    });

 it('invokes apply on restore when confirm returns true', () => {
        service.save(TEMPLATE_ID, sampleInput());
        let applied: WizardDraft | null = null;
        service.maybeRestore(TEMPLATE_ID, (d) => (applied = d), () => true);
        expect(applied).not.toBeNull();
        expect(applied!.mode).toBe('filter');
    });

 it('clears the draft and skips apply when confirm returns false', () => {
        service.save(TEMPLATE_ID, sampleInput());
        let called = false;
        service.maybeRestore(TEMPLATE_ID, () => (called = true), () => false);
        expect(called).toBe(false);
        expect(localStorage.getItem(`wizard-draft-${TEMPLATE_ID}`)).toBeNull();
    });

 it('discards a draft whose version does not match', () => {
        localStorage.setItem(
            `wizard-draft-${TEMPLATE_ID}`,
            JSON.stringify({ ...sampleInput(), version: 99, timestamp: Date.now(), templateId: TEMPLATE_ID }),
        );
        let called = false;
        service.maybeRestore(TEMPLATE_ID, () => (called = true), () => true);
        expect(called).toBe(false);
        expect(localStorage.getItem(`wizard-draft-${TEMPLATE_ID}`)).toBeNull();
    });

 it('discards a draft whose timestamp is older than TTL', () => {
        const ancient = Date.now() - 48 * 60 * 60 * 1000; // 48h ago
        localStorage.setItem(
            `wizard-draft-${TEMPLATE_ID}`,
 // `version` MUST be the current one. `maybeRestore` checks the
 // version before the timestamp, so seeding a stale version here
 // (this line said `1` until the suite was first actually run)
 // discards the draft on the version branch and never exercises
 // the TTL branch this test is named for.
            JSON.stringify({ ...sampleInput(), version: 2, timestamp: ancient, templateId: TEMPLATE_ID }),
        );
        let called = false;
        service.maybeRestore(TEMPLATE_ID, () => (called = true), () => true);
        expect(called).toBe(false);
        expect(localStorage.getItem(`wizard-draft-${TEMPLATE_ID}`)).toBeNull();
    });

 it('discards corrupt JSON without throwing', () => {
        localStorage.setItem(`wizard-draft-${TEMPLATE_ID}`, '{not json');
        let called = false;
        expect(() =>
            service.maybeRestore(TEMPLATE_ID, () => (called = true), () => true),
        ).not.toThrow();
        expect(called).toBe(false);
        expect(localStorage.getItem(`wizard-draft-${TEMPLATE_ID}`)).toBeNull();
    });

 it('clear() removes the entry', () => {
        service.save(TEMPLATE_ID, sampleInput());
        service.clear(TEMPLATE_ID);
        expect(localStorage.getItem(`wizard-draft-${TEMPLATE_ID}`)).toBeNull();
    });
});
