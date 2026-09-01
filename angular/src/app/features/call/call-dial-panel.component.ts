import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CmsLoaderComponent } from '@coolms/core-angular';
import { DrawerService, ToastService } from '@coolms/ui-angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { ApiService } from '../../api/api.service';
import { CallOverlayPreferencesService } from './call-overlay-preferences.service';

/**
 * M9.g Slice B — the dial pad, opened in the right drawer by the topbar
 * `CallDialQuickAccessComponent`. Type or tap a number, hit Call, and the
 * backend rings YOUR device (the `sipEndpoint` from Profile -> Calls) then
 * bridges it out to the number — click-to-dial over the existing
 * `POST /call/originate` (M9.e.2). The resulting call soon pops on the
 * incoming-call overlay + lands in Call history.
 *
 * This is NOT a softphone: the audio is on your phone, not the browser. The
 * in-browser Answer/talk experience is a later slice (WebRTC-SIP).
 */
@Component({
    selector: 'app-call-dial-panel',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, FormsModule],
    template: `
        <div class="dial">
            @if (sipEndpoint().trim() === '') {
                <div class="dial__warn">
                    <i class="bi bi-info-circle"></i>
                    Set <strong>your device</strong> in
                    <button type="button" class="dial__link" (click)="goToSettings()">Profile → Calls</button>
                    before you can dial.
                </div>
            }

            <input class="dial__display" type="text" inputmode="tel"
                   placeholder="Enter a number"
                   [ngModel]="number()" (ngModelChange)="onInput($event)"
                   aria-label="Number to dial" />

            <div class="dial__pad">
                @for (k of keys; track k) {
                    <button type="button" class="dial__key" (click)="press(k)">{{ k }}</button>
                }
            </div>

            <div class="dial__row">
                <button type="button" class="dial__aux" title="Backspace" aria-label="Backspace"
                        [disabled]="number() === ''" (click)="backspace()">
                    <i class="bi bi-backspace"></i>
                </button>
                <button type="button" class="dial__call"
                        [disabled]="number().trim() === '' || sipEndpoint().trim() === '' || calling()"
                        (click)="call()">
                    @if (calling()) {
                        <cms-loader [inline]="true" /> Calling…
                    } @else {
                        <i class="bi bi-telephone-outbound-fill me-1"></i> Call
                    }
                </button>
                <button type="button" class="dial__aux" title="Clear" aria-label="Clear"
                        [disabled]="number() === ''" (click)="clear()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <p class="dial__hint">
                Your device rings first; pick up and it dials the number. Audio is on your phone.
            </p>
        </div>
    `,
    styles: [`
        .dial { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px; }

        .dial__warn {
            display: flex; align-items: flex-start; gap: 8px;
            padding: 10px 12px; border-radius: var(--cms-radius-md, 8px);
            background: var(--cms-warning-light); color: var(--cms-warning-text);
            font-size: .8rem; line-height: 1.45;
        }
        .dial__link {
            border: none; background: none; padding: 0;
            color: inherit; font: inherit; font-weight: 600; text-decoration: underline; cursor: pointer;
        }

        .dial__display {
            width: 100%; text-align: center;
            font-size: 1.5rem; font-variant-numeric: tabular-nums; letter-spacing: .04em;
            padding: 10px 12px;
            border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-lg, 10px);
            background: var(--cms-surface, #fff); color: var(--cms-text, #111827);
        }

        .dial__pad {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
        }
        .dial__key {
            height: 52px;
            border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-lg, 10px);
            background: var(--cms-surface, #fff); color: var(--cms-text, #111827);
            font-size: 1.2rem; font-weight: 500; cursor: pointer;
            transition: background .1s ease, transform .06s ease;
        }
        .dial__key:hover { background: var(--cms-surface-muted, #f3f4f6); }
        .dial__key:active { transform: scale(.96); }

        .dial__row { display: flex; align-items: center; gap: 10px; }
        .dial__aux {
            flex: 0 0 auto; width: 46px; height: 46px;
            display: flex; align-items: center; justify-content: center;
            border: 1px solid var(--cms-border, #e5e7eb); border-radius: var(--cms-radius-lg, 10px);
            background: var(--cms-surface, #fff); color: var(--cms-text-secondary, #6b7280);
            cursor: pointer;
        }
        .dial__aux:disabled { opacity: .4; cursor: default; }
        .dial__call {
            flex: 1 1 auto; height: 46px;
            display: inline-flex; align-items: center; justify-content: center;
            border: none; border-radius: var(--cms-radius-lg, 10px);
            background: var(--cms-success); color: var(--cms-text-inverse); font-size: .95rem; font-weight: 600; cursor: pointer;
            transition: filter .12s ease;
        }
        .dial__call:hover:not(:disabled) { filter: brightness(1.06); }
        .dial__call:disabled { opacity: .5; cursor: default; }

        .dial__hint { margin: 0; font-size: .75rem; color: var(--cms-text-muted, #848b96); text-align: center; }
    `],
})
export class CallDialPanelComponent implements OnInit {
    private readonly api        = inject(ApiService);
    private readonly prefs      = inject(CallOverlayPreferencesService);
    private readonly toast      = inject(ToastService);
    private readonly drawer     = inject(DrawerService);
    private readonly router     = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly number      = signal('');
    readonly calling     = signal(false);
    /** The user's own device, read from their Calls settings. */
    readonly sipEndpoint = this.prefs.sipEndpoint;
    readonly keys        = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

    ngOnInit(): void {
        this.prefs.ensureLoaded().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }

    press(k: string): void {
        this.number.update(n => (n + k).slice(0, 32));
    }

    backspace(): void {
        this.number.update(n => n.slice(0, -1));
    }

    clear(): void {
        this.number.set('');
    }

    /** Keep the typed/pasted value to dialable characters. */
    onInput(v: string): void {
        this.number.set(v.replace(/[^0-9*#+]/g, '').slice(0, 32));
    }

    goToSettings(): void {
        this.drawer.close();
        void this.router.navigate(['/profile']);
    }

    call(): void {
        const num = this.number().trim();
        const endpoint = this.sipEndpoint().trim();
        if ('' === num || '' === endpoint) {
            return;
        }
        this.calling.set(true);
        this.api.originateCall({ endpoint, extension: num }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                this.calling.set(false);
                this.toast.success(`Calling ${num} — your phone will ring.`);
                this.drawer.close();
            },
            error: (e: { status?: number; error?: { detail?: string } }) => {
                this.calling.set(false);
                this.toast.error(this.errorText(e));
            },
        });
    }

    private errorText(e: { status?: number; error?: { detail?: string } }): string {
        if (502 === e?.status) return 'Telephony is unavailable right now. Try again shortly.';
        if (403 === e?.status) return 'You don’t have permission to place calls.';
        return e?.error?.detail ?? 'Could not place the call.';
    }
}
