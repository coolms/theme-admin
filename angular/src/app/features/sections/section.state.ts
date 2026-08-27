import { inject, Injectable } from '@angular/core';
import { State, Action, Selector } from '@ngxs/store';
import type { StateContext } from '@ngxs/store';
import { EMPTY } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { ApiService, SectionApplyResultDto, SiteSectionDto } from '../../api/api.service';
import { ErrorHandlerService, UserPreferencesService } from '@coolms/core-angular';
import {
    ApplyNginxChanges,
    CreateSection,
    DeleteSection,
    LoadSections,
    SetCurrentSection,
    UpdateSection,
} from './section.actions';

export interface SectionStateModel {
    sections: SiteSectionDto[];
    /** null = no override; backend uses host-based resolution. */
    currentSectionSlug: string | null;
    loading: boolean;
    error: string | null;
    /** H9 — last result of `ApplyNginxChanges`. null until first apply. */
    lastApplyResult: SectionApplyResultDto | null;
}

@State<SectionStateModel>({
    name: 'sections',
    defaults: {
        sections: [],
        currentSectionSlug: null,
        loading: false,
        error: null,
        lastApplyResult: null,
    },
})
@Injectable()
export class SectionState {
    private readonly prefs = inject(UserPreferencesService);

    private readonly api    = inject(ApiService);
    private readonly errors = inject(ErrorHandlerService);

    @Action(LoadSections)
    load(ctx: StateContext<SectionStateModel>) {
        ctx.patchState({ loading: true, error: null });
        return this.api.getSections().pipe(
            tap(sections => {
                // Rehydrate currentSectionSlug from persisted preferences when
                // the list first lands. Prevents an unknown slug (stale prefs)
                // from sticking around: if the saved slug is not in the loaded
                // list we silently clear it.
                const saved  = this.prefs.getPageState<{ currentSlug?: string | null }>('section');
                const wanted = saved?.currentSlug ?? null;
                const valid  = null !== wanted && sections.some(s => s.slug === wanted)
                    ? wanted
                    : null;
                ctx.patchState({ sections, loading: false, currentSectionSlug: valid });
            }),
            catchError(err => {
                ctx.patchState({ loading: false, error: this.errors.humanize(err) });
                return EMPTY;
            }),
        );
    }

    @Action(SetCurrentSection)
    setCurrent(ctx: StateContext<SectionStateModel>, { slug }: SetCurrentSection): void {
        ctx.patchState({ currentSectionSlug: slug });
        this.prefs.setPageState('section', { currentSlug: slug });
    }

    @Action(CreateSection)
    create(ctx: StateContext<SectionStateModel>, { payload }: CreateSection) {
        return this.api.createSection(payload).pipe(
            tap(() => ctx.dispatch(new LoadSections())),
        );
    }

    @Action(UpdateSection)
    update(ctx: StateContext<SectionStateModel>, { id, payload }: UpdateSection) {
        return this.api.updateSection(id, payload).pipe(
            tap(() => ctx.dispatch(new LoadSections())),
        );
    }

    @Action(DeleteSection)
    delete(ctx: StateContext<SectionStateModel>, { id }: DeleteSection) {
        return this.api.deleteSection(id).pipe(
            tap(() => ctx.dispatch(new LoadSections())),
        );
    }

    /**
     * H9 — invoke the nginx vhost generator. Refreshes the sections list
     * after the apply succeeds so the UI reflects any state the apply
     * touched. Errors propagate to the caller's `.subscribe({ error })`
     * handler so the toast can show a humanised message.
     */
    @Action(ApplyNginxChanges)
    apply(ctx: StateContext<SectionStateModel>) {
        return this.api.applySections().pipe(
            tap(result => {
                ctx.patchState({ lastApplyResult: result });
                ctx.dispatch(new LoadSections());
            }),
        );
    }

    @Selector()
    static sections(state: SectionStateModel): SiteSectionDto[] {
        return state.sections;
    }

    /**
     * Alias kept for spec readability. Same value as `sections`.
     */
    @Selector()
    static availableSections(state: SectionStateModel): SiteSectionDto[] {
        return state.sections;
    }

    @Selector()
    static currentSectionSlug(state: SectionStateModel): string | null {
        return state.currentSectionSlug;
    }

    @Selector()
    static currentSection(state: SectionStateModel): SiteSectionDto | null {
        if (null === state.currentSectionSlug) return null;
        return state.sections.find(s => s.slug === state.currentSectionSlug) ?? null;
    }

    @Selector()
    static loading(state: SectionStateModel): boolean {
        return state.loading;
    }

    @Selector()
    static error(state: SectionStateModel): string | null {
        return state.error;
    }

    @Selector()
    static lastApplyResult(state: SectionStateModel): SectionApplyResultDto | null {
        return state.lastApplyResult;
    }
}
