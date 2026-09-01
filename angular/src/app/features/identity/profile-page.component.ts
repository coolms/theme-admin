import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
    viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { CalendarPrefs, CmsPageHeaderComponent, DynamicFormComponent, PageTitleService, ToastService, UserAvatarComponent, UserCalendarPreferencesService } from '@coolms/ui-angular';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { Store } from '@ngxs/store';
import { CmsLoaderComponent, PatchCurrentUser, ThemeService } from '@coolms/core-angular';
import { ApiService, IdentityUserDto, ProfileSection } from '../../api/api.service';
import { CallOverlayPrefs, CallOverlayPreferencesService } from '../call/call-overlay-preferences.service';
import { ProfileCalendarTabComponent } from './profile-calendar-tab.component';
import { ProfileCallTabComponent } from './profile-call-tab.component';

/** Marker key the Calendar contributor emits for `formId` — matches
 *  CalendarPreferencesContributor::getFormId() on the backend. The FE
 *  uses it to route the section to the bespoke component instead of
 *  the generic DynamicFormComponent. */
const CALENDAR_FORM_ID = 'calendar:user_preferences';

/** Marker key the Call contributor emits for `formId` — matches
 *  CallSettingsContributor::getFormId() on the backend. Routes the
 *  section to the bespoke ProfileCallTabComponent (incoming-call
 *  overlay on/off + auto-dismiss seconds). */
const CALL_FORM_ID = 'call:user_settings';

type Tab = 'personal' | string;

@Component({
    selector: 'app-profile-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, 
        FormsModule,
        DatePipe,
        CmsPageHeaderComponent,
        DynamicFormComponent,
        UserAvatarComponent,
        ProfileCalendarTabComponent,
        ProfileCallTabComponent,
    ],
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        cms-page-header { margin-bottom: 16px; }

        .profile-body {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
        }

        /* Two-panel card */
        .profile-layout {
            display: flex;
            min-height: 480px;
        }

        /* ── Left sidebar ─────────────────────────────────────────────────────── */
        .profile-sidebar {
            width: 200px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px 16px 24px 16px;
            border-right: 1px solid var(--cms-border);
            gap: 8px;
        }

        .avatar-wrap {
            position: relative;
            width: 80px;
            height: 80px;
            border-radius: 50%;
            overflow: hidden;
            cursor: pointer;
            display: block;
            margin-bottom: 4px;
        }
        .avatar-overlay {
            position: absolute;
            inset: 0;
            background: var(--cms-overlay-scrim);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity .2s;
        }
        .avatar-wrap:hover .avatar-overlay { opacity: 1; }
        .avatar-overlay .bi,
        .avatar-overlay cms-loader { --cms-loader-size: 20px; }

        .avatar-color-picker {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            justify-content: center;
            margin-top: 4px;
        }
        .color-dot {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
            padding: 0;
            outline: none;
            transition: transform .1s, box-shadow .1s;
        }
        .color-dot:hover:not(:disabled) { transform: scale(1.2); }
        .color-dot--active {
            box-shadow: 0 0 0 2px var(--cms-surface), 0 0 0 4px var(--cms-accent);
        }

        .sidebar-name {
            font-size: .875rem;
            font-weight: 600;
            color: var(--cms-text);
            text-align: center;
            word-break: break-word;
        }
        .sidebar-identifier {
            font-size: .75rem;
            color: var(--cms-text-muted);
            text-align: center;
            word-break: break-all;
        }
        .sidebar-since {
            font-size: .75rem;
            color: var(--cms-text-muted);
            text-align: center;
            margin-top: 4px;
        }

        /* ── Right content ────────────────────────────────────────────────────── */
        .profile-content {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
        }

        .profile-tabs {
            display: flex;
            border-bottom: 1px solid var(--cms-border);
            flex-shrink: 0;
        }
        .profile-tab {
            background: none;
            border: none;
            padding: 10px 16px;
            cursor: pointer;
            color: var(--cms-text-muted);
            font-size: .875rem;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .profile-tab--active {
            color: var(--cms-accent);
            border-bottom-color: var(--cms-accent);
        }

        .profile-tab-body {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            flex: 1;
        }

        /* Identifiers */
        .profile-identifiers { display: flex; flex-direction: column; gap: 6px; }
        .profile-identifier-row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: .875rem;
        }
        .profile-identifier-value { flex: 1; }

        /* Footer */
        .profile-footer {
            display: flex;
            justify-content: flex-end;
            padding: 12px 20px;
            border-top: 1px solid var(--cms-border);
            flex-shrink: 0;
        }

        /* Cap input width — personal tab uses cms-input, DynamicForm uses Bootstrap form-control/form-select */
        .profile-tab-body .cms-form-group .cms-input { max-width: 480px; }
        .profile-tab-body ::ng-deep .form-group .form-control,
        .profile-tab-body ::ng-deep .form-group .form-select { max-width: 480px; }

        /* DynamicForm inside tab */
        .profile-tab-body app-dynamic-form { display: block; }
    `],
    template: `
        <cms-page-header icon="person-circle" title="My Profile" />

        <div class="profile-body">
            <div class="profile-layout cms-card">

                <!-- Left sidebar -->
                <aside class="profile-sidebar">
                    <label class="avatar-wrap">
                        <app-user-avatar [user]="user()" size="lg" />
                        <div class="avatar-overlay">
                            @if (avatarBusy()) {
                                <cms-loader [inline]="true" />
                            } @else {
                                <i class="bi bi-camera"></i>
                            }
                        </div>
                        <input type="file" accept="image/*" hidden
                               [disabled]="avatarBusy()"
                               (change)="onAvatarFileSelected($event)" />
                    </label>

                    @if (user()?.avatarUrl && !avatarBusy()) {
                        <button class="cms-btn" (click)="removeAvatar()">
                            <i class="bi bi-trash me-1"></i> Remove
                        </button>
                    }

                    <div class="avatar-color-picker">
                        @for (color of PALETTE; track color) {
                            <button class="color-dot"
                                    [style.background]="color"
                                    [class.color-dot--active]="user()?.avatarColor === color"
                                    [disabled]="colorBusy()"
                                    [title]="color"
                                    (click)="updateColor(color)">
                            </button>
                        }
                    </div>

                    <span class="sidebar-name">{{ displayName() }}</span>
                    <span class="sidebar-identifier">{{ user()?.identifier }}</span>

                    @if (user()?.groups?.[0]?.role) {
                        <span class="cms-badge">{{ user()!.groups[0].role }}</span>
                    }

                    @if (user()?.createdAt) {
                        <span class="sidebar-since">
                            Member since {{ user()!.createdAt | date:'MMM yyyy' }}
                        </span>
                    }
                </aside>

                <!-- Right content -->
                <div class="profile-content">

                    <!-- Tab bar -->
                    <div class="profile-tabs">
                        <button class="profile-tab"
                                [class.profile-tab--active]="activeTab() === 'personal'"
                                (click)="activeTab.set('personal')">
                            <i class="bi bi-person"></i> Personal
                        </button>
                        @for (sec of sections(); track sec.section) {
                            <button class="profile-tab"
                                    [class.profile-tab--active]="activeTab() === sec.section"
                                    (click)="activeTab.set(sec.section)">
                                <i class="bi bi-{{ sec.icon }}"></i> {{ sec.label }}
                            </button>
                        }
                    </div>

                    <!-- Personal tab -->
                    @if (activeTab() === 'personal') {
                        <div class="profile-tab-body">
                            @if (user()?.identifiers?.length) {
                                <div class="cms-form-group">
                                    <label class="cms-label">Identifiers</label>
                                    <div class="profile-identifiers">
                                        @for (id of (user()?.identifiers ?? []); track id.value) {
                                            <div class="profile-identifier-row">
                                                <span class="cms-badge cms-badge--muted">{{ id.type }}</span>
                                                <span class="profile-identifier-value">{{ id.value }}</span>
                                                @if (id.isPrimary) {
                                                    <span class="cms-badge">primary</span>
                                                }
                                                @if (id.isVerified) {
                                                    <i class="bi bi-check-circle-fill text-success" title="Verified"></i>
                                                } @else {
                                                    <i class="bi bi-exclamation-circle text-warning" title="Not verified"></i>
                                                }
                                            </div>
                                        }
                                    </div>
                                </div>
                            }
                            <div class="cms-form-group">
                                <label class="cms-label">First name</label>
                                <input class="cms-input" [(ngModel)]="firstName" placeholder="First name" />
                            </div>
                            <div class="cms-form-group">
                                <label class="cms-label">Last name</label>
                                <input class="cms-input" [(ngModel)]="lastName" placeholder="Last name" />
                            </div>
                        </div>
                        <div class="profile-footer">
                            <button class="cms-btn cms-btn-primary"
                                    [disabled]="savingProfile()"
                                    (click)="saveProfile()">
                                @if (savingProfile()) {
                                    <cms-loader [inline]="true" />
                                }
                                Save changes
                            </button>
                        </div>
                    }

                    <!-- Dynamic settings tabs -->
                    @for (sec of sections(); track sec.section) {
                        @if (activeTab() === sec.section) {
                            @if (sec.formId === CALENDAR_FORM_ID) {
                                <!-- Task #433 (M1.2.f.2) bespoke Calendar tab.
                                     Live previews + radios + async calendar
                                     picker don't fit the DynamicForm field
                                     registry, so we render a dedicated
                                     component but persist through the same
                                     updateSettings endpoint. -->
                                <div class="profile-tab-body">
                                    <app-profile-calendar-tab
                                        #calendarTab
                                        [initial]="(settings()[sec.section] ?? {})"
                                        [saving]="savingCalendar()"
                                        (saved)="saveCalendarPrefs(sec.section, $event)" />
                                </div>
                                <div class="profile-footer">
                                    <button class="cms-btn cms-btn-primary"
                                            [disabled]="savingCalendar()"
                                            (click)="calendarTab.save()">
                                        @if (savingCalendar()) {
                                            <cms-loader [inline]="true" />
                                        }
                                        Save changes
                                    </button>
                                </div>
                            } @else if (sec.formId === CALL_FORM_ID) {
                                <!-- M9.g (Slice A) bespoke "Calls" tab — incoming-call
                                     overlay on/off + auto-dismiss seconds. Persists
                                     through the same updateSettings endpoint and pushes
                                     the merged values into CallOverlayPreferencesService
                                     so the live overlay reacts without a reload. -->
                                <div class="profile-tab-body">
                                    <app-profile-call-tab
                                        #callTab
                                        [initial]="(settings()[sec.section] ?? {})"
                                        [saving]="savingCall()"
                                        (saved)="saveCallSettings(sec.section, $event)" />
                                </div>
                                <div class="profile-footer">
                                    <button class="cms-btn cms-btn-primary"
                                            [disabled]="savingCall()"
                                            (click)="callTab.save()">
                                        @if (savingCall()) {
                                            <cms-loader [inline]="true" />
                                        }
                                        Save changes
                                    </button>
                                </div>
                            } @else {
                                <div class="profile-tab-body">
                                    <app-dynamic-form
                                        [formId]="sec.formId"
                                        [initialValue]="settings()[sec.section] ?? {}"
                                        (submitted)="saveSection(sec.section, $event)" />
                                </div>
                            }
                        }
                    }

                </div>
            </div>
        </div>
    `,
})
export class ProfilePageComponent implements OnInit {
    private readonly api        = inject(ApiService);
    private readonly store      = inject(Store);
    private readonly toast      = inject(ToastService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly calPrefs   = inject(UserCalendarPreferencesService);
    private readonly callPrefs  = inject(CallOverlayPreferencesService);
    private readonly theme      = inject(ThemeService);

    readonly PALETTE = ['#E8834A','#4A90E8','#7B6BE8','#4AC4A0','#E84A6B','#4ACA5A','#E8C44A','#9B59B6'];

    /** Sentinel marker — see {@link CALENDAR_FORM_ID} at the top of this file. */
    readonly CALENDAR_FORM_ID = CALENDAR_FORM_ID;
    /** Sentinel marker — see {@link CALL_FORM_ID} at the top of this file. */
    readonly CALL_FORM_ID = CALL_FORM_ID;

    readonly user           = signal<IdentityUserDto | null>(null);
    readonly sections       = signal<ProfileSection[]>([]);
    readonly settings       = signal<Record<string, Record<string, unknown> | undefined>>({});
    readonly activeTab      = signal<Tab>('personal');
    readonly savingProfile  = signal(false);
    readonly savingCalendar = signal(false);
    readonly savingCall     = signal(false);
    readonly avatarBusy     = signal(false);
    readonly colorBusy      = signal(false);

    private readonly settingsForm = viewChild(DynamicFormComponent);

    firstName = '';
    lastName  = '';

    readonly initials = computed(() => {
        const u = this.user();
        if (!u) return '?';
        const name = u.fullName || u.firstName || u.identifier;
        return name.charAt(0).toUpperCase();
    });

    readonly displayName = computed(() => {
        const u = this.user();
        if (!u) return '';
        return u.fullName || u.firstName || u.identifier;
    });

    ngOnInit(): void {
        this.titleSvc.set('My Profile');

        forkJoin([
            this.api.getMe(),
            this.api.getSettingsSections(),
            this.api.getSettings(),
        ]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: ([user, sections, settings]) => {
                this.user.set(user);
                this.firstName = user.firstName ?? '';
                this.lastName  = user.lastName  ?? '';
                this.sections.set(sections);
                this.settings.set(settings);
                // Task #433 — seed the calendar preferences service from the
                // freshly-loaded /auth/me/settings response so downstream
                // calendar consumers (FullCalendar config, MiniCalendar,
                // topbar QuickAccess) pick up user TZ / first-day / default
                // calendar without each running its own request.
                const cal = settings['calendar'] as Partial<CalendarPrefs> | undefined;
                if (cal) this.calPrefs.update(cal);
                // M9.g — seed the call-overlay prefs so the live screen-pop picks
                // up the user's on/off + auto-dismiss without its own request.
                const call = settings['call'] as Partial<CallOverlayPrefs> | undefined;
                if (call) this.callPrefs.update(call);
            },
            error: () => this.toast.error('Failed to load profile'),
        });
    }

    // ── Personal ──────────────────────────────────────────────────────────────

    saveProfile(): void {
        this.savingProfile.set(true);
        this.api.updateMe({ firstName: this.firstName || null, lastName: this.lastName || null })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: updated => {
                    this.user.set(updated);
                    this.savingProfile.set(false);
                    this.toast.success('Profile saved');
                },
                error: () => {
                    this.savingProfile.set(false);
                    this.toast.error('Failed to save profile');
                },
            });
    }

    // ── Avatar ────────────────────────────────────────────────────────────────

    onAvatarFileSelected(event: Event): void {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        this.avatarBusy.set(true);
        this.api.uploadAvatar(file)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: updated => {
                    this.user.set(updated);
                    this.store.dispatch(new PatchCurrentUser({ avatarUrl: updated.avatarUrl }));
                    this.avatarBusy.set(false);
                    this.toast.success('Avatar updated');
                },
                error: () => {
                    this.avatarBusy.set(false);
                    this.toast.error('Upload failed');
                },
            });
    }

    removeAvatar(): void {
        this.avatarBusy.set(true);
        this.api.deleteAvatar()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.user.update(u => u ? { ...u, avatarUrl: null } : u);
                    this.store.dispatch(new PatchCurrentUser({ avatarUrl: null }));
                    this.avatarBusy.set(false);
                    this.toast.success('Avatar removed');
                },
                error: () => {
                    this.avatarBusy.set(false);
                    this.toast.error('Failed to remove avatar');
                },
            });
    }

    // ── Avatar color ──────────────────────────────────────────────────────────

    updateColor(color: string): void {
        this.colorBusy.set(true);
        this.api.updateAvatarColor(color)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: updated => {
                    this.user.set(updated);
                    this.colorBusy.set(false);
                },
                error: () => {
                    this.colorBusy.set(false);
                    this.toast.error('Failed to update color');
                },
            });
    }

    // ── Dynamic section settings ──────────────────────────────────────────────

    /**
     * Task #433 — submit handler for the bespoke Calendar tab. Mirrors
     * `saveSection` (same PATCH endpoint) but also pushes the merged
     * values into `UserCalendarPreferencesService` so the topbar
     * quick-access, mini-cal, FullCalendar config, event editor, and
     * quick panel all pick the change up immediately (no page reload).
     */
    saveCalendarPrefs(section: string, data: CalendarPrefs): void {
        this.savingCalendar.set(true);
        // The API service strips `null` from PATCH bodies by stringify
        // serialisation — explicit null is fine here, the backend processor
        // accepts it via the array_merge into `extras['settings'][section]`.
        this.api.updateSettings(section, data as unknown as Record<string, unknown>)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: updated => {
                    this.settings.update(s => ({ ...s, [section]: updated }));
                    this.calPrefs.update(updated);
                    this.savingCalendar.set(false);
                    this.toast.success('Calendar preferences saved');
                },
                error: () => {
                    this.savingCalendar.set(false);
                    this.toast.error('Failed to save calendar preferences');
                },
            });
    }

    /**
     * M9.g — submit handler for the bespoke "Calls" tab. Mirrors
     * `saveCalendarPrefs`: PATCHes the section, then pushes the merged
     * values into `CallOverlayPreferencesService` so the live screen-pop
     * overlay reacts immediately (no reload).
     */
    saveCallSettings(section: string, data: CallOverlayPrefs): void {
        this.savingCall.set(true);
        this.api.updateSettings(section, data as unknown as Record<string, unknown>)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: updated => {
                    this.settings.update(s => ({ ...s, [section]: updated }));
                    this.callPrefs.update(updated);
                    this.savingCall.set(false);
                    this.toast.success('Call settings saved');
                },
                error: () => {
                    this.savingCall.set(false);
                    this.toast.error('Failed to save call settings');
                },
            });
    }

    saveSection(section: string, data: Record<string, unknown>): void {
        this.api.updateSettings(section, data)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: updated => {
                    this.settings.update(s => ({ ...s, [section]: updated }));
                    // Re-theme on the spot when the Preferences tab saves,
                    // rather than on the next reload (#2031). Same seeding idea
                    // as the calendar and call tabs above; `update` ignores a
                    // value that is not a known choice, so passing the whole
                    // merged bag's field is safe for every other section.
                    this.theme.update(updated['theme']);
                    this.theme.updateAccent(updated['accentColor']);
                    this.settingsForm()?.resetSaving();
                    this.toast.success('Settings saved');
                },
                error: (e: { error?: { detail?: string } }) => {
                    this.settingsForm()?.setServerError(e?.error?.detail ?? 'Save failed');
                    this.toast.error('Failed to save settings');
                },
            });
    }
}
