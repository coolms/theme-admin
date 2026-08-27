import { Injectable, inject } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { catchError, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { ApiService, NodeDto } from '../../api/api.service';
import { ChmodNode, ChownNode, ClearVfsNode, LoadNode } from './vfs.actions';

export interface VfsStateModel {
    node:    NodeDto | null;
    loading: boolean;
    saving:  boolean;
    error:   string | null;
}

@State<VfsStateModel>({
    name: 'vfs',
    defaults: { node: null, loading: false, saving: false, error: null },
})
@Injectable()
export class VfsState {
    private readonly api = inject(ApiService);

    @Action(LoadNode)
    loadNode(ctx: StateContext<VfsStateModel>, action: LoadNode) {
        ctx.patchState({ loading: true, error: null });
        return this.api.statNode(action.path).pipe(
            tap(node => ctx.patchState({ node, loading: false })),
            catchError(err => {
                const msg = err?.error?.detail ?? err?.error?.['hydra:description'] ?? 'Failed to load node.';
                ctx.patchState({ loading: false, error: msg });
                return of(null);
            }),
        );
    }

    @Action(ChmodNode)
    chmodNode(ctx: StateContext<VfsStateModel>, action: ChmodNode) {
        ctx.patchState({ saving: true, error: null });
        return this.api.chmodNode({ path: action.path, mode: action.mode }).pipe(
            tap(node => ctx.patchState({ node, saving: false })),
            catchError(err => {
                const msg = err?.error?.detail ?? err?.error?.['hydra:description'] ?? 'Failed to change permissions.';
                ctx.patchState({ saving: false, error: msg });
                return of(null);
            }),
        );
    }

    @Action(ChownNode)
    chownNode(ctx: StateContext<VfsStateModel>, action: ChownNode) {
        ctx.patchState({ saving: true, error: null });
        return this.api.chownNode({ path: action.path, uid: action.uid, gid: action.gid }).pipe(
            tap(node => ctx.patchState({ node, saving: false })),
            catchError(err => {
                const msg = err?.error?.detail ?? err?.error?.['hydra:description'] ?? 'Failed to change ownership.';
                ctx.patchState({ saving: false, error: msg });
                return of(null);
            }),
        );
    }

    @Action(ClearVfsNode)
    clearNode(ctx: StateContext<VfsStateModel>) {
        ctx.setState({ node: null, loading: false, saving: false, error: null });
    }

    @Selector() static node(state: VfsStateModel): NodeDto | null { return state.node; }
    @Selector() static loading(state: VfsStateModel): boolean { return state.loading; }
    @Selector() static saving(state: VfsStateModel): boolean { return state.saving; }
    @Selector() static error(state: VfsStateModel): string | null { return state.error; }
}
