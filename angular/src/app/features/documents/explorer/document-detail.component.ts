import { CommonModule, NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ComponentRegistry } from '@coolms/core-angular';
import { CmsRightPanelComponent } from '@coolms/ui-angular';
import { DocumentPageStateService } from './document-page-state.service';
import { InstanceDetailComponent } from './instance-detail.component';

/**
 * F.14c-1 + Phase A.1b — right-panel detail dispatcher.
 *
 * Branches by the page's right-panel mode:
 *
 *   `properties` + template selected → dispatch via `ComponentRegistry`
 *     keyed by `'document-detail-{format}'` (`WordDetailComponent` for
 *     Word; future formats register their own under the same scheme).
 *
 *   `instances` + instance selected → mount `InstanceDetailComponent`
 *     directly. Instance metadata is uniform across formats, so no
 *     per-format split is needed today; if a future format wants
 *     instance-detail extensions it can wrap or replace this branch.
 *
 * The page coordinator gates the right panel on `pageContext.activeItem`
 * — we only render content here when ExplorerLayout has already
 * decided the panel is visible.
 */
@Component({
    selector: 'cms-document-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, NgComponentOutlet, InstanceDetailComponent, CmsRightPanelComponent],
    template: `
        <cms-right-panel [node]="panelNode()" (closed)="onClose()">
            @if (mode() === 'instances') {
                @if (instance(); as i) {
                    <cms-instance-detail [instance]="i" />
                } @else {
                    <div class="cms-document-detail__empty">
                        <p>Select an instance to see its details.</p>
                    </div>
                }
            } @else {
                @if (template(); as t) {
                    @if (detailComponent(); as cmp) {
                        <ng-container *ngComponentOutlet="cmp; inputs: detailInputs()" />
                    } @else {
                        <div class="cms-document-detail__no-handler">
                            <p>
                                No detail UI registered for format
                                <code>{{ t.format }}</code>.
                            </p>
                            <p class="cms-document-detail__no-handler-hint">
                                Register a format module in <code>app.config.ts</code> via
                                <code>ComponentRegistry.register('document-detail-{{ t.format }}', …)</code>.
                            </p>
                        </div>
                    }
                } @else {
                    <div class="cms-document-detail__empty">
                        <p>Select a template to see its details.</p>
                    </div>
                }
            }
        </cms-right-panel>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }
        .cms-document-detail__empty,
        .cms-document-detail__no-handler {
            padding: 2rem;
            text-align: center;
            color: var(--cms-text-muted);
            overflow: auto;
        }
        .cms-document-detail__no-handler code {
            background: var(--cms-border-light);
            padding: 1px 4px;
            border-radius: var(--cms-radius-sm);
        }
        .cms-document-detail__no-handler-hint {
            font-size: 0.85rem;
            margin-top: 0.5rem;
        }
    `],
})
export class DocumentDetailComponent {
    private readonly state = inject(DocumentPageStateService);
    private readonly registry = inject(ComponentRegistry);

    protected readonly mode = this.state.rightPanelMode;
    protected readonly template = this.state.selectedTemplate;
    protected readonly instance = this.state.selectedInstance;
    protected readonly panelNode = this.state.panelNode;

    protected onClose(): void {
        // Phase D hotfix #4: panel header close X is one of four panel
        // close affordances (close X, mode-properties toggle, ESC,
        // background click). Selection is left untouched — closing the
        // panel doesn't deselect the entity.
        this.state.setPropertiesPanelOpen(false);
    }

    protected readonly detailComponent = computed(() => {
        const tpl = this.template();
        if (!tpl) {
            return null;
        }
        return this.registry.get(`document-detail-${tpl.format}`);
    });

    protected readonly detailInputs = computed(() => ({
        template: this.template(),
    }));
}
