import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    signal,
} from '@angular/core';
import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { Store } from '@ngxs/store';
import { CoolmsEditorComponent } from '@coolms/editor-angular';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsFilePickerDialogComponent,
    ConfirmDialogService,
    LocaleSwitcherComponent,
    ModalComponent,
    ToastService,
    type FilePickerDialogData,
} from '@coolms/ui-angular';
import { NewsletterService, type NewsletterSiteDto } from './newsletter.service';

/**
 * Newsletter "Compose campaign" dialog (Option A, #974).
 *
 * Lifted out of the inline section on the Newsletter list page into the
 * platform `app-modal` (CDK Dialog), opened from the page's "Compose"
 * toolbar action. Self-contained: collects subject + HTML body, guards on
 * the confirmed-recipient count, runs the same "send to N" confirm step,
 * then POSTs the campaign and toasts the queued count. Resolves the dialog
 * with `true` once a campaign was queued (so the page can refresh), or
 * `false` on cancel.
 *
 * `confirmedCount` arrives via `DIALOG_DATA` — the page already tracks it
 * for the confirmed bucket.
 *
 * **Multi-locale since #1743.** The same `<app-locale-switcher>` the Editor and
 * the Media panels use drives a per-locale `{subject, body}` map; at send, each
 * recipient gets the language resolved for them, falling back to the platform
 * default. A locale only exists once something is typed into it, and a
 * half-written one is dropped rather than sent — advertising a language whose
 * readers would receive an empty email is worse than not offering it. The
 * switcher hides itself on a single-locale install, so nothing changes there.
 *
 * **The body is the rich `coolms-editor` since #1734**, on the `newsletter`
 * profile. That profile is narrower than `full` on purpose — it drops grid
 * layouts, tables, code blocks, callouts and embeds, because those emit modern
 * CSS or scripted markup that Outlook ignores and no mail client executes, so
 * they would look broken in a way the author never sees while composing.
 *
 * ⚠️ **This could not ship before the send path rendered dtmpl** (#1733). The
 * profile's media insert emits a `{widget:media:UUID …}` tag; while
 * `SendCampaignEmailHandler` concatenated the body and sent it verbatim, every
 * inserted image would have arrived in the subscriber's inbox as that literal
 * tag. The editor and the "process before sending" work were one change, not two.
 *
 * There is no bespoke rich/plain toggle: the profile includes `meta:source`, so
 * raw-HTML editing lives in the editor's own toolbar — which is where the rest
 * of the admin puts it, and it preserves what the old textarea was for.
 */
@Component({
    selector: 'app-newsletter-compose-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ModalComponent,
        FormsModule,
        CoolmsEditorComponent,
        LocaleSwitcherComponent,
    ],
    template: `
        <app-modal title="Compose campaign" [width]="720">
            <p class="hint">
                Sent to every <strong>confirmed</strong> subscriber of the selected list. Each email
                carries a one-click unsubscribe link automatically, and is wrapped in that site's
                email layout.
            </p>
            @if (sites().length > 1) {
                <div class="field">
                    <label class="cms-label" for="news-site">Send to</label>
                    <select id="news-site" class="cms-input"
                            [ngModel]="site()" (ngModelChange)="site.set($event)">
                        @for (s of sites(); track s.slug) {
                            <option [value]="s.slug">
                                {{ s.label }} — {{ s.confirmedCount }} confirmed
                            </option>
                        }
                    </select>
                </div>
            }
            <app-locale-switcher
                label="Write in"
                [activeLocale]="activeLocale()"
                [dirty]="hasContent(activeLocale())"
                (localeChange)="activeLocale.set($event)" />

            <div class="field">
                <label class="cms-label" for="news-subject">Subject</label>
                <input id="news-subject" class="cms-input" type="text"
                       [ngModel]="subject()" (ngModelChange)="setSubject($event)"
                       placeholder="What's new this month?" />
            </div>
            <div class="field">
                <label class="cms-label">Body</label>
                <!--
                  Keyed on the locale so switching REPLACES the editor rather than
                  re-feeding one instance: the rich editor owns its own document
                  state, and pushing new content into a live instance leaves the
                  previous language's undo history (and sometimes its content)
                  behind.
                -->
                @for (loc of [activeLocale()]; track loc) {
                    <coolms-editor class="body"
                                   profile="newsletter"
                                   [content]="body()"
                                   (contentChange)="setBody($event)" />
                }
                <p class="note">
                    Inserted images are embedded in the email, so they show without the
                    “load remote images?” prompt.
                </p>
            </div>

            @if (multiLocale()) {
                <p class="langs">
                    @if (writtenLocales().length > 0) {
                        Will send in
                        @for (loc of writtenLocales(); track loc) {
                            <strong>{{ loc.toUpperCase() }}</strong>{{ $last ? '' : ', ' }}
                        }
                        — everyone else gets <strong>{{ defaultLocale().toUpperCase() }}</strong>.
                    } @else {
                        Nothing written yet. <strong>{{ defaultLocale().toUpperCase() }}</strong> is
                        required — other languages are optional.
                    }
                </p>
            }

            <div class="field">
                <label class="cms-label">Attachments</label>
                @if (attachments().length > 0) {
                    <div class="attachments">
                        @for (path of attachments(); track path) {
                            <span class="attachment" [title]="path">
                                <i class="bi bi-paperclip"></i>
                                <span class="attachment__name">{{ fileName(path) }}</span>
                                <button type="button" class="attachment__remove"
                                        [attr.aria-label]="'Remove ' + fileName(path)"
                                        (click)="removeAttachment(path)">&times;</button>
                            </span>
                        }
                    </div>
                }
                <button type="button" class="cms-btn" (click)="browseAttachments()">
                    <i class="bi bi-paperclip"></i>
                    <span>{{ attachments().length > 0 ? 'Add or remove files…' : 'Attach files…' }}</span>
                </button>
                <p class="note">
                    Sent as real attachments — browse anywhere you have access, including
                    <code>/docs</code>. Each file is read with <em>your</em> permissions when the
                    campaign goes out, so you can only attach what you can already open.
                </p>
            </div>

            <ng-container footer>
                <span class="recipients">
                    {{ recipientCount() }} confirmed recipient{{ recipientCount() === 1 ? '' : 's' }}
                </span>
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-primary"
                        [disabled]="!canSend()" (click)="send()">
                    <i class="bi bi-send"></i>
                    <span>{{ sending() ? 'Sending…' : 'Send campaign' }}</span>
                </button>
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .hint { margin: 0 0 0.85rem; font-size: 0.82rem; color: var(--cms-text-muted, #6b7280); }
        .field { display: flex; flex-direction: column; margin-bottom: 0.85rem; }
        .note { margin: 0.4rem 0 0; font-size: 0.75rem; color: var(--cms-text-muted, #6b7280); }
        .langs { margin: 0 0 0.85rem; font-size: 0.78rem; color: var(--cms-text-muted, #6b7280); }
        app-locale-switcher { display: block; margin-bottom: 0.6rem; }
        .attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 0.5rem; }
        .attachment {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 3px 6px 3px 8px; border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: 6px; font-size: 0.8125rem; max-width: 100%;
        }
        .attachment__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .attachment__remove {
            border: 0; background: transparent; cursor: pointer; line-height: 1;
            font-size: 1rem; color: var(--cms-text-muted, #6b7280); padding: 0 2px;
        }
        .attachment__remove:hover { color: var(--cms-danger, #dc2626); }
        /* The editor sizes to its content; cap it so a long campaign scrolls
           inside the dialog instead of pushing the footer off-screen. */
        .body { display: block; max-height: 22rem; overflow: auto; }
        .recipients {
            margin-right: auto;
            font-size: 0.82rem;
            color: var(--cms-text-muted, #6b7280);
        }
    `],
})
export class NewsletterComposeDialogComponent {
    private readonly api        = inject(NewsletterService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    readonly dialogRef          = inject<DialogRef<boolean>>(DialogRef);

    /**
     * Confirmed-recipient count, passed from the page. Now only the FALLBACK for
     * {@link recipientCount} while the site list loads — the authoritative number
     * is per-list (#1736).
     */
    readonly confirmedCount = inject<number>(DIALOG_DATA, { optional: true }) ?? 0;

    constructor() {
        // Loaded on open rather than injected, because the counts must be current
        // at the moment of sending: a stale number in a "this will email N people"
        // confirmation is the one place being approximately right is not good enough.
        this.api.listSites().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: sites => {
                this.sites.set(sites);
                // Prefer the biggest list as the default target: on a single-site
                // install that is the only list, and on a multi-site one it is the
                // least surprising pre-selection. The picker is hidden entirely
                // when there is nothing to choose between.
                const biggest = [...sites].sort((a, b) => b.confirmedCount - a.confirmedCount)[0];
                if (biggest) this.site.set(biggest.slug);
            },
            // A failed load leaves one implicit target (the default list) and the
            // page's own count — degraded, but composing still works.
            error: () => this.sites.set([]),
        });
    }

    readonly sending = signal(false);

    /**
     * What has been written, per locale (#1743) — the shape the API takes.
     *
     * A locale is absent until something is typed into it, so an admin who only
     * ever writes one language sends exactly one, and the resolver at send time
     * has an honest list of what exists. Empty entries are pruned on the way out
     * ({@link authoredContents}), because a locale present-but-blank would be
     * rejected by the backend and, worse, would advertise a language the
     * campaign cannot actually deliver.
     */
    readonly contents = signal<Record<string, { subject: string; body: string }>>({});

    /**
     * The fallback language, and the one that must be filled in.
     *
     * Same derivation the page editor and media panels use — the tenant's
     * configured default, not the browser's locale: which language a campaign
     * falls back to is a property of the install, not of who is composing.
     */
    readonly defaultLocale = computed(() => {
        const m = this.store.selectSnapshot(AppConfigState.manifest);

        return m?.platformDefaults?.locale ?? m?.supportedLocales?.[0]?.code ?? 'en';
    });

    readonly activeLocale = signal(this.defaultLocale());

    readonly multiLocale = computed(
        () => (this.store.selectSnapshot(AppConfigState.manifest)?.supportedLocales ?? []).length > 1,
    );

    /** Locales with real content — what the campaign will actually go out in. */
    readonly writtenLocales = computed(
        () => Object.keys(this.contents()).filter(loc => this.hasContent(loc)),
    );

    readonly subject = computed(() => this.contents()[this.activeLocale()]?.subject ?? '');
    readonly body    = computed(() => this.contents()[this.activeLocale()]?.body ?? '');

    /** Targetable lists (#1736); a single-site install gets one and no picker. */
    readonly sites = signal<NewsletterSiteDto[]>([]);
    readonly site  = signal('');

    /**
     * VFS paths to attach (#1737).
     *
     * Picked with the generic `<cms-file-picker>` rather than the media picker
     * (#1738): a campaign attachment is usually a PDF or a spreadsheet living in
     * `/docs` or a home folder, and the media picker cannot leave `/media`. No
     * root is passed, so browsing starts at `/` and the server's permission
     * filtering decides what is reachable.
     */
    readonly attachments = signal<string[]>([]);

    /**
     * Recipients for the SELECTED list, not the whole install.
     *
     * Falls back to the count the page passed in until the site list arrives, so
     * the footer is never blank; once loaded it tracks the picker, because
     * "N confirmed recipients" that ignores the target would be a number the
     * admin reasonably reads as a promise.
     */
    readonly recipientCount = computed(() => {
        const selected = this.sites().find(s => s.slug === this.site());

        return selected?.confirmedCount ?? this.confirmedCount;
    });

    setSubject(value: string): void {
        this.patchActive({ subject: value });
    }

    setBody(value: string): void {
        this.patchActive({ body: value });
    }

    private patchActive(patch: Partial<{ subject: string; body: string }>): void {
        const loc = this.activeLocale();
        this.contents.update(all => {
            // A locale is created on first keystroke, so the other half starts
            // empty rather than undefined — `hasContent()` then decides whether
            // the pair is worth sending.
            const existing = all[loc] as { subject: string; body: string } | undefined;

            return {
                ...all,
                [loc]: { subject: existing?.subject ?? '', body: existing?.body ?? '', ...patch },
            };
        });
    }

    /** Does this locale carry a subject AND a body worth sending? */
    hasContent(locale: string): boolean {
        const entry = this.contents()[locale];

        return !!entry && entry.subject.trim() !== '' && this.hasBody(entry.body);
    }

    /**
     * Send is gated on the DEFAULT locale, not on whichever tab is open.
     *
     * The backend rejects a campaign whose default language was never written —
     * it is the fallback every unwritten locale resolves to — so allowing Send
     * after filling only, say, Ukrainian would produce a 422 that reads as a bug.
     */
    canSend(): boolean {
        return this.hasContent(this.defaultLocale()) && !this.sending();
    }

    /**
     * Browse for attachments in a dialog of their own (#1745).
     *
     * Previously the whole VFS tree was inlined here, which pushed the compose
     * form past the viewport and made it resize on every folder expansion. A
     * dismissed picker returns `undefined` and leaves the current selection
     * alone — pressing Escape must not silently drop attachments already chosen.
     */
    browseAttachments(): void {
        this.dialog.open<string[] | undefined>(CmsFilePickerDialogComponent, {
            data: {
                title:        'Attach files',
                multiple:     true,
                value:        this.attachments(),
                confirmLabel: 'Attach',
            } satisfies FilePickerDialogData,
        }).closed.pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(picked => {
            if (undefined === picked) return;
            this.attachments.set(picked);
        });
    }

    removeAttachment(path: string): void {
        this.attachments.update(paths => paths.filter(p => p !== path));
    }

    /** Last path segment — the chip shows a filename, the tooltip the full path. */
    fileName(path: string): string {
        return path.slice(path.lastIndexOf('/') + 1) || path;
    }

    /**
     * A rich editor is never literally empty — an untouched one still reports
     * `<p></p>`, so a `.trim() !== ''` guard (which was enough for the old
     * textarea) would enable Send on a blank campaign. Strip tags and entities
     * and ask whether anything is actually left, treating an embedded image as
     * content in its own right.
     */
    private hasBody(html: string): boolean {
        if (/<img\b/i.test(html)) return true;

        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
    }

    /**
     * Only the locales actually written, trimmed.
     *
     * A half-filled tab (a subject typed, then the admin moved on) is DROPPED
     * rather than sent: the backend would 422 on the blank half, and shipping it
     * would mean advertising a language whose readers get an empty email.
     */
    private authoredContents(): Record<string, { subject: string; body: string }> {
        const out: Record<string, { subject: string; body: string }> = {};
        for (const loc of this.writtenLocales()) {
            const entry = this.contents()[loc];
            out[loc] = { subject: entry.subject.trim(), body: entry.body };
        }

        return out;
    }

    cancel(): void {
        this.dialogRef.close(false);
    }

    send(): void {
        if (!this.canSend()) return;
        const count = this.recipientCount();
        if (count === 0) {
            this.toast.error('There are no confirmed subscribers on that list to send to.');
            return;
        }
        const listName = this.sites().find(s => s.slug === this.site())?.label;
        this.confirmSvc.open({
            title:        'Send campaign',
            message:      `This will email all ${count} confirmed subscriber${count === 1 ? '' : 's'}`
                + (listName ? ` of ${listName}` : '')
                // Naming the languages here is the last chance to notice that a
                // translation was started and never finished — it gets silently
                // dropped, so the confirm step is where that must be visible.
                + (this.multiLocale() ? ` in ${this.writtenLocales().map(l => l.toUpperCase()).join(', ')}` : '')
                + '. This can’t be undone.',
            confirmLabel: 'Send now',
        }).pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => this.dispatch());
    }

    private dispatch(): void {
        this.sending.set(true);
        this.api.sendCampaign(
            this.authoredContents(),
            this.defaultLocale(),
            this.site(),
            this.attachments(),
        ).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: campaign => {
                this.sending.set(false);
                this.toast.success(`Campaign queued to ${campaign.recipientCount} subscriber${campaign.recipientCount === 1 ? '' : 's'}`);
                this.dialogRef.close(true);
            },
            error: () => {
                this.sending.set(false);
                this.toast.error('Failed to send the campaign — please retry');
            },
        });
    }
}
