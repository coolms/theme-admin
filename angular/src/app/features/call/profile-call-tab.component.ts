import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    DestroyRef,
    OnInit,
    inject,
    input,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CmsLoaderComponent } from '@coolms/core-angular';
import { ToastService } from '@coolms/ui-angular';

import { CallOverlayPrefs, CallOverlayPreferencesService } from './call-overlay-preferences.service';
import { WebPhoneService } from './web-phone.service';

/**
 * The "Calls" pane of My Profile -- Call's guest in Identity's `profile.tab`
 * slot (registered as `profile.tab:call` in app.config.ts).
 *
 * Controls the global incoming-call screen-pop overlay: whether it shows
 * at all, how long a settled (answered/ended) card lingers before it
 * auto-closes, and the user's own device for click-to-dial.
 *
 * The slot hands the pane one thing, the settings `section` it edits; the
 * pane owns the rest. It asks the server for the section when it opens
 * (through {@link CallOverlayPreferencesService}, which also feeds the live
 * overlay, so opening the pane re-syncs the overlay as a side effect), and
 * it saves through the same service, so the overlay reacts to a save without
 * a reload. Identity's page neither reads nor writes call settings: it places
 * the pane and knows nothing else about it.
 *
 * The pane renders the whole tab area below the tab bar -- body and footer --
 * because the host cannot reach into a slot to press a Save button for it.
 * `.tab-body` and `.tab-footer` mirror the page's own tab panes so the Calls
 * tab looks like its neighbours.
 */
@Component({
    selector: 'app-profile-call-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, CmsLoaderComponent],
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; }
        .tab-body { padding: 20px; flex: 1; }
        .tab-footer {
            display: flex;
            justify-content: flex-end;
            padding: 12px 20px;
            border-top: 1px solid var(--cms-border);
            flex-shrink: 0;
        }

        .group { display: flex; flex-direction: column; gap: 6px; max-width: 480px; }
        .group + .group { margin-top: 18px; }
        .group-label { font-size: .85rem; font-weight: 600; color: var(--cms-text, #111827); }
        .group-help { font-size: .75rem; color: var(--cms-text-muted, #848b96); margin: 0; }

        .switch-row { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: .875rem; }
        .switch-row input[type="checkbox"] { width: 16px; height: 16px; margin: 0; cursor: pointer; }

        .seconds-row { display: flex; align-items: center; gap: 8px; }
        .seconds-row input[type="number"] { width: 96px; }
        .seconds-row input[disabled] { opacity: .55; }
        .seconds-unit { font-size: .8rem; color: var(--cms-text-secondary, #6b7280); }

        .group input[type="text"].form-control { max-width: 260px; font-family: var(--cms-font-mono, monospace); }

        .phone-card {
            margin-top: 20px;
            padding: 12px 14px;
            border: 1px dashed var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            color: var(--cms-text-muted, #848b96);
            font-size: .8rem;
            background: var(--cms-surface-muted, #f3f4f6);
            max-width: 480px;
        }
        .phone-card strong { color: var(--cms-text, #111827); }
        /* Registered is the only state that is a solid fact rather than an absence. */
        .phone-card--ready {
            border-style: solid;
            border-color: var(--cms-success-subtle-border, #86efac);
            background: var(--cms-success-light, #f0fdf4);
        }
    `],
    template: `
        <div class="tab-body">
            <div class="group">
                <span class="group-label">Incoming-call popup</span>
                <label class="switch-row">
                    <input type="checkbox" [(ngModel)]="overlayEnabled" />
                    Show a popup when a call comes in
                </label>
                <p class="group-help">
                    A small card appears in the corner as calls ring, connect, and end —
                    so you can keep working without switching to the Live calls page.
                </p>
            </div>

            <div class="group">
                <label class="group-label" for="call-dismiss">Auto-dismiss after</label>
                <div class="seconds-row">
                    <input id="call-dismiss" type="number" class="form-control"
                           min="0" max="600" step="1"
                           [disabled]="!overlayEnabled"
                           [(ngModel)]="autoDismissSeconds" />
                    <span class="seconds-unit">seconds</span>
                </div>
                <p class="group-help">
                    How long a card stays after the call is answered or ends.
                    Set to <strong>0</strong> to keep cards until you close them.
                </p>
            </div>

            <div class="group">
                <label class="group-label" for="call-endpoint">Your device (for dialling)</label>
                <input id="call-endpoint" type="text" class="form-control"
                       placeholder="PJSIP/1001" [(ngModel)]="sipEndpoint" />
                <p class="group-help">
                    The channel rung first when you place a call from CoolMS — e.g.
                    <strong>PJSIP/1001</strong> or <strong>SIP/1001</strong> (ask your admin
                    if unsure). This device rings, you pick up, then it dials the number.
                    Leave blank if you don't dial from here.
                </p>
            </div>

            <div class="phone-card" [class.phone-card--ready]="webphone.status() === 'registered'">
                @switch (webphone.status()) {
                    @case ('registered') {
                        <strong>Softphone ready.</strong> You can answer calls in this tab —
                        incoming calls show an Answer button and the audio runs through your headset.
                    }
                    @case ('connecting') {
                        <strong>Softphone connecting…</strong> Registering this browser with the phone system.
                    }
                    @case ('failed') {
                        <strong>Softphone unavailable.</strong> This browser couldn't register with the
                        phone system. Calls still ring your device above; ask your admin to check the
                        WebRTC settings.
                    }
                    @default {
                        <strong>Answering in this browser isn't set up.</strong> You'll still see incoming
                        calls and can dial from here — your device above rings. Ask your admin to
                        provision a softphone credential to answer in the tab.
                    }
                }
            </div>
        </div>
        <div class="tab-footer">
            <button class="cms-btn cms-btn-primary"
                    [disabled]="saving()"
                    (click)="save()">
                @if (saving()) {
                    <cms-loader [inline]="true" />
                }
                Save changes
            </button>
        </div>
    `,
})
export class ProfileCallTabComponent implements OnInit {
    /**
     * The softphone's LIVE registration state. Read, never
     * driven: the shell boots the service from the screen-pop overlay, so this
     * panel only reports what is actually true. It replaced a hardcoded "coming
     * soon" notice that outlived the feature it described -- the softphone had
     * shipped, and the card went on saying it hadn't.
     */
    protected readonly webphone = inject(WebPhoneService);

    private readonly prefs      = inject(CallOverlayPreferencesService);
    private readonly toast      = inject(ToastService);
    private readonly cdr        = inject(ChangeDetectorRef);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * The settings section this pane edits, from the slot: the profile page
     * passes the section name the server listed, and the save PATCHes
     * `/auth/me/settings/<section>` with it.
     */
    readonly section = input<string>('call');

    /** True while a save is in flight (disables the button). */
    readonly saving = signal(false);

    // ngModel-bound fields. Seeded from the server when the pane opens.
    overlayEnabled = true;
    autoDismissSeconds = 8;
    sipEndpoint = '';

    ngOnInit(): void {
        // Ask the server, not the cache: a value this pane never saw is a
        // value the next Save clears, so the form must start from what is
        // actually stored -- also after a change made in another browser tab.
        this.prefs.refresh()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(stored => {
                this.seed(stored);
                this.cdr.markForCheck();
            });
    }

    save(): void {
        // Clamp defensively -- the backend + prefs service also validate.
        const seconds = Number.isFinite(this.autoDismissSeconds)
            ? Math.min(600, Math.max(0, Math.floor(this.autoDismissSeconds)))
            : 8;
        const data: CallOverlayPrefs = {
            overlayEnabled:     this.overlayEnabled,
            autoDismissSeconds: seconds,
            sipEndpoint:        this.sipEndpoint.trim(),
        };

        this.saving.set(true);
        this.prefs.save(this.section(), data)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: stored => {
                    this.seed(stored);
                    this.saving.set(false);
                    this.toast.success('Call settings saved');
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.saving.set(false);
                    this.toast.error('Failed to save call settings');
                    this.cdr.markForCheck();
                },
            });
    }

    private seed(stored: CallOverlayPrefs): void {
        this.overlayEnabled     = stored.overlayEnabled;
        this.autoDismissSeconds = stored.autoDismissSeconds;
        this.sipEndpoint        = stored.sipEndpoint;
    }
}
