import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { State, Action, Selector, Store } from '@ngxs/store';
import type { StateContext } from '@ngxs/store';
import { EMPTY } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { ApiService, NaviTreeDto, NaviNodeDto } from '../../api/api.service';
import { ErrorHandlerService, AppConfigState } from '@coolms/core-angular';
import {
    LoadNaviTrees,
    LoadNaviNodes,
    SelectNaviTree,
    CreateNaviTree,
    UpdateNaviTree,
    DeleteNaviTree,
    CreateNaviNode,
    UpdateNaviNode,
    DeleteNaviNode,
    ReorderNaviNodes,
    MoveNaviNode,
} from './navi.actions';

export interface NaviStateModel {
    trees: NaviTreeDto[];
    selectedTreeSlug: string | null;
    nodes: NaviNodeDto[];
    loading: boolean;
    error: string | null;
}

@State<NaviStateModel>({
    name: 'navi',
    defaults: { trees: [], selectedTreeSlug: null, nodes: [], loading: false, error: null },
})
@Injectable()
export class NaviState {
    private readonly api    = inject(ApiService);
    private readonly errors = inject(ErrorHandlerService);
    private readonly http   = inject(HttpClient);
    private readonly store  = inject(Store);

    @Action(LoadNaviTrees)
    loadTrees(ctx: StateContext<NaviStateModel>) {
        ctx.patchState({ loading: true, error: null });
        return this.api.getNaviTrees().pipe(
            tap(trees => ctx.patchState({ trees, loading: false })),
            catchError(err => {
                ctx.patchState({ loading: false, error: this.errors.humanize(err) });
                return EMPTY;
            }),
        );
    }

    @Action(SelectNaviTree)
    selectTree(ctx: StateContext<NaviStateModel>, { slug }: SelectNaviTree) {
        ctx.patchState({ selectedTreeSlug: slug, nodes: [] });
        return ctx.dispatch(new LoadNaviNodes(slug));
    }

    @Action(LoadNaviNodes)
    loadNodes(ctx: StateContext<NaviStateModel>, { treeSlug }: LoadNaviNodes) {
        ctx.patchState({ loading: true, error: null });
        return this.api.getNaviNodes(treeSlug).pipe(
            tap(nodes => ctx.patchState({ nodes, loading: false })),
            catchError(err => {
                ctx.patchState({ loading: false, error: this.errors.humanize(err) });
                return EMPTY;
            }),
        );
    }

    @Action(CreateNaviTree)
    createTree(ctx: StateContext<NaviStateModel>, { payload }: CreateNaviTree) {
        return this.api.createNaviTree(payload).pipe(
            tap(() => ctx.dispatch(new LoadNaviTrees())),
        );
    }

    @Action(UpdateNaviTree)
    updateTree(ctx: StateContext<NaviStateModel>, { slug, payload }: UpdateNaviTree) {
        return this.api.updateNaviTree(slug, payload).pipe(
            tap(() => ctx.dispatch(new LoadNaviTrees())),
        );
    }

    @Action(DeleteNaviTree)
    deleteTree(ctx: StateContext<NaviStateModel>, { slug }: DeleteNaviTree) {
        return this.api.deleteNaviTree(slug).pipe(
            tap(() => ctx.dispatch(new LoadNaviTrees())),
        );
    }

    @Action(CreateNaviNode)
    createNode(ctx: StateContext<NaviStateModel>, { payload }: CreateNaviNode) {
        return this.api.createNaviNode(payload).pipe(
            tap(() => {
                const slug = ctx.getState().selectedTreeSlug;
                if (slug) ctx.dispatch(new LoadNaviNodes(slug));
            }),
        );
    }

    @Action(UpdateNaviNode)
    updateNode(ctx: StateContext<NaviStateModel>, { id, payload }: UpdateNaviNode) {
        return this.api.updateNaviNode(id, payload).pipe(
            tap(() => {
                const slug = ctx.getState().selectedTreeSlug;
                if (slug) ctx.dispatch(new LoadNaviNodes(slug));
            }),
        );
    }

    @Action(DeleteNaviNode)
    deleteNode(ctx: StateContext<NaviStateModel>, { id }: DeleteNaviNode) {
        return this.api.deleteNaviNode(id).pipe(
            tap(() => {
                const slug = ctx.getState().selectedTreeSlug;
                if (slug) ctx.dispatch(new LoadNaviNodes(slug));
            }),
        );
    }

    @Action(ReorderNaviNodes)
    reorderNodes(ctx: StateContext<NaviStateModel>, { items }: ReorderNaviNodes) {
        return this.api.reorderNaviNodes(items).pipe(
            tap(() => {
                const slug = ctx.getState().selectedTreeSlug;
                if (slug) ctx.dispatch(new LoadNaviNodes(slug));
            }),
            catchError(err => {
                ctx.patchState({ error: this.errors.humanize(err) });
                return EMPTY;
            }),
        );
    }

    @Action(MoveNaviNode)
    moveNode(ctx: StateContext<NaviStateModel>, { nodeId, parentId, sortOrder }: MoveNaviNode) {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const url = (manifest?.navi?.nodesMove ?? '').replace('{id}', nodeId);

        return this.http.patch(url, { parentId, sortOrder }, {
            headers: { 'Content-Type': 'application/merge-patch+json' },
        }).pipe(
            tap(() => {
                const slug = ctx.getState().selectedTreeSlug;
                if (slug) ctx.dispatch(new LoadNaviNodes(slug));
            }),
            catchError(err => {
                ctx.patchState({ error: this.errors.humanize(err) });
                return EMPTY;
            }),
        );
    }

    @Selector()
    static trees(state: NaviStateModel): NaviTreeDto[] {
        return state.trees;
    }

    @Selector()
    static nodes(state: NaviStateModel): NaviNodeDto[] {
        return state.nodes;
    }

    @Selector()
    static selectedTreeSlug(state: NaviStateModel): string | null {
        return state.selectedTreeSlug;
    }

    @Selector()
    static loading(state: NaviStateModel): boolean {
        return state.loading;
    }

    @Selector()
    static error(state: NaviStateModel): string | null {
        return state.error;
    }
}
