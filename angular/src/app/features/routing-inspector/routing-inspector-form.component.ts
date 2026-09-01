import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoutingInspectorStateService } from './routing-inspector-state.service';
import { PageActionsService, PageTitleService } from '@coolms/ui-angular';

/**
 * Routing Inspector form slot (`RoutingInspectorForm`).
 *
 * Owns the (host, path) form, the Inspect submit button, and the error
 * banner. Reads/writes state through `RoutingInspectorStateService`.
 *
 * This slot is the "head" of the page: it triggers state hydration
 * from query params on init, and registers the layout's `reload` header
 * action so the cms-page-header's Reload button fires `runInspect()`
 * through the same state instance.
 */
@Component({
    selector: 'coolms-routing-inspector-form',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <form class="inspector-form" (ngSubmit)="onSubmit()">
            <div class="inspector-form__field">
                <label for="rinsp-host">Host</label>
                <input id="rinsp-host" name="host" type="text"
                       [ngModel]="state.hostInput()"
                       (ngModelChange)="state.hostInput.set($event)"
                       placeholder="localhost"
                       autocomplete="off" spellcheck="false" />
            </div>
            <div class="inspector-form__field inspector-form__field--grow">
                <label for="rinsp-path">Path</label>
                <input id="rinsp-path" name="path" type="text"
                       [ngModel]="state.pathInput()"
                       (ngModelChange)="state.pathInput.set($event)"
                       placeholder="/"
                       autocomplete="off" spellcheck="false" />
            </div>
            <div class="inspector-form__submit">
                <button type="submit" class="cms-btn cms-btn-primary"
                        [disabled]="state.loading()">
                    @if (state.loading()) {
                        <i class="bi bi-arrow-clockwise spin"></i> Inspecting…
                    } @else {
                        <i class="bi bi-search"></i> Inspect
                    }
                </button>
            </div>
        </form>

        @if (state.error(); as e) {
            <div class="banner banner--error" role="alert">
                <i class="bi bi-exclamation-triangle"></i>
                {{ e }}
            </div>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; gap: 12px; }

        .inspector-form {
            display: flex;
            gap: 12px;
            align-items: flex-end;
            padding: 12px 16px;
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-md, 8px);
            background: var(--cms-surface, #fff);
            flex-wrap: wrap;
        }
        .inspector-form__field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 180px;
        }
        .inspector-form__field--grow { flex: 1; min-width: 240px; }
        .inspector-form__field label {
            font-size: .75rem;
            color: var(--cms-text-muted, #848b96);
            text-transform: uppercase;
            letter-spacing: .03em;
        }
        .inspector-form__field input {
            padding: 6px 10px;
            border: 1px solid var(--cms-border, #e5e7eb);
            border-radius: var(--cms-radius-sm, 4px);
            font-size: .9rem;
            font-family: var(--cms-font-mono, monospace);
        }
        .inspector-form__field input:focus {
            outline: 2px solid var(--cms-accent, #F5A623);
            outline-offset: -1px;
            border-color: transparent;
        }
        .inspector-form__submit { display: flex; align-items: center; }

        .banner {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: var(--cms-radius, 6px);
        }
        .banner--error { background: var(--cms-danger-light); border: 1px solid var(--cms-danger-border); color: var(--cms-danger-text); }


        .spin {
            animation: spin 1s linear infinite;
            display: inline-block;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
        }
    `],
})
export class RoutingInspectorFormComponent implements OnInit {
    readonly state       = inject(RoutingInspectorStateService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly pageActions = inject(PageActionsService, { optional: true });

    ngOnInit(): void {
        this.titleSvc.set('Routing Inspector');
        this.state.hydrateAndRun();

        // Wire the layout's `reload` header action through to the state
        // service so Reload re-runs the inspection with the current
        // (host, path). The YAML declares the button's id/icon/title;
        // we just contribute the click handler -- setHandlers leaves
        // the YAML-declared action set alone.
        this.pageActions?.setHandlers({
            reload: () => this.state.runInspect(),
        });
    }

    onSubmit(): void {
        this.state.runInspect();
    }
}
