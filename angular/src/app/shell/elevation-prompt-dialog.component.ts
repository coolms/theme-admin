import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    signal,
    ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import {
    ELEVATION_WARNING_FACTOR_MISSING, ELEVATION_WARNING_MFA_OFF, ELEVATION_WARNING_PASSWORD_NOT_SET,
    ElevationService, type ElevationPromptRequest, type ElevationState, ErrorHandlerService,
} from '@coolms/core-angular';
import { ModalComponent } from '@coolms/ui-angular';

/**
 * The elevation prompt: elevation is session state, asked for at the 403.
 *
 * Opened by the `ELEVATION_PROMPT` port -- from the interceptor on a refused
 * VFS action, or from a control that a false capability flag disabled -- and
 * closes with `true` once the server has elevated this session.
 *
 * The line for how the LAST elevation ended is rendered FIRST, before the
 * password is asked for: F5 on the sole tab is a close (the beacon), and a
 * person asked for a password again after a reload with no explanation reads
 * it as a fault. The sentence is the ADR's.
 *
 * Nothing here decides anything. The server says whether the installation
 * can elevate yet (`warnings`), whether a code is required (`mfaRequired`,
 * and 428 when it turns out to be), and whether the password was right (403).
 * The dialog renders those answers and asks again.
 */
@Component({
    selector: 'app-elevation-prompt-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ModalComponent],
    template: `
        <app-modal title="Elevate this session">

            <p class="ep-ended">{{ endedLine() }}</p>

            @if (data.refusal; as refusal) {
                <p class="ep-refusal"><i class="bi bi-shield-lock"></i> {{ refusal }}</p>
            }

            @if (blocker(); as blocker) {
                <!-- The installation cannot elevate yet: no admin password, or
                     MFA on with no confirmed factor. The message names the
                     server command; there is nothing to type here. -->
                <div class="cms-alert cms-alert--warning">{{ blocker }}</div>
            } @else {
                <form autocomplete="off">
                    <label class="ep-label" for="ep-password">Admin password</label>
                    <input #passwordEl
                           id="ep-password"
                           type="password"
                           class="cms-input"
                           [class.cms-input--invalid]="error() && !codeStage()"
                           autocomplete="off"
                           name="elevation-password"
                           [(ngModel)]="password"
                           [disabled]="busy()"
                           (keydown.enter)="onEnter($event)" />

                    @if (codeStage()) {
                        <label class="ep-label" for="ep-code">Code from the admin authenticator</label>
                        <input #codeEl
                               id="ep-code"
                               type="text"
                               class="cms-input ep-code"
                               [class.cms-input--invalid]="error() && codeStage()"
                               inputmode="numeric"
                               pattern="[0-9]*"
                               maxlength="6"
                               autocomplete="one-time-code"
                               name="elevation-code"
                               [(ngModel)]="code"
                               [disabled]="busy()"
                               (keydown.enter)="onEnter($event)" />
                    }

                    @if (error(); as err) {
                        <div class="ep-error">{{ err }}</div>
                    }
                </form>

                <p class="ep-note">
                    Elevation lasts {{ lifetimeMinutes() }} minutes from the grant and ends when you
                    close or reload the admin panel. You stay signed in as yourself.
                </p>
                @if (mfaOff(); as note) {
                    <p class="ep-note ep-note--muted">{{ note }}</p>
                }
            }

            <!-- ng-container, not a div: .cms-dialog-footer spaces its children,
                 and a wrapper would make both buttons one child. -->
            <ng-container footer>
                <button type="button" class="cms-btn" (click)="cancel()" [disabled]="busy()">Cancel</button>
                @if (!blocker()) {
                    <button type="button"
                            class="cms-btn cms-btn-primary"
                            (click)="submit()"
                            [disabled]="busy() || !password || (codeStage() && code.length < 6)">
                        @if (busy()) { Elevating... } @else { Elevate }
                    </button>
                }
            </ng-container>
        </app-modal>
    `,
    styles: [`
        .ep-ended         { margin: 0 0 12px; font-size: .9rem; color: var(--cms-text, #111827); }
        .ep-refusal       { margin: 0 0 12px; font-size: .85rem; color: var(--cms-text-secondary, #6b7280); }
        .ep-refusal i     { margin-right: 4px; }
        .ep-label         { display: block; font-size: .8rem; font-weight: 600; color: var(--cms-text); margin: 10px 0 5px; }
        .cms-input        { display: block; width: 100%; }
        .ep-code          { letter-spacing: .3em; font-family: var(--cms-font-mono, monospace); }
        .cms-input--invalid { border-color: var(--cms-danger) !important; }
        .ep-error         { margin-top: 6px; font-size: .8rem; color: var(--cms-danger-text); }
        .ep-note          { margin: 14px 0 0; font-size: .78rem; color: var(--cms-text-secondary, #6b7280); }
        .ep-note--muted   { margin-top: 6px; color: var(--cms-text-muted, #848b96); }
    `],
})
export class ElevationPromptDialogComponent implements AfterViewInit {
    private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
    private readonly elevation = inject(ElevationService);
    private readonly errors    = inject(ErrorHandlerService);
    readonly data = inject<ElevationPromptRequest>(DIALOG_DATA);

    @ViewChild('passwordEl') private readonly passwordEl?: ElementRef<HTMLInputElement>;
    @ViewChild('codeEl')     private readonly codeEl?: ElementRef<HTMLInputElement>;

    password = '';
    code     = '';

    readonly busy  = signal(false);
    readonly error = signal<string | null>(null);

    /**
     * The code field shows from the start when the switch is on, and appears
     * after a 428 when the server turns out to want one.
     */
    readonly codeStage = signal(this.data.state.mfaRequired);

    readonly lifetimeMinutes = computed(() => Math.max(1, Math.round(this.data.state.lifetimeSeconds / 60)));

    /** The ADR's sentence for how the last elevation ended, rendered first. */
    readonly endedLine = computed(() => endedSentence(this.data.state));

    /** A warning that means the installation cannot elevate yet, or null. */
    readonly blocker = computed<string | null>(() =>
        this.data.state.warnings.find(w =>
            w.code === ELEVATION_WARNING_PASSWORD_NOT_SET || w.code === ELEVATION_WARNING_FACTOR_MISSING,
        )?.message ?? null,
    );

    /** The recommendation carried while the MFA switch is off, or null. */
    readonly mfaOff = computed<string | null>(() =>
        this.data.state.warnings.find(w => w.code === ELEVATION_WARNING_MFA_OFF)?.message ?? null,
    );

    ngAfterViewInit(): void {
        // CDK focuses the first tabbable (the modal X); the password is what
        // the person came to type.
        setTimeout(() => this.passwordEl?.nativeElement.focus());
    }

    submit(): void {
        if (this.busy() || !this.password) return;
        if (this.codeStage() && this.code.length < 6) return;

        this.busy.set(true);
        this.error.set(null);

        this.elevation.elevate(this.password, this.codeStage() ? this.code : undefined).subscribe({
            next: () => this.dialogRef.close(true),
            error: (err: unknown) => {
                this.busy.set(false);
                this.error.set(this.explain(err));
                if (err instanceof HttpErrorResponse && err.status === 428) {
                    this.codeStage.set(true);
                    setTimeout(() => this.codeEl?.nativeElement.focus());
                }
            },
        });
    }

    cancel(): void {
        this.dialogRef.close(false);
    }

    /** Enter submits from either field; the form has no submit button of its own. */
    onEnter(event: Event): void {
        event.preventDefault();
        this.submit();
    }

    /**
     * The status codes the endpoint documents, in the person's words. 428 is
     * not an error: the password was right and a code is now asked for.
     */
    private explain(err: unknown): string {
        if (!(err instanceof HttpErrorResponse)) return this.errors.humanize(err);

        switch (err.status) {
            case 403: return this.codeStage()
                ? 'Wrong password, or a wrong or already used code.'
                : 'Wrong password.';
            case 428: return 'The password is right. Enter the code from the admin authenticator as well.';
            case 429: return 'Too many attempts. Wait a few minutes and try again.';
            case 409: return this.errors.humanize(err);  // names the server command
            default:  return this.errors.humanize(err);
        }
    }
}

/**
 * First, the way the last elevation ended, before the password is asked
 * for. The `closed` sentence is the design's own; the others follow its shape.
 */
export function endedSentence(state: ElevationState): string {
    const at = state.ended.at !== null && state.ended.at !== '' ? ` at ${clock(state.ended.at)}` : '';
    const again = 'Enter the admin password to elevate again.';

    switch (state.ended.reason) {
        case 'closed':
            return `Your elevated session ended when the admin panel was closed or reloaded${at}. ${again}`;
        case 'expired':
            return `Your elevated session expired${at}. ${again}`;
        case 'dropped_by_user':
            return `You ended your elevated session${at}. ${again}`;
        case 'refresh_from_other_pair':
            return `Your elevated session was ended${at} because the sign-in continued from another address or browser. ${again}`;
        case 'never':
        default:
            return 'This action needs an elevated session. Enter the admin password to elevate.';
    }
}

/** 14:32 in the person's locale; the ADR's sentence carries a clock time, not a date. */
function clock(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
