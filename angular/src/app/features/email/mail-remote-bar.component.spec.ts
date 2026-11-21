import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { NaviGraphService, type NaviGraphNode } from '@coolms/core-angular';

import { type RemoteContentDto } from './email.types';
import { MailRemoteBarComponent, type RemoteContentAction } from './mail-remote-bar.component';

/** The image bar's tree as the server seeds it (navi.toolbar.email.remote-content). */
const blocked = { field: '_remoteContent', op: 'eq', value: 'blocked' };
const node = (path: string, action: string, label: string, shortLabel: string, showWhen: unknown, extra: Record<string, unknown> = {}): NaviGraphNode => ({
    id: path, path, title: label, parentId: null, sortOrder: 0, isActive: true, isVisible: true, children: [],
    meta: { action, label, shortLabel, icon: 'image', surface: 'toolbar', showWhen, ...extra },
});
const TREE: NaviGraphNode[] = [
    node('/allow-message', 'allow-remote-message', 'Load images', 'Load', blocked),
    node('/allow-sender', 'allow-remote-sender', 'Always show images from this sender', 'Always', {
        or: [blocked, { and: [{ field: '_remoteContent', op: 'eq', value: 'allowed' }, { field: '_remoteReason', op: 'eq', value: 'message' },
            { field: '_remoteSender', op: 'eq', value: true }] }],
    }, {
        disabledWhen: { field: '_remoteSender', op: 'eq', value: false }, disabledReason: 'no-sender',
        disabledReasonText: 'This message names no sender address to allow.',
    }),
    node('/disallow-sender', 'disallow-remote-sender', 'Stop showing images from this sender', 'Stop', {
        and: [{ field: '_remoteContent', op: 'eq', value: 'allowed' }, { field: '_remoteReason', op: 'eq', value: 'sender' }],
    }),
];

const BLOCKED: RemoteContentDto = { state: 'blocked', reason: null, sentence: 'Images from outside the message are hidden to protect your privacy.' };
const BY_MESSAGE: RemoteContentDto = { state: 'allowed', reason: 'message', sentence: 'Always show images from this sender?' };
const BY_SENDER: RemoteContentDto = { state: 'allowed', reason: 'sender', sentence: 'Images are shown because you always show images from news@example.test.' };

describe('MailRemoteBarComponent: the server\'s image bar in one row', () => {
    let fixture: ComponentFixture<MailRemoteBarComponent>;
    let acted: RemoteContentAction[];

    function render(content: RemoteContentDto, hasSender = true, nodes: NaviGraphNode[] = TREE): HTMLElement {
        // The service's own showWhen evaluation, without its store: isVisible and matchesShowWhen read nothing injected.
        const naviGraph: NaviGraphService = Object.create(NaviGraphService.prototype);
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting(), { provide: NaviGraphService, useValue: naviGraph }],
        });
        fixture = TestBed.createComponent(MailRemoteBarComponent);
        fixture.componentRef.setInput('content', content);
        fixture.componentRef.setInput('nodes', nodes);
        fixture.componentRef.setInput('hasSender', hasSender);
        acted = [];
        fixture.componentInstance.act.subscribe(a => acted.push(a));
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }
    const bar = (el: HTMLElement): HTMLElement | null => el.querySelector('.mrb');
    const buttons = (el: HTMLElement): HTMLButtonElement[] => Array.from(el.querySelectorAll<HTMLButtonElement>('.mrb__actions button'));

    it('blocked: the server\'s sentence, Load images as the main action, Always quieter, each with its short label', () => {
        const el = render(BLOCKED);
        expect(bar(el)?.getAttribute('data-remote')).toBe('blocked');
        expect(el.querySelector('.mrb__text')?.textContent?.trim()).toBe(BLOCKED.sentence as string);
        expect(buttons(el).map(b => b.getAttribute('data-action'))).toEqual(['allow-remote-message', 'allow-remote-sender']);
        expect(buttons(el)[0].classList.contains('cms-btn-primary')).toBeTrue();
        expect(buttons(el)[1].classList.contains('cms-btn-primary')).toBeFalse();
        expect(buttons(el).map(b => b.getAttribute('data-short'))).toEqual(['Load', 'Always']);
        expect(buttons(el)[0].getAttribute('aria-label')).toBe('Load images');
        expect(el.querySelector('.mrb__close')).withContext('a blocked bar is not a question').toBeNull();

        buttons(el)[0].click();
        expect(acted).toEqual(['allow-remote-message']);
    });

    it('a message with no sender keeps Always in sight; pressed, it says why in the server\'s words and runs nothing', () => {
        const el = render(BLOCKED, false);
        const always = buttons(el)[1];
        expect(always.getAttribute('aria-disabled')).toBe('true');
        expect(always.title).toBe('This message names no sender address to allow.');

        always.click();
        fixture.detectChanges();
        expect(acted).toEqual([]);
        expect(el.querySelector('.mrb__said')?.textContent?.trim()).toBe('This message names no sender address to allow.');
        expect(bar(el)?.hasAttribute('data-said')).toBeTrue();
    });

    it('allowed for this message: the question, Always as the main action, and a close that hides it for this view only', () => {
        const el = render(BY_MESSAGE);
        expect(buttons(el).map(b => b.getAttribute('data-action'))).toEqual(['allow-remote-sender']);
        expect(buttons(el)[0].classList.contains('cms-btn-primary')).toBeTrue();
        const close = el.querySelector<HTMLButtonElement>('.mrb__close');
        expect(close).not.toBeNull();

        close!.click();
        fixture.detectChanges();
        expect(bar(el)).toBeNull();
        expect(acted).withContext('closing asks nothing of the server').toEqual([]);
    });

    it('allowed by the sender: the server\'s sentence and Stop', () => {
        const el = render(BY_SENDER);
        expect(buttons(el).map(b => b.getAttribute('data-action'))).toEqual(['disallow-remote-sender']);
        expect(el.querySelector('.mrb__close')).toBeNull();
    });

    it('nothing to say: no bar; no tree served: the sentence alone, no action', () => {
        expect(bar(render({ state: 'none', reason: null, sentence: null }))).toBeNull();
        TestBed.resetTestingModule();
        const el = render(BLOCKED, true, []);
        expect(bar(el)).not.toBeNull();
        expect(buttons(el)).toEqual([]);
    });

    it('while an action runs, none can be pressed', () => {
        const el = render(BLOCKED);
        fixture.componentRef.setInput('busy', 'allow-remote-message');
        fixture.detectChanges();
        expect(buttons(el).every(b => b.disabled)).toBeTrue();
        buttons(el)[1].click();
        expect(acted).toEqual([]);
    });
});
