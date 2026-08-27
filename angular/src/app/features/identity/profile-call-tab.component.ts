import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    OnInit,
    Output,
    inject,
    input,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CallOverlayPrefs } from '../call/call-overlay-preferences.service';
import { WebPhoneService } from '../call/web-phone.service';

/**
 * M9.g (Slice A) — bespoke "Calls" tab inside My Profile.
 *
 * Controls the global incoming-call screen-pop overlay: whether it shows
 * at all, and how long a settled (answered/ended) card lingers before it
 * auto-closes. Submits via `(saved)` to the parent (`ProfilePageComponent`),
 * which PATCHes `/auth/me/settings/call` and pushes the merged values into
 * `CallOverlayPreferencesService` so the live overlay reacts immediately.
 *
 * A checkbox + a gated numeric field don't warrant the DynamicForm
 * pipeline, so — like the Calendar tab — this is a dedicated component
 * behind the `call:user_settings` sentinel formId.
 */
@Component({
    selector: 'app-profile-call-tab',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    styles: [`
        :host { display: block; }
        .group { display: flex; flex-direction: column; gap: 6px; max-width: 480px; }
        .group + .group { margin-top: 18px; }
        .group-label { font-size: .85rem; font-weight: 600; color: var(--cms-text, #111827); }
        .group-help { font-size: .75rem; color: var(--cms-text-muted, #6b7280); margin: 0; }

        .switch-row { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: .875rem; }
        .switch-row input[type="checkbox"] { width: 16px; height: 16px; margin: 0; cursor: pointer; }

        .seconds-row { display: flex; align-items: center; gap: 8px; }
        .seconds-row input[type="number"] { width: 96px; }
        .seconds-row input[disabled] { opacity: .55; }
        .seconds-unit { font-size: .8rem; color: var(--cms-text-secondary, #6b7280); }

        .group input[type="text"].form-control { max-width: 260px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

        .phone-card {
            margin-top: 20px;
            padding: 12px 14px;
            border: 1px dashed var(--cms-border, #d1d5db);
            border-radius: 8px;
            color: var(--cms-text-muted, #6b7280);
            font-size: .8rem;
            background: var(--cms-bg-subtle, #f9fafb);
            max-width: 480px;
        }
        .phone-card strong { color: var(--cms-text, #111827); }
        /* Registered is the only state that is a solid fact rather than an absence. */
        .phone-card--ready {
            border-style: solid;
            border-color: var(--cms-success-border, #a7f3d0);
            background: var(--cms-success-bg, #ecfdf5);
        }
    `],
    template: `
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
    `,
})
export class ProfileCallTabComponent implements OnInit {
    /**
     * The softphone's LIVE registration state (M9.g C.3-infra). Read, never
     * driven: the shell boots the service from the screen-pop overlay, so this
     * panel only reports what is actually true. It replaced a hardcoded "coming
     * soon" notice that outlived the feature it described — the softphone had
     * shipped, and the card went on saying it hadn't.
     */
    protected readonly webphone = inject(WebPhoneService);

    /** Initial values for the form. Provided by the parent. */
    initial = input<Partial<CallOverlayPrefs>>({});

    /** Whether the parent is currently persisting the form (disables submit). */
    saving = input<boolean>(false);

    /** Emitted when the user clicks Save changes (parent owns the network call). */
    @Output() saved = new EventEmitter<CallOverlayPrefs>();

    // ngModel-bound fields. ngOnInit seeds them from `initial`.
    overlayEnabled = true;
    autoDismissSeconds = 8;
    sipEndpoint = '';

    ngOnInit(): void {
        const init = this.initial();
        this.overlayEnabled = typeof init.overlayEnabled === 'boolean' ? init.overlayEnabled : true;
        this.autoDismissSeconds = typeof init.autoDismissSeconds === 'number' && Number.isFinite(init.autoDismissSeconds)
            ? init.autoDismissSeconds
            : 8;
        this.sipEndpoint = typeof init.sipEndpoint === 'string' ? init.sipEndpoint : '';
    }

    save(): void {
        // Clamp defensively — the backend + prefs service also validate.
        const seconds = Number.isFinite(this.autoDismissSeconds)
            ? Math.min(600, Math.max(0, Math.floor(this.autoDismissSeconds)))
            : 8;
        this.saved.emit({
            overlayEnabled:     this.overlayEnabled,
            autoDismissSeconds: seconds,
            sipEndpoint:        this.sipEndpoint.trim(),
        });
    }
}
