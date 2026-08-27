import { type CreateNaviTreeDto, type UpdateNaviTreeDto, type CreateNaviNodeDto, type UpdateNaviNodeDto } from '../../api/api.service';

export class LoadNaviTrees {
    static readonly type = '[Navi] Load Trees';
}

export class LoadNaviNodes {
    static readonly type = '[Navi] Load Nodes';
    constructor(public treeSlug: string) {}
}

export class SelectNaviTree {
    static readonly type = '[Navi] Select Tree';
    constructor(public slug: string) {}
}

export class CreateNaviTree {
    static readonly type = '[Navi] Create Tree';
    constructor(public payload: CreateNaviTreeDto) {}
}

export class UpdateNaviTree {
    static readonly type = '[Navi] Update Tree';
    constructor(public slug: string, public payload: UpdateNaviTreeDto) {}
}

export class DeleteNaviTree {
    static readonly type = '[Navi] Delete Tree';
    constructor(public slug: string) {}
}

export class CreateNaviNode {
    static readonly type = '[Navi] Create Node';
    constructor(public payload: CreateNaviNodeDto) {}
}

export class UpdateNaviNode {
    static readonly type = '[Navi] Update Node';
    constructor(public id: string, public payload: UpdateNaviNodeDto) {}
}

export class DeleteNaviNode {
    static readonly type = '[Navi] Delete Node';
    constructor(public id: string) {}
}

export class ReorderNaviNodes {
    static readonly type = '[Navi] Reorder Nodes';
    constructor(public items: Array<{ id: string; sortOrder: number }>) {}
}

export class MoveNaviNode {
    static readonly type = '[Navi] Move Node';
    constructor(
        public nodeId:    string,
        public parentId:  string | null,
        public sortOrder?: number,
    ) {}
}
