import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, afterNextRender, computed, inject, input, output, signal } from '@angular/core';

import { EmailMailboxDto } from './email.types';

/**
 * The mailbox the folders are of, as one card. With more than one mailbox the card is the switcher: it opens the list
 * of them, each with its unread count, and a choice changes the card. With one, it names it and does nothing more.
 */
@Component({
    selector: 'app-mailbox-switcher',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (current(); as mailbox) {
            <div class="mbs__head">
            @if (mailboxes().length < 2) {
                <div class="mbs__card" (contextmenu)="menu.emit({ event: $event, id: mailbox.id })">
                    <ng-container *ngTemplateOutlet="face; context: { $implicit: mailbox }" />
                </div>
            } @else {
                <button type="button" class="mbs__card" aria-haspopup="true"
                        [attr.aria-expanded]="open()"
                        [attr.aria-label]="'Mailbox: ' + name(mailbox)"
                        (click)="toggle()"
                        (contextmenu)="menu.emit({ event: $event, id: mailbox.id })">
                    <ng-container *ngTemplateOutlet="face; context: { $implicit: mailbox }" />
                    <!-- A number on the card is the open mailbox's own; other mailboxes' unread mail is a dot. -->
                    @if ((unread()[mailbox.id] ?? 0) > 0) {
                        <span class="mbs__count" [attr.aria-label]="unread()[mailbox.id] + ' unread'">
                            {{ shown(unread()[mailbox.id]) }}
                        </span>
                    }
                    @if (elsewhere() > 0) {
                        <span class="mbs__elsewhere" role="img"
                              [attr.title]="elsewhere() + ' unread in other mailboxes'"
                              [attr.aria-label]="elsewhere() + ' unread in other mailboxes'"></span>
                    }
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                </button>
            }
            @if (hasSettings()) {
                <button type="button" class="mbs__settings" data-test="mailbox-settings"
                        title="Mailbox settings" aria-label="Mailbox settings" (click)="settings.emit()">
                    <i class="bi bi-gear" aria-hidden="true"></i>
                </button>
            }
            </div>
            @if (mailboxes().length > 1) {
                @if (open()) {
                    <ul class="mbs__list" aria-label="Choose a mailbox">
                        @for (m of mailboxes(); track m.id) {
                            <li>
                                <button type="button" class="mbs__choice"
                                        [attr.aria-current]="m.id === currentId()"
                                        (click)="choose(m.id)"
                                        (contextmenu)="menu.emit({ event: $event, id: m.id })">
                                    <ng-container *ngTemplateOutlet="face; context: { $implicit: m }" />
                                    @if ((unread()[m.id] ?? 0) > 0) {
                                        <span class="mbs__count" [attr.aria-label]="unread()[m.id] + ' unread'">
                                            {{ shown(unread()[m.id]) }}
                                        </span>
                                    }
                                </button>
                            </li>
                        }
                    </ul>
                }
            }
        }

        <ng-template #face let-m>
            <span class="mbs__avatar" [style.background]="colour(m.id)" aria-hidden="true">{{ initial(m) }}</span>
            <span class="mbs__text">
                <span class="mbs__label" [title]="name(m)">{{ name(m) }}</span>
                @if (m.emailAddress && m.emailAddress !== name(m)) {
                    <span class="mbs__address" [title]="m.emailAddress">{{ m.emailAddress }}</span>
                }
            </span>
        </ng-template>
    `,
    styles: [`
        /* The card's border and padding sit in the column's gutter: its content starts at the column's edge. */
        :host { display: block; position: relative; flex: 0 0 auto; margin-left: -9px; }
        .mbs__card, .mbs__choice {
            display: flex; align-items: center; gap: 9px; width: 100%; min-width: 0; text-align: left;
            padding: 8px; background: transparent; color: var(--cms-text); font: inherit;
        }
        .mbs__head {
            display: flex; align-items: stretch; min-width: 0;
            border: 1px solid var(--cms-border); border-radius: var(--cms-radius-md, 8px); background: var(--cms-surface);
        }
        .mbs__card { position: relative; flex: 1 1 auto; gap: 6px; border: 0; border-radius: var(--cms-radius-md, 8px); }
        /* The others' unread sits on the avatar: beside the chevron and the gear it left the name no room. */
        .mbs__card > .mbs__count { position: absolute; top: 2px; left: 20px; box-shadow: 0 0 0 2px var(--cms-surface); }
        .mbs__settings {
            flex: 0 0 auto; width: 28px; padding: 0; border: 0; background: transparent; cursor: pointer;
            color: var(--cms-text-muted); border-radius: var(--cms-radius-md, 8px);
        }
        .mbs__settings:hover { background: var(--cms-surface-hover); color: var(--cms-text); }
        button.mbs__card { cursor: pointer; }
        button.mbs__card:hover, .mbs__choice:hover { background: var(--cms-surface-hover); }
        .mbs__avatar {
            flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
            display: inline-flex; align-items: center; justify-content: center;
            color: var(--cms-text-inverse); font-size: .875rem; font-weight: 600; line-height: 1; user-select: none;
        }
        .mbs__text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
        /* Two lines for the name: on one, a long list of similar names reads as the same name over and over. */
        .mbs__label {
            display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
            overflow-wrap: anywhere; font-size: .875rem; font-weight: 600; line-height: 1.25;
        }
        .mbs__address {
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            font-size: .75rem; color: var(--cms-text-muted);
        }
        .mbs__count {
            flex: 0 0 auto; background: var(--cms-accent, #F5A623); color: var(--cms-accent-fg, #1a1a1a);
            border-radius: 999px; font-size: .6875rem; line-height: 1.2; padding: 1px 5px; min-width: 16px; text-align: center;
        }
        .mbs__elsewhere {
            flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%;
            background: var(--cms-accent, #F5A623);
        }
        .mbs__list {
            position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 10;
            margin: 0; padding: 4px; list-style: none; max-height: 60vh; overflow-y: auto;
            background: var(--cms-surface); border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-md, 8px); box-shadow: var(--cms-shadow-md);
        }
        .mbs__choice { border: 0; border-radius: var(--cms-radius, 6px); cursor: pointer; }
        .mbs__choice[aria-current="true"] { background: var(--cms-selected-light); }
    `],
    imports: [NgTemplateOutlet],
})
export class MailboxSwitcherComponent {
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);

    readonly mailboxes = input.required<readonly EmailMailboxDto[]>();
    readonly currentId = input.required<string | null>();
    readonly unread = input.required<Readonly<Record<string, number>>>();
    /** The server offers this person the mailbox's settings. */
    readonly hasSettings = input(false);
    readonly chosen = output<string>();
    readonly settings = output<void>();
    readonly menu = output<{ event: MouseEvent; id: string }>();

    protected readonly open = signal(false);
    protected readonly current = computed(() => this.mailboxes().find(m => m.id === this.currentId()) ?? null);
    protected readonly elsewhere = computed(() => this.mailboxes()
        .filter(m => m.id !== this.currentId())
        .reduce((sum, m) => sum + (this.unread()[m.id] ?? 0), 0));

    @HostListener('document:pointerdown', ['$event'])
    protected onPointerDown(event: Event): void {
        if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
            this.open.set(false);
        }
    }

    @HostListener('document:keydown.escape')
    protected onEscape(): void {
        if (!this.open()) {
            return;
        }
        this.open.set(false);
        this.host.nativeElement.querySelector<HTMLButtonElement>('.mbs__card')?.focus();
    }

    protected toggle(): void {
        this.open.set(!this.open());
        if (this.open()) {
            afterNextRender(() => this.host.nativeElement.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus(), { injector: this.injector });
        }
    }

    protected choose(id: string): void {
        this.open.set(false);
        if (id !== this.currentId()) {
            this.chosen.emit(id);
        }
    }

    protected name(m: EmailMailboxDto): string {
        return m.label || m.emailAddress || m.id;
    }

    protected initial(m: EmailMailboxDto): string {
        return (this.name(m).trim().charAt(0) || '?').toUpperCase();
    }

    protected shown(count: number): string {
        return count > 99 ? '99+' : String(count);
    }

    protected colour(id: string): string {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = (hash * 31 + id.charCodeAt(i)) % 360;
        }
        return `hsl(${hash}, 48%, 45%)`;
    }
}
